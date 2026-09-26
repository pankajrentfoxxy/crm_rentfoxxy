/**
 * Technician bucket (claude/carret-support.md rework D): one row per person
 * holding something, and a technician filter shows only that person.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { techBucketBoard } = require('../services/supportTechBucketService');

describe('technician bucket', () => {
  after(async () => { await pool.end(); });
  it('counts match the lists and one technician sees only themself', async () => {
    const board = await techBucketBoard(pool);
    for (const t of board) {
      for (const k of ['visits', 'to_collect', 'in_hand', 'deliveries', 'parts', 'old_parts']) {
        assert.equal(t.counts[k], t[k].length, `${t.name} ${k}`);
      }
    }
    if (!board.length) return;
    const one = await techBucketBoard(pool, { userId: board[0].user_id });
    assert.equal(one.length, 1);
    assert.equal(one[0].user_id, board[0].user_id);
    assert.deepEqual(one[0].counts, board[0].counts);
  });
});
