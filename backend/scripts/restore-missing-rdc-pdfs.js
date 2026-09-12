/**
 * Restore Return DC PDFs that are in DB but missing on disk.
 * Keeps the stored filename so existing /uploads/... URLs keep working.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');

async function restoreOne(dcNumber, wantedRel) {
  const absWanted = path.join(__dirname, '..', wantedRel);
  if (fs.existsSync(absWanted) && fs.statSync(absWanted).size > 0) {
    return { dcNumber, ok: true, skipped: true };
  }
  const newPath = await regenerateReturnDcPdfByRdc(pool, dcNumber);
  if (!newPath) return { dcNumber, ok: false, error: 'regen_failed' };
  const absNew = path.join(__dirname, '..', String(newPath).replace(/^\/+/, ''));
  if (!fs.existsSync(absNew)) return { dcNumber, ok: false, error: 'new_missing' };
  fs.mkdirSync(path.dirname(absWanted), { recursive: true });
  if (path.resolve(absNew) !== path.resolve(absWanted)) {
    fs.copyFileSync(absNew, absWanted);
  }
  await pool.query(
    `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW()
      WHERE dc_number = $2 AND movement_type = 'return'`,
    [wantedRel, dcNumber]
  );
  return { dcNumber, ok: true, bytes: fs.statSync(absWanted).size };
}

async function main() {
  const only = process.argv[2] || null;
  const r = await pool.query(
    `SELECT dc_number, pdf_path
       FROM delivery_challan_lines
      WHERE movement_type = 'return'
        AND pdf_path IS NOT NULL AND pdf_path <> ''
        AND ($1::text IS NULL OR dc_number = $1)
      ORDER BY dc_number`,
    [only]
  );
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of r.rows) {
    const rel = String(row.pdf_path).replace(/^\/+/, '');
    const result = await restoreOne(row.dc_number, rel);
    if (result.skipped) skipped += 1;
    else if (result.ok) {
      ok += 1;
      if (ok % 25 === 0) console.log(`restored ${ok}...`);
    } else {
      failed += 1;
      console.error('FAIL', result);
    }
  }
  console.log(JSON.stringify({ total: r.rows.length, restored: ok, skipped, failed }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
