/**
 * Sequential inventory asset identifiers for PO receiving (TTSPL0001 …).
 * Uses singleton row vendor_inventory_asset_sequence (migration 036).
 */

const PREFIX = 'TTSPL';
const PAD = 4;

/**
 * Atomically reserves `qty` consecutive numbers inside an open PG transaction.
 * @param {import('pg').PoolClient} client
 * @param {number} qty
 */
async function allocateTtsplCodes(client, qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 1 || n > 500) {
    throw new RangeError('Invalid quantity for code allocation');
  }

  const r = await client.query(
    `UPDATE vendor_inventory_asset_sequence
     SET next_num = next_num + $1
     WHERE id = 1
     RETURNING next_num - $1 AS start_num`,
    [n]
  );

  if (!r.rows?.length) {
    throw new Error('Inventory asset sequence missing — apply migration 036');
  }

  const start = Number(r.rows[0].start_num);
  if (!Number.isFinite(start) || start < 1) {
    throw new Error('Invalid sequence state');
  }

  const codes = [];
  for (let i = 0; i < n; i += 1) {
    const num = start + i;
    codes.push(`${PREFIX}${String(num).padStart(PAD, '0')}`);
  }

  return codes;
}

module.exports = {
  allocateTtsplCodes,
  TTSPL_PREFIX: PREFIX,
  TTSPL_PAD: PAD
};
