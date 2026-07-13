const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/138_support_ticket_items_processor.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('138_support_ticket_items_processor.sql') ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    console.log('Migration 138 applied: support_ticket_items.processor column.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
