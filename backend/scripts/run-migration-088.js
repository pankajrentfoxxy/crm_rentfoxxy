require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/088_parts_management_flow.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('part_instances','ticket_part_blocks')`
  );
  const seqs = await pool.query(
    `SELECT doc_type FROM sm_document_sequences
      WHERE doc_type IN ('part_request','part_instance')`
  );
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'part_requests'
        AND column_name IN ('request_type','blocks_stage','instance_id','request_number')`
  );
  const tcol = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = 'open_part_requests'`
  );

  console.log('Migration 088 OK');
  console.log('  tables   :', tables.rows.map((r) => r.table_name).join(', '));
  console.log('  sequences:', seqs.rows.map((r) => r.doc_type).join(', '));
  console.log('  pr cols  :', cols.rows.map((r) => r.column_name).join(', '));
  console.log('  tickets.open_part_requests:', tcol.rows.length ? 'yes' : 'NO');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
