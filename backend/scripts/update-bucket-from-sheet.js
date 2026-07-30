#!/usr/bin/env node
/**
 * Set customer bucket price (rent_monthly_rate) from DC amount in a spreadsheet,
 * or from CRM SO/DC rate when --from-dc-rate is passed.
 *
 * Filters (default): Status = sold, Entity = gorefurbo
 *
 * Usage:
 *   node scripts/update-bucket-from-sheet.js [path/to/sheet.xlsx]           # dry-run
 *   node scripts/update-bucket-from-sheet.js [path] --commit                # apply
 *   node scripts/update-bucket-from-sheet.js --from-dc-rate --commit      # CRM DC rate, no sheet
 *
 * Sheet columns (auto-detected):
 *   TTSPL, Status, Entity, DC Amount / DC Rate / Price, Customer Bucket Price (optional)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { resolveSerialRentRate } = require('../services/serialRentRateService');
const { logCustomerAssetEdit } = require('../services/customerAssetActivityService');

const DEFAULT_SHEET = path.join(__dirname, '../data/Untitled spreadsheet (1).xlsx');
const COMMIT = process.argv.includes('--commit');
const FROM_DC_RATE = process.argv.includes('--from-dc-rate');
const ENTITY_FILTER = (() => {
  const i = process.argv.indexOf('--entity');
  return i >= 0 ? String(process.argv[i + 1] || 'gorefurbo').toLowerCase() : 'gorefurbo';
})();
const STATUS_FILTER = (() => {
  const i = process.argv.indexOf('--status');
  return i >= 0 ? String(process.argv[i + 1] || 'sold').toLowerCase() : 'sold';
})();

const TTSPL_HEADERS = ['TTSPL', 'TTSPL ID', 'TTSPLID', 'TTSPL Id', 'ttspl_id'];
const STATUS_HEADERS = ['Status', 'STATUS', 'inventory_status'];
const ENTITY_HEADERS = ['Entity', 'ENTITY', 'Owner F', 'entity', 'current_entity'];
const DC_AMOUNT_HEADERS = [
  'DC Amount', 'DC Amount (CRM / SO Rate)', 'DC Rate', 'DC Price',
  'SO Rate', 'Billing Rate', 'Rate', 'Amount',
];

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function cell(row, headers) {
  const wanted = new Set(headers.map((h) => h.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(trim(key).toLowerCase())) return value;
  }
  return undefined;
}

function extractTtspl(raw) {
  const s = trim(raw);
  if (!s) return '';
  const m = s.match(/TTSPL[A-Z0-9]+/i);
  return m ? m[0].toUpperCase() : s.toUpperCase();
}

function parseMoney(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function matchesFilter(value, filter) {
  return trim(value).toLowerCase().includes(filter);
}

function loadSheet(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  return {
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }),
    sheetName,
    path: filePath,
  };
}

function sheetPathArg() {
  return process.argv.find((a) => a.endsWith('.xlsx') && !a.startsWith('--'));
}

async function fetchSerial(ttspl) {
  const { rows } = await pool.query(
    `SELECT vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number,
            vsn.rent_monthly_rate, vsn.inventory_status, vsn.current_entity,
            vsn.current_dc_number, vsn.current_customer_id,
            COALESCE(c.company_name, c.name) AS customer_name
       FROM vendor_serial_numbers vsn
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      WHERE vsn.deleted_at IS NULL
        AND (
          UPPER(vsn.inventory_asset_code) = $1
          OR UPPER(vsn.extra->>'ttspl_id') = $1
        )
      LIMIT 1`,
    [ttspl]
  );
  return rows[0] || null;
}

async function main() {
  const updates = [];

  if (FROM_DC_RATE) {
    const { rows } = await pool.query(
      `SELECT vsn.serial_id, vsn.inventory_asset_code AS ttspl, vsn.rent_monthly_rate,
              vsn.inventory_status, vsn.current_entity, vsn.current_dc_number,
              vsn.current_customer_id, COALESCE(c.company_name, c.name) AS customer_name
         FROM vendor_serial_numbers vsn
         LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
        WHERE vsn.deleted_at IS NULL
          AND LOWER(vsn.current_entity) LIKE $1
          AND LOWER(vsn.inventory_status) = $2
        ORDER BY vsn.inventory_asset_code`,
      [`%${ENTITY_FILTER.replace('goreforbo', 'goref')}%`, STATUS_FILTER]
    );

    for (const row of rows) {
      const dcRate = row.current_dc_number
        ? await resolveSerialRentRate(pool, row.serial_id, row.current_dc_number)
        : await resolveSerialRentRate(pool, row.serial_id);
      if (dcRate == null) continue;
      const oldRate = parseMoney(row.rent_monthly_rate);
      if (oldRate != null && Math.abs(oldRate - dcRate) < 0.01) continue;
      updates.push({
        serial_id: row.serial_id,
        ttspl: extractTtspl(row.ttspl),
        customer_id: row.current_customer_id,
        customer_name: row.customer_name,
        dc_number: row.current_dc_number,
        old_rate: oldRate,
        new_rate: dcRate,
        source: 'CRM DC/SO rate',
      });
    }
  } else {
    const filePath = sheetPathArg() || DEFAULT_SHEET;
    const sheet = loadSheet(filePath);
    if (!sheet) {
      console.error(`Sheet not found: ${filePath}`);
      console.error('Upload the file or use --from-dc-rate');
      process.exit(1);
    }
    console.log(`Sheet: ${sheet.path} (${sheet.rows.length} rows, "${sheet.sheetName}")`);

    for (const row of sheet.rows) {
      const ttspl = extractTtspl(cell(row, TTSPL_HEADERS));
      if (!ttspl) continue;
      const status = trim(cell(row, STATUS_HEADERS));
      const entity = trim(cell(row, ENTITY_HEADERS));
      if (STATUS_FILTER && status && !matchesFilter(status, STATUS_FILTER)) continue;
      if (ENTITY_FILTER && entity && !matchesFilter(entity, ENTITY_FILTER.replace('goreforbo', 'goref'))) continue;

      const dcAmount = parseMoney(cell(row, DC_AMOUNT_HEADERS));
      if (dcAmount == null) continue;

      const serial = await fetchSerial(ttspl);
      if (!serial) {
        updates.push({ ttspl, skipped: true, reason: 'Serial not found in CRM', new_rate: dcAmount });
        continue;
      }
      if (ENTITY_FILTER && serial.current_entity && !matchesFilter(serial.current_entity, ENTITY_FILTER.replace('goreforbo', 'goref'))) {
        continue;
      }
      if (STATUS_FILTER && serial.inventory_status && !matchesFilter(serial.inventory_status, STATUS_FILTER)) {
        continue;
      }

      const oldRate = parseMoney(serial.rent_monthly_rate);
      if (oldRate != null && Math.abs(oldRate - dcAmount) < 0.01) continue;

      updates.push({
        serial_id: serial.serial_id,
        ttspl,
        customer_id: serial.current_customer_id,
        customer_name: serial.customer_name,
        dc_number: serial.current_dc_number,
        old_rate: oldRate,
        new_rate: dcAmount,
        source: 'Sheet DC amount',
      });
    }
  }

  const applicable = updates.filter((u) => !u.skipped);
  const skipped = updates.filter((u) => u.skipped);

  console.log(`Mode: ${FROM_DC_RATE ? 'CRM DC rate' : 'Sheet'} | Filter: ${STATUS_FILTER} + ${ENTITY_FILTER}`);
  console.log(`To update: ${applicable.length}${COMMIT ? ' (LIVE)' : ' (dry-run)'}`);
  if (skipped.length) console.log(`Not found in CRM: ${skipped.length}`);

  applicable.slice(0, 25).forEach((u) => {
    console.log(`  ${u.ttspl} ${u.customer_name || ''} ${u.old_rate ?? '—'} -> ${u.new_rate} [${u.source}]`);
  });
  if (applicable.length > 25) console.log(`  ... +${applicable.length - 25} more`);

  if (!COMMIT || !applicable.length) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of applicable) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_monthly_rate = $1, updated_at = NOW()
          WHERE serial_id = $2`,
        [u.new_rate, u.serial_id]
      );
      await logCustomerAssetEdit({
        customerId: u.customer_id,
        serialId: u.serial_id,
        ttsplId: u.ttspl,
        changes: [{
          field: 'rent_monthly_rate',
          label: 'Monthly rate',
          oldValue: u.old_rate,
          newValue: u.new_rate,
        }],
        actorUserId: null,
        actorName: 'update-bucket-from-sheet',
      }).catch(() => {});
    }
    await client.query('COMMIT');
    console.log(`Updated ${applicable.length} serial(s).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
