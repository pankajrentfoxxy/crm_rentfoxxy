#!/usr/bin/env node
/**
 * Apply corrected Customer Asset Price + DC Amount from dc_diff.xlsx (or similar).
 *
 * Matches rows by TTSPL (+ optional DC Number). Updates:
 *   - vendor_serial_numbers.rent_monthly_rate  (Customer Asset Amount)
 *   - sales_order_lines.rate via sales_order_serials (DC Amount / SO billing rate)
 *   - rent_devices.month_rent / rent_amount when an active row exists
 *
 * Sheet columns (auto-detected):
 *   TTSPL, DC Number
 *   Customer Asset Price / Customer Asset Amount / Customer Bucket Price
 *   DC Amount / DC Rate
 *   Correct Data  — single corrected rate (applied to both fields unless Field column set)
 *   Correct Customer Asset Price, Correct DC Amount — optional separate targets
 *   Field — optional: "customer", "dc", or "both" (default both when Correct Data is used)
 *
 * Usage:
 *   node scripts/import-dc-diff-corrections.js [path/to/dc_diff.xlsx]           # dry-run
 *   node scripts/import-dc-diff-corrections.js [path] --commit                    # apply
 *   node scripts/import-dc-diff-corrections.js [path] --commit --regen-pdf      # + SO/DC PDFs
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { logCustomerAssetEdit } = require('../services/customerAssetActivityService');
const {
  recalcSoSecurityIfOneMonthRental,
  syncDcSecurityForSo,
  getSalesOrderLines,
  getDeliveryChallanLines,
} = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');

const DEFAULT_SHEET = path.join(__dirname, '../data/dc_diff.xlsx');
const COMMIT = process.argv.includes('--commit');
const REGEN_PDF = process.argv.includes('--regen-pdf');

const TTSPL_HEADERS = ['TTSPL', 'TTSPL ID', 'TTSPLID', 'TTSPL Id', 'ttspl_id', 'inventory_asset_code'];
const DC_HEADERS = ['DC Number', 'DC', 'DC No', 'dc_number', 'Delivery Challan'];
const FIELD_HEADERS = ['Field', 'Update Field', 'Target Field', 'Type'];
const CORRECT_DATA_HEADERS = ['Correct Data', 'Correct Rate', 'Correct Amount', 'Correct Price'];
const CORRECT_CUSTOMER_HEADERS = [
  'Correct Customer Asset Price', 'Correct Customer Asset Amount',
  'Correct Bucket Price', 'Correct Customer Price',
];
const CORRECT_DC_HEADERS = ['Correct DC Amount', 'Correct DC Rate', 'Correct DC Price'];
const CUSTOMER_ASSET_HEADERS = [
  'Customer Asset Price', 'Customer Asset Amount', 'Customer Bucket Price',
  'Correct Customer Asset', 'Rental Price', 'Monthly Rate', 'Bucket Price',
];
const DC_AMOUNT_HEADERS = [
  'DC Amount', 'DC Rate', 'DC Price', 'SO Rate', 'Billing Rate',
];
const CRM_READONLY_HEADERS = [
  'Customer Bucket Price (CRM)', 'Customer Bucket Price (Stored)',
  'DC Amount (CRM / SO Rate)', 'DC Amount (Sheet)', 'Customer Bucket Price (Sheet)',
  'Difference', 'Mismatch Reason',
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

function cellExcluding(row, headers, excludeHeaders) {
  const exclude = new Set(excludeHeaders.map((h) => h.toLowerCase()));
  const wanted = new Set(headers.map((h) => h.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    const k = trim(key).toLowerCase();
    if (exclude.has(k)) continue;
    if (wanted.has(k)) return value;
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

function ratesEqual(a, b, tolerance = 0.01) {
  const x = parseMoney(a);
  const y = parseMoney(b);
  if (x == null && y == null) return true;
  if (x == null || y == null) return false;
  return Math.abs(x - y) <= tolerance;
}

function sheetPathArg() {
  return process.argv.find((a) => a.endsWith('.xlsx') && !a.startsWith('--'));
}

function resolveCorrections(row) {
  const field = trim(cell(row, FIELD_HEADERS)).toLowerCase();
  const correctData = parseMoney(cell(row, CORRECT_DATA_HEADERS));
  let customerAsset = parseMoney(cell(row, CORRECT_CUSTOMER_HEADERS));
  let dcAmount = parseMoney(cell(row, CORRECT_DC_HEADERS));

  if (customerAsset == null && dcAmount == null && correctData != null) {
    if (!field || field.includes('both') || field.includes('all')) {
      customerAsset = correctData;
      dcAmount = correctData;
    } else if (field.includes('customer') || field.includes('bucket') || field.includes('asset')) {
      customerAsset = correctData;
    } else if (field.includes('dc') || field.includes('so')) {
      dcAmount = correctData;
    } else {
      customerAsset = correctData;
      dcAmount = correctData;
    }
  }

  // Fallback: user-edited price columns (never use CRM export read-only columns)
  if (customerAsset == null) {
    customerAsset = parseMoney(cellExcluding(row, CUSTOMER_ASSET_HEADERS, CRM_READONLY_HEADERS));
  }
  if (dcAmount == null) {
    dcAmount = parseMoney(cellExcluding(row, DC_AMOUNT_HEADERS, CRM_READONLY_HEADERS));
  }

  return { customerAsset, dcAmount, field };
}

async function fetchSerialContext(ttspl, dcNumber) {
  const { rows } = await pool.query(
    `SELECT vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number,
            vsn.rent_monthly_rate, vsn.current_dc_number, vsn.current_customer_id,
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
  const serial = rows[0];
  if (!serial) return null;

  const params = [serial.serial_id];
  let dcClause = '';
  const dc = dcNumber || serial.current_dc_number;
  if (dc) {
    params.push(String(dc));
    dcClause = `AND sos.dc_number = $${params.length}`;
  }

  const sosRes = await pool.query(
    `SELECT sos.allocation_id, sos.line_id, sos.sales_order_number, sos.dc_number,
            sol.rate AS so_line_rate
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE sos.serial_id = $1
        AND sos.status <> 'removed'
        ${dcClause}
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    params
  );

  return {
    serial,
    allocation: sosRes.rows[0] || null,
  };
}

async function regenerateSoAndDcPdfs(salesOrderNumber) {
  const soLines = await getSalesOrderLines(salesOrderNumber);
  if (soLines.length) {
    const soPdf = await generateDocumentPdf({
      docType: 'sales_order',
      docNumber: salesOrderNumber,
      header: soLines[0],
      lines: soLines,
    });
    await pool.query(
      `UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`,
      [soPdf, salesOrderNumber]
    );
  }
  const dcRes = await pool.query(
    `SELECT DISTINCT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  for (const { dc_number: dcNumber } of dcRes.rows) {
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) continue;
    const pdf = await generateDocumentPdf({
      docType: 'delivery_challan',
      docNumber: dcNumber,
      header: lines[0],
      lines,
    });
    await pool.query(
      `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW() WHERE dc_number = $2`,
      [pdf, dcNumber]
    );
  }
}

async function main() {
  const filePath = sheetPathArg() || DEFAULT_SHEET;
  if (!fs.existsSync(filePath)) {
    console.error(`Sheet not found: ${filePath}`);
    console.error('Upload dc_diff.xlsx to backend/data/ then re-run.');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  console.log(`Sheet: ${filePath} (${rows.length} rows, tab "${sheetName}")`);
  if (rows[0]) console.log(`Columns: ${Object.keys(rows[0]).join(' | ')}`);

  const planned = [];
  const skipped = [];

  for (const row of rows) {
    const ttspl = extractTtspl(cell(row, TTSPL_HEADERS));
    if (!ttspl) continue;

    const { customerAsset, dcAmount } = resolveCorrections(row);
    if (customerAsset == null && dcAmount == null) {
      skipped.push({ ttspl, reason: 'No corrected amount in row' });
      continue;
    }

    const dcNumber = trim(cell(row, DC_HEADERS)) || null;
    const ctx = await fetchSerialContext(ttspl, dcNumber);
    if (!ctx) {
      skipped.push({ ttspl, reason: 'Serial not found in CRM' });
      continue;
    }

    const { serial, allocation } = ctx;
    const oldCustomer = parseMoney(serial.rent_monthly_rate);
    const oldDc = allocation ? parseMoney(allocation.so_line_rate) : null;

    const updateCustomer = customerAsset != null && !ratesEqual(oldCustomer, customerAsset);
    const updateDc = dcAmount != null && allocation && !ratesEqual(oldDc, dcAmount);

    if (!updateCustomer && !updateDc) {
      skipped.push({ ttspl, reason: 'Already matches CRM' });
      continue;
    }

    if (dcAmount != null && !allocation) {
      skipped.push({ ttspl, reason: 'No SO allocation — cannot update DC amount' });
      if (!updateCustomer) continue;
    }

    planned.push({
      ttspl,
      serial_id: serial.serial_id,
      customer_id: serial.current_customer_id,
      customer_name: serial.customer_name,
      dc_number: allocation?.dc_number || serial.current_dc_number,
      so_number: allocation?.sales_order_number || null,
      line_id: allocation?.line_id || null,
      old_customer: oldCustomer,
      new_customer: updateCustomer ? customerAsset : oldCustomer,
      old_dc: oldDc,
      new_dc: updateDc ? dcAmount : oldDc,
      updateCustomer,
      updateDc,
    });
  }

  console.log(`\nTo update: ${planned.length}${COMMIT ? ' (LIVE)' : ' (dry-run)'}`);
  console.log(`Skipped: ${skipped.length}`);

  planned.slice(0, 30).forEach((p) => {
    const parts = [];
    if (p.updateCustomer) parts.push(`asset ${p.old_customer ?? '—'} → ${p.new_customer}`);
    if (p.updateDc) parts.push(`DC ${p.old_dc ?? '—'} → ${p.new_dc}`);
    console.log(`  ${p.ttspl} ${p.customer_name || ''} | ${parts.join(' | ')}`);
  });
  if (planned.length > 30) console.log(`  ... +${planned.length - 30} more`);

  if (skipped.length && skipped.length <= 15) {
    skipped.forEach((s) => console.log(`  skip ${s.ttspl}: ${s.reason}`));
  } else if (skipped.length) {
    console.log(`  (first skips) ${skipped.slice(0, 10).map((s) => `${s.ttspl}:${s.reason}`).join('; ')}`);
  }

  if (!COMMIT || !planned.length) return;

  const client = await pool.connect();
  const affectedSos = new Set();
  try {
    await client.query('BEGIN');
    for (const p of planned) {
      if (p.updateCustomer) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET rent_monthly_rate = $1, updated_at = NOW()
            WHERE serial_id = $2`,
          [p.new_customer, p.serial_id]
        );
        await logCustomerAssetEdit({
          customerId: p.customer_id,
          serialId: p.serial_id,
          ttsplId: p.ttspl,
          changes: [{
            field: 'rent_monthly_rate',
            label: 'Monthly rate',
            oldValue: p.old_customer,
            newValue: p.new_customer,
          }],
          actorUserId: null,
          actorName: 'import-dc-diff-corrections',
        }).catch(() => {});
      }

      if (p.updateDc && p.line_id) {
        await client.query(
          `UPDATE sales_order_lines SET rate = $1, updated_at = NOW() WHERE id = $2`,
          [p.new_dc, p.line_id]
        );
        if (p.so_number) affectedSos.add(p.so_number);
      }

      if (p.updateCustomer || p.updateDc) {
        const rate = p.new_customer ?? p.new_dc;
        if (rate != null) {
          await client.query(
            `UPDATE rent_devices
                SET month_rent = $1, rent_amount = $1, updated_at = NOW()
              WHERE serial_id = $2 AND status = 'active'`,
            [rate, p.serial_id]
          );
        }
      }
    }

    for (const soNumber of affectedSos) {
      await recalcSoSecurityIfOneMonthRental(client, soNumber);
      await syncDcSecurityForSo(client, soNumber);
    }

    await client.query('COMMIT');
    console.log(`\nUpdated ${planned.length} row(s). SO lines touched: ${affectedSos.size}.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (REGEN_PDF && affectedSos.size) {
    console.log('Regenerating SO/DC PDFs...');
    for (const soNumber of affectedSos) {
      try {
        await regenerateSoAndDcPdfs(soNumber);
        console.log(`  PDFs regenerated for ${soNumber}`);
      } catch (e) {
        console.warn(`  PDF regen failed for ${soNumber}:`, e.message);
      }
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
