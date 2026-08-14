const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/193_bluedart_awb_tracking_sync.sql'),
    'utf8'
  );
  await pool.query(sql);
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'delivery_challan_lines'
      AND column_name LIKE 'courier_%'
    ORDER BY 1
  `);
  console.log('ok', r.rows.map((x) => x.column_name));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
