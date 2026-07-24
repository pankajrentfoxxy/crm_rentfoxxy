#!/usr/bin/env node
/**
 * One-time migration: update customer asset rental prices from Excel.
 *
 * Sheet: Customer
 *   TTSPL ID                             -> inventory_asset_code (primary match key)
 *   Sr. no.                              -> serial_number (fallback match)
 *   Vendor                               -> disambiguates when multiple DB rows match
 *   Customer Rental price (Base price)   -> vendor_serial_numbers.rent_monthly_rate
 *
 * Usage:
 *   node scripts/import-customer-asset-prices.js [--dry-run] [path/to/customer_price.xlsx]
 *
 * Default file: backend/data/customer_price.xlsx
 * Output:       backend/data/not_found.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');

const DEFAULT_FILE = path.join(__dirname, '../data/customer_price.xlsx');
const NOT_FOUND_CSV = path.join(__dirname, '../data/not_found.csv');
const SHEET_NAME = 'Customer';
const PROGRESS_EVERY = 100;

const SERIAL_HEADERS = ['Sr. no.', 'Sr. no', 'Sr no', 'Sr.no.', 'Serial Number', 'serial_number'];
const TTSPL_HEADERS = ['TTSPL ID', 'TTSPL Id', 'TTSPL', 'ttspl_id', 'inventory_asset_code'];
const VENDOR_HEADERS = ['Vendor', 'vendor', 'asset_type', 'Asset Type'];
const PRICE_HEADERS = [
  'Customer Rental price (Base price)',
  'Customer Rental Price (Base Price)',
  'Customer Rental price',
  'customer_rental_price',
];

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((a) => !a.startsWith('-') && /\.xlsx$/i.test(a));
  return { dryRun, filePath: fileArg || DEFAULT_FILE };
}

function trim(value) {
  if (value == null) return '';
  return String(value).trim();
}

function cell(row, headers) {
  const wanted = new Set(headers.map((h) => h.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(trim(key).toLowerCase())) return value;
  }
  return undefined;
}

function normalizeKey(value) {
  return trim(value).toLowerCase().replace(/\s+/g, ' ').replace(/ /g, '_');
}

function formatPoType(t) {
  if (!t) return '';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTtsplId(raw) {
  const value = trim(raw);
  if (!value) return '';
  const match = value.match(/TTSPL[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : value.toUpperCase();
}

function assetTypeMatches(excelVendor, dbRow) {
  const needle = normalizeKey(excelVendor);
  if (!needle) return true;

  const businessName = normalizeKey(dbRow.business_name);
  const purchaseOrderType = normalizeKey(dbRow.purchase_order_type);
  const formattedPoType = normalizeKey(formatPoType(dbRow.purchase_order_type));

  if (needle === 'self' || needle.startsWith('self/') || needle.includes('/self')) {
    if (
      purchaseOrderType === 'direct_purchase'
      || businessName.includes('self')
      || businessName.includes('rentfoxxy')
    ) {
      return true;
    }
  }

  if (needle.includes('sg') && needle.includes('laptop')) {
    if (purchaseOrderType.includes('sg') || businessName.includes('sg')) return true;
  }

  if (needle.includes('prompt')) {
    if (purchaseOrderType.includes('prompt') || businessName.includes('prompt')) return true;
  }

  if (needle.includes('firmsap')) {
    if (purchaseOrderType.includes('firmsap') || businessName.includes('firmsap')) return true;
  }

  if (needle.includes('siddhi')) {
    if (purchaseOrderType.includes('siddhi') || businessName.includes('siddhi')) return true;
  }

  if (needle.includes('g_computer') || needle.includes('g._computer')) {
    if (
      purchaseOrderType.includes('g_computer')
      || businessName.includes('g_computer')
      || businessName.includes('g computer')
    ) {
      return true;
    }
  }

  if (needle.includes('hemant')) {
    if (businessName.includes('hemant')) return true;
  }

  if (needle.includes('rabyte')) {
    if (businessName.includes('rabyte')) return true;
  }

  const candidates = new Set([
    purchaseOrderType,
    formattedPoType,
    businessName,
    normalizeKey(dbRow.vendor_display_name),
  ].filter(Boolean));

  for (const candidate of candidates) {
    if (candidate === needle) return true;
    if (candidate.replace(/[._]/g, '') === needle.replace(/[._/]/g, '')) return true;
    if (candidate.includes(needle) || needle.includes(candidate)) return true;
  }
  return false;
}

function pickBestMatch(matches, ttsplId) {
  if (matches.length === 1) return matches[0];

  const normalizedTtspl = ttsplId.toLowerCase();
  const byTtspl = matches.filter(
    (row) => trim(row.inventory_asset_code).toLowerCase() === normalizedTtspl
  );
  if (byTtspl.length === 1) return byTtspl[0];

  const deployed = matches.filter((row) => row.current_customer_id != null);
  if (deployed.length === 1) return deployed[0];

  const deployedByTtspl = byTtspl.filter((row) => row.current_customer_id != null);
  if (deployedByTtspl.length === 1) return deployedByTtspl[0];

  return null;
}

function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return Number(raw.toFixed(2));
  }
  const cleaned = String(raw).replace(/[,₹\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

function pricesEqual(a, b) {
  const left = a == null ? null : Number(a);
  const right = b == null ? null : Number(b);
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.005;
}

function parseExcelRow(row) {
  const serial = trim(cell(row, SERIAL_HEADERS));
  const ttsplRaw = trim(cell(row, TTSPL_HEADERS));
  const ttsplId = extractTtsplId(ttsplRaw);
  const vendor = trim(cell(row, VENDOR_HEADERS));
  const price = parsePrice(cell(row, PRICE_HEADERS));

  if ((!serial && !ttsplId) || price == null) {
    return {
      skip: true,
      reason: !serial && !ttsplId ? 'empty serial/TTSPL' : 'empty/invalid price',
    };
  }

  const lookupKeys = [...new Set(
    [serial, ttsplId, extractTtsplId(serial)]
      .map((value) => trim(value).toLowerCase())
      .filter(Boolean)
  )];

  return {
    skip: false,
    serial,
    ttsplId,
    vendor,
    price,
    lookupKeys,
  };
}

async function findMatches(client, lookupKeys) {
  const { rows } = await client.query(
    `SELECT vsn.serial_id,
            vsn.serial_number,
            vsn.inventory_asset_code,
            vsn.current_customer_id,
            vsn.rent_monthly_rate,
            p.purchase_order_type,
            COALESCE(v.business_name, TRIM(v.first_name || ' ' || COALESCE(v.last_name, ''))) AS business_name
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id AND p.deleted_at IS NULL
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
      WHERE vsn.deleted_at IS NULL
        AND (
          LOWER(TRIM(COALESCE(vsn.serial_number, ''))) = ANY($1::text[])
          OR LOWER(TRIM(COALESCE(vsn.inventory_asset_code, ''))) = ANY($1::text[])
          OR LOWER(TRIM(COALESCE(vsn.extra->>'ttspl_id', ''))) = ANY($1::text[])
        )`,
    [lookupKeys]
  );
  return rows;
}

function writeNotFoundCsv(rows) {
  const header = 'Serial Number,TTSPL ID,Vendor,Price\n';
  const body = rows.map((r) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [esc(r.serial), esc(r.ttsplId), esc(r.vendor), esc(r.price)].join(',');
  }).join('\n');
  fs.writeFileSync(NOT_FOUND_CSV, header + body + (body ? '\n' : ''), 'utf8');
}

async function main() {
  const { dryRun, filePath } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    console.error('Upload customer_price.xlsx to backend/data/ and rerun.');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    console.error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const excelRows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NAME], { defval: '' });

  const summary = {
    dryRun,
    filePath,
    totalExcelRows: excelRows.length,
    skippedEmpty: 0,
    matched: 0,
    updated: 0,
    skippedSamePrice: 0,
    notFound: 0,
    duplicateMatches: 0,
    errors: [],
  };

  const notFoundRows = [];
  const duplicateRows = [];
  let updateCount = 0;

  const client = await pool.connect();

  try {
    if (!dryRun) await client.query('BEGIN');

    for (let i = 0; i < excelRows.length; i += 1) {
      const rowNum = i + 2;
      const parsed = parseExcelRow(excelRows[i]);

      if (parsed.skip) {
        summary.skippedEmpty += 1;
        continue;
      }

      let matches;
      try {
        matches = await findMatches(client, parsed.lookupKeys);
      } catch (err) {
        summary.errors.push({ row: rowNum, serial: parsed.serial, error: err.message });
        throw err;
      }

      if (!matches.length) {
        summary.notFound += 1;
        notFoundRows.push({
          serial: parsed.serial,
          ttsplId: parsed.ttsplId,
          vendor: parsed.vendor,
          price: parsed.price,
        });
        continue;
      }

      let target = null;
      if (matches.length === 1) {
        target = matches[0];
      } else {
        const typedMatches = matches.filter((m) => assetTypeMatches(parsed.vendor, m));
        target = pickBestMatch(typedMatches.length ? typedMatches : matches, parsed.ttsplId);
      }

      if (!target) {
        summary.duplicateMatches += 1;
        duplicateRows.push({
          row: rowNum,
          serial: parsed.serial,
          ttsplId: parsed.ttsplId,
          vendor: parsed.vendor,
          price: parsed.price,
          serial_ids: matches.map((m) => m.serial_id),
        });
        continue;
      }

      summary.matched += 1;

      if (pricesEqual(target.rent_monthly_rate, parsed.price)) {
        summary.skippedSamePrice += 1;
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        if (summary.updated % PROGRESS_EVERY === 0) {
          console.log(`[dry-run] Would update ${summary.updated} records so far…`);
        }
        continue;
      }

      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_monthly_rate = $1,
                updated_at = NOW()
          WHERE serial_id = $2`,
        [parsed.price, target.serial_id]
      );

      summary.updated += 1;
      updateCount += 1;
      if (updateCount % PROGRESS_EVERY === 0) {
        console.log(`Updated ${updateCount} records…`);
      }
    }

    if (!dryRun) {
      await client.query('COMMIT');
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr.message);
      }
    }
    console.error('Migration failed:', err.message);
    summary.errors.push({ fatal: err.message });
    writeNotFoundCsv(notFoundRows);
    client.release();
    await pool.end();
    process.exit(1);
  }

  writeNotFoundCsv(notFoundRows);
  client.release();
  await pool.end();

  console.log('\n=== Customer Asset Price Import Summary ===');
  console.log(`Mode:              ${dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  console.log(`Excel file:        ${filePath}`);
  console.log(`Total Excel rows:  ${summary.totalExcelRows}`);
  console.log(`Skipped (empty):   ${summary.skippedEmpty}`);
  console.log(`Matched:           ${summary.matched}`);
  console.log(`Updated:           ${summary.updated}`);
  console.log(`Skipped same price:${summary.skippedSamePrice}`);
  console.log(`Not found:         ${summary.notFound}`);
  console.log(`Duplicate matches: ${summary.duplicateMatches}`);
  console.log(`Not found CSV:     ${NOT_FOUND_CSV}`);

  if (duplicateRows.length) {
    console.log('\nDuplicate matches (skipped):');
    duplicateRows.slice(0, 20).forEach((d) => {
      console.log(`  row ${d.row} serial=${d.serial} vendor=${d.vendor} serial_ids=${d.serial_ids.join(',')}`);
    });
    if (duplicateRows.length > 20) {
      console.log(`  … and ${duplicateRows.length - 20} more`);
    }
  }

  if (summary.errors.length) {
    console.log('\nErrors:');
    summary.errors.forEach((e) => console.log(' ', e));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
