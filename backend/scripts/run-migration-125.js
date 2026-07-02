<<<<<<< HEAD
#!/usr/bin/env node
require('dotenv').config();
=======
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
>>>>>>> 6fabf54f74e8859cd2cf7e81e0dd94b331e612e7
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
<<<<<<< HEAD
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '125_asset_config_brand_allowlist.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 125 applied (asset config brand allowlist).');
  await pool.end();
})().catch((e) => {
  console.error(e);
=======
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/125_vendor_repair_dispatch.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration 125 applied.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
>>>>>>> 6fabf54f74e8859cd2cf7e81e0dd94b331e612e7
  process.exit(1);
});
