#!/usr/bin/env node
/**
 * Update CRM delivered dates from July billing sheet (Rental Period Start column only).
 *
 * Updates:
 *   - vendor_serial_numbers.delivered_at
 *   - delivery_challan_lines.delivered_at / delivery_completed_at (outbound DC for that customer)
 *
 * Usage:
 *   node backend/scripts/import-july-delivered-dates.js [--dry-run] [path/to/July Sheet.xlsx]
 *
 * Default file: backend/July Sheet.xlsx
 * Only rows whose Rental Period Start falls in July 2026 are processed.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('../config/db');

const DEFAULT_FILE = path.join(__dirname, '../July Sheet.xlsx');
const NOT_FOUND_CSV = path.join(__dirname, '../data/july_delivered_dates_not_found.csv');
const JULY_PREFIX = '2026-07';

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find((a) => !a.startsWith('-') && /\.xlsx$/i.test(a));
  return { dryRun, filePath: fileArg || DEFAULT_FILE };
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function extractTtspl(raw) {
  const value = trim(raw);
  if (!value) return '';
  const match = value.match(/TTSPL[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : value.toUpperCase();
}

function parseRentalStart(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = trim(raw);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toIstDateString(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

async function findSerial(client, { ttspl, serialNumber }) {
  if (ttspl) {
    const r = await client.query(
      `SELECT serial_id, inventory_asset_code, serial_number, current_customer_id,
              current_dc_number, delivered_at, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_asset_code = $1
        ORDER BY serial_id DESC
        LIMIT 1`,
      [ttspl]
    );
    if (r.rows.length) return r.rows[0];
  }
  if (serialNumber) {
    const r = await client.query(
      `SELECT serial_id, inventory_asset_code, serial_number, current_customer_id,
              current_dc_number, delivered_at, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND UPPER(serial_number) = UPPER($1)
        ORDER BY serial_id DESC
        LIMIT 1`,
      [serialNumber]
    );
    if (r.rows.length) return r.rows[0];
  }
  return null;
}

async function main() {
  const { dryRun, filePath } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const targets = [];
  for (const row of rows) {
    const rentalStart = parseRentalStart(row['Rental Period Start']);
    if (!rentalStart || !rentalStart.startsWith(JULY_PREFIX)) continue;
    const ttspl = extractTtspl(row.TTSPL || row['TTSPL ID']);
    const serialNumber = trim(row['S No'] || row['Sr. no.'] || row['Serial Number']);
    if (!ttspl && !serialNumber) continue;
    targets.push({ ttspl, serialNumber, rentalStart, customerName: trim(row['Updated Name']) });
  }

  console.log(`Sheet rows: ${rows.length}`);
  console.log(`July ${JULY_PREFIX} delivery updates: ${targets.length}`);
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — applying updates');

  const client = await pool.connect();
  const notFound = [];
  const skipped = [];
  const updated = [];

  try {
    if (!dryRun) await client.query('BEGIN');

    for (const t of targets) {
      const serial = await findSerial(client, t);
      if (!serial) {
        notFound.push({ ...t, reason: 'serial not found' });
        continue;
      }

      const oldDate = toIstDateString(serial.delivered_at);
      if (oldDate === t.rentalStart) {
        skipped.push({ ...t, serial_id: serial.serial_id, oldDate });
        continue;
      }

      if (!dryRun) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET delivered_at = $2::timestamptz, updated_at = NOW()
            WHERE serial_id = $1`,
          [serial.serial_id, `${t.rentalStart}T00:00:00.000Z`]
        );

        if (serial.current_dc_number && serial.current_customer_id) {
          await client.query(
            `UPDATE delivery_challan_lines
                SET delivered_at = $1::timestamptz,
                    delivery_completed_at = $1::timestamptz,
                    updated_at = NOW()
              WHERE dc_number = $2
                AND customer_id = $3
                AND COALESCE(movement_type, 'outbound') = 'outbound'`,
            [`${t.rentalStart}T00:00:00.000Z`, serial.current_dc_number, serial.current_customer_id]
          );
        }
      }

      updated.push({
        ttspl: serial.inventory_asset_code || t.ttspl,
        serial_number: serial.serial_number,
        serial_id: serial.serial_id,
        customer_id: serial.current_customer_id,
        dc_number: serial.current_dc_number,
        oldDate: oldDate || '(empty)',
        newDate: t.rentalStart,
      });
    }

    if (!dryRun) await client.query('COMMIT');

    console.log(`Updated: ${updated.length}`);
    console.log(`Skipped (already correct): ${skipped.length}`);
    console.log(`Not found: ${notFound.length}`);

    if (updated.length) {
      console.log('\nSample updates:');
      updated.slice(0, 10).forEach((u) => {
        console.log(`  ${u.ttspl} ${u.serial_number}: ${u.oldDate} -> ${u.newDate}`);
      });
    }

    if (notFound.length) {
      const csv = [
        'TTSPL,Serial,Rental Period Start,Customer,Reason',
        ...notFound.map((r) =>
          [r.ttspl, r.serialNumber, r.rentalStart, `"${(r.customerName || '').replace(/"/g, '""')}"`, r.reason].join(',')
        ),
      ].join('\n');
      fs.mkdirSync(path.dirname(NOT_FOUND_CSV), { recursive: true });
      fs.writeFileSync(NOT_FOUND_CSV, csv);
      console.log(`\nNot found written to ${NOT_FOUND_CSV}`);
    }
  } catch (err) {
    if (!dryRun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
