const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function ensureVendorManagementSchema() {
  for (const file of [
    '032_vendor_management.sql',
    '033_vendor_po_bills.sql',
    '034_vendor_spo_bills_and_parts_catalog.sql',
    '035_vendor_spare_grn_serial.sql',
    '036_vendor_serial_ttspl_and_rental.sql',
    '037_vendor_serial_inventory_meta.sql'
  ]) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
}

module.exports = { ensureVendorManagementSchema };
