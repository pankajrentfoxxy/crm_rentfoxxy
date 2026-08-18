/**
 * Apply pending migrations from a minimum number onward (skips already-applied).
 * Usage: node scripts/run-pending-from.js 195
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const fromNum = Number(process.argv[2] || '195');

function migrationNumber(name) {
  const m = String(name).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const dir = path.join(__dirname, '../migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => {
      const n = migrationNumber(f);
      return n != null && n >= fromNum;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const already = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
      [file]
    );
    if (already.rows.length) {
      skipped += 1;
      console.log(`SKIP ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied += 1;
      console.log(`APPLIED ${file}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`FAILED ${file} -> ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`DONE applied=${applied} skipped=${skipped} scanned=${files.length} from=${fromNum}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async () => {
    await pool.end().catch(() => {});
    process.exit(1);
  });
