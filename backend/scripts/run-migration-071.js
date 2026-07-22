require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/071_phase9_floor_fixes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ticket_parts' AND column_name IN ('unit_cost', 'is_upgrade')
     ORDER BY column_name`
  );
  console.log('Migration 071 OK — ticket_parts columns:', check.rows.map((r) => r.column_name).join(', '));
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
