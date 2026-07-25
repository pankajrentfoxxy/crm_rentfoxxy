#!/usr/bin/env node
/**
 * Import laptops from inventory_not_on_floor.csv into CRM as dead inventory.
 *
 * - Creates direct_purchase PO (RENTFOXXY SELF) + GRN (received) per laptop
 * - Uses TTSPL from CSV only — never allocates new TTSPL codes
 * - Skips rows without valid TTSPL or serial number
 * - Skips if TTSPL or serial already exists in CRM
 * - Sets qc_status = dead (Dead Laptops page)
 *
 * Usage:
 *   node scripts/import-dead-laptops-from-csv.js [--dry-run] [path/to/inventory_not_on_floor.csv]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');
const { allocatePurchaseOrderNumber } = require('../services/vendorNumberService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { logGrnReceive } = require('../services/ttsplAuditService');

const DEFAULT_CSV = path.join(__dirname, '../data/inventory_not_on_floor.csv');
const SELF_VENDOR_NAME = 'RENTFOXXY SELF';
const PO_TYPE = 'direct_purchase';
const PO_STATE = 'Haryana';
const IMPORT_REMARK = 'Dead laptop intake from inventory_not_on_floor.csv';

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((a) => !a.startsWith('-') && /\.csv$/i.test(a));
  return { dryRun, filePath: fileArg || DEFAULT_CSV };
}

function trim(value) {
  if (value == null) return '';
  return String(value).replace(/[\r\n]+/g, '').trim();
}

function normalizeField(value) {
  const cleaned = trim(value);
  if (!cleaned || cleaned === '-') return 'NA';
  return cleaned;
}

function extractTtsplId(raw) {
  const value = trim(raw);
  if (!value) return '';
  const match = value.match(/TTSPL[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : '';
}

function parseCsv(content) {
  const rows = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return rows;

  const headers = parseCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function buildLineItem(row) {
  const rate = 0;
  return {
    quantity: 1,
    receivedQty: 1,
    brand: normalizeField(row.Brand),
    model: normalizeField(row['Model No']),
    product_name: normalizeField(row['Model No']),
    processor: normalizeField(row.Processor),
    generation: normalizeField(row.Generation),
    ram: normalizeField(row.RAM),
    storage: normalizeField(row.Storage),
    gpu: 'Integrated',
    screen_size: '14"',
    unit_price: rate,
    price: rate,
    warranty_months: 12,
  };
}

async function resolveSelfVendor(client) {
  const { rows } = await client.query(
    `SELECT vendor_id, business_name, state
       FROM vendors
      WHERE deleted_at IS NULL
        AND TRIM(UPPER(business_name)) = TRIM(UPPER($1))
      LIMIT 1`,
    [SELF_VENDOR_NAME]
  );
  if (!rows.length) {
    throw new Error(`Vendor "${SELF_VENDOR_NAME}" not found`);
  }
  return rows[0];
}

async function loadExistingKeys(client) {
  const { rows } = await client.query(
    `SELECT LOWER(TRIM(serial_number)) AS serial_number,
            UPPER(TRIM(inventory_asset_code)) AS inventory_asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL`
  );
  const serials = new Set();
  const ttspls = new Set();
  rows.forEach((row) => {
    if (row.serial_number) serials.add(row.serial_number);
    if (row.inventory_asset_code) ttspls.add(row.inventory_asset_code);
  });
  return { serials, ttspls };
}

async function importOneLaptop(client, {
  row,
  vendor,
  actorLabel,
  dryRun,
}) {
  const serialNumber = trim(row['Serial No']).toUpperCase();
  const ttsplId = extractTtsplId(row.TTSPLID);
  const rentalStartDate = new Date().toISOString().slice(0, 10);
  const line = buildLineItem(row);
  const subTotal = 0;
  const totalAmount = getTotalAmountOfPurchaseOrder(subTotal, true);
  const isSameState = true;

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      serialNumber,
      ttsplId,
    };
  }

  const purchaseOrderNumber = await allocatePurchaseOrderNumber(client, null);
  const poIns = await client.query(
    `INSERT INTO vendor_purchase_orders (
       purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
       po_state, is_same_state, sub_total_amount, total_amount,
       line_items, assets_details, product_details_legacy_ids, remarks,
       status, invoice_created, approved_at, sent_to_vendor_at,
       status_updated_by_name, created_at, updated_at
     ) VALUES (
       $1, $2::date, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12,
       'approved', TRUE, NOW(), NOW(),
       $13, NOW(), NOW()
     )
     RETURNING po_id, purchase_order_number`,
    [
      purchaseOrderNumber,
      rentalStartDate,
      PO_TYPE,
      vendor.vendor_id,
      PO_STATE,
      isSameState,
      subTotal,
      totalAmount,
      JSON.stringify([line]),
      JSON.stringify({ intake: true, source: 'dead_laptop_csv_import', lines: [line] }),
      JSON.stringify([]),
      IMPORT_REMARK,
      actorLabel,
    ]
  );
  const poId = poIns.rows[0].po_id;

  const grnIns = await client.query(
    `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, bill_files, created_at, updated_at)
     VALUES ($1, $2::jsonb, 'received', '[]'::jsonb, NOW(), NOW())
     RETURNING grn_id`,
    [
      poId,
      JSON.stringify({
        intake_source: 'dead_laptop_csv_import',
        received_by: actorLabel,
        notes: IMPORT_REMARK,
      }),
    ]
  );
  const grnId = grnIns.rows[0].grn_id;

  const extra = {
    line_index: 0,
    rental_start_date: rentalStartDate,
    unique_product_serial: ttsplId,
    intake_source: 'dead_laptop_csv_import',
    status: 'dead',
    action_status: 'dead',
    brand: line.brand,
    model: line.model,
    processor: line.processor,
    generation: line.generation,
    ram: line.ram,
    storage: line.storage,
  };

  const serialIns = await client.query(
    `INSERT INTO vendor_serial_numbers (
       po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
       qc_status, inventory_status, extra, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5::date,
       'dead', 'scrapped', $6::jsonb, NOW(), NOW()
     )
     RETURNING serial_id, serial_number, inventory_asset_code`,
    [poId, grnId, serialNumber, ttsplId, rentalStartDate, JSON.stringify(extra)]
  );
  const serial = serialIns.rows[0];

  await freezeAcceptedReceiveConfig(client, {
    serialId: serial.serial_id,
    grnId,
    productDetailId: null,
    config: {
      brand: line.brand,
      model: line.model,
      processor: line.processor,
      generation: line.generation,
      ram: line.ram,
      storage: line.storage,
      gpu: line.gpu,
      screen_size: line.screen_size,
    },
  });

  try {
    await logGrnReceive({
      ttsplId,
      vendorSerialId: serial.serial_id,
      serialNumber,
      poLabel: purchaseOrderNumber,
      actorUserId: null,
      db: client,
    });
  } catch (auditErr) {
    console.error(`GRN audit failed for ${ttsplId}:`, auditErr.message);
  }

  return {
    ok: true,
    serialId: serial.serial_id,
    serialNumber,
    ttsplId,
    poId,
    purchaseOrderNumber,
    grnId,
  };
}

async function main() {
  const { dryRun, filePath } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const summary = {
    dryRun,
    filePath,
    totalRows: rows.length,
    imported: 0,
    skippedNoTtspl: 0,
    skippedNoSerial: 0,
    skippedExists: 0,
    errors: [],
    results: [],
  };

  const client = await pool.connect();

  try {
    const vendor = await resolveSelfVendor(client);
    const existing = await loadExistingKeys(client);

    if (!dryRun) await client.query('BEGIN');

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowNum = i + 2;
      const serialNumber = trim(row['Serial No']).toUpperCase();
      const ttsplId = extractTtsplId(row.TTSPLID);

      if (!serialNumber) {
        summary.skippedNoSerial += 1;
        continue;
      }
      if (!ttsplId) {
        summary.skippedNoTtspl += 1;
        summary.errors.push({
          row: rowNum,
          serial: serialNumber,
          reason: 'Missing or invalid TTSPL ID',
        });
        continue;
      }
      if (existing.serials.has(serialNumber.toLowerCase()) || existing.ttspls.has(ttsplId)) {
        summary.skippedExists += 1;
        continue;
      }

      try {
        const result = await importOneLaptop(client, {
          row,
          vendor,
          actorLabel: 'dead-laptop-import-script',
          dryRun,
        });

        if (!dryRun) {
          existing.serials.add(serialNumber.toLowerCase());
          existing.ttspls.add(ttsplId);
        }

        summary.imported += 1;
        summary.results.push(result);
      } catch (err) {
        summary.errors.push({
          row: rowNum,
          serial: serialNumber,
          ttspl: ttsplId,
          error: err.message,
        });
        if (!dryRun) throw err;
      }
    }

    if (!dryRun) await client.query('COMMIT');
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr.message);
      }
    }
    console.error('Import failed:', err.message);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();
  await pool.end();

  console.log('\n=== Dead Laptop CSV Import Summary ===');
  console.log(`Mode:               ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
  console.log(`CSV file:           ${filePath}`);
  console.log(`Total CSV rows:     ${summary.totalRows}`);
  console.log(`Imported:           ${summary.imported}`);
  console.log(`Skipped no serial:  ${summary.skippedNoSerial}`);
  console.log(`Skipped no TTSPL:   ${summary.skippedNoTtspl}`);
  console.log(`Skipped exists:     ${summary.skippedExists}`);

  if (summary.results.length) {
    console.log('\nSample imports:');
    summary.results.slice(0, 10).forEach((r) => {
      console.log(
        `  ${r.ttsplId} | ${r.serialNumber} | PO ${r.purchaseOrderNumber || '(dry-run)'}`
      );
    });
    if (summary.results.length > 10) {
      console.log(`  … and ${summary.results.length - 10} more`);
    }
  }

  if (summary.errors.length) {
    console.log('\nSkipped / errors:');
    summary.errors.forEach((e) => console.log(' ', e));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
