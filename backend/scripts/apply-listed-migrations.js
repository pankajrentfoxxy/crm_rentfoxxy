#!/usr/bin/env node
/**
 * Apply exactly the migrations named, one transaction, recorded in
 * schema_migrations — never "everything pending" (run-all-migrations.js would
 * also replay seed / dummy-data files on this box).
 *
 *   node scripts/apply-listed-migrations.js 339_floor_stage_forms.sql 340_laptop_config_confirmations.sql
 *       → dry run: applies, prints checks, ROLLS BACK
 *   ... --commit
 *       → the same, and COMMITS
 *
 * A file already recorded in schema_migrations is skipped. Any error rolls
 * back all of them.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const commit = process.argv.includes('--commit');
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('Name the migration files to apply.'); process.exit(2); }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const f of files) {
      const name = path.basename(f);
      const full = path.join(__dirname, '..', 'migrations', name);
      if (!fs.existsSync(full)) throw new Error(`No such migration: ${name}`);
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])).rows.length) {
        console.log(`${name}: already recorded — skipped`);
        continue;
      }
      await c.query(fs.readFileSync(full, 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`${name}: applied`);
    }
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    console.log(commit ? 'COMMITTED' : 'Dry run — ROLLED BACK. Add --commit to keep it.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(`FAILED, nothing kept: ${e.message}`);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
