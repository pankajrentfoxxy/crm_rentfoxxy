/**
 * Early return before lock-in ends (claude/carret-lockin-warranty.md, L2–L4).
 *
 *   Support raises  → pending_sales
 *   Sales proposes  → pending_accounts   (full remaining rent / negotiated / waive)
 *   Accounts decide → approved | rejected
 *   pickup created  → used
 *
 * A return pickup for a laptop still in lock-in is refused unless the laptop
 * has an approved request. Approval with an amount puts one "Lock-in break"
 * charge on customer_invoice_extra_lines, billed on the next invoice through
 * Money → Support charges to bill.
 */
const pool = require('../config/db');
const { toDateStr, daysUntil, warrantyStatus, lockInActive } = require('./lockInWarrantyService');

const LOCK_IN_HSN = '997314'; // SAC: leasing / rental of computers
const LOCK_IN_GST = 18;
const OPEN = ['pending_sales', 'pending_accounts', 'approved'];

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, statusCode: status, ...extra });
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Remaining lock-in rent: days left × monthly rate / 30. */
function fullAmount(monthlyRate, remainingDays) {
  return round2((Number(monthlyRate || 0) * Number(remainingDays || 0)) / 30);
}

async function loadSerials(client, serialIds) {
  const ids = [...new Set((serialIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT serial_id, inventory_status, current_customer_id, rent_monthly_rate,
            COALESCE(inventory_asset_code, extra->>'ttspl_id', serial_number) AS asset_code,
            lock_in_start_date, lock_in_end_date, warranty_start_date, warranty_end_date, battery_warranty_end_date
       FROM vendor_serial_numbers WHERE serial_id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

async function openRequestsBySerial(client, serialIds) {
  if (!serialIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT * FROM lock_in_break_requests
      WHERE serial_id = ANY($1::int[]) AND status = ANY($2::text[])`,
    [serialIds, OPEN]
  );
  return new Map(rows.map((r) => [Number(r.serial_id), r]));
}

/**
 * Adds lock-in / warranty facts to the support asset list (rows carry `id` =
 * serial_id and `asset_bucket` = inventory_status).
 */
async function decorateAssets(client, assets) {
  const list = assets || [];
  const serials = await loadSerials(client || pool, list.map((a) => a.id));
  const byId = new Map(serials.map((s) => [Number(s.serial_id), s]));
  const reqs = await openRequestsBySerial(client || pool, serials.map((s) => Number(s.serial_id)));
  for (const a of list) {
    const s = byId.get(Number(a.id)) || {};
    const row = { ...s, inventory_status: a.asset_bucket || s.inventory_status };
    a.deal = row.inventory_status === 'sold' ? 'sale' : (row.inventory_status === 'on_demo' ? 'demo' : 'rental');
    a.lock_in_start_date = toDateStr(s.lock_in_start_date);
    a.lock_in_end_date = toDateStr(s.lock_in_end_date);
    a.lock_in_active = lockInActive(row);
    a.lock_in_days_left = a.lock_in_active ? daysUntil(s.lock_in_end_date) : 0;
    a.monthly_rate = s.rent_monthly_rate != null ? Number(s.rent_monthly_rate) : null;
    a.warranty_start_date = toDateStr(s.warranty_start_date);
    a.warranty_end_date = toDateStr(s.warranty_end_date);
    a.battery_warranty_end_date = toDateStr(s.battery_warranty_end_date);
    a.warranty_status = warrantyStatus(row);
    const r = reqs.get(Number(a.id));
    a.early_return = r ? { id: r.id, status: r.status, approved_amount: r.approved_amount } : null;
  }
  return list;
}

/**
 * Refuses a RETURN pickup for laptops still in lock-in without an approved
 * early-return request. Replacement swaps and repair pickups do not call this.
 * Returns the approved requests it relied on (to mark used).
 */
async function assertReturnAllowed(client, serialIds) {
  const serials = await loadSerials(client, serialIds);
  const locked = serials.filter((s) => lockInActive(s));
  if (!locked.length) return [];
  const reqs = await openRequestsBySerial(client, locked.map((s) => Number(s.serial_id)));
  const blocked = locked.filter((s) => reqs.get(Number(s.serial_id))?.status !== 'approved');
  if (blocked.length) {
    const names = blocked.map((s) => `${s.asset_code} (lock-in till ${toDateStr(s.lock_in_end_date)}, ${daysUntil(s.lock_in_end_date)} days left)`);
    throw fail(
      `Lock-in is not complete for ${names.join(', ')}. Raise an early-return request — Sales and Accounts must approve it before the return pickup.`,
      409,
      {
        code: 'LOCK_IN_ACTIVE',
        laptops: blocked.map((s) => ({
          serial_id: s.serial_id,
          asset_code: s.asset_code,
          lock_in_end_date: toDateStr(s.lock_in_end_date),
          days_left: daysUntil(s.lock_in_end_date),
          early_return: reqs.get(Number(s.serial_id)) ? { id: reqs.get(Number(s.serial_id)).id, status: reqs.get(Number(s.serial_id)).status } : null,
        })),
      }
    );
  }
  return locked.map((s) => reqs.get(Number(s.serial_id)));
}

/**
 * A return pickup's laptops (codes as the pickup form sends them) → the laptops
 * whose lock-in must be checked. The old laptop of a live replacement is not a
 * return: the replacement carries its lock-in (L1), so it is left out.
 */
async function serialIdsForReturn(client, customerId, codes) {
  const list = [...new Set((codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return [];
  const { rows } = await client.query(
    `SELECT v.serial_id
       FROM vendor_serial_numbers v
      WHERE v.deleted_at IS NULL
        AND ($1::int IS NULL OR v.current_customer_id = $1)
        AND (UPPER(COALESCE(v.inventory_asset_code, '')) = ANY($2::text[])
             OR UPPER(COALESCE(v.extra->>'ttspl_id', '')) = ANY($2::text[])
             OR UPPER(COALESCE(v.serial_number, '')) = ANY($2::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM support_replacement_orders ro
           WHERE ro.old_serial_id = v.serial_id AND ro.status <> 'cancelled'
        )`,
    [customerId || null, list]
  );
  return rows.map((r) => Number(r.serial_id));
}

async function markUsed(client, requests, dcNumber = null) {
  const ids = (requests || []).filter(Boolean).map((r) => r.id);
  if (!ids.length) return;
  await client.query(
    `UPDATE lock_in_break_requests SET status = 'used', used_at = NOW(), used_on_dc_number = $2, updated_at = NOW()
      WHERE id = ANY($1::int[]) AND status = 'approved'`,
    [ids, dcNumber]
  );
}

/** Support: raise a request for one laptop. */
async function createRequest(client, {
  serialId, ticketId = null, supportRequestId = null, plannedReturnDate = null, reason, user,
}) {
  const [s] = await loadSerials(client, [serialId]);
  if (!s) throw fail('Laptop not found', 404);
  if (!lockInActive(s)) throw fail(`${s.asset_code} is not in lock-in — a normal return pickup can be created.`, 409);
  if (!String(reason || '').trim() || String(reason).trim().length < 3) throw fail('Say why the customer wants to return early');
  const planned = toDateStr(plannedReturnDate || new Date());
  if (planned < toDateStr(new Date())) throw fail('Planned return date cannot be in the past');
  const end = toDateStr(s.lock_in_end_date);
  if (planned >= end) throw fail(`Lock-in ends on ${end}; a return on or after that day needs no approval.`);
  const days = daysUntil(end, planned);
  const rate = Number(s.rent_monthly_rate || 0);
  // Checked first so a caller's transaction is not aborted by the unique index.
  const open = (await openRequestsBySerial(client, [Number(s.serial_id)])).get(Number(s.serial_id));
  if (open) throw fail(`${s.asset_code} already has an open early-return request (#${open.id}, ${open.status.replace('_', ' ')})`, 409);
  try {
    const { rows } = await client.query(
      `INSERT INTO lock_in_break_requests
         (serial_id, customer_id, support_ticket_id, support_request_id, asset_code, lock_in_end_date,
          planned_return_date, remaining_days, monthly_rate, full_amount, reason, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [s.serial_id, s.current_customer_id, ticketId, supportRequestId, s.asset_code, end, planned, days, rate,
        fullAmount(rate, days), String(reason).trim(), user?.user_id || null]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') throw fail(`${s.asset_code} already has an open early-return request`, 409);
    throw e;
  }
}

async function loadForUpdate(client, id) {
  const r = (await client.query('SELECT * FROM lock_in_break_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!r) throw fail('Early-return request not found', 404);
  return r;
}

/** Sales: full / negotiated amount / waive. */
async function propose(client, id, { proposal, amount, note, user }) {
  const r = await loadForUpdate(client, id);
  if (!['pending_sales', 'pending_accounts'].includes(r.status)) throw fail(`This request is ${r.status.replace('_', ' ')}`, 409);
  if (!['full', 'negotiated', 'waive'].includes(proposal)) throw fail('Choose full, negotiated or waive');
  let proposed = Number(r.full_amount);
  if (proposal === 'waive') proposed = 0;
  if (proposal === 'negotiated') {
    proposed = round2(amount);
    if (!(proposed >= 0)) throw fail('Enter the negotiated amount');
    if (proposed > Number(r.full_amount)) throw fail(`Negotiated amount cannot exceed the full remaining rent (Rs ${r.full_amount})`);
  }
  if (proposal !== 'full' && String(note || '').trim().length < 3) throw fail('Add a note on what was agreed with the customer');
  const { rows } = await client.query(
    `UPDATE lock_in_break_requests
        SET proposal = $2, proposed_amount = $3, sales_note = $4, proposed_by = $5, proposed_at = NOW(),
            status = 'pending_accounts', updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, proposal, proposed, String(note || '').trim() || null, user?.user_id || null]
  );
  return rows[0];
}

/** Accounts: approve (with Sales' amount) or reject. */
async function decide(client, id, { approve, note, user }) {
  const r = await loadForUpdate(client, id);
  if (r.status !== 'pending_accounts') throw fail(r.status === 'pending_sales' ? 'Sales has not proposed an amount yet' : `This request is ${r.status.replace('_', ' ')}`, 409);
  if (!approve) {
    if (String(note || '').trim().length < 3) throw fail('Say why it is rejected');
    const { rows } = await client.query(
      `UPDATE lock_in_break_requests SET status = 'rejected', accounts_note = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, String(note).trim(), user?.user_id || null]
    );
    return rows[0];
  }
  const amount = round2(r.proposed_amount);
  let chargeLineId = null;
  if (amount > 0) {
    const description = `Lock-in break: ${r.asset_code} returned before lock-in end ${toDateStr(r.lock_in_end_date)} `
      + `(${r.remaining_days} days${r.proposal === 'negotiated' ? ', negotiated' : ''})`;
    const ins = await client.query(
      `INSERT INTO customer_invoice_extra_lines
         (customer_id, charge_type, description, amount, status, billing_mode, serial_id,
          unit_price, quantity, gst_rate, hsn_code, accounts_note, raised_at, raised_by, created_at, updated_at)
       VALUES ($1, 'lock_in_break', $2, $3, 'APPROVED', 'MONTHLY', $4, $3, 1, $5, $6, $7, NOW(), $8, NOW(), NOW())
       RETURNING extra_line_id`,
      [r.customer_id, description, amount, r.serial_id, LOCK_IN_GST, LOCK_IN_HSN, String(note || '').trim() || null, user?.user_id || null]
    );
    chargeLineId = ins.rows[0].extra_line_id;
  }
  const { rows } = await client.query(
    `UPDATE lock_in_break_requests
        SET status = 'approved', approved_amount = $2, accounts_note = $3, decided_by = $4, decided_at = NOW(),
            charge_line_id = $5, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, amount, String(note || '').trim() || null, user?.user_id || null, chargeLineId]
  );
  return rows[0];
}

/** Withdraw an open request (customer keeps the laptop). An approved charge not yet billed is waived. */
async function cancel(client, id, { note, user }) {
  const r = await loadForUpdate(client, id);
  if (!OPEN.includes(r.status)) throw fail(`This request is ${r.status.replace('_', ' ')}`, 409);
  if (r.charge_line_id) {
    const line = (await client.query('SELECT status FROM customer_invoice_extra_lines WHERE extra_line_id = $1', [r.charge_line_id])).rows[0];
    if (line?.status === 'BILLED') throw fail('The lock-in charge is already on an invoice — raise a credit note instead', 409);
    await client.query(
      `UPDATE customer_invoice_extra_lines SET status = 'WAIVED', waived_reason = 'Early return withdrawn', updated_at = NOW()
        WHERE extra_line_id = $1`,
      [r.charge_line_id]
    );
  }
  const { rows } = await client.query(
    `UPDATE lock_in_break_requests
        SET status = 'cancelled', accounts_note = COALESCE(accounts_note, $2), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, String(note || '').trim() || `Withdrawn by user ${user?.user_id || ''}`.trim()]
  );
  return rows[0];
}

async function list({ status = null, customerId = null } = {}) {
  const params = [];
  const where = [];
  if (status === 'open') {
    params.push(OPEN); where.push(`r.status = ANY($${params.length}::text[])`);
  } else if (status) {
    params.push(String(status)); where.push(`r.status = $${params.length}`);
  }
  if (customerId) { params.push(Number(customerId)); where.push(`r.customer_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT r.*, COALESCE(c.company_name, c.name) AS customer_name,
            ru.name AS requested_by_name, pu.name AS proposed_by_name, du.name AS decided_by_name,
            NULLIF(TRIM(CONCAT(COALESCE(v.extra->>'brand', ''), ' ', COALESCE(v.extra->>'model', v.extra->>'model_name', ''))), '') AS model_name
       FROM lock_in_break_requests r
       LEFT JOIN customers c ON c.customer_id = r.customer_id
       LEFT JOIN vendor_serial_numbers v ON v.serial_id = r.serial_id
       LEFT JOIN users ru ON ru.user_id = r.requested_by
       LEFT JOIN users pu ON pu.user_id = r.proposed_by
       LEFT JOIN users du ON du.user_id = r.decided_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE r.status WHEN 'pending_sales' THEN 0 WHEN 'pending_accounts' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
               r.created_at DESC
      LIMIT 300`,
    params
  );
  return rows;
}

module.exports = {
  LOCK_IN_HSN,
  fullAmount,
  decorateAssets,
  assertReturnAllowed,
  serialIdsForReturn,
  markUsed,
  createRequest,
  propose,
  decide,
  cancel,
  list,
};
