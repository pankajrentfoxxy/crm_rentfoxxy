require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const sql = `
BEGIN;

UPDATE delivery_challan_lines
SET pre_dispatch_qc_ticket_id = NULL,
    pre_dispatch_qc_passed = FALSE
WHERE pre_dispatch_qc_ticket_id IS NOT NULL;

UPDATE support_ticket_items
SET floor_ticket_id = NULL
WHERE floor_ticket_id IS NOT NULL;

UPDATE part_instances
SET installed_ticket_id = NULL,
    installed_at = NULL
WHERE installed_ticket_id IS NOT NULL;

UPDATE sales_order_serials
SET qc_ticket_id = NULL
WHERE qc_ticket_id IS NOT NULL;

UPDATE customer_credit_notes
SET return_ticket_id = NULL
WHERE return_ticket_id IS NOT NULL;

UPDATE vendor_debit_notes
SET return_ticket_id = NULL
WHERE return_ticket_id IS NOT NULL;

TRUNCATE TABLE
  qc_photos,
  diagnosis_images,
  diagnosis_parts_required,
  ticket_part_blocks,
  activities,
  work_logs,
  ticket_parts,
  photos,
  ticket_services,
  ticket_checklist_progress,
  chip_level_repairs,
  qc_results,
  diagnosis_results,
  part_requests,
  ttspl_config_history,
  dc_qc_tickets
RESTART IDENTITY CASCADE;

DELETE FROM tickets;

COMMIT;
`;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tickets) AS tickets,
      (SELECT COUNT(*)::int FROM delivery_challan_lines) AS dc_lines,
      (SELECT COUNT(*)::int FROM support_tickets) AS support_tickets
  `);
  console.log('Before:', before.rows[0]);

  await pool.query(sql);

  const after = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tickets) AS tickets,
      (SELECT COUNT(*)::int FROM delivery_challan_lines) AS dc_lines,
      (SELECT COUNT(*)::int FROM support_tickets) AS support_tickets,
      (SELECT COUNT(*)::int FROM activities) AS activities
  `);
  console.log('After:', after.rows[0]);
  console.log('Floor ticket reset completed successfully.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Reset failed:', err.message);
  try {
    await pool.query('ROLLBACK');
  } catch (_) { /* ignore */ }
  await pool.end();
  process.exit(1);
});
