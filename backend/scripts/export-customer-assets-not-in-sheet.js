#!/usr/bin/env node
/**
 * List live customer-held laptops that exist in CRM but are missing from the price sheet.
 *
 * Usage:
 *   node scripts/export-customer-assets-not-in-sheet.js [path/to/customer_price.xlsx]
 *
 * Default Excel: backend/data/customer_price.xlsx
 * Output CSV:     backend/data/customer_assets_not_in_sheet.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');

const DEFAULT_FILE = path.join(__dirname, '../data/customer_price.xlsx');
const OUTPUT_CSV = path.join(__dirname, '../data/customer_assets_not_in_sheet.csv');
const SHEET_NAME = 'Customer';

const SERIAL_HEADERS = ['Sr. no.', 'Sr. no', 'Sr no', 'Sr.no.', 'Serial Number', 'serial_number'];
const TTSPL_HEADERS = ['TTSPL ID', 'TTSPL Id', 'TTSPL', 'ttspl_id', 'inventory_asset_code'];

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

function extractTtsplId(raw) {
  const value = trim(raw);
  if (!value) return '';
  const match = value.match(/TTSPL[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : value.toUpperCase();
}

function addLookupKeys(set, ...values) {
  values.forEach((value) => {
    const normalized = trim(value).toLowerCase();
    if (normalized) set.add(normalized);
    const ttspl = extractTtsplId(value);
    if (ttspl) set.add(ttspl.toLowerCase());
  });
}

function loadSheetLookupKeys(filePath) {
  const wb = XLSX.readFile(filePath);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(', ')}`);
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NAME], { defval: '' });
  const keys = new Set();

  rows.forEach((row) => {
    const serial = trim(cell(row, SERIAL_HEADERS));
    const ttsplRaw = trim(cell(row, TTSPL_HEADERS));
    const ttsplId = extractTtsplId(ttsplRaw);
    addLookupKeys(keys, serial, ttsplRaw, ttsplId);
  });

  return { keys, rowCount: rows.length };
}

function assetInSheet(asset, sheetKeys) {
  const candidates = [
    asset.serial_number,
    asset.inventory_asset_code,
    asset.extra_ttspl_id,
    extractTtsplId(asset.inventory_asset_code),
    extractTtsplId(asset.extra_ttspl_id),
  ];

  return candidates.some((value) => {
    const normalized = trim(value).toLowerCase();
    return normalized && sheetKeys.has(normalized);
  });
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function fetchLiveCustomerAssets(client) {
  const { rows } = await client.query(
    `SELECT vsn.serial_id,
            vsn.serial_number,
            vsn.inventory_asset_code,
            vsn.extra->>'ttspl_id' AS extra_ttspl_id,
            vsn.rent_monthly_rate,
            vsn.inventory_status,
            vsn.current_customer_id,
            c.customer_id,
            COALESCE(c.company_name, c.name) AS customer_name,
            COALESCE(vsn.extra->>'brand', inv.brand) AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', inv.model) AS model_name
       FROM vendor_serial_numbers vsn
       JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN inventory inv ON (
         inv.machine_number = vsn.inventory_asset_code
         OR inv.serial_number = vsn.serial_number
       )
      WHERE vsn.deleted_at IS NULL
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.inventory_status = ANY($1::text[])
      ORDER BY customer_name ASC, vsn.inventory_asset_code ASC NULLS LAST, vsn.serial_number ASC`,
    [DEPLOYED_WITH_CUSTOMER_STATUSES]
  );
  return rows;
}

async function main() {
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('-') && /\.xlsx$/i.test(a));
  const filePath = fileArg || DEFAULT_FILE;

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const { keys: sheetKeys, rowCount } = loadSheetLookupKeys(filePath);
  const client = await pool.connect();

  try {
    const assets = await fetchLiveCustomerAssets(client);
    const missing = assets.filter((asset) => !assetInSheet(asset, sheetKeys));

    const header = [
      'Customer ID',
      'Customer Name',
      'TTSPL ID',
      'Serial Number',
      'Brand',
      'Model',
      'Status',
      'Current Rental Price',
    ].join(',');

    const body = missing.map((asset) => [
      csvEscape(asset.customer_id),
      csvEscape(asset.customer_name),
      csvEscape(asset.inventory_asset_code || asset.extra_ttspl_id || ''),
      csvEscape(asset.serial_number || ''),
      csvEscape(asset.brand || ''),
      csvEscape(asset.model_name || ''),
      csvEscape(asset.inventory_status || ''),
      csvEscape(asset.rent_monthly_rate ?? ''),
    ].join(',')).join('\n');

    fs.writeFileSync(OUTPUT_CSV, `${header}\n${body}${body ? '\n' : ''}`, 'utf8');

    console.log('\n=== Customer Assets Not In Sheet ===');
    console.log(`Excel file:              ${filePath}`);
    console.log(`Sheet rows:              ${rowCount}`);
    console.log(`Live customer assets:    ${assets.length}`);
    console.log(`Missing from sheet:      ${missing.length}`);
    console.log(`Output CSV:              ${OUTPUT_CSV}`);

    if (missing.length) {
      console.log('\nSample (first 10):');
      missing.slice(0, 10).forEach((asset) => {
        console.log(
          `  ${asset.customer_name} | ${asset.inventory_asset_code || '-'} | ${asset.serial_number || '-'} | ₹${asset.rent_monthly_rate ?? '-'}`
        );
      });
      if (missing.length > 10) {
        console.log(`  … and ${missing.length - 10} more in CSV`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
