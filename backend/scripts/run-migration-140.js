require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/140_dc_assignment_history.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('140_dc_assignment_history.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    console.log('Migration 140 applied.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
