/**
 * fetch_delivery_date_mismatch.js  — READ-ONLY
 * ------------------------------------------------------------------
 * Lists ONLY the customer assets whose DELIVERY DATE in CRM
 * (rent_start_date) does not match the July sheet's "Rental Period
 * Start". No other fields. No writes. No updates.
 *
 * Match key: TTSPL (primary) -> Serial (fallback).
 *
 * Output: console table + delivery_date_mismatch.csv
 *   TTSPL, Serial, CRM Delivery Date, Sheet Delivery Date, CRM Status
 *
 * Run:
 *   node fetch_delivery_date_mismatch.js --excel "July_Sheet.xlsx"
 *   [--sheet "Sheet1"] [--out delivery_date_mismatch.csv]
 *
 * DB: Prisma if available, else project pg (lib/config / CRM_PG_*).
 * ------------------------------------------------------------------
 */
const fs = require('fs');
const XLSX = require('xlsx');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const EXCEL = arg('--excel', 'July_Sheet.xlsx');
const SHEET = arg('--sheet', 'Sheet1');
const OUT = arg('--out', 'delivery_date_mismatch.csv');

const ttsplTok = s => { const m = String(s || '').toUpperCase().match(/TTSPL[A-Z0-9]+/); return m ? m[0] : null; };
const ns = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// normalise any date to YYYY-MM-DD for comparison
// CRM timestamps are stored in UTC; render the calendar day in IST (Asia/Kolkata)
// so a delivery at e.g. 2026-07-21T06:12Z is reported as 2026-07-21 (not 07-20).
const IST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});
function dstr(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v).trim().slice(0, 10);
  return IST_YMD.format(d); // en-CA => YYYY-MM-DD
}

// Excel stores dates as serial numbers. cellDates parsing introduces an off-by-one
// (rounding to ~23:59:50 of the previous day), so parse the raw serial directly.
function xlDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const o = XLSX.SSF.parse_date_code(v);
    if (!o || !o.y) return null;
    return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
  }
  return dstr(v); // already a Date or a string date
}

function readSheet() {
  if (!fs.existsSync(EXCEL)) throw new Error(`Excel not found: ${EXCEL}`);
  const wb = XLSX.readFile(EXCEL, { cellDates: false });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`);
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const H = g[0].map(x => String(x || '').toLowerCase().trim());
  const idx = names => H.findIndex(h => names.some(n => h === n));
  const cT = idx(['ttspl']), cS = idx(['s no', 'serial', 'sr. no.', 'serial no']),
        cStart = idx(['rental period start', 'delivery date', 'delivered date']);
  if (cT < 0 && cS < 0) throw new Error(`No TTSPL/Serial column. Header: ${g[0].join(' | ')}`);
  if (cStart < 0) throw new Error(`"Rental Period Start" (delivery date) column not found. Header: ${g[0].join(' | ')}`);
  const rows = [];
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r) continue;
    const ttspl = ttsplTok(r[cT]);
    const serial = cS >= 0 && r[cS] != null ? String(r[cS]).trim() : null;
    if (!ttspl && !serial) continue;
    const deliver = xlDate(r[cStart]);
    if (!deliver) continue;             // ignore rows with no sheet delivery date
    rows.push({ ttspl, serial, deliver });
  }
  return rows;
}

async function getDb() {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient(); await prisma.$queryRawUnsafe('SELECT 1');
    return {
      kind: 'prisma',
      find: (ttspl, serial) => prisma.$queryRawUnsafe(
        `SELECT inventory_asset_code AS ttspl, serial_number, delivered_at, rent_start_date, inventory_status
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND ( ($1 <> '' AND UPPER(inventory_asset_code) = $1)
               OR ($2 <> '' AND REGEXP_REPLACE(UPPER(serial_number),'[^A-Z0-9]','','g') = $2) )
          LIMIT 2`, (ttspl || ''), (serial ? ns(serial) : '')),
      end: () => prisma.$disconnect(),
    };
  } catch (_) {}
  const { Pool } = require('pg');
  let conf; try { const cfg = require('./lib/config'); conf = cfg.getConfig ? cfg.getConfig().crm : (cfg.crm || cfg.default?.crm); } catch (_) {}
  const pool = new Pool(conf || {
    host: process.env.CRM_PG_HOST || '127.0.0.1', port: Number(process.env.CRM_PG_PORT || 5432),
    user: process.env.CRM_PG_USER || 'postgres', password: process.env.CRM_PG_PASSWORD || '',
    database: process.env.CRM_PG_DATABASE || 'crm_rentfoxxy',
  });
  const client = await pool.connect();
  return {
    kind: 'pg',
    find: async (ttspl, serial) => (await client.query(
      `SELECT inventory_asset_code AS ttspl, serial_number, delivered_at, rent_start_date, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND ( (NULLIF($1,'') IS NOT NULL AND UPPER(inventory_asset_code) = $1)
             OR (NULLIF($2,'') IS NOT NULL AND REGEXP_REPLACE(UPPER(serial_number),'[^A-Z0-9]','','g') = $2) )
        LIMIT 2`, [(ttspl || ''), (serial ? ns(serial) : '')])).rows,
    end: async () => { client.release(); await pool.end(); },
  };
}

(async () => {
  const rows = readSheet();
  console.log(`\n=== Delivery-date mismatch check (READ-ONLY) ===`);
  console.log(`Sheet: ${EXCEL} / ${SHEET}   rows with a delivery date: ${rows.length}\n`);

  const db = await getDb();
  console.log(`DB adapter: ${db.kind}\n`);

  const mismatches = [], notFound = [];
  let matched = 0, same = 0;

  for (const r of rows) {
    const found = await db.find(r.ttspl, r.serial);
    if (!found || found.length === 0) { notFound.push(r); continue; }
    matched++;
    const rec = found[0];
    const crmDeliver = dstr(rec.delivered_at);
    if (crmDeliver === r.deliver) { same++; continue; }
    mismatches.push({ ttspl: r.ttspl || rec.ttspl || '', serial: r.serial || rec.serial_number || '',
      crm: crmDeliver || '(null)', sheet: r.deliver, status: rec.inventory_status });
  }
  await db.end();

  // console table
  if (mismatches.length) {
    console.log('TTSPL          Serial            CRM Delivery  →  Sheet Delivery   (status)');
    console.log('-------------------------------------------------------------------------------');
    mismatches.forEach(m =>
      console.log(`${(m.ttspl||'').padEnd(14)} ${(m.serial||'').padEnd(16)} ${String(m.crm).padEnd(12)} →  ${String(m.sheet).padEnd(12)}   (${m.status})`));
  }

  // CSV
  const csv = ['TTSPL,Serial,CRM Delivery Date,Sheet Delivery Date,CRM Status',
    ...mismatches.map(m => `"${m.ttspl}","${m.serial}",${m.crm},${m.sheet},${m.status}`)].join('\n');
  let outPath = OUT;
  try {
    fs.writeFileSync(outPath, csv);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      outPath = OUT.replace(/\.csv$/i, '') + `_${Date.now()}.csv`;
      fs.writeFileSync(outPath, csv);
      console.log(`\n(Original CSV was locked/open — wrote to ${outPath} instead)`);
    } else { throw e; }
  }

  console.log(`\n================ SUMMARY ================`);
  console.log(`Sheet rows (with delivery date) : ${rows.length}`);
  console.log(`Matched in CRM                  : ${matched}`);
  console.log(`Delivery date SAME              : ${same}`);
  console.log(`Delivery date MISMATCH          : ${mismatches.length}`);
  console.log(`Not found in CRM                : ${notFound.length}`);
  console.log(`Mismatches written to           : ${outPath}`);
  console.log(`========================================`);
  console.log(`READ-ONLY — nothing was modified.`);
})().catch(e => { console.error(e); process.exit(1); });