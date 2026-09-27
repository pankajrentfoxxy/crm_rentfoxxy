#!/usr/bin/env node
/**
 * Merge Asset Configuration duplicates that normalize-asset-configuration.js
 * does not treat as equal (spacing / punctuation variants), 27 Sep 2026.
 *
 *   node scripts/merge-asset-config-duplicates.js            → dry run (rolls back)
 *   node scripts/merge-asset-config-duplicates.js --commit   → keeps it (backup JSON first)
 *
 * By NAME, so the same run works on live. For each duplicate: its brand
 * mappings move to the kept row (dropped where the kept row already has that
 * brand), generations under a duplicate processor move to the kept one, the
 * duplicate is soft-deleted (as normalize does), and the old spelling on PO
 * lines (vendor_product_details) and laptops (extra.model / extra.processor)
 * becomes the kept spelling.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MERGES = [
  { kind: 'model', keep: 'Elitebook 840 G1', dupes: ['ELITEBOOK 840G1'] },
  { kind: 'model', keep: 'Thinkpad T14 (Touchscreen)', dupes: ['Thinkpad T14 (Touch Screen)'] },
  { kind: 'processor', keep: 'Core 2 Duo', dupes: ['CORE2 DUO', 'Core2Duo'] },
];

const CFG = {
  model: { table: 'asset_config_models', map: 'asset_config_brand_models', mapCol: 'model_id', vpdCol: 'model', extraKey: 'model' },
  processor: { table: 'asset_config_processors', map: 'asset_config_brand_processors', mapCol: 'processor_id', vpdCol: 'processor', extraKey: 'processor' },
};

(async () => {
  const commit = process.argv.includes('--commit');
  const c = await pool.connect();
  const backup = [];
  try {
    await c.query('BEGIN');
    for (const m of MERGES) {
      const cfg = CFG[m.kind];
      const keep = (await c.query(
        `SELECT * FROM ${cfg.table} WHERE name = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [m.keep]
      )).rows[0];
      if (!keep) { console.log(`- ${m.kind} "${m.keep}": not found, skipped`); continue; }
      for (const dupeName of m.dupes) {
        const dupe = (await c.query(
          `SELECT * FROM ${cfg.table} WHERE name = $1 AND deleted_at IS NULL AND id <> $2 ORDER BY id LIMIT 1`, [dupeName, keep.id]
        )).rows[0];
        if (!dupe) { console.log(`- ${m.kind} "${dupeName}": already merged / not found`); continue; }
        backup.push({ table: cfg.table, row: dupe });

        const maps = (await c.query(`SELECT * FROM ${cfg.map} WHERE ${cfg.mapCol} = $1 AND deleted_at IS NULL`, [dupe.id])).rows;
        let moved = 0; let dropped = 0;
        for (const mp of maps) {
          backup.push({ table: cfg.map, row: mp });
          const has = (await c.query(
            `SELECT 1 FROM ${cfg.map} WHERE brand_id = $1 AND ${cfg.mapCol} = $2 AND deleted_at IS NULL`, [mp.brand_id, keep.id]
          )).rows.length;
          if (has) {
            await c.query(`UPDATE ${cfg.map} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [mp.id]);
            dropped += 1;
          } else {
            await c.query(`UPDATE ${cfg.map} SET ${cfg.mapCol} = $2, updated_at = NOW() WHERE id = $1`, [mp.id, keep.id]);
            moved += 1;
          }
        }
        let gens = 0;
        if (m.kind === 'processor') {
          const g = await c.query(
            `UPDATE asset_config_generations SET processor_id = $2, updated_at = NOW() WHERE processor_id = $1 AND deleted_at IS NULL RETURNING id`,
            [dupe.id, keep.id]
          );
          gens = g.rowCount;
        }
        await c.query(`UPDATE ${cfg.table} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [dupe.id]);

        const vpd = await c.query(
          `UPDATE vendor_product_details SET ${cfg.vpdCol} = $2 WHERE ${cfg.vpdCol} = $1 RETURNING product_detail_id`,
          [dupeName, m.keep]
        );
        const vsnBefore = (await c.query(
          `SELECT serial_id, extra->>'${cfg.extraKey}' AS v FROM vendor_serial_numbers WHERE extra->>'${cfg.extraKey}' = $1`, [dupeName]
        )).rows;
        backup.push({ table: 'vendor_serial_numbers.extra', key: cfg.extraKey, rows: vsnBefore });
        const vsn = await c.query(
          `UPDATE vendor_serial_numbers
              SET extra = jsonb_set(extra, '{${cfg.extraKey}}', to_jsonb($2::text)), updated_at = NOW()
            WHERE extra->>'${cfg.extraKey}' = $1`,
          [dupeName, m.keep]
        );
        console.log(`- ${m.kind} "${dupeName}" (#${dupe.id}) → "${m.keep}" (#${keep.id}): mappings moved ${moved}, dropped ${dropped}`
          + `${m.kind === 'processor' ? `, generations moved ${gens}` : ''}, PO lines ${vpd.rowCount}, laptops ${vsn.rowCount}`);
      }
    }
    if (commit) {
      const dir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `asset-config-merge-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2));
      await c.query('COMMIT');
      console.log(`COMMITTED (before-values: ${file})`);
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run — ROLLED BACK. Add --commit to keep it.');
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
