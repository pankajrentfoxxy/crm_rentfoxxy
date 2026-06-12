const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const pre = await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ttspl_audit_log') AS audit_log,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'ticket_type') AS ticket_type
  `);
  console.log('Pre-check:', pre.rows[0]);

  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/056_phase2_floor_pipeline.sql'),
    'utf8'
  );
  await pool.query(sql);
  console.log('Migration 056 OK (idempotent)');

  const sections = await pool.query(`
    SELECT section FROM permission_sections
    WHERE section LIKE 'floor%' OR section IN ('chip_level_repair', 'parts_inventory', 'ttspl_history')
    ORDER BY section
  `);
  console.log('Phase 2 sections:', sections.rows.map((r) => r.section).join(', '));

  await pool.end();
}

main().catch(async (e) => {
  console.error('Failed:', e.message);
  await pool.end();
  process.exit(1);
});
