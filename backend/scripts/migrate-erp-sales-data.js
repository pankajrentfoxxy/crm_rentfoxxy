/**
 * Optional: copy ERP sales documents into CRM tables via rentfoxxy-api.
 * Usage: node scripts/migrate-erp-sales-data.js
 * Requires ERP_BASE_URL + ERP_API_TOKEN in env.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const pool = require('../config/db');

const ERP_BASE = process.env.ERP_BASE_URL || 'https://erp.rentfoxxy.com/rentfoxxy-api';
const TOKEN = process.env.ERP_API_TOKEN || '';

async function fetchErp(path) {
  const { data } = await axios.get(`${ERP_BASE}${path}`, {
    headers: { Authorization: TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}` },
    timeout: 60000,
  });
  return data;
}

async function main() {
  console.log('ERP sales data migration — stub. Implement pagination per ERP list APIs.');
  console.log('Target tables: sales_quotations, sales_order_lines, delivery_challan_lines');
  await pool.query('SELECT 1');
  console.log('DB connection OK. Extend this script to map ERP rows into CRM schema.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
