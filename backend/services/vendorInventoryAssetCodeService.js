/**
 * Sequential inventory asset identifiers for PO receiving (TTSPL0001 …).
 * Uses singleton row vendor_inventory_asset_sequence (migration 036).
 *
 * Allocation fills the lowest unused numbers first so a failed/aborted receive
 * (which bumps the counter but never inserts a row) does not leave permanent gaps.
 */

const PREFIX = 'TTSPL';
const PAD = 4;

function formatTtspl(num) {
  return `${PREFIX}${String(num).padStart(PAD, '0')}`;
}

function parseTtsplNum(code) {
  const m = String(code || '').match(/^TTSPL(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Active TTSPL numbers already assigned to a laptop row.
 * @param {import('pg').PoolClient} client
 */
async function loadUsedTtsplNumbers(client) {
  const r = await client.query(
    `SELECT inventory_asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND inventory_asset_code ~ '^TTSPL[0-9]+$'`
  );
  const used = new Set();
  for (const row of r.rows) {
    const n = parseTtsplNum(row.inventory_asset_code);
    if (Number.isFinite(n) && n > 0) used.add(n);
  }
  return used;
}

/**
 * Atomically reserves `qty` TTSPL codes inside an open PG transaction.
 * Reuses the lowest gap before advancing the sequence pointer.
 * @param {import('pg').PoolClient} client
 * @param {number} qty
 */
async function allocateTtsplCodes(client, qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 1 || n > 500) {
    throw new RangeError('Invalid quantity for code allocation');
  }

  const seqRes = await client.query(
    `SELECT next_num FROM vendor_inventory_asset_sequence WHERE id = 1 FOR UPDATE`
  );
  if (!seqRes.rows?.length) {
    throw new Error('Inventory asset sequence missing — apply migration 036');
  }

  const used = await loadUsedTtsplNumbers(client);
  let cursor = Math.max(1, Number(seqRes.rows[0].next_num) || 1);
  const nums = [];

  while (nums.length < n) {
    if (!used.has(cursor)) {
      nums.push(cursor);
      used.add(cursor);
    }
    cursor += 1;
  }

  const newNext = Math.max(Number(seqRes.rows[0].next_num) || 1, ...nums) + 1;
  await client.query(
    `UPDATE vendor_inventory_asset_sequence SET next_num = $1 WHERE id = 1`,
    [newNext]
  );

  return nums.map(formatTtspl);
}

/**
 * Report gaps between 1 and the highest active TTSPL number.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
async function findTtsplGaps(db) {
  const used = await loadUsedTtsplNumbers(db);
  if (!used.size) return { max: 0, gaps: [], next_num: null };

  const max = Math.max(...used);
  const gaps = [];
  for (let i = 1; i <= max; i += 1) {
    if (!used.has(i)) gaps.push(i);
  }

  const seqRes = await db.query(
    `SELECT next_num FROM vendor_inventory_asset_sequence WHERE id = 1`
  );
  return {
    max,
    gaps,
    gap_count: gaps.length,
    next_num: seqRes.rows[0]?.next_num ?? null,
  };
}

module.exports = {
  allocateTtsplCodes,
  findTtsplGaps,
  loadUsedTtsplNumbers,
  formatTtspl,
  parseTtsplNum,
  TTSPL_PREFIX: PREFIX,
  TTSPL_PAD: PAD,
};
