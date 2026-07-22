require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'support_ticket_items'
      AND column_name IN (
        'pickup_type','customer_otp_code','customer_otp_sent_at','customer_otp_verified_at',
        'warehouse_received_at','warehouse_esign_url','warehouse_esign_at','warehouse_esign_by',
        'porter_tracking_id','porter_order_id','return_dc_number'
      )
    ORDER BY column_name`);
  console.log('New support_ticket_items columns:', cols.rows.map((r) => r.column_name).join(', '));

  const seq = await pool.query(`SELECT doc_type, last_value, prefix FROM sm_document_sequences WHERE doc_type = 'return_dc'`);
  console.log('return_dc sequence:', JSON.stringify(seq.rows[0] || null));

  const backfill = await pool.query(`
    SELECT pickup_type, COUNT(*)::int AS n
    FROM support_ticket_items
    WHERE item_type = 'pickup'
    GROUP BY pickup_type ORDER BY pickup_type`);
  console.log('Pickup item types after backfill:', JSON.stringify(backfill.rows));

  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
