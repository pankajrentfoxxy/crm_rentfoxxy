const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('billing integration (optional DB)', () => {
  it('skips when DATABASE_URL is not set', async (t) => {
    if (!process.env.DATABASE_URL && !process.env.PGHOST) {
      t.skip('No database configured — integration tests skipped');
      return;
    }
    const pool = require('../config/db');
    const r = await pool.query('SELECT 1 AS ok');
    assert.equal(r.rows[0].ok, 1);
    await pool.end();
  });
});
