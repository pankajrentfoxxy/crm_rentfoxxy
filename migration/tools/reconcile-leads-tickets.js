#!/usr/bin/env node
/**
 * Before/after counts: refurb source DB vs CRM target for Leads + Tickets.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { createRefurbSource, closeRefurbPool } = require('../lib/refurbSource');

async function count(pool, sql) {
  const { rows } = await pool.query(sql);
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  const crm = getCrmPool();
  let source;
  try {
    source = await createRefurbSource();
  } catch (e) {
    console.error('Cannot connect to refurb source DB:', e.message);
    console.error('Restore laptop_refurbishment_backup.sql and set REFURB_DATABASE_URL in migration/.env');
    process.exit(1);
  }

  const tables = [
    'leads',
    'lead_activities',
    'lead_assignments',
    'lead_remarks',
    'lead_company_research',
    'lead_followup_notifications',
    'tickets',
    'activities',
    'work_logs',
    'ticket_parts',
    'part_requests',
  ];

  console.log('\n=== Leads + Tickets reconciliation ===\n');
  console.log('Table'.padEnd(32), 'Source'.padStart(8), 'Target'.padStart(8), 'Delta'.padStart(8));
  console.log('-'.repeat(58));

  let leadSrc = 0;
  let leadTgt = 0;
  let ticketSrc = 0;
  let ticketTgt = 0;

  for (const t of tables) {
    const [srcRows] = await source.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
    const src = Number(srcRows[0]?.c ?? 0);
    let tgt = 0;
    try {
      tgt = await count(crm, `SELECT COUNT(*)::int AS c FROM ${t}`);
    } catch (e) {
      console.log(t.padEnd(32), String(src).padStart(8), 'ERR'.padStart(8));
      continue;
    }
    const delta = tgt - src;
    console.log(t.padEnd(32), String(src).padStart(8), String(tgt).padStart(8), String(delta).padStart(8));
    if (t === 'leads') {
      leadSrc = src;
      leadTgt = tgt;
    }
    if (t === 'tickets') {
      ticketSrc = src;
      ticketTgt = tgt;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Source leads:  ${leadSrc}`);
  console.log(`Target leads:  ${leadTgt}`);
  console.log(`Source tickets: ${ticketSrc}`);
  console.log(`Target tickets: ${ticketTgt}`);

  const dupLeads = await crm.query(
    `SELECT COUNT(*)::int AS c FROM (
       SELECT LOWER(TRIM(COALESCE(email, ''))) AS em, TRIM(COALESCE(phone, '')) AS ph
       FROM leads
       WHERE COALESCE(email, '') <> '' OR COALESCE(phone, '') <> ''
       GROUP BY 1, 2
       HAVING COUNT(*) > 1
     ) d`
  );
  const orphanAct = await crm.query(
    `SELECT COUNT(*)::int AS c FROM lead_activities la
      LEFT JOIN leads l ON l.lead_id = la.lead_id WHERE l.lead_id IS NULL`
  );
  const orphanTicketAct = await crm.query(
    `SELECT COUNT(*)::int AS c FROM activities a
      LEFT JOIN tickets t ON t.ticket_id = a.ticket_id WHERE t.ticket_id IS NULL`
  );
  console.log(`Duplicate lead email+phone groups: ${dupLeads.rows[0]?.c ?? 0}`);
  console.log(`Orphan lead_activities: ${orphanAct.rows[0]?.c ?? 0}`);
  console.log(`Orphan ticket activities: ${orphanTicketAct.rows[0]?.c ?? 0}`);

  await closeRefurbPool();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
