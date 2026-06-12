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
    '037_vendor_serial_inventory_meta.sql',
    '038_inventory_management_laravel_views.sql',
    '052_phase1_vendor_procurement.sql',
    '055_vendor_portal_sessions.sql'
  ]) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
}

async function ensureVendorBillingSchema() {
  for (const file of ['053_vendor_billing_tables.sql', '054_vendor_invoice_upload.sql']) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
}

module.exports = { ensureVendorManagementSchema, ensureVendorBillingSchema };
