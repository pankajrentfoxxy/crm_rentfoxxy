require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const dir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
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
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [file]
      );
      await pool.query('COMMIT');
      applied += 1;
      console.log(`APPLIED ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error(`FAILED ${file} -> ${error.message}`);
      throw error;
    }
  }

  console.log(`DONE applied=${applied} skipped=${skipped} total=${files.length}`);
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
