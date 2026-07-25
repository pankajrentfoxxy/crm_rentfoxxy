#!/usr/bin/env node
/**
 * Export laptops from Excel (Main sheet) that are NOT present in CRM floor inventory.
 * Status is ignored — only checks whether TTSPL / serial exists in vendor_serial_numbers.
 *
 * Usage:
 *   node scripts/export-inventory-not-on-floor.js [path/to/All_Inventory_Data.xlsx]
 *
 * Default Excel: backend/data/All_Inventory_Data.xlsx
 * Output CSV:    backend/data/inventory_not_on_floor.csv
 * Output XLSX:   backend/data/inventory_not_on_floor.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');

const DEFAULT_FILE = path.join(__dirname, '../data/All_Inventory_Data.xlsx');
const OUTPUT_CSV = path.join(__dirname, '../data/inventory_not_on_floor.csv');
const OUTPUT_XLSX = path.join(__dirname, '../data/inventory_not_on_floor.xlsx');
const SHEET_NAME = 'Main';

const SERIAL_HEADERS = [
  'Serial No',
  'Serial No.',
  'Serial Number',
  'Sr. no.',
  'Sr. no',
  'Sr no',
  'serial_number',
];
const TTSPL_HEADERS = [
  'TTSPLID',
  'TTSPL ID',
  'TTSPL Id',
  'TTSPL',
  'ttspl_id',
  'inventory_asset_code',
];
const TYPE_HEADERS = ['Type', 'type', 'System'];

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

function isLaptopRow(row) {
  const typeValue = trim(cell(row, TYPE_HEADERS)).toLowerCase();
  if (!typeValue) return true;
  return typeValue.includes('laptop');
}

function rowPresentInCrm(row, crmKeys) {
  const serial = trim(cell(row, SERIAL_HEADERS));
  const ttsplRaw = trim(cell(row, TTSPL_HEADERS));
  const ttsplId = extractTtsplId(ttsplRaw);

  const candidates = [serial, ttsplRaw, ttsplId]
    .map((value) => trim(value).toLowerCase())
    .filter(Boolean);

  return candidates.some((key) => crmKeys.has(key));
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function loadExcelRows(filePath) {
  const wb = XLSX.readFile(filePath);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(', ')}`);
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NAME], { defval: '' });
  return rows.filter(isLaptopRow);
}

async function loadCrmLookupKeys(client) {
  const { rows } = await client.query(
    `SELECT LOWER(TRIM(COALESCE(serial_number, ''))) AS serial_number,
            LOWER(TRIM(COALESCE(inventory_asset_code, ''))) AS inventory_asset_code,
            LOWER(TRIM(COALESCE(extra->>'ttspl_id', ''))) AS extra_ttspl_id,
            LOWER(TRIM(COALESCE(extra->>'unique_product_serial', ''))) AS unique_product_serial
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND po_id IS NOT NULL
        AND spo_id IS NULL`
  );

  const keys = new Set();
  rows.forEach((row) => {
    addLookupKeys(
      keys,
      row.serial_number,
      row.inventory_asset_code,
      row.extra_ttspl_id,
      row.unique_product_serial,
      extractTtsplId(row.inventory_asset_code),
      extractTtsplId(row.extra_ttspl_id),
      extractTtsplId(row.unique_product_serial)
    );
  });

  return { keys, crmCount: rows.length };
}

function writeCsv(rows) {
  const exportColumns = [
    'Type',
    'Brand',
    'Model No',
    'Serial No',
    'TTSPLID',
    'Processor',
    'Generation',
    'RAM',
    'Storage',
    'STATUS',
    'Location',
    'Owner F',
    'Rental price',
  ];

  const header = exportColumns.join(',');
  const body = rows.map((row) => exportColumns.map((col) => {
    const value = row[col] ?? row[col.replace(' ', ' ')] ?? '';
    return csvEscape(value);
  }).join(',')).join('\n');

  fs.writeFileSync(OUTPUT_CSV, `${header}\n${body}${body ? '\n' : ''}`, 'utf8');
}

function writeXlsx(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Not On Floor');
  XLSX.writeFile(wb, OUTPUT_XLSX);
}

async function main() {
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('-') && /\.xlsx$/i.test(a));
  const filePath = fileArg || DEFAULT_FILE;

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    console.error('Upload All_Inventory_Data.xlsx to backend/data/ and rerun.');
    process.exit(1);
  }

  const excelRows = loadExcelRows(filePath);
  const client = await pool.connect();

  try {
    const { keys: crmKeys, crmCount } = await loadCrmLookupKeys(client);
    const missing = excelRows.filter((row) => !rowPresentInCrm(row, crmKeys));

    writeCsv(missing);
    writeXlsx(missing);

    console.log('\n=== Inventory Not On Floor Export ===');
    console.log(`Excel file:           ${filePath}`);
    console.log(`Sheet:                ${SHEET_NAME}`);
    console.log(`Sheet laptop rows:    ${excelRows.length}`);
    console.log(`CRM floor laptops:    ${crmCount}`);
    console.log(`In sheet, not in CRM: ${missing.length}`);
    console.log(`Output CSV:           ${OUTPUT_CSV}`);
    console.log(`Output XLSX:          ${OUTPUT_XLSX}`);

    if (missing.length) {
      console.log('\nSample (first 10):');
      missing.slice(0, 10).forEach((row) => {
        console.log(
          `  ${trim(cell(row, TTSPL_HEADERS)) || '-'} | ${trim(cell(row, SERIAL_HEADERS)) || '-'} | ${trim(row.Brand) || '-'} ${trim(row['Model No']) || ''}`
        );
      });
      if (missing.length > 10) {
        console.log(`  … and ${missing.length - 10} more in export files`);
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
