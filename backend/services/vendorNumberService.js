const pool = require('../config/db');

async function nextPurchaseOrderNumber() {
  const r = await pool.query(`SELECT COALESCE(MAX(po_id), 0) + 1 AS n FROM vendor_purchase_orders`);
  const n = r.rows[0].n;
  return `PO-${String(n).padStart(4, '0')}`;
}

async function nextSparePartsPurchaseOrderNumber() {
  const r = await pool.query(`SELECT COALESCE(MAX(spo_id), 0) + 1 AS n FROM vendor_spare_parts_purchase_orders`);
  const n = r.rows[0].n;
  return `SP-PO-${String(n).padStart(4, '0')}`;
}

module.exports = {
  nextPurchaseOrderNumber,
  nextSparePartsPurchaseOrderNumber
};
