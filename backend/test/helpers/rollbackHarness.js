/**
 * One connection, one outer transaction, rolled back at the end. Handlers'
 * BEGIN/COMMIT/ROLLBACK become savepoints and pool.query goes to the same
 * connection, so a test can drive real handlers end to end and leave nothing
 * behind (no TTSPL code, PO, ticket or document number is used up).
 */
const pool = require('../../config/db');

const realConnect = pool.connect.bind(pool);
const realQuery = pool.query.bind(pool);
let C = null;

function wrap(c) {
  let depth = 0;
  return {
    query: (text, ...rest) => {
      const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
      if (t === 'BEGIN') { depth += 1; return c.query(`SAVEPOINT hx${depth}`); }
      if (t === 'COMMIT') { depth -= 1; return c.query(`RELEASE SAVEPOINT hx${depth + 1}`); }
      if (t === 'ROLLBACK') { depth -= 1; return c.query(`ROLLBACK TO SAVEPOINT hx${depth + 1}`); }
      return c.query(text, ...rest);
    },
    release: () => {},
  };
}

async function open() {
  C = await realConnect();
  await C.query('BEGIN');
  const w = wrap(C);
  pool.connect = async (...a) => (a.length ? realConnect(...a) : w);
  pool.query = (...a) => C.query(...a);
  return C;
}

async function close() {
  if (C) {
    await C.query('ROLLBACK');
    C.release();
    C = null;
  }
  pool.connect = realConnect;
  pool.query = realQuery;
  await pool.end();
}

/** Drive an express handler with a fake req/res. */
async function call(fn, { params = {}, body = {}, query = {}, user, validators = [] } = {}) {
  const res = { code: 200, body: null, headersSent: false };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.setHeader = () => {};
  const req = { params, body, query, user, permissionCache: {} };
  for (const v of validators) await v.run(req);
  await fn(req, res);
  return res;
}

module.exports = { open, close, call, db: () => C };
