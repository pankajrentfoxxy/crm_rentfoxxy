require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';
const pool = require('../config/db');

async function main() {
  const ticketId = Number(process.argv[2]) || 1922;
  const t = await pool.query(
    `SELECT t.ticket_id, t.sales_order_number, s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1`,
    [ticketId]
  );
  console.log('ticket', t.rows[0]);
  if (t.rows[0]?.sales_order_number) {
    const w = await pool.query(
      `SELECT sales_order_number, status, qc_started_at, qc_due_at, qc_overdue
         FROM dispatch_workflow
        WHERE sales_order_number = $1`,
      [t.rows[0].sales_order_number]
    );
    console.log('workflow', w.rows[0]);
  }
  const c = await pool.query('SELECT qc_eta_minutes FROM dispatch_workflow_config WHERE id = 1');
  console.log('config', c.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
