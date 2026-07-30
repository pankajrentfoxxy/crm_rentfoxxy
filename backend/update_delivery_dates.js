/**
 * update_delivery_dates.js
 * ------------------------------------------------------------------
 * Updates CRM delivery dates on vendor_serial_numbers to match the
 * July sheet's delivery date ("Rental Period Start" / delivery date).
 *
 * Per confirmed scope:
 *   - Sets BOTH delivered_at (timestamptz) and rent_start_date (date).
 *   - delivered_at: keeps the existing time-of-day, only changes the
 *     calendar day (shift by whole IST days). If it was NULL, sets it
 *     to the sheet date at 12:00 IST.
 *   - rent_start_date: date-only, set to the sheet date.
 *   - Also fills units that currently have NO delivery date (in_transit).
 *
 * SAFETY: DRY-RUN by default. Pass --apply to actually write.
 *
 * Match key: TTSPL (primary) -> Serial (fallback). Ambiguous multi-matches
 * are skipped and reported.
 *
 * Run (preview):  node update_delivery_dates.js --excel "July Sheet.xlsx"
 * Run (apply):    node update_delivery_dates.js --excel "July Sheet.xlsx" --apply
 *   [--sheet "Sheet1"] [--out delivery_date_updates.csv]
 * ------------------------------------------------------------------
 */
const fs = require('fs');
const XLSX = require('xlsx');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const EXCEL = arg('--excel', 'July Sheet.xlsx');
const SHEET = arg('--sheet', 'Sheet1');
const OUT = arg('--out', 'delivery_date_updates.csv');
const APPLY = has('--apply');

const ttsplTok = (s) => { const m = String(s || '').toUpperCase().match(/TTSPL[A-Z0-9]+/); return m ? m[0] : null; };
const ns = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Render calendar day in IST (Asia/Kolkata) — CRM timestamps are stored in UTC.
const IST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});
const istYmd = (v) => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : IST_YMD.format(d);
};

// Excel dates -> YYYY-MM-DD via the raw serial (cellDates rounding is off-by-one).
function xlDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const o = XLSX.SSF.parse_date_code(v);
    if (!o || !o.y) return null;
    return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
  }
  return istYmd(v);
}

// Shift a timestamp so its IST calendar day becomes targetYmd, keeping time-of-day.
// IST is a fixed +5:30 offset (no DST), so a whole-day shift preserves the IST clock time.
function shiftKeepTime(oldTs, targetYmd) {
  const cur = istYmd(oldTs);
  if (cur === targetYmd) return oldTs;
  const diffDays = Math.round(
    (Date.parse(`${targetYmd}T00:00:00Z`) - Date.parse(`${cur}T00:00:00Z`)) / 86400000
  );
  return new Date(oldTs.getTime() + diffDays * 86400000);
}

// 12:00 IST == 06:30 UTC — safe default for a previously-null delivered_at.
const noonIstUtc = (targetYmd) => new Date(`${targetYmd}T06:30:00.000Z`);

function readSheet() {
  if (!fs.existsSync(EXCEL)) throw new Error(`Excel not found: ${EXCEL}`);
  const wb = XLSX.readFile(EXCEL, { cellDates: false });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`);
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const H = g[0].map((x) => String(x || '').toLowerCase().trim());
  const idx = (names) => H.findIndex((h) => names.some((n) => h === n));
  const cT = idx(['ttspl']);
  const cS = idx(['s no', 'serial', 'sr. no.', 'serial no']);
  const cStart = idx(['rental period start', 'delivery date', 'delivered date']);
  if (cT < 0 && cS < 0) throw new Error(`No TTSPL/Serial column. Header: ${g[0].join(' | ')}`);
  if (cStart < 0) throw new Error(`Delivery date column not found. Header: ${g[0].join(' | ')}`);
  const rows = [];
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r) continue;
    const ttspl = ttsplTok(r[cT]);
    const serial = cS >= 0 && r[cS] != null ? String(r[cS]).trim() : null;
    if (!ttspl && !serial) continue;
    const deliver = xlDate(r[cStart]);
    if (!deliver) continue;
    rows.push({ ttspl, serial, deliver });
  }
  return rows;
}

async function getDb() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  await prisma.$queryRawUnsafe('SELECT 1');
  return {
    find: (ttspl, serial) => prisma.$queryRawUnsafe(
      `SELECT serial_id, inventory_asset_code AS ttspl, serial_number, delivered_at, rent_start_date, inventory_status
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND ( ($1 <> '' AND UPPER(inventory_asset_code) = $1)
             OR ($2 <> '' AND REGEXP_REPLACE(UPPER(serial_number),'[^A-Z0-9]','','g') = $2) )
        LIMIT 2`, (ttspl || ''), (serial ? ns(serial) : '')),
    update: (serialId, deliveredIso, rentYmd) => prisma.$executeRawUnsafe(
      `UPDATE vendor_serial_numbers
          SET delivered_at = $1::timestamptz,
              rent_start_date = $2::date,
              updated_at = NOW()
        WHERE serial_id = $3`, deliveredIso, rentYmd, serialId),
    end: () => prisma.$disconnect(),
  };
}

(async () => {
  const rows = readSheet();
  console.log(`\n=== Update CRM delivery dates from sheet (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Sheet: ${EXCEL} / ${SHEET}   rows with a delivery date: ${rows.length}\n`);

  const db = await getDb();

  const planned = [];
  const notFound = [];
  const ambiguous = [];
  let noChange = 0;
  let applied = 0;
  let failed = 0;

  for (const r of rows) {
    const found = await db.find(r.ttspl, r.serial);
    if (!found || found.length === 0) { notFound.push(r); continue; }
    if (found.length > 1) { ambiguous.push(r); continue; }
    const rec = found[0];

    const target = r.deliver;
    const oldDeliveredYmd = istYmd(rec.delivered_at);
    const oldRentYmd = istYmd(rec.rent_start_date);

    const deliveredChanges = oldDeliveredYmd !== target;
    const rentChanges = oldRentYmd !== target;
    if (!deliveredChanges && !rentChanges) { noChange++; continue; }

    const newDeliveredTs = rec.delivered_at
      ? shiftKeepTime(new Date(rec.delivered_at), target)
      : noonIstUtc(target);
    const newDeliveredIso = newDeliveredTs.toISOString();

    const change = {
      ttspl: rec.ttspl || r.ttspl || '',
      serial: rec.serial_number || r.serial || '',
      serial_id: rec.serial_id,
      status: rec.inventory_status,
      old_delivered: oldDeliveredYmd || '(null)',
      new_delivered: target,
      old_rent: oldRentYmd || '(null)',
      new_rent: target,
      new_delivered_iso: newDeliveredIso,
    };
    planned.push(change);

    if (APPLY) {
      try {
        await db.update(rec.serial_id, newDeliveredIso, target);
        applied++;
      } catch (e) {
        failed++;
        change.error = e.message;
        console.error(`  ! ${change.ttspl}/${change.serial}: ${e.message}`);
      }
    }
  }

  await db.end();

  // Console preview
  if (planned.length) {
    console.log('TTSPL          Serial            delivered_at (IST)          rent_start_date          (status)');
    console.log('----------------------------------------------------------------------------------------------------');
    planned.forEach((c) => console.log(
      `${(c.ttspl || '').padEnd(14)} ${(c.serial || '').padEnd(16)} ${String(c.old_delivered).padStart(10)} -> ${String(c.new_delivered).padEnd(10)}   ${String(c.old_rent).padStart(10)} -> ${String(c.new_rent).padEnd(10)}   (${c.status})`
    ));
  }

  // CSV report
  const csv = [
    'TTSPL,Serial,SerialId,Status,Old Delivered (IST),New Delivered,Old RentStart,New RentStart,New Delivered Timestamp,Error',
    ...planned.map((c) => `"${c.ttspl}","${c.serial}",${c.serial_id},${c.status},${c.old_delivered},${c.new_delivered},${c.old_rent},${c.new_rent},${c.new_delivered_iso},"${c.error || ''}"`),
  ].join('\n');
  let outPath = OUT;
  try { fs.writeFileSync(outPath, csv); } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      outPath = OUT.replace(/\.csv$/i, '') + `_${Date.now()}.csv`;
      fs.writeFileSync(outPath, csv);
    } else { throw e; }
  }

  console.log(`\n================ SUMMARY (${APPLY ? 'APPLIED' : 'DRY-RUN — nothing written'}) ================`);
  console.log(`Sheet rows (with delivery date) : ${rows.length}`);
  console.log(`Would change / changed          : ${planned.length}`);
  console.log(`Already correct (no change)     : ${noChange}`);
  console.log(`Ambiguous (multi-match, skipped): ${ambiguous.length}`);
  console.log(`Not found in CRM                : ${notFound.length}`);
  if (APPLY) {
    console.log(`Applied OK                      : ${applied}`);
    console.log(`Failed                          : ${failed}`);
  }
  console.log(`Report written to               : ${outPath}`);
  console.log('====================================================');
  if (!APPLY) console.log('DRY-RUN — re-run with --apply to write these changes.');
})().catch((e) => { console.error(e); process.exit(1); });
