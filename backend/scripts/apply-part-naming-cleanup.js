#!/usr/bin/env node
/**
 * Part naming clean-up, step 2: APPLY the reviewed CSV.
 *
 * Step 1 (scripts/part-naming-cleanup-report.js) wrote
 * claude/reports/part-naming-cleanup-<tag>.csv. A reviewer edits category /
 * kind / specs ("capacity=8 GB; ram_type=DDR4") / fits / fits_brand /
 * fits_models ("Latitude 5420 | Latitude 5520") / own_name and puts
 * apply=yes on every row to change. Only apply=yes rows are touched.
 *
 *   node scripts/apply-part-naming-cleanup.js --file <csv> [--commit]
 *
 * DRY RUN BY DEFAULT: every row is validated with the same rules as the Parts
 * catalogue form (constants/partNaming.js normalizePartStructure) and printed
 * with its new name; nothing is written. With --commit, inside ONE
 * transaction: every target row is locked FOR UPDATE, the before-image of each
 * changed `parts` row and linked `vendor_spare_parts_catalog` row is written
 * to backend/backups/part-naming-cleanup-<ts>.json FIRST, then the rows are
 * updated and the transaction commits. Any problem (invalid structure, a row
 * renamed since the report, two parts ending up identical, a clash with a
 * part not in the file) aborts the whole run — nothing half-applied.
 *
 * What changes on a part: category, part_type (kind), specs (+ _was = the old
 * name, kept for search), default_fitment, compatible_brands /
 * compatible_models, part_name (generated unless own_name), name_override,
 * spec_key. The linked spare catalogue row follows (name, category,
 * part_type). Stock, units, prices, is_consumable are NOT touched; duplicates
 * are NOT merged (the report flags them for a person).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { normalizePartStructure } = require('../constants/partNaming');
const { parseCsv, specsFromCell } = require('../services/partNamingCleanup');

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const COMMIT = args.includes('--commit');
const FILE = arg('--file');

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const list = (cell) => String(cell || '').split('|').map(clean).filter(Boolean);

/** A reviewed CSV row → the structure normalizePartStructure takes. */
function structureFromRow(r) {
  const own = clean(r.own_name);
  return {
    category: r.category,
    kind: r.kind,
    specs: specsFromCell(r.specs),
    default_fitment: clean(r.fits) || 'unset',
    compatible_brands: clean(r.fits_brand) ? [clean(r.fits_brand)] : [],
    compatible_models: list(r.fits_models),
    name_override: Boolean(own),
    part_name: own,
  };
}

/** Validate every approved row; returns { plan[], problems[] } without touching the DB. */
function planFromRows(rows) {
  const plan = [];
  const problems = [];
  for (const r of rows) {
    if (clean(r.apply).toLowerCase() !== 'yes') continue;
    const id = Number(r.part_id);
    if (!Number.isInteger(id) || id <= 0) { problems.push(`bad part_id "${r.part_id}"`); continue; }
    const n = normalizePartStructure(structureFromRow(r));
    if (!n.ok) { problems.push(`#${id} ${r.current_name}: ${n.errors.join('; ')}`); continue; }
    plan.push({ id, expectName: r.current_name, value: n.value });
  }
  const seen = new Map();
  for (const p of plan) {
    if (seen.has(p.value.spec_key)) problems.push(`#${p.id} and #${seen.get(p.value.spec_key)} would be the same part (${p.value.part_name}) — merge by hand or change one`);
    else seen.set(p.value.spec_key, p.id);
  }
  return { plan, problems };
}

async function main() {
  if (!FILE) throw new Error('--file <reviewed csv> is required');
  const rows = parseCsv(fs.readFileSync(path.resolve(FILE), 'utf8'));
  const { plan, problems } = planFromRows(rows);
  const approved = rows.filter((r) => clean(r.apply).toLowerCase() === 'yes').length;
  console.log(`${rows.length} rows in the file, ${approved} marked apply=yes`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = plan.map((p) => p.id);
    const cur = new Map((await client.query(
      'SELECT * FROM parts WHERE part_id = ANY($1::int[]) ORDER BY part_id FOR UPDATE', [ids]
    )).rows.map((r) => [r.part_id, r]));

    for (const p of plan) {
      const row = cur.get(p.id);
      if (!row) { problems.push(`#${p.id}: no such part`); continue; }
      if (clean(row.part_name) !== clean(p.expectName)) problems.push(`#${p.id}: renamed since the report ("${p.expectName}" → "${row.part_name}") — re-run the report`);
    }
    // Clash with a live part that is not being changed here.
    if (plan.length) {
      const clash = await client.query(
        `SELECT part_id, part_name, spec_key FROM parts
          WHERE spec_key = ANY($1::text[]) AND archived IS NOT TRUE AND NOT (part_id = ANY($2::int[]))`,
        [plan.map((p) => p.value.spec_key), ids]
      );
      for (const c of clash.rows) {
        const mine = plan.find((p) => p.value.spec_key === c.spec_key);
        problems.push(`#${mine.id} would duplicate #${c.part_id} "${c.part_name}"`);
      }
    }

    for (const p of plan) {
      const row = cur.get(p.id);
      if (!row) continue;
      const tag = row.part_name === p.value.part_name ? '(name unchanged)' : '';
      console.log(`#${p.id}  ${row.part_name}  →  ${p.value.part_name} ${tag}  [${p.value.category}/${p.value.part_type}]`);
    }

    if (problems.length) {
      console.log(`\n${problems.length} problem(s) — nothing applied:`);
      problems.forEach((x) => console.log(`  - ${x}`));
      await client.query('ROLLBACK');
      process.exitCode = 2;
      return;
    }
    if (!COMMIT) {
      await client.query('ROLLBACK');
      console.log(`\nDRY RUN: ${plan.length} part(s) would change. Re-run with --commit to apply.`);
      return;
    }

    const catalog = (await client.query(
      'SELECT * FROM vendor_spare_parts_catalog WHERE floor_part_id = ANY($1::int[]) ORDER BY part_id FOR UPDATE', [ids]
    )).rows;
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `part-naming-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backup, JSON.stringify({
      file: path.resolve(FILE), at: new Date().toISOString(), parts: [...cur.values()], vendor_spare_parts_catalog: catalog,
    }, null, 2));
    console.log(`\nbackup: ${backup}`);

    for (const p of plan) {
      const row = cur.get(p.id);
      const v = p.value;
      const specs = { ...v.specs, _was: row.specs?._was || row.part_name };
      await client.query(
        `UPDATE parts
            SET category = $2, part_type = $3, specs = $4::jsonb, default_fitment = $5,
                compatible_brands = $6, compatible_models = $7, part_name = $8,
                name_override = $9, spec_key = $10, updated_at = NOW()
          WHERE part_id = $1`,
        [p.id, v.category, v.part_type, JSON.stringify(specs), v.default_fitment,
          v.compatible_brands, v.compatible_models, v.part_name, v.name_override, v.spec_key]
      );
      await client.query(
        `UPDATE vendor_spare_parts_catalog
            SET name = $2, category = $3, part_type = $4, updated_at = NOW()
          WHERE floor_part_id = $1`,
        [p.id, v.part_name, v.category, v.part_type]
      );
    }
    await client.query('COMMIT');
    console.log(`APPLIED: ${plan.length} part(s) renamed / structured.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { planFromRows, structureFromRow };
