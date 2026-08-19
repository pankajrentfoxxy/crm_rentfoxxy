#!/usr/bin/env node
/**
 * Import HDD REPRORT.xlsx into part_instances as discarded, then create one draft Scrap Challan.
 *
 * Sheet2 layout: three side-by-side columns (1TB / 320GB / 500GB) with serial numbers.
 *
 * Usage:
 *   node scripts/import-hdd-scrap-report.js [--dry-run] [path/to/HDD REPRORT.xlsx]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { generatePrtId } = require('../services/partIdService');
const { recordMovement, MOVEMENT } = require('../services/partMovementService');
const { resolveOrCreateFloorPartId, normalizeCategory } = require('../services/partInventoryService');
const { createScrapChallan } = require('../services/scrapChallanService');

const DEFAULT_FILE = path.join(__dirname, '../../HDD REPRORT.xlsx');
const SHEET_NAME = 'Sheet2';
const DEFAULT_RECIPIENT_NAME = 'Scrap buyer (update before dispatch)';
const DEFAULT_RECIPIENT_ADDRESS = 'Address to be updated before dispatch';
const NOTES = 'Imported from HDD REPRORT.xlsx';

const GROUPS = [
  { titleCol: 0, serialCol: 1 },
  { titleCol: 3, serialCol: 4 },
  { titleCol: 6, serialCol: 7 },
];

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseGroupHeader(raw) {
  const h = trim(raw);
  const m = h.match(/^(.+?)\s*\(\s*PRICE\s*(\d+)/i);
  if (m) {
    return {
      partName: m[1].replace(/\s+/g, ' ').trim(),
      unitCost: Number(m[2]) || 0,
    };
  }
  return { partName: h || 'HDD', unitCost: 0 };
}

function parseSheet2(workbook) {
  const sheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 3) return [];

  const headerRow = rows[0];
  const groups = GROUPS.map(({ titleCol, serialCol }) => ({
    serialCol,
    ...parseGroupHeader(headerRow[titleCol]),
  }));

  const items = [];
  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r] || [];
    for (const g of groups) {
      const serial = trim(row[g.serialCol]);
      if (!serial || serial.toLowerCase() === 's/n no.' || serial.toLowerCase() === 's.no') continue;
      items.push({
        row: r + 1,
        partName: g.partName,
        unitCost: g.unitCost,
        serialNumber: serial,
      });
    }
  }
  return items;
}

async function findExistingSerial(client, serial) {
  const r = await client.query(
    `SELECT pi.*, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE LOWER(TRIM(COALESCE(pi.serial_number, ''))) = LOWER($1)
      ORDER BY pi.instance_id DESC
      LIMIT 1`,
    [serial]
  );
  return r.rows[0] || null;
}

async function markDiscarded(client, inst, { unitCost, notes, actorUserId }) {
  const wasInStock = inst.status === 'in_stock';
  await client.query(
    `UPDATE part_instances
        SET status = 'discarded',
            unit_cost = COALESCE($2, unit_cost),
            notes = COALESCE($3, notes),
            updated_at = NOW()
      WHERE instance_id = $1`,
    [inst.instance_id, unitCost != null ? unitCost : null, notes]
  );
  if (wasInStock) {
    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, COALESCE(quantity, 0) - 1), updated_at = NOW() WHERE part_id = $1`,
      [inst.part_id]
    );
  }
  await recordMovement(client, {
    type: MOVEMENT.DISCARDED,
    partId: inst.part_id,
    instanceId: inst.instance_id,
    prtId: inst.prt_id,
    serialNumber: inst.serial_number,
    category: inst.category,
    partName: inst.part_name,
    unitCost: unitCost ?? inst.unit_cost,
    notes,
    actorUserId,
    actorName: 'import-hdd-scrap-report',
  });
  return inst.instance_id;
}

async function createDiscarded(client, { partId, part, serialNumber, unitCost, notes, actorUserId }) {
  const prtId = await generatePrtId(new Date(), client);
  const cost = unitCost != null ? unitCost : Number(part?.cost || 0);
  const ins = await client.query(
    `INSERT INTO part_instances
       (prt_id, serial_number, part_id, unit_cost, status, notes, source,
        received_by, received_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'discarded',$5,'manual',$6,NOW(),NOW(),NOW())
     RETURNING instance_id, prt_id, serial_number, unit_cost`,
    [prtId, serialNumber, Number(partId), cost, notes, actorUserId || null]
  );
  const row = ins.rows[0];
  await recordMovement(client, {
    type: MOVEMENT.DISCARDED,
    partId: Number(partId),
    instanceId: row.instance_id,
    prtId: row.prt_id,
    serialNumber: row.serial_number,
    category: part?.category,
    partName: part?.part_name,
    unitCost: cost,
    notes,
    actorUserId,
    actorName: 'import-hdd-scrap-report',
  });
  return row.instance_id;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fileArg = process.argv.find((a) => !a.startsWith('-') && /\.xlsx$/i.test(a));
  const filePath = fileArg || DEFAULT_FILE;

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const items = parseSheet2(workbook);
  console.log(`Parsed ${items.length} HDD serial(s) from ${path.basename(filePath)} (${SHEET_NAME})`);
  if (!items.length) {
    console.error('No serial numbers found.');
    process.exit(1);
  }

  const byPart = {};
  for (const it of items) {
    byPart[it.partName] = (byPart[it.partName] || 0) + 1;
  }
  console.log('Breakdown:', byPart);

  if (dryRun) {
    console.log('\n*** DRY RUN — sample ***');
    items.slice(0, 5).forEach((it) => {
      console.log(`  ${it.partName} @ ₹${it.unitCost} — ${it.serialNumber}`);
    });
    console.log(`  ... ${items.length - 5} more`);
    return;
  }

  const client = await pool.connect();
  const summary = { created: [], updated: [], skipped: [], errors: [] };
  const instanceIds = [];

  try {
    await client.query('BEGIN');

    for (const item of items) {
      try {
        const existing = await findExistingSerial(client, item.serialNumber);
        if (existing) {
          if (existing.scrap_challan_number) {
            summary.skipped.push({ serial: item.serialNumber, reason: `On challan ${existing.scrap_challan_number}` });
            continue;
          }
          if (existing.status === 'scrapped') {
            summary.skipped.push({ serial: item.serialNumber, reason: 'Already scrapped' });
            continue;
          }
          if (existing.status === 'discarded') {
            instanceIds.push(existing.instance_id);
            summary.skipped.push({ serial: item.serialNumber, prt_id: existing.prt_id, reason: 'Already discarded' });
            continue;
          }
          if (!['in_stock', 'defective'].includes(existing.status)) {
            summary.errors.push({ serial: item.serialNumber, reason: `Status is ${existing.status}` });
            continue;
          }
          const id = await markDiscarded(client, existing, {
            unitCost: item.unitCost,
            notes: NOTES,
            actorUserId: null,
          });
          instanceIds.push(id);
          summary.updated.push({ serial: item.serialNumber, prt_id: existing.prt_id });
          continue;
        }

        const partId = await resolveOrCreateFloorPartId(client, {
          part_name: item.partName,
          category: 'storage',
        });
        const partRes = await client.query(
          `SELECT part_id, part_name, category, cost FROM parts WHERE part_id = $1`,
          [partId]
        );
        const part = partRes.rows[0];
        const id = await createDiscarded(client, {
          partId,
          part,
          serialNumber: item.serialNumber,
          unitCost: item.unitCost,
          notes: NOTES,
          actorUserId: null,
        });
        instanceIds.push(id);
        summary.created.push({ serial: item.serialNumber, part: item.partName });
      } catch (err) {
        summary.errors.push({ serial: item.serialNumber, reason: err.message });
      }
    }

    const uniqueIds = [...new Set(instanceIds)];
    let challanNumber = null;
    if (uniqueIds.length) {
      try {
        const tableCheck = await client.query(`SELECT to_regclass('public.scrap_challans') AS t`);
        if (tableCheck.rows[0]?.t) {
          const challan = await createScrapChallan(client, {
            instanceIds: uniqueIds,
            recipientName: DEFAULT_RECIPIENT_NAME,
            recipientAddress: DEFAULT_RECIPIENT_ADDRESS,
            remarks: `Bulk import from ${path.basename(filePath)} — update recipient before dispatch`,
            itemRemarks: {},
            actorUserId: null,
          });
          challanNumber = challan.challan_number;
        } else {
          console.warn('\nNote: scrap_challans table missing — run migration 196, then create challan from Discarded Parts UI.');
        }
      } catch (chErr) {
        console.warn('\nScrap challan not created:', chErr.message);
        console.warn('Parts were imported as discarded. Select them on Discarded Parts → Convert to Scrap.');
      }
    }

    await client.query('COMMIT');

    console.log('\n--- Import complete ---');
    console.log(`Created: ${summary.created.length}`);
    console.log(`Updated to discarded: ${summary.updated.length}`);
    console.log(`Skipped: ${summary.skipped.length}`);
    console.log(`Errors: ${summary.errors.length}`);
    console.log(`Scrap challan (draft): ${challanNumber || 'none'}`);
    console.log(`Parts on challan: ${uniqueIds.length}`);

    if (summary.errors.length) {
      summary.errors.forEach((e) => console.log(`  ERROR ${e.serial}: ${e.reason}`));
    }
    if (challanNumber) {
      console.log(`\nOpen: Inventory → Scrap Challans → ${challanNumber}`);
      console.log('Update recipient details, then dispatch when ready.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
