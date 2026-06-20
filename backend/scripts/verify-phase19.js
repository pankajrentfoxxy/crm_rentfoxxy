require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const out = {};

  const tables = ['support_part_requests', 'support_part_challans', 'support_challan_items'];
  for (const t of tables) {
    const r = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1) AS ok`, [t]
    );
    out[`table_${t}`] = r.rows[0].ok;
  }

  const seq = await pool.query(
    `SELECT doc_type, last_value, prefix FROM sm_document_sequences
     WHERE doc_type IN ('support_part_request','support_part_challan') ORDER BY doc_type`
  );
  out.sequences = seq.rows;

  const perms = await pool.query(
    `SELECT role, section, can_view, can_create FROM role_permissions
     WHERE section IN ('support_part_requests','support_part_challan') ORDER BY section, role`
  );
  out.permissions = perms.rows;

  const constr = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname = 'part_instances_status_check'`
  );
  out.part_instances_status_check = constr.rows[0]?.def;

  const tickets = await pool.query(`SELECT COUNT(*)::int AS n FROM support_tickets`);
  const parts = await pool.query(`SELECT COUNT(*)::int AS n FROM parts WHERE NOT COALESCE(archived,false)`);
  out.support_tickets = tickets.rows[0].n;
  out.parts_available = parts.rows[0].n;

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
