#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { getCrmPool, closePools } = require('../lib/db');

async function main() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const dcs = src.getTableRows('delivery_challans');
  const crm = getCrmPool();

  const erpByStatus = {};
  const erpPendingDc = new Set();
  const erpInTransitDc = new Set();
  for (const dc of dcs) {
    const st = String(dc.status || 'null').toLowerCase();
    erpByStatus[st] = (erpByStatus[st] || 0) + 1;
    if (st === 'pending' && dc.dc_number) erpPendingDc.add(String(dc.dc_number));
    if (st === 'in_transit' && dc.dc_number) erpInTransitDc.add(String(dc.dc_number));
  }

  console.log('ERP row counts by status:', erpByStatus);
  console.log('ERP distinct dc_number status=pending:', erpPendingDc.size);
  console.log('ERP distinct dc_number status=in_transit:', erpInTransitDc.size);

  const crmStatus = await crm.query(`
    SELECT status, COUNT(*) rows, COUNT(DISTINCT dc_number) dcs
      FROM delivery_challan_lines
     WHERE COALESCE(movement_type,'outbound')='outbound'
     GROUP BY status ORDER BY status
  `);
  console.log('\nCRM outbound by status:');
  for (const r of crmStatus.rows) console.log(r);

  const crmPending = await crm.query(`
    SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines
     WHERE COALESCE(movement_type,'outbound')='outbound' AND status='pending'
  `);
  const crmInTransit = await crm.query(`
    SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines
     WHERE COALESCE(movement_type,'outbound')='outbound' AND status='in_transit'
  `);
  console.log('\nCRM distinct pending DC:', crmPending.rows[0].c);
  console.log('CRM distinct in_transit DC:', crmInTransit.rows[0].c);

  await closePools();
  src.end();
}

main().catch(console.error);
