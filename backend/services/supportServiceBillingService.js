/**
 * Service on SOLD (gorefurbo) laptops (claude/carret-lockin-warranty.md, W1–W2).
 *
 *   - Out of warranty: every part is chargeable (it cannot be marked free) and a
 *     free replacement is refused — paid repair only. Battery / charger parts
 *     follow the battery warranty, everything else the technical warranty.
 *   - A sold laptop's charges (parts once priced and used, plus service charges
 *     Support adds) land on support_service_charges, NOT the rental invoice a
 *     sale customer does not have. Accounts approve them and raise one gorefurbo
 *     service order (SVO/yy-yy/nnnn), then attach the Zoho invoice to it.
 */
const pool = require('../config/db');
const { toDateStr, warrantyStatus } = require('./lockInWarrantyService');

const SERVICE_HSN = '998713'; // SAC: maintenance and repair of computers
const PART_HSN = '847330';
const GST_RATE = 18;

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, statusCode: status, ...extra });
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function isBatteryOrChargerPart(part) {
  if (!part) return false;
  if (['battery', 'power'].includes(String(part.category || '').toLowerCase())) return true;
  return /batter|charger|adapter|adaptor/i.test(`${part.part_name || ''} ${part.part_type || ''}`);
}

/** The laptop behind a code (TTSPL / serial), with its warranty dates. */
async function laptopForCode(client, codes) {
  const list = [...new Set((codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return null;
  const r = await (client || pool).query(
    `SELECT serial_id, inventory_status, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id', serial_number) AS asset_code,
            warranty_start_date, warranty_end_date, battery_warranty_end_date
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (UPPER(COALESCE(inventory_asset_code, '')) = ANY($1::text[])
             OR UPPER(COALESCE(extra->>'ttspl_id', '')) = ANY($1::text[])
             OR UPPER(COALESCE(serial_number, '')) = ANY($1::text[]))
      ORDER BY (inventory_status = 'sold') DESC
      LIMIT 1`,
    [list]
  );
  return r.rows[0] || null;
}

/**
 * Whether this part on this laptop must be charged: sold laptop whose relevant
 * warranty (battery for battery / charger parts) has ended.
 */
function partOutOfWarranty(laptop, part) {
  if (!laptop || laptop.inventory_status !== 'sold') return null;
  const today = toDateStr(new Date());
  const end = isBatteryOrChargerPart(part) ? laptop.battery_warranty_end_date : laptop.warranty_end_date;
  const endStr = toDateStr(end);
  if (endStr && endStr > today) return null;
  return endStr
    ? `Out of warranty (${isBatteryOrChargerPart(part) ? 'battery / charger ' : ''}warranty ended ${endStr})`
    : 'Out of warranty (sold with no warranty)';
}

/** W1: a sold laptop out of technical warranty gets paid repair, not a free replacement. */
async function assertFreeReplacementAllowed(client, codeGroups) {
  const refused = [];
  for (const codes of codeGroups || []) {
    const lap = await laptopForCode(client, codes);
    if (!lap || lap.inventory_status !== 'sold') continue;
    if (warrantyStatus(lap) !== 'in') {
      refused.push(`${lap.asset_code} (${lap.warranty_end_date ? `warranty ended ${toDateStr(lap.warranty_end_date)}` : 'no warranty'})`);
    }
  }
  if (refused.length) {
    throw fail(
      `Out of warranty: ${refused.join(', ')}. A sold laptop out of warranty gets paid repair only — no free replacement. Add the parts and a service charge on the ticket instead.`,
      409,
      { code: 'OUT_OF_WARRANTY' }
    );
  }
}

/** Record each sold laptop's warranty state on its ticket lines (what Support saw at the time). */
async function stampTicketWarranty(client, ticketId) {
  await (client || pool).query(
    `UPDATE support_ticket_items sti
        SET warranty_status = CASE
              WHEN v.warranty_end_date > CURRENT_DATE THEN 'in'
              WHEN v.battery_warranty_end_date > CURRENT_DATE THEN 'battery_only'
              ELSE 'out' END
       FROM vendor_serial_numbers v
      WHERE sti.ticket_id = $1 AND sti.warranty_status IS NULL
        AND v.inventory_status = 'sold' AND v.deleted_at IS NULL
        AND UPPER(COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', v.serial_number))
            = UPPER(COALESCE(NULLIF(sti.ttspl_id, ''), NULLIF(sti.unique_serial_number, ''), sti.serial_number))`,
    [ticketId]
  );
}

/* ------------------------------------------------------------ part charges */

/**
 * A part request on a SOLD laptop: keep its service-charge line in step
 * (chargeable + priced + used/dispatched → pending line for Accounts). Returns
 * null when the laptop is not sold, so the caller falls back to the rental
 * invoice path.
 */
async function syncSalePartCharge(client, requestId) {
  const r = (await client.query(
    `SELECT spr.*, p.part_name, p.hsn_code AS part_hsn, st.customer_id
       FROM support_part_requests spr
       LEFT JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.id = $1`,
    [requestId]
  )).rows[0];
  if (!r) return null;
  const lap = await laptopForCode(client, [r.ttspl_id, r.serial_number]);
  if (!lap || lap.inventory_status !== 'sold') return null;

  const line = (await client.query(
    'SELECT * FROM support_service_charges WHERE source_part_request_id = $1', [requestId]
  )).rows[0];
  if (line && ['billed'].includes(line.status)) return { status: 'BILLED' };
  const chargeable = r.billing_type === 'charge_customer' && Number(r.charge_amount) > 0;
  const reached = ['used', 'delivered', 'dispatched'].includes(String(r.status || ''));
  if (!chargeable) {
    if (line) await client.query('DELETE FROM support_service_charges WHERE id = $1', [line.id]);
    return { status: r.billing_type === 'charge_customer' ? 'WAITING_FOR_PRICE' : 'FREE' };
  }
  if (!reached) return { status: 'WAITING_FOR_USE' };
  const description = `Spare part: ${r.part_name || 'part'} for ${lap.asset_code}${r.charge_reason ? ` (${r.charge_reason})` : ''}`;
  if (line) {
    await client.query(
      `UPDATE support_service_charges
          SET unit_price = $2, description = $3, quantity = $4, updated_at = NOW(),
              status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END
        WHERE id = $1`,
      [line.id, r.charge_amount, description, Number(r.quantity || 1)]
    );
  } else {
    await client.query(
      `INSERT INTO support_service_charges
         (ticket_id, ticket_item_id, serial_id, customer_id, charge_kind, source_part_request_id,
          description, quantity, unit_price, gst_rate, hsn_code, added_by)
       VALUES ($1, $2, $3, $4, 'part', $5, $6, $7, $8, $9, $10, $11)`,
      [r.support_ticket_id, r.support_item_id || null, lap.serial_id, r.customer_id, requestId,
        description, Number(r.quantity || 1), r.charge_amount, GST_RATE, r.part_hsn || PART_HSN, r.charge_marked_by || null]
    );
  }
  return { status: 'PENDING_ACCOUNTS', amount: Number(r.charge_amount) };
}

/* --------------------------------------------------------- service charges */

async function addServiceCharge(client, { ticketId, ticketItemId = null, description, amount, quantity = 1, user }) {
  const t = (await client.query('SELECT id, customer_id FROM support_tickets WHERE id = $1', [ticketId])).rows[0];
  if (!t) throw fail('Ticket not found', 404);
  const item = ticketItemId
    ? (await client.query('SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2', [ticketItemId, ticketId])).rows[0]
    : null;
  if (ticketItemId && !item) throw fail('That laptop is not on this ticket', 404);
  const lap = item ? await laptopForCode(client, [item.ttspl_id, item.unique_serial_number, item.serial_number]) : null;
  if (!lap || lap.inventory_status !== 'sold') throw fail('Service charges are for sold (gorefurbo) laptops — choose the sold laptop on this ticket');
  const price = round2(amount);
  if (!(price > 0)) throw fail('Enter the service charge (more than 0)');
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const desc = String(description || '').trim();
  if (desc.length < 3) throw fail('Describe the service (e.g. "Motherboard repair labour")');
  const { rows } = await client.query(
    `INSERT INTO support_service_charges
       (ticket_id, ticket_item_id, serial_id, customer_id, charge_kind, description, quantity, unit_price, gst_rate, hsn_code, added_by)
     VALUES ($1, $2, $3, $4, 'service', $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [ticketId, ticketItemId, lap.serial_id, t.customer_id, `${desc} — ${lap.asset_code}`, qty, price, GST_RATE, SERVICE_HSN, user?.user_id || null]
  );
  return rows[0];
}

async function removeServiceCharge(client, id) {
  const c = (await client.query('SELECT * FROM support_service_charges WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!c) throw fail('Charge not found', 404);
  if (c.charge_kind !== 'service') throw fail('A part charge follows its part request — unmark the part instead', 409);
  if (c.status !== 'pending') throw fail(`This charge is ${c.status} — it can no longer be removed`, 409);
  await client.query('DELETE FROM support_service_charges WHERE id = $1', [id]);
}

const SELECT_CHARGES = `
  SELECT sc.*, sc.quantity * sc.unit_price AS amount,
         COALESCE(c.company_name, c.name) AS customer_name,
         COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', v.serial_number) AS asset_code,
         v.warranty_end_date, v.battery_warranty_end_date,
         so.order_number, so.status AS order_status, so.invoice_number,
         au.name AS added_by_name, du.name AS decided_by_name
    FROM support_service_charges sc
    LEFT JOIN customers c ON c.customer_id = sc.customer_id
    LEFT JOIN vendor_serial_numbers v ON v.serial_id = sc.serial_id
    LEFT JOIN support_service_orders so ON so.id = sc.service_order_id
    LEFT JOIN users au ON au.user_id = sc.added_by
    LEFT JOIN users du ON du.user_id = sc.decided_by`;

async function listTicketCharges(ticketId) {
  const { rows } = await pool.query(`${SELECT_CHARGES} WHERE sc.ticket_id = $1 ORDER BY sc.id`, [ticketId]);
  return rows;
}

async function listCharges({ status = null, customerId = null } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(String(status)); where.push(`sc.status = $${params.length}`); }
  if (customerId) { params.push(Number(customerId)); where.push(`sc.customer_id = $${params.length}`); }
  const { rows } = await pool.query(
    `${SELECT_CHARGES} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY customer_name, sc.created_at LIMIT 500`,
    params
  );
  return rows;
}

async function decideCharge(client, id, { approve, note, user }) {
  const c = (await client.query('SELECT * FROM support_service_charges WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!c) throw fail('Charge not found', 404);
  if (!['pending', 'approved', 'rejected'].includes(c.status)) throw fail(`This charge is ${c.status}`, 409);
  if (!approve && String(note || '').trim().length < 3) throw fail('Say why it is rejected');
  const { rows } = await client.query(
    `UPDATE support_service_charges
        SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, approve ? 'approved' : 'rejected', user?.user_id || null, String(note || '').trim() || null]
  );
  return rows[0];
}

/** Accounts: one gorefurbo service order for a customer's approved charges. */
async function raiseServiceOrder(client, { customerId, chargeIds, user }) {
  const { nextFinancialYearNumber, computeGstBreakdown } = require('./salesManagementService');
  const ids = [...new Set((chargeIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw fail('Choose the approved charges to bill');
  const charges = (await client.query(
    'SELECT * FROM support_service_charges WHERE id = ANY($1::int[]) FOR UPDATE', [ids]
  )).rows;
  if (charges.length !== ids.length) throw fail('One or more charges were not found', 404);
  for (const c of charges) {
    if (Number(c.customer_id) !== Number(customerId)) throw fail('All charges must belong to the same customer');
    if (c.status !== 'approved') throw fail(`Charge #${c.id} is ${c.status} — only approved charges can be billed`, 409);
  }
  const cust = (await client.query(
    `SELECT customer_id, COALESCE(company_name, name) AS name, gst_no, billing_address, billing_city,
            billing_state, billing_pincode, shipping_state
       FROM customers WHERE customer_id = $1`,
    [customerId]
  )).rows[0];
  if (!cust) throw fail('Customer not found', 404);
  const subtotal = round2(charges.reduce((s, c) => s + Number(c.quantity) * Number(c.unit_price), 0));
  const supplyState = cust.billing_state || cust.shipping_state || '';
  const gst = computeGstBreakdown({ subtotal, supplyState, gstRate: GST_RATE });
  const orderNumber = await nextFinancialYearNumber('service_order', client);
  const address = [cust.billing_address, cust.billing_city, cust.billing_state, cust.billing_pincode].filter(Boolean).join(', ');
  const so = (await client.query(
    `INSERT INTO support_service_orders
       (order_number, customer_id, customer_name, gst_number, billing_address, supply_state,
        subtotal, gst_type, cgst, sgst, igst, grand_total, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [orderNumber, customerId, cust.name, cust.gst_no || null, address || null, supplyState || null,
      gst.subtotal, gst.gst_type, gst.cgst, gst.sgst, gst.igst, gst.grand_total, user?.user_id || null]
  )).rows[0];
  await client.query(
    `UPDATE support_service_charges SET status = 'billed', service_order_id = $2, billed_at = NOW(), updated_at = NOW()
      WHERE id = ANY($1::int[])`,
    [ids, so.id]
  );
  return so;
}

async function listServiceOrders({ status = null } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(String(status)); where = 'WHERE so.status = $1'; }
  const { rows } = await pool.query(
    `SELECT so.*, u.name AS created_by_name,
            (SELECT json_agg(json_build_object('id', sc.id, 'description', sc.description, 'quantity', sc.quantity,
                     'unit_price', sc.unit_price, 'charge_kind', sc.charge_kind, 'ticket_id', sc.ticket_id) ORDER BY sc.id)
               FROM support_service_charges sc WHERE sc.service_order_id = so.id) AS lines
       FROM support_service_orders so
       LEFT JOIN users u ON u.user_id = so.created_by
       ${where}
      ORDER BY so.created_at DESC LIMIT 300`,
    params
  );
  return rows;
}

async function attachInvoice(client, id, { invoiceNumber, pdfPath = null, user }) {
  const n = String(invoiceNumber || '').trim();
  if (!n) throw fail('Enter the Zoho invoice number');
  const so = (await client.query('SELECT * FROM support_service_orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!so) throw fail('Service order not found', 404);
  if (so.status === 'cancelled') throw fail('This service order is cancelled', 409);
  const { rows } = await client.query(
    `UPDATE support_service_orders
        SET invoice_number = $2, invoice_pdf_path = COALESCE($3, invoice_pdf_path), invoice_uploaded_at = NOW(),
            invoice_uploaded_by = $4, status = 'invoiced', updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, n, pdfPath, user?.user_id || null]
  );
  return rows[0];
}

/** Undo an order not yet invoiced: its charges go back to approved. */
async function cancelServiceOrder(client, id) {
  const so = (await client.query('SELECT * FROM support_service_orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!so) throw fail('Service order not found', 404);
  if (so.status !== 'awaiting_invoice') throw fail(`This service order is ${so.status.replace('_', ' ')} — it can no longer be cancelled`, 409);
  await client.query(
    `UPDATE support_service_charges SET status = 'approved', service_order_id = NULL, billed_at = NULL, updated_at = NOW()
      WHERE service_order_id = $1`,
    [id]
  );
  const { rows } = await client.query(
    `UPDATE support_service_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`, [id]
  );
  return rows[0];
}

module.exports = {
  SERVICE_HSN,
  isBatteryOrChargerPart,
  laptopForCode,
  partOutOfWarranty,
  assertFreeReplacementAllowed,
  stampTicketWarranty,
  syncSalePartCharge,
  addServiceCharge,
  removeServiceCharge,
  listTicketCharges,
  listCharges,
  decideCharge,
  raiseServiceOrder,
  listServiceOrders,
  attachInvoice,
  cancelServiceOrder,
};
