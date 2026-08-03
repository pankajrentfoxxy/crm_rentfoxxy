#!/usr/bin/env node
/**
 * Export customer assets where Customer Bucket Price ≠ DC (SO) rate.
 *
 * Usage:
 *   node scripts/export-customer-bucket-dc-mismatch.js [path/to/sheet.xlsx]
 *
 * Optional spreadsheet columns (auto-detected):
 *   TTSPL, DC Number, Customer Bucket Price / Rental Price / Price
 *
 * Output: backend/data/customer_bucket_dc_mismatch.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { resolveSerialRentRate } = require('../services/serialRentRateService');

const OUTPUT = path.join(__dirname, '../data/customer_bucket_dc_mismatch.xlsx');
const DEFAULT_INPUT = path.join(__dirname, '../data/Untitled spreadsheet.xlsx');

const TTSPL_HEADERS = ['TTSPL', 'TTSPL ID', 'TTSPLID', 'TTSPL Id', 'ttspl_id', 'inventory_asset_code'];
const DC_HEADERS = ['DC Number', 'DC', 'DC No', 'dc_number', 'Delivery Challan'];
const BUCKET_HEADERS = [
  'Customer Bucket Price', 'Bucket Price', 'Customer Price', 'Rental Price',
  'Per Month Rate', 'Monthly Rate', 'Price', 'Rate', 'Rental Amount',
];
const DC_AMOUNT_HEADERS = ['DC Amount', 'DC Rate', 'DC Price', 'SO Rate', 'Billing Rate'];

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

function fmtDate(d) {
  if (!d) return '';
  const s = String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

function ratesMismatch(a, b, tolerance = 0.01) {
  const x = parseMoney(a);
  const y = parseMoney(b);
  if (x == null && y == null) return false;
  if (x == null || y == null) return true;
  return Math.abs(x - y) > tolerance;
}

function loadSheetRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { rows: [], path: null };
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  return { rows, path: filePath, sheetName };
}

function sheetRowMap(sheetRows) {
  const map = new Map();
  for (const row of sheetRows) {
    const ttspl = extractTtspl(cell(row, TTSPL_HEADERS));
    if (!ttspl) continue;
    map.set(ttspl, {
      ttspl,
      dc_number: trim(cell(row, DC_HEADERS)),
      sheet_bucket_price: parseMoney(cell(row, BUCKET_HEADERS)),
      sheet_dc_amount: parseMoney(cell(row, DC_AMOUNT_HEADERS)),
      raw: row,
    });
  }
  return map;
}

async function fetchCustomerAssets() {
  const { rows } = await pool.query(
    `SELECT vsn.serial_id,
            vsn.serial_number,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl,
            vsn.inventory_status,
            vsn.current_customer_id AS customer_id,
            COALESCE(c.company_name, c.name) AS customer_name,
            COALESCE(vsn.extra->>'brand', inv.brand) AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', inv.model) AS model,
            COALESCE(vsn.extra->>'processor', inv.processor) AS processor,
            COALESCE(vsn.extra->>'generation', inv.generation) AS generation,
            COALESCE(vsn.extra->>'ram', inv.ram) AS ram,
            COALESCE(vsn.extra->>'storage', inv.storage) AS storage,
            vsn.current_entity AS entity_code,
            vsn.current_dc_number AS dc_number,
            COALESCE(vsn.dispatched_at, pod.dispatched_at) AS dispatch_date,
            COALESCE(vsn.delivered_at, pod.delivery_completed_at) AS delivered_at,
            vsn.rent_monthly_rate AS stored_bucket_price,
            COALESCE(dd.sales_order_number, sos.sales_order_number) AS sales_order_number,
            sos_rate.rate AS sos_bucket_price
       FROM vendor_serial_numbers vsn
       JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN inventory inv ON (
         inv.machine_number = vsn.inventory_asset_code OR inv.serial_number = vsn.serial_number
       )
       LEFT JOIN LATERAL (
         SELECT dcl.dispatched_at, dcl.delivery_completed_at, dcl.sales_order_number
           FROM delivery_challan_lines dcl
          WHERE dcl.dc_number = vsn.current_dc_number
            AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
          ORDER BY dcl.id DESC LIMIT 1
       ) pod ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(dcl.delivered_at, dcl.delivery_completed_at) AS delivered_at,
                dcl.dc_number, dcl.sales_order_number
           FROM delivery_challan_lines dcl
           CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(dcl.serial_number) = 'array' THEN dcl.serial_number ELSE '[]'::jsonb END
           ) AS elem
          WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
            AND NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '')::int = vsn.serial_id
          ORDER BY COALESCE(dcl.delivered_at, dcl.delivery_completed_at) DESC NULLS LAST
          LIMIT 1
       ) dd ON TRUE
       LEFT JOIN LATERAL (
         SELECT sol.rate
           FROM sales_order_serials sos
           JOIN sales_order_lines sol ON sol.id = sos.line_id
          WHERE sos.serial_id = vsn.serial_id
            AND sos.status <> 'removed'
            AND (vsn.current_dc_number IS NULL OR sos.dc_number = vsn.current_dc_number)
          ORDER BY sos.allocation_id DESC LIMIT 1
       ) sos_rate ON TRUE
       LEFT JOIN LATERAL (
         SELECT sos.sales_order_number
           FROM sales_order_serials sos
          WHERE sos.serial_id = vsn.serial_id AND sos.status <> 'removed'
          ORDER BY sos.allocation_id DESC LIMIT 1
       ) sos ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.inventory_status = ANY($1::text[])
      ORDER BY customer_name, ttspl`,
    [DEPLOYED_WITH_CUSTOMER_STATUSES]
  );
  return rows;
}

async function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  const sheet = loadSheetRows(fs.existsSync(inputPath) ? inputPath : null);
  const sheetByTtspl = sheetRowMap(sheet.rows);
  const filterTtspls = sheet.rows.length ? new Set(sheetByTtspl.keys()) : null;

  console.log(sheet.path
    ? `Sheet: ${sheet.path} (${sheet.rows.length} rows, sheet "${sheet.sheetName}")`
    : 'No input sheet — comparing all CRM customer assets');

  const assets = await fetchCustomerAssets();
  const mismatches = [];

  for (const a of assets) {
    const ttspl = extractTtspl(a.ttspl);
    if (filterTtspls && !filterTtspls.has(ttspl)) continue;

    const dcNumber = trim(a.dc_number);
    const dcRate = dcNumber ? await resolveSerialRentRate(pool, a.serial_id, dcNumber) : null;
    const crmBucket = parseMoney(a.stored_bucket_price) ?? parseMoney(a.sos_bucket_price);
    const sheetInfo = sheetByTtspl.get(ttspl) || {};
    const sheetBucket = sheetInfo.sheet_bucket_price ?? null;
    const sheetDcAmount = sheetInfo.sheet_dc_amount ?? null;

    const crmMismatch = ratesMismatch(crmBucket, dcRate);
    const sheetBucketVsDc = sheetBucket != null && dcRate != null && ratesMismatch(sheetBucket, dcRate);
    const sheetBucketVsSheetDc = sheetBucket != null && sheetDcAmount != null && ratesMismatch(sheetBucket, sheetDcAmount);
    const sheetBucketVsCrmBucket = sheetBucket != null && crmBucket != null && ratesMismatch(sheetBucket, crmBucket);

    if (!crmMismatch && !sheetBucketVsDc && !sheetBucketVsSheetDc && !sheetBucketVsCrmBucket) continue;

    const reasons = [];
    if (crmMismatch) reasons.push('CRM bucket ≠ DC rate');
    if (sheetBucketVsDc) reasons.push('Sheet bucket ≠ CRM DC rate');
    if (sheetBucketVsSheetDc) reasons.push('Sheet bucket ≠ Sheet DC amount');
    if (sheetBucketVsCrmBucket) reasons.push('Sheet bucket ≠ CRM bucket');

    mismatches.push({
      'Mismatch Reason': reasons.join('; '),
      'Customer Name': a.customer_name || '',
      'Customer ID': a.customer_id || '',
      TTSPL: ttspl || '',
      'Serial Number': a.serial_number || '',
      Brand: a.brand || '',
      Model: a.model || '',
      Processor: a.processor || '',
      Generation: a.generation || '',
      RAM: a.ram || '',
      Storage: a.storage || '',
      Entity: a.entity_code || '',
      Status: a.inventory_status || '',
      'DC Number': dcNumber || sheetInfo.dc_number || '',
      'SO Number': a.sales_order_number || '',
      'Dispatch Date': fmtDate(a.dispatch_date),
      'Delivered Date': fmtDate(a.delivered_at),
      'Customer Bucket Price (CRM)': crmBucket ?? '',
      'Customer Bucket Price (Stored)': parseMoney(a.stored_bucket_price) ?? '',
      'Customer Bucket Price (Sheet)': sheetBucket ?? '',
      'DC Amount (CRM / SO Rate)': dcRate ?? '',
      'DC Amount (Sheet)': sheetDcAmount ?? '',
      Difference: (crmBucket != null && dcRate != null) ? +(crmBucket - dcRate).toFixed(2) : '',
    });
  }

  console.log(`CRM assets scanned: ${assets.length}`);
  console.log(`Mismatches: ${mismatches.length}`);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(mismatches);
  XLSX.utils.book_append_sheet(wb, ws, 'Mismatches');
  XLSX.writeFile(wb, OUTPUT);
  console.log(`Written: ${OUTPUT}`);

  if (mismatches.length) {
    mismatches.slice(0, 10).forEach((r) => {
      console.log(`  ${r.TTSPL} ${r['Customer Name']} bucket=${r['Customer Bucket Price (CRM)']} dc=${r['DC Amount (CRM / SO Rate)']} — ${r['Mismatch Reason']}`);
    });
    if (mismatches.length > 10) console.log(`  ... +${mismatches.length - 10} more`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
