/**
 * Customers in the new UI (claude/carret-customers-returns-control.md, step 1).
 *
 * One row per customer with what they hold and owe: laptops on rent / on demo /
 * bought, returns, monthly rent, security held, outstanding. The tag (Rental /
 * Sales / Both) follows activity — migration 355, refresh_customer_type().
 * The Customer Access scope (req.allowedCustomerTypes) limits both list and
 * record, exactly like the old screens.
 */
const pool = require('../config/db');

const TAGS = ['rental', 'sales', 'both'];

const METRICS_SQL = `
  (SELECT COUNT(*)::int FROM vendor_serial_numbers v
    WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL AND v.inventory_status = 'rented') AS rented_count,
  (SELECT COUNT(*)::int FROM vendor_serial_numbers v
    WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL AND v.inventory_status = 'on_demo') AS demo_count,
  (SELECT COUNT(*)::int FROM vendor_serial_numbers v
    WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL
      AND v.inventory_status IN ('reserved', 'dispatch_ready', 'in_transit')) AS on_the_way_count,
  (SELECT COUNT(*)::int FROM vendor_serial_numbers v
    WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL AND v.inventory_status = 'sold') AS sold_count,
  (SELECT COUNT(*)::int FROM delivery_challan_lines d
    WHERE d.customer_id = c.customer_id AND d.movement_type = 'return'
      AND LOWER(COALESCE(d.status, '')) <> 'cancelled') AS return_count,
  (SELECT COALESCE(SUM(v.rent_monthly_rate), 0) FROM vendor_serial_numbers v
    WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL AND v.inventory_status = 'rented') AS monthly_rent,
  (SELECT COALESCE(SUM(s.amount - COALESCE(s.refund_amount, 0)), 0) FROM customer_security_deposits s
    WHERE s.customer_id = c.customer_id AND LOWER(COALESCE(s.status, '')) NOT IN ('refunded', 'cancelled')) AS security_held,
  (SELECT COALESCE(SUM(i.grand_total - COALESCE(i.amount_paid, 0)), 0) FROM customer_invoices i
    WHERE i.customer_id = c.customer_id AND LOWER(COALESCE(i.status, '')) NOT IN ('draft', 'cancelled', 'paid')) AS outstanding`;

function scopeClause(allowedTypes, params) {
  if (!Array.isArray(allowedTypes) || !allowedTypes.length || TAGS.every((t) => allowedTypes.includes(t))) return null;
  params.push(allowedTypes);
  return `c.customer_type = ANY($${params.length}::text[])`;
}

function shape(r) {
  const n = (v) => (v == null ? 0 : Number(v));
  return {
    ...r,
    monthly_rent: n(r.monthly_rent),
    security_held: n(r.security_held),
    outstanding: n(r.outstanding),
    display_name: r.company_name || r.name,
  };
}

async function listCustomers({
  search = '', tag = '', status = 'active', activity = '', kyc = '', page = 1, limit = 50, allowedTypes = null,
} = {}) {
  const params = [];
  const where = [];
  const scope = scopeClause(allowedTypes, params);
  if (scope) where.push(scope);
  if (status === 'active') where.push('COALESCE(c.status, 1) = 1');
  if (status === 'inactive') where.push('COALESCE(c.status, 1) <> 1');
  if (TAGS.includes(tag)) { params.push(tag); where.push(`c.customer_type = $${params.length}`); }
  if (kyc === 'verified') where.push('c.kyc_verified IS TRUE');
  if (kyc === 'pending') where.push('c.kyc_verified IS NOT TRUE');
  const q = String(search || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(c.name ILIKE $${i} OR COALESCE(c.company_name, '') ILIKE $${i} OR COALESCE(c.trade_name, '') ILIKE $${i}
      OR COALESCE(c.email, '') ILIKE $${i} OR COALESCE(c.phone, '') ILIKE $${i} OR COALESCE(c.gst_no, '') ILIKE $${i}
      OR c.customer_id::text = TRIM($${i}, '%'))`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Activity filters work on the computed columns, so they wrap the query.
  const activityFilter = {
    renting: 'rented_count + demo_count + on_the_way_count > 0',
    bought: 'sold_count > 0',
    returned: 'return_count > 0',
    none: 'rented_count + demo_count + on_the_way_count + sold_count + return_count = 0',
    owes: 'outstanding > 0',
  }[activity];

  const base = `
    SELECT c.customer_id, c.name, c.company_name, c.trade_name, c.email, c.phone, c.gst_no, c.billing_city,
           c.billing_state, c.customer_type, c.customer_type_source, c.status, c.kyc_verified, c.portal_enabled,
           c.created_at, c.onboarded_at,
           ${METRICS_SQL}
      FROM customers c
      ${whereSql}`;
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const filtered = `SELECT * FROM (${base}) x ${activityFilter ? `WHERE ${activityFilter}` : ''}`;
  const [{ rows }, totals] = await Promise.all([
    pool.query(`${filtered} ORDER BY monthly_rent DESC, sold_count DESC, customer_id DESC LIMIT ${lim} OFFSET ${(pg - 1) * lim}`, params),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE customer_type = 'rental')::int AS rental,
              COUNT(*) FILTER (WHERE customer_type = 'sales')::int AS sales,
              COUNT(*) FILTER (WHERE customer_type = 'both')::int AS both,
              COALESCE(SUM(rented_count), 0)::int AS laptops_on_rent,
              COALESCE(SUM(monthly_rent), 0) AS monthly_rent
         FROM (${filtered}) y`,
      params
    ),
  ]);
  const t = totals.rows[0];
  return {
    data: rows.map(shape),
    total: t.total,
    page: pg,
    limit: lim,
    summary: { rental: t.rental, sales: t.sales, both: t.both, laptops_on_rent: t.laptops_on_rent, monthly_rent: Number(t.monthly_rent || 0) },
  };
}

async function getOverview(customerId, { allowedTypes = null } = {}) {
  const params = [Number(customerId)];
  const scope = scopeClause(allowedTypes, params);
  const { rows } = await pool.query(
    `SELECT c.*, ${METRICS_SQL},
            (SELECT COUNT(DISTINCT s.sales_order_number)::int FROM sales_order_lines s
              WHERE s.customer_id = c.customer_id AND LOWER(COALESCE(s.status, '')) <> 'cancelled') AS order_count,
            (SELECT COUNT(*)::int FROM support_tickets t
              WHERE t.customer_id = c.customer_id AND t.status NOT IN ('closed', 'cancelled', 'resolved')) AS open_tickets,
            (SELECT COUNT(*)::int FROM vendor_serial_numbers v
              WHERE v.current_customer_id = c.customer_id AND v.deleted_at IS NULL AND v.inventory_status = 'rented'
                AND v.lock_in_end_date > CURRENT_DATE) AS in_lock_in,
            u.name AS type_set_by_name
       FROM customers c
       LEFT JOIN users u ON u.user_id = c.customer_type_set_by
      WHERE c.customer_id = $1 ${scope ? `AND ${scope}` : ''}`,
    params
  );
  if (!rows[0]) return null;
  const r = shape(rows[0]);
  delete r.portal_password_hash;
  return r;
}

/** A customer's sales orders, one row per order (lines are denormalised). */
async function listOrders(customerId) {
  const { rows } = await pool.query(
    `SELECT s.sales_order_number,
            MIN(s.quotation_type) AS quotation_type,
            MIN(s.entity_code) AS entity_code,
            MIN(s.created_at) AS created_at,
            STRING_AGG(DISTINCT s.status, ', ') AS status,
            SUM(COALESCE(s.main_qty, s.quantity, 0))::int AS qty,
            SUM(COALESCE(s.rate, 0) * COALESCE(s.main_qty, s.quantity, 0)) AS value,
            (SELECT COUNT(*)::int FROM sales_order_serials sos
              WHERE sos.sales_order_number = s.sales_order_number AND sos.status <> 'removed') AS laptops
       FROM sales_order_lines s
      WHERE s.customer_id = $1
      GROUP BY s.sales_order_number
      ORDER BY MIN(s.created_at) DESC
      LIMIT 200`,
    [Number(customerId)]
  );
  return rows.map((r) => ({ ...r, value: Number(r.value || 0) }));
}

module.exports = { listCustomers, getOverview, listOrders };

/* ------------------------------------------------------ account closure (SD1) */

/** What stands in the way of closing, and what would be refunded. */
async function closureCheck(db, customerId) {
  const id = Number(customerId);
  const q = async (sql) => Number((await db.query(sql, [id])).rows[0].n || 0);
  const withCustomer = await q(`SELECT COUNT(*) AS n FROM vendor_serial_numbers WHERE current_customer_id = $1 AND deleted_at IS NULL
                                  AND inventory_status IN ('rented', 'on_demo', 'reserved', 'dispatch_ready', 'in_transit')`);
  const openReturns = await q(`SELECT COUNT(*) AS n FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
                                WHERE t.customer_id = $1 AND i.item_type = 'pickup' AND i.warehouse_received_at IS NULL
                                  AND COALESCE(i.status, '') NOT IN ('cancelled', 'removed', 'resolved', 'closed', 'inventory_updated')`);
  const openDamage = await q(`SELECT COUNT(*) AS n FROM damage_cases WHERE customer_id = $1 AND status IN ('reported', 'priced', 'proposed')`);
  const unbilled = Number((await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM customer_invoice_extra_lines
      WHERE customer_id = $1 AND status = 'APPROVED' AND billed_in_invoice_id IS NULL`, [id]
  )).rows[0].n || 0);
  const outstanding = Number((await db.query(
    `SELECT COALESCE(SUM(grand_total - COALESCE(amount_paid, 0)), 0) AS n FROM customer_invoices
      WHERE customer_id = $1 AND LOWER(COALESCE(status, '')) NOT IN ('draft', 'cancelled', 'paid')`, [id]
  )).rows[0].n || 0);
  const deposits = (await db.query(
    `SELECT deposit_id, amount, COALESCE(refund_amount, 0) AS refund_amount, status
       FROM customer_security_deposits
      WHERE customer_id = $1 AND LOWER(COALESCE(status, '')) NOT IN ('refunded', 'cancelled')
      ORDER BY deposit_id`, [id]
  )).rows;
  const held = deposits.reduce((s, d) => s + Number(d.amount) - Number(d.refund_amount), 0);
  const blockers = [];
  if (withCustomer) blockers.push(`${withCustomer} laptop(s) still with the customer`);
  if (openReturns) blockers.push(`${openReturns} pickup(s) not yet received at the warehouse`);
  if (openDamage) blockers.push(`${openDamage} damage case(s) still open`);
  if (unbilled > 0) blockers.push(`Rs ${unbilled} of approved charges not yet invoiced`);
  const refundable = Math.max(0, Math.round((held - outstanding) * 100) / 100);
  return {
    with_customer: withCustomer, open_returns: openReturns, open_damage: openDamage, unbilled_charges: unbilled,
    outstanding, security_held: Math.round(held * 100) / 100, refundable, deposits, blockers,
  };
}

/**
 * Accounts close the account: refund the deposit less anything owed, mark the
 * customer inactive. Refused while laptops, pickups or charges are still open.
 */
async function closeAccount(client, customerId, { note, refundReference, user }) {
  const id = Number(customerId);
  const cur = (await client.query('SELECT customer_id, status, closed_at FROM customers WHERE customer_id = $1 FOR UPDATE', [id])).rows[0];
  if (!cur) throw Object.assign(new Error('Customer not found'), { status: 404 });
  if (cur.closed_at) throw Object.assign(new Error('This account is already closed'), { status: 409 });
  const why = String(note || '').trim();
  if (why.length < 3) throw Object.assign(new Error('Say why the account is being closed'), { status: 400 });
  const chk = await closureCheck(client, id);
  if (chk.blockers.length) throw Object.assign(new Error(`Cannot close yet: ${chk.blockers.join('; ')}`), { status: 409 });
  // Refund deposits oldest first up to the refundable amount; the rest is kept against dues.
  let left = chk.refundable;
  const refunded = [];
  for (const d of chk.deposits) {
    const remaining = Number(d.amount) - Number(d.refund_amount);
    const give = Math.min(remaining, left);
    const total = Math.round((Number(d.refund_amount) + give) * 100) / 100;
    await client.query(
      `UPDATE customer_security_deposits
          SET refund_amount = $2, refund_date = CURRENT_DATE, refund_reference = $3,
              status = $4, notes = CONCAT_WS(E'\\n', notes, $5::text), updated_at = NOW()
        WHERE deposit_id = $1`,
      [d.deposit_id, total, refundReference || null,
        total >= Number(d.amount) - 0.001 ? 'refunded' : 'partially_refunded',
        give < remaining ? `Account closed: Rs ${Math.round((remaining - give) * 100) / 100} kept against dues` : 'Refunded on account closure']
    );
    refunded.push({ deposit_id: d.deposit_id, refunded: Math.round(give * 100) / 100 });
    left = Math.round((left - give) * 100) / 100;
  }
  await client.query(
    `UPDATE customers SET status = 0, closed_at = NOW(), closed_by = $2, close_note = $3, updated_at = NOW() WHERE customer_id = $1`,
    [id, user?.user_id || null, why]
  );
  return { ...chk, refunded };
}

module.exports.closureCheck = closureCheck;
module.exports.closeAccount = closeAccount;
