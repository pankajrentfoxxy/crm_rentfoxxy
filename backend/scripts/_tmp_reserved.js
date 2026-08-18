require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const r = await pool.query(
    `SELECT s.serial_id, s.inventory_status, s.qc_status,
            t.ticket_id, t.status AS ticket_status, st.stage_name
       FROM vendor_serial_numbers s
       LEFT JOIN tickets t ON t.vendor_serial_id = s.serial_id AND t.status NOT IN ('completed','cancelled')
       LEFT JOIN stages st ON st.stage_id = t.current_stage_id
      WHERE s.serial_id = ANY($1::int[])`,
    [[1383, 3369]]
  );
  console.log(r.rows);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
