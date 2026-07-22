#!/usr/bin/env node
/**
 * Sync customer deployed assets from delivered outbound DCs.
 * Usage: node scripts/sync-customer-deployed-assets.js [customerId]
 */
const pool = require('../config/db');
const { syncDeployedAssets, fetchDeploymentGaps } = require('../services/customerDeployedAssetsSyncService');

async function main() {
  const customerId = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const client = await pool.connect();
  try {
    const gaps = await fetchDeploymentGaps(client, { customerId });
    console.log(`Found ${gaps.length} deployment gap(s)${customerId ? ` for customer ${customerId}` : ''}`);

    await client.query('BEGIN');
    const out = await syncDeployedAssets(client, { customerId, actorName: 'sync-customer-deployed-assets' });
    await client.query('COMMIT');

    console.log(`Synced ${out.synced}/${out.scanned}`);
    if (out.failed.length) {
      console.log('Failures:', out.failed.slice(0, 20));
    }

    const targets = ['C077YZ2', 'DTP70J3', '6D4C3F3', 'H549HC2', 'F446PH2', 'F51RF12'];
    const verify = await client.query(
      `SELECT serial_number, inventory_status, current_customer_id, current_dc_number
         FROM vendor_serial_numbers
        WHERE serial_number = ANY($1::text[]) AND deleted_at IS NULL`,
      [targets]
    );
    console.log('Target serials after sync:', verify.rows);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
