'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const r = await pool.query(
    `SELECT dc_number, delivery_person_id, created_at
       FROM delivery_challan_lines
      WHERE assigned_user_id IS NULL
        AND delivery_person_id IS NOT NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT 500`
  );
  const lines = [
    '# Unresolved delivery identity',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'These `delivery_challan_lines` rows have a `delivery_person_id` that matched neither `users.user_id` nor `delivery_technicians.technician_id` (with a linked `user_id`). Fix them by hand, then re-run migration 210.',
    '',
    `| dc_number | delivery_person_id | created_at |`,
    `|---|---|---|`,
    ...r.rows.map((x) => `| ${x.dc_number || ''} | ${x.delivery_person_id} | ${x.created_at || ''} |`),
    '',
    r.rows.length ? `${r.rows.length} row(s) listed (capped at 500).` : 'None — every resolvable DC line has `assigned_user_id`.',
    '',
  ];
  const dest = path.join(__dirname, '../../docs/support-revamp/IDENTITY_UNRESOLVED.md');
  fs.writeFileSync(dest, lines.join('\n'));
  console.log(`Wrote ${dest} (${r.rows.length} unresolved)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
