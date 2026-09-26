/**
 * Support charges (claude/carret-support.md; user's rules 26 Sep 2026).
 *
 * PARTS — free by default: the service is ours and a part failing is not the
 * customer's fault. A part is charged only when Support marks its request
 * chargeable (with a reason); the WAREHOUSE sets the price. Once a chargeable
 * part is priced and used (or delivered to the customer), it becomes an
 * APPROVED line in customer_invoice_extra_lines; Accounts adds approved lines
 * to the customer's draft invoice (addChargesToDraftInvoice) — the same totals
 * rule the invoice uses (non-security lines + 18% GST − credit + security).
 *
 * WFH — a laptop delivered to an employee's home (work from home): a return
 * pickup or a replacement delivery is chargeable, Rs 799 + GST, when Support
 * clicks "charge". The amount is written to that DC's shiping_charges (for a
 * replacement: its sales order, which the DC copies), which is what the
 * Delivery Charges page lists — outside the rental invoice.
 */
const pool = require('../config/db');

const WFH_CHARGE = Number(process.env.SUPPORT_WFH_CHARGE || 799);
const PART_GST_RATE = 18;
const PART_HSN = process.env.SUPPORT_PART_HSN || '847330';
const SUPERVISORS = new Set(['super_admin', 'admin', 'manager', 'support_lead']);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/* ------------------------------------------------------------------ WFH */

/**
 * Is this laptop with the customer as work-from-home? Its latest allocation to
 * this customer (sales_order_serials) says so, else the sales order line.
 * Returns { is_wfh, address, sales_order_number, dc_number } or { is_wfh: false }.
 */
async function laptopWfh(db, { code, customerId }) {
  const c = String(code || '').trim();
  if (!c) return { is_wfh: false };
  const r = (await db.query(
    `SELECT sos.is_wfh, sos.delivery_address, sos.sales_order_number, sos.dc_number,
            (SELECT bool_or(COALESCE(sol.is_wfh, FALSE)) FROM sales_order_lines sol
              WHERE sol.id = sos.line_id) AS line_wfh
       FROM sales_order_serials sos
       JOIN sales_order_lines so1 ON so1.sales_order_number = sos.sales_order_number
      WHERE (UPPER(COALESCE(sos.ttspl_id, '')) = UPPER($1) OR UPPER(COALESCE(sos.serial_number, '')) = UPPER($1))
        AND ($2::int IS NULL OR so1.customer_id = $2)
      ORDER BY sos.created_at DESC NULLS LAST, sos.allocation_id DESC
      LIMIT 1`,
    [c, customerId || null]
  )).rows[0];
  if (!r) return { is_wfh: false };
  const isWfh = Boolean(r.is_wfh || r.line_wfh);
  return {
    is_wfh: isWfh,
    address: isWfh ? r.delivery_address || null : null,
    sales_order_number: r.sales_order_number,
    dc_number: r.dc_number,
  };
}

/**
 * Support clicks "charge" on a WFH return pickup or replacement delivery.
 * Pickup → the item's return DC; replacement → the replacement sales order
 * (and its DC if already made). Refused when the laptop is not WFH.
 */
async function chargeWfhDelivery(client, { itemId, user }) {
  if (!SUPERVISORS.has(String(user?.role || ''))) throw fail('Only the support lead can charge a delivery', 403);
  const item = (await client.query(
    `SELECT i.*, t.customer_id FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
      WHERE i.id = $1 FOR UPDATE OF i`,
    [itemId]
  )).rows[0];
  if (!item) throw fail('Support item not found', 404);
  if (item.wfh_charge) return { already: true, dc_number: item.wfh_charge_dc_number, amount: Number(item.wfh_charge_amount) };
  const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
  const wfh = await laptopWfh(client, { code, customerId: item.customer_id });
  if (!wfh.is_wfh) throw fail('This laptop is not with the customer as work-from-home — no delivery charge applies');

  let target = null;
  if (item.item_type === 'pickup' && item.return_dc_number) {
    target = item.return_dc_number;
    await client.query(
      `UPDATE delivery_challan_lines SET shiping_charges = $2, updated_at = NOW() WHERE dc_number = $1`,
      [target, WFH_CHARGE]
    );
  } else if (item.item_type === 'replacement' || item.status === 'order_placed' || item.status === 'swap_initiated') {
    const order = (await client.query(
      `SELECT sales_order_number, dc_number FROM support_replacement_orders
        WHERE item_id = $1 AND status NOT IN ('cancelled') ORDER BY id DESC LIMIT 1`,
      [item.id]
    )).rows[0];
    if (!order?.sales_order_number) throw fail('The replacement order is not raised yet — charge it once it is');
    await client.query(
      `UPDATE sales_order_lines SET shiping_charges = $2, is_wfh = TRUE, updated_at = NOW() WHERE sales_order_number = $1`,
      [order.sales_order_number, WFH_CHARGE]
    );
    const dc = order.dc_number || (await client.query(
      `SELECT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1 AND COALESCE(movement_type,'outbound') = 'outbound'
        ORDER BY created_at DESC LIMIT 1`,
      [order.sales_order_number]
    )).rows[0]?.dc_number;
    if (dc) {
      await client.query(`UPDATE delivery_challan_lines SET shiping_charges = $2, updated_at = NOW() WHERE dc_number = $1`, [dc, WFH_CHARGE]);
    }
    target = dc || order.sales_order_number;
  } else {
    throw fail('Only a return pickup or a replacement delivery can carry the work-from-home charge');
  }

  await client.query(
    `UPDATE support_ticket_items
        SET wfh_charge = TRUE, wfh_charge_amount = $2, wfh_charge_dc_number = $3,
            wfh_charge_by = $4, wfh_charge_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [item.id, WFH_CHARGE, target, user.user_id || null]
  );
  await client.query(
    `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
     VALUES ($1, $2, $3, 'wfh_delivery_charged', $4::jsonb)`,
    [item.id, item.ticket_id, user.user_id || null, JSON.stringify({ amount: WFH_CHARGE, gst: 'extra', on: target })]
  );
  return { charged: true, amount: WFH_CHARGE, dc_number: target };
}

/* ---------------------------------------------------------------- parts */

/** Support marks (or unmarks) a part request chargeable, with a reason. */
async function markPartChargeable(client, { requestId, chargeable, reason, user }) {
  const r = (await client.query('SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
  if (!r) throw fail('Part request not found', 404);
  const billed = (await client.query(
    `SELECT status FROM customer_invoice_extra_lines WHERE source_part_request_id = $1`, [requestId]
  )).rows[0];
  if (billed && billed.status === 'BILLED') throw fail('Already billed on an invoice — it can no longer change', 409);
  if (chargeable && String(reason || '').trim().length < 3) throw fail('Say why the customer is charged for this part');
  await client.query(
    `UPDATE support_part_requests
        SET billing_type = $2::text, charge_reason = $3::text, charge_marked_by = $4, charge_marked_at = NOW(),
            charge_amount = CASE WHEN $2::text = 'under_warranty' THEN 0 ELSE charge_amount END,
            updated_at = NOW()
      WHERE id = $1`,
    [requestId, chargeable ? 'charge_customer' : 'under_warranty', chargeable ? String(reason).trim() : null, user?.user_id || null]
  );
  return syncPartCharge(client, requestId, user);
}

/** The warehouse sets (or corrects) a chargeable part's price. */
async function setPartPrice(client, { requestId, amount, user }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw fail('Enter the part price (more than 0)');
  const r = (await client.query('SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
  if (!r) throw fail('Part request not found', 404);
  if (r.billing_type !== 'charge_customer') throw fail('Support has not marked this part chargeable — it is free', 409);
  const billed = (await client.query(
    `SELECT status FROM customer_invoice_extra_lines WHERE source_part_request_id = $1`, [requestId]
  )).rows[0];
  if (billed && billed.status === 'BILLED') throw fail('Already billed on an invoice — it can no longer change', 409);
  await client.query(
    `UPDATE support_part_requests SET charge_amount = $2, charge_priced_by = $3, charge_priced_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [requestId, Math.round(n * 100) / 100, user?.user_id || null]
  );
  return syncPartCharge(client, requestId, user);
}

/**
 * Keep the charge line in step with the request: chargeable + priced + used or
 * delivered → APPROVED line; not chargeable any more → WAIVED; BILLED is final.
 */
async function syncPartCharge(client, requestId, user = null) {
  const r = (await client.query(
    `SELECT spr.*, p.part_name, st.customer_id, st.id AS support_ticket_id
       FROM support_part_requests spr
       LEFT JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.id = $1`,
    [requestId]
  )).rows[0];
  if (!r) return null;
  const line = (await client.query(
    `SELECT * FROM customer_invoice_extra_lines WHERE source_part_request_id = $1`, [requestId]
  )).rows[0];
  if (line?.status === 'BILLED') return { status: 'BILLED' };

  const chargeable = r.billing_type === 'charge_customer' && Number(r.charge_amount) > 0;
  const reached = ['used', 'delivered', 'dispatched'].includes(String(r.status || ''));
  if (!chargeable) {
    if (line) {
      await client.query(
        `UPDATE customer_invoice_extra_lines SET status = 'WAIVED', waived_reason = 'Not chargeable any more', updated_at = NOW()
          WHERE extra_line_id = $1`,
        [line.extra_line_id]
      );
    }
    const marked = r.billing_type === 'charge_customer';
    return { status: marked ? 'WAITING_FOR_PRICE' : (line ? 'WAIVED' : 'FREE') };
  }
  if (!reached) return { status: 'WAITING_FOR_USE' };

  const description = `Spare part: ${r.part_name || 'part'}${r.ttspl_id ? ` for ${r.ttspl_id}` : ''} — support ticket #${r.support_ticket_id}${r.charge_reason ? ` (${r.charge_reason})` : ''}`;
  if (line) {
    await client.query(
      `UPDATE customer_invoice_extra_lines
          SET amount = $2, unit_price = $2, quantity = 1, description = $3, status = 'APPROVED', waived_reason = NULL, updated_at = NOW()
        WHERE extra_line_id = $1`,
      [line.extra_line_id, r.charge_amount, description]
    );
  } else {
    await client.query(
      `INSERT INTO customer_invoice_extra_lines
         (customer_id, charge_type, description, amount, status, billing_mode, source_part_request_id,
          unit_price, quantity, gst_rate, hsn_code, raised_at, raised_by, created_at, updated_at)
       VALUES ($1, 'spare_part', $2, $3, 'APPROVED', 'MONTHLY', $4, $3, 1, $5, $6, NOW(), $7, NOW(), NOW())`,
      [r.customer_id, description, r.charge_amount, requestId, PART_GST_RATE, PART_HSN, user?.user_id || null]
    );
  }
  return { status: 'APPROVED', amount: Number(r.charge_amount) };
}

/** Approved charges not yet on an invoice (Accounts' list). */
async function listChargesToBill({ customerId } = {}) {
  const params = [];
  let where = `WHERE l.status = 'APPROVED' AND l.billed_in_invoice_id IS NULL AND l.source_part_request_id IS NOT NULL`;
  if (customerId) { params.push(Number(customerId)); where += ` AND l.customer_id = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT l.extra_line_id, l.customer_id, COALESCE(c.company_name, c.name) AS customer_name, l.description,
            l.amount, l.gst_rate, l.hsn_code, l.raised_at, l.source_part_request_id,
            (SELECT ci.invoice_id FROM customer_invoices ci
              WHERE ci.customer_id = l.customer_id AND LOWER(ci.status) = 'draft'
              ORDER BY ci.invoice_year DESC, ci.invoice_month DESC LIMIT 1) AS draft_invoice_id
       FROM customer_invoice_extra_lines l
       LEFT JOIN customers c ON c.customer_id = l.customer_id
       ${where}
      ORDER BY l.raised_at`,
    params
  );
  return rows;
}

/**
 * Accounts adds approved charges to a customer's DRAFT invoice. Lines carry
 * no laptop serial or rent dates, so the draft's rental clean-ups leave them
 * alone; totals are recomputed the invoice's way.
 */
async function addChargesToDraftInvoice(client, { invoiceId, extraLineIds, user }) {
  const { invoiceMoneyTotals } = require('./billingSchedulerService');
  const { rentalLinesSubtotal, securityLinesSubtotal } = require('./billingSecurityService');
  const inv = (await client.query('SELECT * FROM customer_invoices WHERE invoice_id = $1 FOR UPDATE', [invoiceId])).rows[0];
  if (!inv) throw fail('Invoice not found', 404);
  if (String(inv.status || '').toLowerCase() !== 'draft') throw fail('Charges can only be added to a draft invoice', 409);
  const ids = [...new Set((extraLineIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw fail('Choose the charges to add');
  const lines = (await client.query(
    `SELECT * FROM customer_invoice_extra_lines WHERE extra_line_id = ANY($1::int[]) FOR UPDATE`, [ids]
  )).rows;
  if (lines.length !== ids.length) throw fail('One or more charges were not found', 404);
  for (const l of lines) {
    if (Number(l.customer_id) !== Number(inv.customer_id)) throw fail('A charge belongs to a different customer');
    if (l.status !== 'APPROVED' || l.billed_in_invoice_id) throw fail(`Charge #${l.extra_line_id} is ${String(l.status).toLowerCase()} — only approved, unbilled charges can be added`, 409);
  }
  const existing = Array.isArray(inv.line_items) ? inv.line_items : JSON.parse(inv.line_items || '[]');
  const added = lines.map((l) => ({
    line_type: 'part', // customer_invoice_lines.line_type is varchar(10)
    extra_line_id: l.extra_line_id,
    period: l.description,
    description: l.description,
    amount: Number(l.amount),
    hsn_code: l.hsn_code || PART_HSN,
    quantity: Number(l.quantity || 1),
    unit_price: Number(l.unit_price || l.amount),
  }));
  const merged = [...existing, ...added];
  const subtotal = rentalLinesSubtotal(merged);
  const gstPercent = parseFloat(inv.gst_percent != null ? inv.gst_percent : 18);
  const money = invoiceMoneyTotals(subtotal, gstPercent, parseFloat(inv.credit_note_adjustment || 0), securityLinesSubtotal(merged));
  await client.query(
    `UPDATE customer_invoices SET line_items = $2::jsonb, subtotal = $3, gst_amount = $4, grand_total = $5, updated_at = NOW()
      WHERE invoice_id = $1`,
    [invoiceId, JSON.stringify(merged), subtotal.toFixed(2), money.gstAmount, money.grandTotal]
  );
  for (const a of added) {
    await client.query(
      // period_label is varchar(10); the description goes in model (varchar 120).
      `INSERT INTO customer_invoice_lines (invoice_id, brand, model, period_label, amount, line_type)
       VALUES ($1, 'Spare part', $2, 'Part', $3, 'part')`,
      [invoiceId, String(a.description).slice(0, 120), a.amount]
    );
  }
  await client.query(
    `UPDATE customer_invoice_extra_lines SET status = 'BILLED', billed_in_invoice_id = $2, updated_at = NOW()
      WHERE extra_line_id = ANY($1::int[])`,
    [ids, invoiceId]
  );
  return { invoice_id: invoiceId, added: added.length, subtotal, grand_total: money.grandTotal, by: user?.user_id || null };
}

module.exports = {
  WFH_CHARGE,
  laptopWfh,
  chargeWfhDelivery,
  markPartChargeable,
  setPartPrice,
  syncPartCharge,
  listChargesToBill,
  addChargesToDraftInvoice,
};
