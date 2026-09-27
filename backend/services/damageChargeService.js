/**
 * Damage charges on customer laptops (claude/carret-customers-returns-control.md, DM1).
 *
 *   reported  — technician (visit / pickup) or warehouse (receive): part + issue + photos
 *   priced    — warehouse sets each line's price
 *   proposed  — sales / accounts agree it with the customer; the customer is emailed
 *   approved | waived | rejected — accounts
 *   billed    — next month's invoice ("Damage charges"), or a service order for a
 *               sold laptop (no monthly invoice)
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const mailTransport = require('./mailTransport');

const DAMAGE_HSN = '847330';
const GST_RATE = 18;
const PHOTO_ROOT = path.join(__dirname, '..', 'private-uploads', 'damage-cases');

const fail = (message, status = 400) => Object.assign(new Error(message), { status, statusCode: status });
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function listCatalog() {
  const { rows } = await pool.query(
    `SELECT damage_id, code, name, charge_amount FROM support_damage_catalog WHERE active IS TRUE ORDER BY name`
  );
  return rows.map((r) => ({ ...r, charge_amount: Number(r.charge_amount || 0) }));
}

/** Only files this module stored may be referenced (no path tricks). */
function assertOwnPhoto(p) {
  const full = path.resolve(path.join(__dirname, '..'), String(p || ''));
  if (!full.startsWith(PHOTO_ROOT + path.sep) || !fs.existsSync(full)) throw fail(`Photo not found: ${p}`);
  return full;
}

async function resolveLaptop(client, { serialId, assetCode }) {
  const r = await client.query(
    `SELECT serial_id, inventory_status, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id', serial_number) AS asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (($1::int IS NOT NULL AND serial_id = $1)
          OR ($2::text IS NOT NULL AND (UPPER(COALESCE(inventory_asset_code, '')) = UPPER($2) OR UPPER(serial_number) = UPPER($2))))
      LIMIT 1`,
    [serialId || null, assetCode || null]
  );
  return r.rows[0] || null;
}

async function createCase(client, {
  source, serialId = null, assetCode = null, customerId = null, ticketId = null, ticketItemId = null,
  returnDcNumber = null, notes = null, lines = [], user,
}) {
  if (!['technician_visit', 'repair_pickup', 'return_pickup', 'warehouse_receive'].includes(source)) throw fail('Say where the damage was found');
  const lap = await resolveLaptop(client, { serialId, assetCode });
  if (!lap) throw fail('Laptop not found');
  let cust = customerId ? Number(customerId) : null;
  if (!cust && ticketId) cust = (await client.query('SELECT customer_id FROM support_tickets WHERE id = $1', [ticketId])).rows[0]?.customer_id || null;
  if (!cust && returnDcNumber) {
    cust = (await client.query(
      `SELECT customer_id FROM delivery_challan_lines WHERE dc_number = $1 AND movement_type = 'return' LIMIT 1`, [returnDcNumber]
    )).rows[0]?.customer_id || null;
  }
  if (!cust) cust = lap.current_customer_id;
  if (!cust) throw fail('Which customer had this laptop? Raise it from the ticket or the return challan.');
  const clean = (lines || []).map((l) => ({
    part_id: l.part_id ? Number(l.part_id) : null,
    part_name: String(l.part_name || '').trim() || null,
    damage_id: l.damage_id ? Number(l.damage_id) : null,
    issue: String(l.issue || '').trim(),
    photos: Array.isArray(l.photos) ? l.photos : [],
    quantity: Math.max(1, parseInt(l.quantity, 10) || 1),
  }));
  if (!clean.length) throw fail('Add at least one damaged or missing part');
  for (const l of clean) {
    if (l.issue.length < 3) throw fail('Describe the issue for each part');
    if (!l.part_id && !l.part_name) throw fail('Choose the part for each line');
    if (!l.photos.length) throw fail('Add a photo for each part');
    l.photos.forEach(assertOwnPhoto);
  }
  const { rows } = await client.query(
    `INSERT INTO damage_cases (customer_id, serial_id, asset_code, source, support_ticket_id, support_ticket_item_id,
                               return_dc_number, notes, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [cust, lap.serial_id, lap.asset_code, source, ticketId || null, ticketItemId || null, returnDcNumber || null,
      String(notes || '').trim() || null, user?.user_id || null]
  );
  const c = rows[0];
  for (const l of clean) {
    let partName = l.part_name;
    if (l.part_id && !partName) partName = (await client.query('SELECT part_name FROM parts WHERE part_id = $1', [l.part_id])).rows[0]?.part_name || null;
    await client.query(
      `INSERT INTO damage_case_lines (case_id, part_id, part_name, damage_id, issue, photos, quantity)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [c.id, l.part_id, partName, l.damage_id, l.issue, JSON.stringify(l.photos), l.quantity]
    );
  }
  return c;
}

async function loadForUpdate(client, id) {
  const c = (await client.query('SELECT * FROM damage_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!c) throw fail('Damage case not found', 404);
  return c;
}

/** Warehouse: a price on every line. */
async function price(client, id, { lines = [], user }) {
  const c = await loadForUpdate(client, id);
  if (!['reported', 'priced'].includes(c.status)) throw fail(`This case is ${c.status} — it can no longer be re-priced`, 409);
  const own = (await client.query('SELECT id FROM damage_case_lines WHERE case_id = $1', [id])).rows.map((r) => r.id);
  const given = new Map((lines || []).map((l) => [Number(l.id), l.price]));
  for (const lineId of own) {
    const p = Number(given.get(lineId));
    if (!Number.isFinite(p) || p < 0) throw fail('Enter a price (0 or more) for every part');
    await client.query('UPDATE damage_case_lines SET price = $2 WHERE id = $1', [lineId, round2(p)]);
  }
  const { rows } = await client.query(
    `UPDATE damage_cases SET status = 'priced', priced_by = $2, priced_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, user?.user_id || null]
  );
  return rows[0];
}

async function totalOf(client, id) {
  const r = await client.query('SELECT COALESCE(SUM(price * quantity), 0) AS t FROM damage_case_lines WHERE case_id = $1', [id]);
  return round2(r.rows[0].t);
}

function emailHtml(c, cust, lines, total, note) {
  const rows = lines.map((l) => `<tr><td style="padding:4px 8px;border:1px solid #ddd">${l.part_name || ''}</td><td style="padding:4px 8px;border:1px solid #ddd">${l.issue}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${l.quantity}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">Rs ${Number(l.price || 0).toLocaleString('en-IN')}</td></tr>`).join('');
  return `<p>Dear ${cust.company_name || cust.name || 'Customer'},</p>
<p>During ${({ technician_visit: 'our technician\'s visit', repair_pickup: 'the repair pickup', return_pickup: 'the return pickup', warehouse_receive: 'the inspection on receipt at our warehouse' })[c.source]} of laptop <b>${c.asset_code}</b> we found the following damage. Photos are attached.</p>
<table style="border-collapse:collapse"><tr><th style="padding:4px 8px;border:1px solid #ddd">Part</th><th style="padding:4px 8px;border:1px solid #ddd">Issue</th><th style="padding:4px 8px;border:1px solid #ddd">Qty</th><th style="padding:4px 8px;border:1px solid #ddd">Charge</th></tr>${rows}
<tr><td colspan="3" style="padding:4px 8px;border:1px solid #ddd;text-align:right"><b>Total (plus ${GST_RATE}% GST)</b></td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right"><b>Rs ${total.toLocaleString('en-IN')}</b></td></tr></table>
${note ? `<p>${String(note).replace(/</g, '&lt;')}</p>` : ''}
<p>These charges will be added to your next invoice as "Damage charges". Please reply to this email if you have any questions.</p>
<p>Regards,<br/>Rentfoxxy</p>`;
}

/** Sales / Accounts: the customer has been told; email them the details. */
async function propose(client, id, { note = null, emailTo = null, sendEmail = true, user }) {
  const c = await loadForUpdate(client, id);
  if (!['priced', 'proposed'].includes(c.status)) throw fail(c.status === 'reported' ? 'The warehouse has not priced it yet' : `This case is ${c.status}`, 409);
  const lines = (await client.query('SELECT * FROM damage_case_lines WHERE case_id = $1 ORDER BY id', [id])).rows;
  const total = await totalOf(client, id);
  const cust = (await client.query('SELECT name, company_name, email FROM customers WHERE customer_id = $1', [c.customer_id])).rows[0] || {};
  const to = String(emailTo || cust.email || '').trim();
  let sentAt = null;
  let emailError = null;
  if (sendEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw fail('Enter the customer\'s email address');
    try {
      const transporter = mailTransport.getTransport('default');
      const from = mailTransport.getFromAddress('default');
      if (!transporter || !from) throw new Error('Email is not configured');
      const attachments = lines.flatMap((l) => (l.photos || []).map((p, i) => ({ filename: `${c.asset_code}-${l.id}-${i + 1}${path.extname(p) || '.jpg'}`, path: assertOwnPhoto(p) })));
      await transporter.sendMail({
        from, to, subject: `Damage charges — laptop ${c.asset_code}`, html: emailHtml(c, cust, lines, total, note), attachments,
      });
      sentAt = new Date();
    } catch (e) {
      // Outbound mail is off on QA (outboundMessagingGuard): record it, do not block the case.
      emailError = e.message;
    }
  }
  const { rows } = await client.query(
    `UPDATE damage_cases
        SET status = 'proposed', proposed_by = $2, proposed_at = NOW(), proposal_note = $3,
            email_to = $4, email_sent_at = COALESCE($5, email_sent_at), email_error = $6, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, user?.user_id || null, String(note || '').trim() || null, to || null, sentAt, emailError]
  );
  return { ...rows[0], total };
}

/** Accounts: approve (optionally a lower agreed amount), waive or reject. */
async function decide(client, id, { decision, amount = null, note = null, user }) {
  const c = await loadForUpdate(client, id);
  if (c.status !== 'proposed') throw fail(['reported', 'priced'].includes(c.status) ? 'Sales / Accounts have not proposed it to the customer yet' : `This case is ${c.status}`, 409);
  const why = String(note || '').trim();
  if (!['approve', 'waive', 'reject'].includes(decision)) throw fail('Approve, waive or reject');
  if (decision !== 'approve' && why.length < 3) throw fail('Say why');
  const total = await totalOf(client, id);
  let approved = null;
  let chargeLineId = null;
  let serviceChargeId = null;
  if (decision === 'approve') {
    approved = amount === null || amount === '' || amount === undefined ? total : round2(amount);
    if (!(approved >= 0) || approved > total) throw fail(`Amount must be between 0 and the priced total (Rs ${total})`);
    if (approved < total && why.length < 3) throw fail('Say why the amount is lower than priced');
    if (approved > 0) {
      const lap = (await client.query('SELECT inventory_status FROM vendor_serial_numbers WHERE serial_id = $1', [c.serial_id])).rows[0];
      const description = `Damage charges: ${c.asset_code} (case #${c.id})`;
      if (lap?.inventory_status === 'sold') {
        // A sold laptop's customer has no monthly invoice: bill it on a service order (W2).
        const r = await client.query(
          `INSERT INTO support_service_charges (ticket_id, serial_id, customer_id, charge_kind, description, quantity, unit_price,
                                               gst_rate, hsn_code, status, added_by, decided_by, decided_at)
           VALUES ($1,$2,$3,'part',$4,1,$5,$6,$7,'approved',$8,$8,NOW()) RETURNING id`,
          [c.support_ticket_id || 0, c.serial_id, c.customer_id, description, approved, GST_RATE, DAMAGE_HSN, user?.user_id || null]
        );
        serviceChargeId = r.rows[0].id;
      } else {
        const r = await client.query(
          `INSERT INTO customer_invoice_extra_lines
             (customer_id, charge_type, description, amount, status, billing_mode, serial_id,
              unit_price, quantity, gst_rate, hsn_code, accounts_note, raised_at, raised_by, created_at, updated_at)
           VALUES ($1, 'damage', $2, $3, 'APPROVED', 'MONTHLY', $4, $3, 1, $5, $6, $7, NOW(), $8, NOW(), NOW())
           RETURNING extra_line_id`,
          [c.customer_id, description, approved, c.serial_id, GST_RATE, DAMAGE_HSN, why || null, user?.user_id || null]
        );
        chargeLineId = r.rows[0].extra_line_id;
      }
    }
  }
  const status = { approve: 'approved', waive: 'waived', reject: 'rejected' }[decision];
  const { rows } = await client.query(
    `UPDATE damage_cases
        SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4, approved_amount = $5,
            charge_line_id = $6, service_charge_id = $7, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, status, user?.user_id || null, why || null, approved, chargeLineId, serviceChargeId]
  );
  return rows[0];
}

async function cancel(client, id, { note, user }) {
  const c = await loadForUpdate(client, id);
  if (!['reported', 'priced'].includes(c.status)) throw fail(`This case is ${c.status} — ask Accounts to waive it instead`, 409);
  const { rows } = await client.query(
    `UPDATE damage_cases SET status = 'cancelled', decided_by = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, user?.user_id || null, String(note || '').trim() || 'Cancelled']
  );
  return rows[0];
}

const SELECT_CASES = `
  SELECT dc.*, COALESCE(c.company_name, c.name) AS customer_name, c.email AS customer_email,
         ru.name AS reported_by_name, pu.name AS priced_by_name, su.name AS proposed_by_name, du.name AS decided_by_name,
         (SELECT COALESCE(SUM(l.price * l.quantity), 0) FROM damage_case_lines l WHERE l.case_id = dc.id) AS total,
         (SELECT COUNT(*)::int FROM damage_case_lines l WHERE l.case_id = dc.id) AS line_count,
         (SELECT json_agg(json_build_object('id', l.id, 'part_id', l.part_id, 'part_name', l.part_name, 'damage_id', l.damage_id,
                  'issue', l.issue, 'photos', l.photos, 'quantity', l.quantity, 'price', l.price) ORDER BY l.id)
            FROM damage_case_lines l WHERE l.case_id = dc.id) AS lines
    FROM damage_cases dc
    LEFT JOIN customers c ON c.customer_id = dc.customer_id
    LEFT JOIN users ru ON ru.user_id = dc.reported_by
    LEFT JOIN users pu ON pu.user_id = dc.priced_by
    LEFT JOIN users su ON su.user_id = dc.proposed_by
    LEFT JOIN users du ON du.user_id = dc.decided_by`;

async function list({ status = null, customerId = null, ticketId = null, returnDcNumber = null } = {}) {
  const params = [];
  const where = [];
  if (status === 'open') where.push(`dc.status IN ('reported', 'priced', 'proposed')`);
  else if (status) { params.push(status); where.push(`dc.status = $${params.length}`); }
  if (customerId) { params.push(Number(customerId)); where.push(`dc.customer_id = $${params.length}`); }
  if (ticketId) { params.push(Number(ticketId)); where.push(`dc.support_ticket_id = $${params.length}`); }
  if (returnDcNumber) { params.push(String(returnDcNumber)); where.push(`dc.return_dc_number = $${params.length}`); }
  const { rows } = await pool.query(
    `${SELECT_CASES} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY dc.created_at DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({ ...r, total: Number(r.total || 0) }));
}

async function get(id) {
  const { rows } = await pool.query(`${SELECT_CASES} WHERE dc.id = $1`, [id]);
  return rows[0] ? { ...rows[0], total: Number(rows[0].total || 0) } : null;
}

module.exports = {
  PHOTO_ROOT, listCatalog, assertOwnPhoto, createCase, price, propose, decide, cancel, list, get,
};
