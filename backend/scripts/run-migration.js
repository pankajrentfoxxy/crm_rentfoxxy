const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const migrationDir = path.join(__dirname, '../migrations');

  const files = fs
    .readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();

  try {
    for (const file of files) {
      console.log(`Running ${file}`);

      const sql = fs.readFileSync(
        path.join(migrationDir, file),
        'utf8'
      );

      await client.query(sql);

      console.log(`✓ ${file}`);
    }

    console.log('All migrations completed');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();