require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/125_vendor_repair_dispatch.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration 125 applied.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
