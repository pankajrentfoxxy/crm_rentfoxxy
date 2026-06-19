require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/090_grn_config_verification.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'grn_serial_capture_tokens'
        AND column_name IN ('config_verified','config_verified_at','actual_config','config_check')`
  );
  const tbl = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'grn_config_verifications'`
  );
  console.log('Migration 090 OK');
  console.log('  token columns:', cols.rows.map((r) => r.column_name).join(', '));
  console.log('  audit table  :', tbl.rows.length ? 'grn_config_verifications' : 'NO');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
