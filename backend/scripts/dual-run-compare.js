'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const day = new Date().toISOString().slice(0, 10);
  const legacy = await pool.query(`
    SELECT status, COUNT(*)::int AS n
      FROM support_tickets
     GROUP BY status
     ORDER BY status
  `).catch(() => ({ rows: [] }));
  const v2 = await pool.query(`
    SELECT status, COUNT(*)::int AS n
      FROM support_tickets_v2
     GROUP BY status
     ORDER BY status
  `);
  const disagreements = await pool.query(`
    SELECT t.ticket_id AS legacy_id, t.ticket_number AS legacy_number, t.status AS legacy_status,
           v.ticket_id AS v2_id, v.ticket_number AS v2_number, v.status AS v2_status
      FROM support_tickets t
      JOIN support_tickets_v2 v ON v.legacy_ticket_id = t.ticket_id
     WHERE UPPER(COALESCE(t.status,'')) <> UPPER(COALESCE(v.status,''))
     LIMIT 200
  `).catch(() => ({ rows: [] }));

  const legacyOpen = legacy.rows.filter((r) => !/closed|cancelled|resolved/i.test(r.status || '')).reduce((s, r) => s + r.n, 0);
  const v2Open = v2.rows.filter((r) => !/CLOSED|CANCELLED|RESOLVED/.test(r.status || '')).reduce((s, r) => s + r.n, 0);

  await pool.query(
    `INSERT INTO support_dual_run_snapshots
       (snapshot_date, legacy_open, v2_open, legacy_by_status, v2_by_status, disagreements)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)
     ON CONFLICT (snapshot_date) DO UPDATE
       SET legacy_open = EXCLUDED.legacy_open,
           v2_open = EXCLUDED.v2_open,
           legacy_by_status = EXCLUDED.legacy_by_status,
           v2_by_status = EXCLUDED.v2_by_status,
           disagreements = EXCLUDED.disagreements`,
    [
      day, legacyOpen, v2Open,
      JSON.stringify(Object.fromEntries(legacy.rows.map((r) => [r.status, r.n]))),
      JSON.stringify(Object.fromEntries(v2.rows.map((r) => [r.status, r.n]))),
      JSON.stringify(disagreements.rows),
    ]
  ).catch((e) => {
    if (!/does not exist/i.test(e.message || '')) throw e;
  });

  const existing = fs.readdirSync(path.join(__dirname, '../../docs/support-revamp'))
    .filter((f) => /^DUAL_RUN_DAY_\d+\.md$/.test(f));
  const nn = String(existing.length + 1).padStart(2, '0');
  const out = path.join(__dirname, '../../docs/support-revamp', `DUAL_RUN_DAY_${nn}.md`);
  const lines = [
    `# Dual run ${day}`,
    '',
    `- Legacy open: ${legacyOpen}`,
    `- v2 open: ${v2Open}`,
    `- Disagreements: ${disagreements.rows.length}`,
    '',
    '## Legacy by status',
    ...legacy.rows.map((r) => `- ${r.status}: ${r.n}`),
    '',
    '## v2 by status',
    ...v2.rows.map((r) => `- ${r.status}: ${r.n}`),
    '',
    '## Disagreements',
    disagreements.rows.length
      ? disagreements.rows.map((r) => `- ${r.legacy_number} ${r.legacy_status} ≠ ${r.v2_number} ${r.v2_status}`).join('\n')
      : 'None.',
    '',
  ];
  fs.writeFileSync(out, lines.join('\n'));
  console.log(out);
  if (disagreements.rows.length) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
