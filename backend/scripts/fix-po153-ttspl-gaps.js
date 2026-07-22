#!/usr/bin/env node
/**
 * Close a TTSPL gap on PO-0155 (po_id=153) by shifting every laptop AFTER the gap
 * down by one number (7483→7482 … 7489→7488). Next new GRN receive gets TTSPL7489.
 *
 *   node scripts/fix-po153-ttspl-gaps.js              # dry-run
 *   node scripts/fix-po153-ttspl-gaps.js --commit
 *   node scripts/fix-po153-ttspl-gaps.js --gap=7482
 */
require('dotenv').config();
const pool = require('../config/db');
const { formatTtspl, parseTtsplNum } = require('../services/vendorInventoryAssetCodeService');

const PO_ID = 153;
const COMMIT = process.argv.includes('--commit');
const GAP_ARG = process.argv.find((a) => a.startsWith('--gap='));
const FORCED_GAP = GAP_ARG ? Number(GAP_ARG.split('=')[1]) : null;

function holdCode(serialId) {
  return `TTSPLH${serialId}`;
}

/**
 * Find first missing integer in a sorted list of TTSPL numbers on this PO.
 */
function findFirstGap(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > 1) return sorted[i - 1] + 1;
  }
  return null;
}

/**
 * Build two-phase rename plan for all units with num > gap (shift each down by 1).
 */
function buildCascadePlan(rows, gapNum) {
  const toShift = rows
    .map((r) => ({
      ...r,
      num: parseTtsplNum(r.inventory_asset_code),
    }))
    .filter((r) => Number.isFinite(r.num) && r.num > gapNum)
    .sort((a, b) => a.num - b.num);

  if (!toShift.length) return { gapNum, phase1: [], phase2: [] };

  const phase1 = [];
  const phase2 = [];

  for (const row of toShift) {
    const target = row.num - 1;
    const from = formatTtspl(row.num);
    const to = formatTtspl(target);
    const isLowest = row.num === toShift[0].num;

    if (isLowest) {
      phase1.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        from,
        to: formatTtspl(gapNum),
        via: null,
      });
    } else {
      const hold = holdCode(row.serial_id);
      phase1.push({ serial_id: row.serial_id, serial_number: row.serial_number, from, to: hold, via: hold });
      phase2.push({ serial_id: row.serial_id, serial_number: row.serial_number, from: hold, to, via: null });
    }
  }

  return { gapNum, phase1, phase2 };
}

async function reassignTtsplById(client, serialId, serialNumber, oldTtspl, newTtspl) {
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
      WHERE serial_id = $1 AND (ttspl_id ILIKE $2 OR ttspl_id IS NULL)`,
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
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE po_id = $1 AND deleted_at IS NULL
          AND inventory_asset_code ~ '^TTSPL[0-9]+$'
        ORDER BY CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)`,
      [PO_ID]
    );

    const nums = before.rows
      .map((r) => parseTtsplNum(r.inventory_asset_code))
      .filter((n) => Number.isFinite(n));

    const gapNum = FORCED_GAP || findFirstGap(nums);
    if (!gapNum) {
      console.log('\nNo TTSPL gap found on this PO — nothing to fix.\n');
      return;
    }

    const plan = buildCascadePlan(before.rows, gapNum);
    const shiftCount = plan.phase1.length;

    console.log(`\n=== Fix TTSPL gap on ${poRes.rows[0].purchase_order_number} (po_id=${PO_ID}) ===`);
    console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
    console.log(`Gap at: ${formatTtspl(gapNum)}`);
    console.log(`Units to shift down: ${shiftCount} (${formatTtspl(gapNum + 1)} … ${formatTtspl(nums[nums.length - 1])})`);
    console.log(`After fix, highest on PO: ${formatTtspl(nums[nums.length - 1] - 1)}`);
    console.log(`Next new GRN receive will get: ${formatTtspl(nums[nums.length - 1])}\n`);

    console.log('Before:');
    for (const r of before.rows) console.log(`  ${r.inventory_asset_code}  ${r.serial_number}`);

    console.log('\nPhase 1 (move to hold / fill gap):');
    for (const step of plan.phase1) {
      console.log(`  ${step.serial_number}: ${step.from} → ${step.to}`);
    }
    if (plan.phase2.length) {
      console.log('\nPhase 2 (hold → final):');
      for (const step of plan.phase2) {
        console.log(`  ${step.serial_number}: ${step.from} → ${step.to}`);
      }
    }

    if (!COMMIT) {
      console.log('\nDry-run OK — pass --commit to apply.\n');
      return;
    }

    await client.query('BEGIN');

    for (const step of plan.phase1) {
      await reassignTtsplById(client, step.serial_id, step.serial_number, step.from, step.to);
    }
    for (const step of plan.phase2) {
      await reassignTtsplById(client, step.serial_id, step.serial_number, step.from, step.to);
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
          AND inventory_asset_code ~ '^TTSPL[0-9]+$'
        ORDER BY CAST(SUBSTRING(inventory_asset_code FROM 6) AS INTEGER)`,
      [PO_ID]
    );
    console.log('\nAfter:');
    for (const r of after.rows) console.log(`  ${r.inventory_asset_code}  ${r.serial_number}`);
    console.log(`\nSequence next_num set to ${newNext} → next receive: ${formatTtspl(newNext)}\n`);
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
