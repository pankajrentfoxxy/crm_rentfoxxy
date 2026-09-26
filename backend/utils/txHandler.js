/**
 * Run an Express handler inside ONE database transaction.
 *
 * The handler receives (db, res) where db is a single client in BEGIN and res
 * is a holding response: nothing reaches the caller until the work commits,
 * so a refusal (status >= 400) or a crash rolls back every write the handler
 * made. (Production safety C: next-stage, assign and friends wrote to the
 * shared pool step by step, so a refused or failed move left half its writes.)
 */
const pool = require('../config/db');

async function inTransaction(res, handler) {
  const client = await pool.connect();
  const held = { code: 200, body: undefined };
  const holding = {
    status(c) { held.code = c; return holding; },
    json(b) { held.body = b; return holding; },
    setHeader() { return holding; },
    headersSent: false,
  };
  try {
    await client.query('BEGIN');
    await handler(client, holding);
    await client.query(held.code >= 400 ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    held.code = e.status || e.statusCode || 500;
    held.body = { success: false, message: held.code === 500 ? 'Server error' : e.message };
    if (held.code === 500) console.error('[inTransaction]', e);
  } finally {
    client.release();
  }
  return res.status(held.code).json(held.body);
}

module.exports = { inTransaction };
