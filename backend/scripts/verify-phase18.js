require('dotenv').config();
const pool = require('../config/db');

(async () => {
  try {
    const c = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='support_ticket_items'
         AND column_name IN ('visited_lat','visited_lng','ttspl_id','ttspl_verified',
           'ttspl_verified_at','ttspl_verified_by','reached_warehouse_at',
           'warehouse_received_by','floor_ticket_id','proof_of_completion_path')
       ORDER BY column_name`
    );
    console.log('item cols   :', c.rows.map((r) => r.column_name).join(', '));

    const o = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='support_replacement_orders'
         AND column_name IN ('sales_order_number','dc_number','pickup_pod_path',
           'new_dc_number','delivery_person_id','pickup_assigned_to')
       ORDER BY column_name`
    );
    console.log('order cols  :', o.rows.map((r) => r.column_name).join(', '));

    const p = await pool.query(
      `SELECT role FROM role_permissions WHERE section='support_technician' ORDER BY role`
    );
    console.log('tech perms  :', p.rows.map((r) => r.role).join(', '));
    process.exit(0);
  } catch (e) {
    console.error('verify failed:', e.message);
    process.exit(1);
  }
})();
