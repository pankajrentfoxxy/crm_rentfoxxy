require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const CORRECT_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K';

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/073b_fix_seed_passwords.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const verify = await pool.query(
    `SELECT email, role,
       CASE WHEN password_hash = $1 THEN 'ok' ELSE 'wrong' END AS password_status
     FROM users
     WHERE email LIKE '%@rentfoxxy.com'
     ORDER BY email`,
    [CORRECT_HASH]
  );
  const wrong = verify.rows.filter((r) => r.password_status !== 'ok');
  console.log('Migration 073b OK — seed users:', verify.rows.length, 'wrong:', wrong.length);
  if (wrong.length) {
    wrong.forEach((r) => console.log('  still wrong:', r.email));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
