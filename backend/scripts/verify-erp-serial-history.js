require('dotenv').config();
const pool = require('../config/db');
const { loadErpSerialHistory } = require('../services/erpSerialHistoryService');

async function main() {
  const serial = process.argv[2] || 'TTSPL7357';
  const db = await pool.query(
    `SELECT COUNT(*)::int AS c FROM inward_outward WHERE source = 'erp' AND unique_number = $1`,
    [serial]
  );
  console.log('direct rows for', serial, db.rows[0].c);

  const erpIds = [15412, 15660, 15911, 15919, 16004, 16672];
  const byErp = await pool.query(
    `SELECT erp_id, io_type, purpose, created_at FROM inward_outward WHERE erp_id = ANY($1::bigint[]) ORDER BY created_at`,
    [erpIds]
  );
  if (serial.toUpperCase().includes('7357')) {
    console.log('expected erp ids found:', byErp.rows.length, byErp.rows);
  }

  const r = await loadErpSerialHistory(pool, serial);
  console.log('service count', r.erp_history_count);
  r.erp_history.forEach((row) => {
    console.log(row.sno, row.date_display, row.type_display, row.purpose_display, row.party.name);
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
