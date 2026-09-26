#!/usr/bin/env node
/**
 * Production (config truth) — laptops whose configuration disagrees between
 * the tables that hold it. Same two steps as floor-ticket-cleanup.js.
 *
 * Step 1 — report (read-only):
 *   node scripts/config-drift.js --csv <file> [--all]
 *   Default scope: laptops in stock or in repair. --all: every laptop.
 *
 * Step 2 — apply what was approved ("yes" in Approve):
 *   node scripts/config-drift.js --apply <reviewed.csv> [--dry-run]
 *
 * The reference is vendor_serial_numbers.extra — the record every sales
 * document, challan and invoice already reads — so this NEVER changes it (and
 * so never changes what a customer is billed or shown). Actions:
 *   FIX_LEGACY   the legacy `inventory` row differs → set that one field to the
 *                record's value (old value kept in the CSV and the activity log)
 *   CHECK        the floor's production asset or the last QC2 script result
 *                differs → a person checks the laptop; nothing is applied
 * A row is applied only if the values are still the ones the report saw.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const pool = require('../config/db');
const { getCurrentConfig, norm } = require('../services/laptopConfigService');

const WHERE = {
  label: { floor: 'Production asset (floor copy)', legacy: 'Inventory (legacy)', last_confirmed: 'Last QC2 / part-fit confirmation' },
};

async function load(db, all) {
  const { rows } = await db.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND spo_id IS NULL
        ${all ? '' : "AND inventory_status IN ('in_stock', 'in_repair')"}
      ORDER BY serial_id`
  );
  const out = [];
  for (const { serial_id: id } of rows) {
    const cc = await getCurrentConfig(db, { serialId: id });
    if (!cc) continue;
    for (const d of cc.disagreements) {
      out.push({
        serial_id: id, ttspl_id: cc.ttspl_id, field: d.field, where: d.where,
        other: d.value, record: d.current,
        action: d.where === 'legacy' ? 'FIX_LEGACY' : 'CHECK',
      });
    }
  }
  return out;
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const HEADER = ['Approve', 'Serial id', 'TTSPL', 'Field', 'Where it differs', 'Value there', 'Value on the record (kept)', 'Proposed action'];

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

(async () => {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const all = args.includes('--all');

  if (arg('--apply')) {
    const reviewed = parseCsv(fs.readFileSync(arg('--apply'), 'utf8'))
      .filter((r) => /^(yes|y)$/i.test(r.Approve) && r['Proposed action'] === 'FIX_LEGACY');
    const dry = args.includes('--dry-run');
    let done = 0; const skipped = [];
    for (const r of reviewed) {
      const id = Number(r['Serial id']);
      const field = r.Field;
      if (!['brand', 'model', 'processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size'].includes(field)) { skipped.push(`${id}: bad field ${field}`); continue; }
      const cc = await getCurrentConfig(pool, { serialId: id });
      const d = cc?.disagreements.find((x) => x.where === 'legacy' && x.field === field);
      if (!d || norm(field, d.value) !== norm(field, r['Value there']) || norm(field, d.current) !== norm(field, r['Value on the record (kept)'])) {
        skipped.push(`${id} ${field}: changed since the report`); continue;
      }
      if (dry) { done += 1; continue; }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const sn = (await client.query('SELECT serial_number FROM vendor_serial_numbers WHERE serial_id = $1', [id])).rows[0]?.serial_number;
        // `field` is one of the whitelisted column names above.
        const u = await client.query(
          `UPDATE inventory SET ${field} = $1, updated_at = NOW() WHERE LOWER(serial_number) = LOWER($2) RETURNING inventory_id`,
          [d.current, sn]
        );
        // The reviewed CSV (old value, new value, who approved) is the record of this change.
        if (u.rowCount) console.log(`  ${cc.ttspl_id || id} inventory.${field}: "${d.value}" -> "${d.current}"`);
        await client.query('COMMIT');
        done += 1;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        skipped.push(`${id} ${field}: ${e.message}`);
      } finally { client.release(); }
    }
    console.log(`${dry ? 'Would apply' : 'Applied'} ${done} of ${reviewed.length} approved FIX_LEGACY rows.`);
    if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
  } else {
    const rows = await load(pool, all);
    const out = arg('--csv');
    if (out) {
      const lines = [HEADER.join(',')];
      for (const r of rows) {
        lines.push([r.action === 'FIX_LEGACY' ? 'yes' : '', r.serial_id, r.ttspl_id, r.field, WHERE.label[r.where] || r.where, r.other, r.record, r.action].map(csvCell).join(','));
      }
      fs.writeFileSync(out, `${lines.join('\n')}\n`);
    }
    const by = {};
    for (const r of rows) by[`${r.action} (${r.where})`] = (by[`${r.action} (${r.where})`] || 0) + 1;
    console.log(`Laptops checked: ${all ? 'all' : 'in stock + in repair'}; differences: ${rows.length}, on ${new Set(rows.map((r) => r.serial_id)).size} laptops`);
    for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v}`);
    if (out) console.log(`Wrote ${out}`);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
