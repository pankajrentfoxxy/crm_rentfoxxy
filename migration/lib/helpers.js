/**
 * Shared migration helpers
 */
const { getCrmId, setCrmId } = require('./id-map');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeGst(gst) {
  return String(gst || '').trim().toUpperCase().replace(/\s+/g, '');
}

function str(val, maxLen, fallback = '') {
  const s = val == null ? '' : String(val).trim();
  if (!s) return fallback;
  return maxLen ? s.slice(0, maxLen) : s;
}

function parseJson(val, fallback = null) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function extractAddressText(val) {
  const parsed = parseJson(val);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return str(parsed.address || parsed.name, 5000, '');
  }
  return str(val, 5000, '');
}

async function findExistingByEmailOrGst(crm, { table, emailCol, gstCol, email, gst, idCol }) {
  const em = normalizeEmail(email);
  const g = normalizeGst(gst);
  if (em) {
    const { rows } = await crm.query(
      `SELECT ${idCol} FROM ${table} WHERE LOWER(TRIM(${emailCol})) = $1 LIMIT 1`,
      [em]
    );
    if (rows.length) return rows[0][idCol];
  }
  if (g && g.length >= 10) {
    const gstColName = gstCol || 'gst_number';
    const { rows } = await crm.query(
      `SELECT ${idCol} FROM ${table} WHERE UPPER(REPLACE(TRIM(${gstColName}), ' ', '')) = $1 LIMIT 1`,
      [g]
    );
    if (rows.length) return rows[0][idCol];
  }
  return null;
}

async function bumpVendorSequence(crm) {
  await crm.query(
    `SELECT setval('vendors_vendor_id_seq', (SELECT COALESCE(MAX(vendor_id), 1) FROM vendors), true)`
  );
}

async function bumpCustomerSequence(crm) {
  await crm.query(
    `SELECT setval('customers_customer_id_seq', (SELECT COALESCE(MAX(customer_id), 1) FROM customers), true)`
  );
}

async function bumpCustomerAddressSequence(crm) {
  await crm.query(
    `SELECT setval('customer_addresses_customer_address_id_seq', (SELECT COALESCE(MAX(customer_address_id), 1) FROM customer_addresses), true)`
  );
}

async function bumpPoSequence(crm) {
  await crm.query(
    `SELECT setval('vendor_purchase_orders_po_id_seq', (SELECT COALESCE(MAX(po_id), 1) FROM vendor_purchase_orders), true)`
  );
}

async function bumpSpoSequence(crm) {
  await crm.query(
    `SELECT setval('vendor_spare_parts_purchase_orders_spo_id_seq', (SELECT COALESCE(MAX(spo_id), 1) FROM vendor_spare_parts_purchase_orders), true)`
  );
}

async function bumpInventorySequence(crm) {
  await crm.query(
    `SELECT setval('inventory_inventory_id_seq', (SELECT COALESCE(MAX(inventory_id), 1) FROM inventory), true)`
  );
}

async function bumpGrnSequence(crm) {
  await crm.query(
    `SELECT setval('vendor_goods_received_notes_grn_id_seq', (SELECT COALESCE(MAX(grn_id), 1) FROM vendor_goods_received_notes), true)`
  );
}

async function bumpSerialSequence(crm) {
  await crm.query(
    `SELECT setval('vendor_serial_numbers_serial_id_seq', (SELECT COALESCE(MAX(serial_id), 1) FROM vendor_serial_numbers), true)`
  );
}

async function bumpSalesOrderLineSequence(crm) {
  await crm.query(
    `SELECT setval('sales_order_lines_id_seq', (SELECT COALESCE(MAX(id), 1) FROM sales_order_lines), true)`
  );
}

async function bumpDeliveryChallanLineSequence(crm) {
  await crm.query(
    `SELECT setval('delivery_challan_lines_id_seq', (SELECT COALESCE(MAX(id), 1) FROM delivery_challan_lines), true)`
  );
}

async function bumpSupportTicketSequence(crm) {
  await crm.query(
    `SELECT setval('support_tickets_id_seq', (SELECT COALESCE(MAX(id), 1) FROM support_tickets), true)`
  );
}

async function bumpSupportTicketItemSequence(crm) {
  await crm.query(
    `SELECT setval('support_ticket_items_id_seq', (SELECT COALESCE(MAX(id), 1) FROM support_ticket_items), true)`
  );
}

async function bumpAllocationLogSequence(crm) {
  await crm.query(
    `SELECT setval('allocation_logs_id_seq', (SELECT COALESCE(MAX(id), 1) FROM allocation_logs), true)`
  );
}

module.exports = {
  normalizeEmail,
  normalizeGst,
  str,
  parseJson,
  extractAddressText,
  findExistingByEmailOrGst,
  getCrmId,
  setCrmId,
  bumpVendorSequence,
  bumpCustomerSequence,
  bumpCustomerAddressSequence,
  bumpPoSequence,
  bumpSpoSequence,
  bumpInventorySequence,
  bumpGrnSequence,
  bumpSerialSequence,
  bumpSalesOrderLineSequence,
  bumpDeliveryChallanLineSequence,
  bumpSupportTicketSequence,
  bumpSupportTicketItemSequence,
  bumpAllocationLogSequence,
};
