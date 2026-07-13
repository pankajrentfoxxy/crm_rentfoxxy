#!/usr/bin/env node
/**
 * Close TTSPL gap on PO-0155 (po_id=153): shift 7483→7482, 7484→7483, 7485→7484.
 *
 *   node scripts/fix-po153-ttspl-gaps.js           # dry-run
 *   node scripts/fix-po153-ttspl-gaps.js --commit
 */
require('dotenv').config();
const pool = require('../config/db');
const { formatTtspl } = require('../services/vendorInventoryAssetCodeService');

const PO_ID = 153;
const COMMIT = process.argv.includes('--commit');

/** Renames in order: highest target first, via temporary code to avoid unique-index clashes. */
const RENAMES = [
  { serial: '5CG0278FK8', from: 'TTSPL7485', to: 'TTSPL7484', via: 'TTSPL7484_HOLD' },
  { serial: '5CG02747JL', from: 'TTSPL7484', to: 'TTSPL7483', via: 'TTSPL7483_HOLD' },
  { serial: '5CG0278MBZ', from: 'TTSPL7483', to: 'TTSPL7482', via: null },
];

async function reassignTtspl(client, serialNumber, oldTtspl, newTtspl) {
  const vsn = await client.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE serial_number ILIKE $1 AND deleted_at IS NULL`,
    [serialNumber]
  );
  if (!vsn.rows.length) throw new Error(`Serial ${serialNumber} not found`);
  const serialId = vsn.rows[0].serial_id;

  const conflict = await client.query(
    `SELECT serial_id, serial_number FROM vendor_serial_numbers
      WHERE inventory_asset_code ILIKE $1 AND serial_id <> $2 AND deleted_at IS NULL`,
    [newTtspl, serialId]
  );
  if (conflict.rows.length) {
    throw new Error(`${newTtspl} already used by ${conflict.rows[0].serial_number}`);
  }

  await client.query(
    `UPDATE vendor_serial_numbers
        SET inventory_asset_code = $3,
            extra = jsonb_set(
              jsonb_set(COALESCE(extra, '{}'::jsonb), '{ttspl_id}', to_jsonb($3::text)),
              '{unique_product_serial}', to_jsonb($3::text)
            ),
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId, oldTtspl, newTtspl]
  );

  await client.query(
    `UPDATE sales_order_serials SET ttspl_id = $3, updated_at = NOW()
      WHERE serial_id = $1 AND ttspl_id ILIKE $2`,
    [serialId, oldTtspl, newTtspl]
  ).catch(() => {});

  await client.query(
    `UPDATE tickets SET ttspl_id = $3, machine_number = $3, updated_at = NOW()
      WHERE vendor_serial_id = $1 AND (ttspl_id ILIKE $2 OR machine_number ILIKE $2)`,
    [serialId, oldTtspl, newTtspl]
  ).catch(() => {});

  await client.query(
    `UPDATE inventory_status_transitions SET ttspl_id = $3
      WHERE serial_id = $1 AND ttspl_id ILIKE $2`,
    [serialId, oldTtspl, newTtspl]
  ).catch(() => {});

  await client.query(
    `UPDATE ttspl_audit_log SET ttspl_id = $3
      WHERE vendor_serial_id = $1 AND ttspl_id ILIKE $2`,
    [serialId, oldTtspl, newTtspl]
  ).catch(() => {});

  return { serialId, serialNumber, oldTtspl, newTtspl };
}

async function main() {
  const client = await pool.connect();
  try {
    const poRes = await client.query(
      `SELECT purchase_order_number FROM vendor_purchase_orders WHERE po_id = $1`,
      [PO_ID]
    );
    if (!poRes.rows.length) throw new Error(`PO ${PO_ID} not found`);

    const before = await client.query(
      `SELECT serial_number, inventory_asset_code FROM vendor_serial_numbers
        WHERE po_id = $1 AND deleted_at IS NULL
        ORDER BY CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)`,
      [PO_ID]
    );

    console.log(`\n=== Fix TTSPL gap on ${poRes.rows[0].purchase_order_number} (po_id=${PO_ID}) ===`);
    console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);
    console.log('Before:');
    for (const r of before.rows) console.log(`  ${r.inventory_asset_code}  ${r.serial_number}`);

    console.log('\nPlanned renames:');
    for (const step of RENAMES) {
      const via = step.via ? ` (via ${step.via})` : '';
      console.log(`  ${step.serial}: ${step.from} → ${step.to}${via}`);
    }

    if (!COMMIT) {
      console.log('\nDry-run OK — pass --commit to apply.\n');
      return;
    }

    await client.query('BEGIN');
    for (const step of RENAMES) {
      if (step.via) {
        await reassignTtspl(client, step.serial, step.from, step.via);
        await reassignTtspl(client, step.serial, step.via, step.to);
      } else {
        await reassignTtspl(client, step.serial, step.from, step.to);
      }
    }

    const maxRes = await client.query(
      `SELECT MAX(CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)) AS n
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_asset_code ~ '^TTSPL[0-9]+$'`
    );
    const newNext = Number(maxRes.rows[0]?.n || 0) + 1;
    await client.query(
      `UPDATE vendor_inventory_asset_sequence SET next_num = GREATEST(next_num, $1) WHERE id = 1`,
      [newNext]
    );

    await client.query('COMMIT');

    const after = await pool.query(
      `SELECT serial_number, inventory_asset_code FROM vendor_serial_numbers
        WHERE po_id = $1 AND deleted_at IS NULL
        ORDER BY CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)`,
      [PO_ID]
    );
    console.log('\nAfter:');
    for (const r of after.rows) console.log(`  ${r.inventory_asset_code}  ${r.serial_number}`);
    console.log(`\nSequence next_num reconciled to >= ${formatTtspl(newNext)}\n`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
