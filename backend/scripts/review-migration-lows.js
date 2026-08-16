'use strict';

require('dotenv').config();
const readline = require('readline');
const pool = require('../config/db');
const { resolvePickupType } = require('../services/supportPickupMigration');

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

async function listLows(db) {
  const items = (await db.query(
    `SELECT i.id, i.ticket_id, i.serial_number, i.pickup_type, i.service_dc_number, i.status,
            t.customer_id, t.customer_name
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
      WHERE i.item_type = 'pickup'`
  )).rows;
  const reviewed = new Set(
    (await db.query('SELECT legacy_item_id FROM support_migration_review')).rows.map((r) => r.legacy_item_id)
  );
  const migrated = new Set(
    (await db.query(
      'SELECT legacy_item_id FROM support_work_orders WHERE legacy_item_id IS NOT NULL'
    )).rows.map((r) => r.legacy_item_id)
  );
  const lows = [];
  for (const item of items) {
    if (migrated.has(item.id) || reviewed.has(item.id)) continue;
    const decision = resolvePickupType(item, {});
    if (decision.confidence !== 'LOW') continue;
    lows.push({ item, decision });
  }
  return lows;
}

async function upsert(db, itemId, decision, userId, note) {
  if (decision !== 'repair' && decision !== 'return') {
    throw new Error('decision must be repair or return');
  }
  await db.query(
    `INSERT INTO support_migration_review (legacy_item_id, decision, decided_by, note)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (legacy_item_id) DO UPDATE
       SET decision = EXCLUDED.decision,
           decided_by = EXCLUDED.decided_by,
           decided_at = NOW(),
           note = EXCLUDED.note`,
    [itemId, decision, userId || null, note || null]
  );
}

async function main() {
  const listOnly = process.argv.includes('--list');
  const itemId = arg('--item');
  const decision = arg('--decision');
  const by = arg('--by');

  if (itemId && decision) {
    await upsert(pool, Number(itemId), decision, by ? Number(by) : null, arg('--note'));
    console.log(`Reviewed item ${itemId} as ${decision}`);
    return;
  }

  const lows = await listLows(pool);
  if (!lows.length) {
    console.log('No unreviewed LOW-confidence pickup items.');
    return;
  }

  console.log(`${lows.length} LOW-confidence pickup(s) need a repair/return decision:\n`);
  for (const row of lows) {
    const i = row.item;
    console.log(
      `  item ${i.id}  ticket ${i.ticket_id}  customer ${i.customer_id || ''} ${i.customer_name || ''}  serial ${i.serial_number || '-'}  suggested ${row.decision.wo_type} (${row.decision.rule})`
    );
  }

  if (listOnly || !process.stdin.isTTY) {
    console.log('\nAccept one: node scripts/review-migration-lows.js --item <id> --decision repair|return');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  for (const row of lows) {
    const i = row.item;
    const ans = String(await ask(`item ${i.id} (${i.serial_number || 'no serial'}) repair/return/skip: `)).trim().toLowerCase();
    if (ans === 'repair' || ans === 'return') {
      await upsert(pool, i.id, ans, by ? Number(by) : null, null);
      console.log(`  saved ${ans}`);
    }
  }
  rl.close();
}

main()
  .catch((e) => {
    console.error('review-migration-lows:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
