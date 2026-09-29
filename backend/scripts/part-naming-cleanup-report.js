#!/usr/bin/env node
/**
 * Part naming clean-up, step 1: REPORT (read-only).
 *
 * For every part in `parts` it proposes category + kind + specs + fits and
 * the generated name (constants/partNaming.js), rule-based from the current
 * name (services/partNamingCleanup.js). Rows the rules are sure of are status
 * OK with apply=yes; everything else is REVIEW with apply blank and the reason
 * in `reasons`. Nothing is written to the database.
 *
 *   node scripts/part-naming-cleanup-report.js [--tag QA-2026-09-29] [--out <dir>]
 *
 * Writes claude/reports/part-naming-cleanup-<tag>.csv. Review it: edit
 * category / kind / specs ("capacity=8 GB; ram_type=DDR4") / fits_* / own_name,
 * set apply=yes on rows to change, then run
 * scripts/apply-part-naming-cleanup.js (dry run first).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  proposeForPart, markDuplicates, specsToCell, csvCell, CONFIDENT,
} = require('../services/partNamingCleanup');
const { kindLabel } = require('../constants/partNaming');

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TAG = arg('--tag', `QA-${new Date().toISOString().slice(0, 10)}`);
const OUT = path.resolve(arg('--out', path.join(__dirname, '..', '..', 'claude', 'reports')));

const HEAD = [
  'part_id', 'apply', 'status', 'current_name', 'current_category', 'current_type', 'current_fits_brands',
  'stock_units', 'counted_qty', 'proposed_name', 'category', 'kind', 'kind_label', 'specs',
  'fits', 'fits_brand', 'fits_models', 'own_name', 'reasons',
];

async function main() {
  const parts = (await pool.query(
    `SELECT p.*,
            (SELECT count(*)::int FROM part_instances pi WHERE pi.part_id = p.part_id) AS unit_count
       FROM parts p
      ORDER BY p.part_id`
  )).rows;
  const modelIndex = (await pool.query(
    `SELECT b.name AS brand, m.name AS model
       FROM asset_config_brand_models bm
       JOIN asset_config_brands b ON b.id = bm.brand_id
       JOIN asset_config_models m ON m.id = bm.model_id`
  )).rows;
  const knownBrands = (await pool.query('SELECT name FROM asset_config_brands')).rows.map((r) => r.name);

  const rows = markDuplicates(parts.map((part) => ({ part, proposal: proposeForPart(part, { modelIndex, knownBrands }) })));

  const out = rows.map(({ part, proposal: pr }) => ({
    part_id: part.part_id,
    apply: pr.status === CONFIDENT ? 'yes' : '',
    status: pr.status,
    current_name: part.part_name,
    current_category: part.category,
    current_type: part.part_type,
    current_fits_brands: (part.compatible_brands || []).join(' | '),
    stock_units: part.unit_count,
    counted_qty: part.quantity,
    proposed_name: pr.name,
    category: pr.structure.category,
    kind: pr.structure.kind,
    kind_label: pr.structure.kind ? kindLabel(pr.structure.category, pr.structure.kind) : '',
    specs: specsToCell(pr.structure.specs),
    fits: pr.structure.default_fitment,
    fits_brand: (pr.structure.compatible_brands || [])[0] || '',
    fits_models: (pr.structure.compatible_models || []).join(' | '),
    own_name: '',
    reasons: pr.reasons.join('; '),
  }));

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `part-naming-cleanup-${TAG}.csv`);
  fs.writeFileSync(file, `${[HEAD.join(','), ...out.map((r) => HEAD.map((h) => csvCell(r[h])).join(','))].join('\n')}\n`);

  const ok = out.filter((r) => r.status === CONFIDENT).length;
  const byCat = {};
  for (const r of out) byCat[r.category || '(none)'] = (byCat[r.category || '(none)'] || 0) + 1;
  console.log(`${file}`);
  console.log(`parts: ${out.length}   confident (apply=yes): ${ok}   REVIEW: ${out.length - ok}`);
  console.log(`duplicates flagged: ${rows.filter((r) => r.proposal.duplicate_of).length}`);
  console.log('proposed categories:', Object.entries(byCat).sort().map(([k, v]) => `${k} ${v}`).join(', '));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
