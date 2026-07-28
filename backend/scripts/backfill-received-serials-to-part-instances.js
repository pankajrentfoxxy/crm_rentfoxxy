/**
 * One-time backfill: copy already-received spare-parts serial numbers
 * (vendor_serial_numbers) into the Parts inventory (part_instances.serial_number).
 *
 * Behaviour (idempotent, safe to re-run):
 *  - For each received vendor serial (spo_id set, not soft-deleted), resolve the
 *    floor parts.part_id the same way the receive flow does.
 *  - If a matching part_instances row for that SPO/GRN/part already has this
 *    serial, skip it.
 *  - Else, if there is a serial-less part_instances row for that SPO/GRN/part
 *    (created earlier by the receive sync without a serial), PATCH its
 *    serial_number — no stock change (quantity was already counted).
 *  - Else, INSERT a fresh in_stock instance (with serial) and bump parts.quantity.
 *
 * Usage:
 *   node scripts/backfill-received-serials-to-part-instances.js            # apply
 *   node scripts/backfill-received-serials-to-part-instances.js --dry-run  # preview only
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const pool = require('../config/db');
const { resolveFloorPartsId } = require('../controllers/vendorManagement/sparePartsOrders.controller');
const { createPartInstances } = require('../services/partIdService');

const DRY_RUN = process.argv.includes('--dry-run');

function parseJsonMaybe(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function parseLineItems(raw) {
  const p = parseJsonMaybe(raw);
  return Array.isArray(p) ? p : [];
}

function lineMatchesPartId(line, partIdStr) {
  const ids = [
    line.product_detail_id, line.part_id, line.product_id, line.pro_id, line.id,
    line.floor_part_id, line.parts_catalog_id,
  ].map((v) => (v == null ? null : String(v)));
  return ids.includes(String(partIdStr));
}

async function main() {
  console.log(`\nBackfill received serials → part_instances ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}\n`);

  // 1) Load every received spare serial.
  const serialsRes = await pool.query(
    `SELECT serial_id, spo_id, grn_id, serial_number, extra
       FROM vendor_serial_numbers
      WHERE spo_id IS NOT NULL
        AND deleted_at IS NULL
        AND serial_number IS NOT NULL
        AND TRIM(serial_number) <> ''
      ORDER BY spo_id, grn_id, serial_id`
  );
  if (!serialsRes.rows.length) {
    console.log('No received spare serials found. Nothing to do.');
    return;
  }

  // 2) Cache SPO line_items.
  const spoIds = [...new Set(serialsRes.rows.map((r) => r.spo_id))];
  const spoRes = await pool.query(
    `SELECT spo_id, line_items FROM vendor_spare_parts_purchase_orders WHERE spo_id = ANY($1::int[])`,
    [spoIds]
  );
  const spoLines = new Map();
  spoRes.rows.forEach((row) => spoLines.set(row.spo_id, parseLineItems(row.line_items)));

  // 3) Group serials by (spo_id, grn_id, resolved floor part_id).
  const groups = new Map();
  let unresolved = 0;
  const partsIdCache = new Map();

  for (const row of serialsRes.rows) {
    const lines = spoLines.get(row.spo_id) || [];
    const extra = parseJsonMaybe(row.extra) || {};
    let line = null;

    const li = Number(extra.line_index);
    if (Number.isInteger(li) && li >= 0 && li < lines.length) {
      line = lines[li];
    }
    if (!line && extra.part_id != null) {
      line = lines.find((l) => lineMatchesPartId(l, extra.part_id)) || null;
    }
    if (!line && lines.length === 1) {
      [line] = lines;
    }
    if (!line) { unresolved += 1; continue; }

    const cacheKey = `${row.spo_id}|${extra.line_index ?? extra.part_id ?? 'x'}`;
    let partsId = partsIdCache.get(cacheKey);
    if (partsId === undefined) {
      partsId = await resolveFloorPartsId(line);
      partsIdCache.set(cacheKey, partsId);
    }
    if (!partsId) { unresolved += 1; continue; }

    const gkey = `${row.spo_id}|${row.grn_id || 0}|${partsId}`;
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        spoId: row.spo_id,
        grnId: row.grn_id || null,
        partsId,
        unitCost: Number(line.unit_price ?? line.rate ?? line.cost ?? 0),
        locationCode: line.location_code || null,
        batchNumber: line.batch_number || null,
        serials: [],
      });
    }
    groups.get(gkey).serials.push(String(row.serial_number).trim());
  }

  // 4) Apply per group.
  let patched = 0;
  let inserted = 0;
  let alreadyOk = 0;

  for (const g of groups.values()) {
    // Existing instances for this SPO/GRN/part.
    const instRes = await pool.query(
      `SELECT instance_id, serial_number
         FROM part_instances
        WHERE part_id = $1
          AND spo_id = $2
          AND (grn_id = $3 OR ($3 IS NULL AND grn_id IS NULL))
        ORDER BY instance_id`,
      [g.partsId, g.spoId, g.grnId]
    );
    const existingSerials = new Set(
      instRes.rows
        .filter((r) => r.serial_number && String(r.serial_number).trim() !== '')
        .map((r) => String(r.serial_number).trim().toLowerCase())
    );
    const seriallessQueue = instRes.rows
      .filter((r) => !r.serial_number || String(r.serial_number).trim() === '')
      .map((r) => r.instance_id);

    for (const serial of g.serials) {
      if (existingSerials.has(serial.toLowerCase())) { alreadyOk += 1; continue; }

      if (seriallessQueue.length) {
        const instanceId = seriallessQueue.shift();
        if (!DRY_RUN) {
          await pool.query(
            `UPDATE part_instances SET serial_number = $1, updated_at = NOW() WHERE instance_id = $2`,
            [serial, instanceId]
          );
        }
        existingSerials.add(serial.toLowerCase());
        patched += 1;
      } else {
        if (!DRY_RUN) {
          await createPartInstances({
            partId: g.partsId,
            quantity: 1,
            unitCost: g.unitCost,
            locationCode: g.locationCode,
            spoId: g.spoId,
            grnId: g.grnId,
            batchNumber: g.batchNumber,
            serialNumbers: [serial],
          });
        }
        existingSerials.add(serial.toLowerCase());
        inserted += 1;
      }
    }
  }

  console.log('Summary');
  console.log('-------');
  console.log(`Received serials scanned : ${serialsRes.rows.length}`);
  console.log(`Groups (spo/grn/part)    : ${groups.size}`);
  console.log(`Already present          : ${alreadyOk}`);
  console.log(`Patched onto instances   : ${patched}`);
  console.log(`Inserted new instances   : ${inserted}  (parts.quantity bumped)`);
  console.log(`Unresolved (skipped)     : ${unresolved}  (no matching floor part)`);
  if (DRY_RUN) console.log('\nDRY RUN — no changes written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
