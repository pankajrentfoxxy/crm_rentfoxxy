const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const file = path.join(__dirname, '../migrations/088_parts_complete_flow.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration 088 applied.');

    const checks = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='part_instances') AS part_instances,
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='ticket_part_blocks') AS ticket_part_blocks,
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='part_requests' AND column_name='request_number') AS pr_request_number,
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='part_requests' AND column_name='instance_id') AS pr_instance_id,
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='tickets' AND column_name='open_part_requests') AS tickets_open,
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='parts' AND column_name='updated_at') AS parts_updated_at,
         (SELECT COUNT(*) FROM sm_document_sequences WHERE doc_type IN ('part_request','part_instance')) AS seqs,
         (SELECT COUNT(*) FROM permission_sections WHERE section IN ('parts_requests','parts_approval','parts_procurement')) AS perms`
    );
    console.table(checks.rows);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration 088 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
})();
