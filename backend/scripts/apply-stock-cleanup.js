#!/usr/bin/env node
/**
 * ST-D4 — Stock data clean-up, step 2: APPLY the reviewed CSVs.
 *
 * Step 1 (scripts/stock-cleanup-report.js) wrote one CSV per problem to
 * claude/reports/stock-cleanup-<n>-<slug>-<tag>.csv. After review, this script
 * applies the rows whose fix_code is actionable and whose confidence is
 * "high" (plus "medium" with --include-medium). A reviewer vetoes a row by
 * changing its confidence to "low", its fix_code to "SKIP", or (optional
 * column) putting "no" in an `approve` column.
 *
 *   node scripts/apply-stock-cleanup.js [--tag QA-2026-09-27] [--dir <reports dir>]
 *        [--only 1,2,3,4,6] [--include-medium] [--actor-user-id <id>] [--commit]
 *
 * DRY RUN BY DEFAULT: everything runs inside one transaction (BEGIN … ROLLBACK)
 * so the counts are what a commit would do, including state-machine refusals.
 * --commit keeps it: the before-values of every touched row are written to
 * backend/backups/stock-cleanup-<ts>.json FIRST, then COMMIT.
 *
 * Every row is re-checked against the live row (locked FOR UPDATE) before it is
 * applied; a row whose laptop has moved on since the report is skipped as stale.
 * Each row runs under a SAVEPOINT so one failure does not undo the others.
 *
 * Status changes go through inventoryStateMachine.transitionAsset(). The one
 * allowOverride is scrapped -> returned_to_vendor (CSV 6): scrapped is terminal
 * in the state machine, but these laptops were never scrap — the old vendor
 * replacement code mislabelled them — so this is a correction, and the reason
 * written to the audit trail says so. qc_status / extra are written directly
 * (allowed), each with a ttspl_audit_log entry.
 *
 * Actions (fix_code)
 *   1 TO_SOLD                rented -> sold + customer / DC / entity from the sale challan; warranty stamped
 *   1 SET_CUSTOMER           stays rented; customer / DC / entity restored (transitionAsset rented -> rented)
 *   2 TO_IN_REPAIR           in_stock -> in_repair (open floor ticket) + ticket activity
 *   2 SET_QC_PENDING         qc_status -> qc_pending (stays in_stock)
 *   2 MARK_PASSED            qc_status -> passed (medium only: needs --include-medium)
 *   3 CLEAR_CUSTOMER_DC      clear current_customer_id + current_dc_number (+ current_entity when in_stock)
 *   3 CLEAR_CUSTOMER         clear current_customer_id only (keeps the vendor repair DC)
 *   4 BACKFILL_SCRAP_AUDIT   insert the missing inventory_status_transitions row (-> scrapped) at the best-known date
 *   4 CANCEL_TICKET          cancel the open floor ticket of a scrapped laptop + ticket activity
 *   6 TO_RETURNED_TO_VENDOR  scrapped -> returned_to_vendor (allowOverride, correction) + qc_status + extra
 * Not actionable (listed for people): REVIEW, KEEP_RETURNED, KEEP_VENDOR_REPAIR_DC,
 *   QC_PENDING_NO_ACTION, SEE_CSV6, WAREHOUSE_TAG_SLOT, SKIP.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { transitionAsset } = require('../services/inventoryStateMachine');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { stampOnDelivery } = require('../services/lockInWarrantyService');

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const COMMIT = args.includes('--commit');
const INCLUDE_MEDIUM = args.includes('--include-medium');
const TAG = arg('--tag', 'QA-2026-09-27');
const DIR = path.resolve(arg('--dir', path.join(__dirname, '..', '..', 'claude', 'reports')));
const ONLY = arg('--only') ? new Set(arg('--only').split(',').map((s) => s.trim())) : null;
const ACTOR_ID = arg('--actor-user-id') ? Number(arg('--actor-user-id')) : null;
const ACTOR_NAME = 'ST-D4 stock clean-up';
const CALLER = 'scripts/apply-stock-cleanup';

// Applied in this order: 6 first, because 3 and 4 defer those laptops to it;
// 3 before 2, because 13 in-stock laptops are in both (stale DC + open floor
// ticket) and 3's re-check expects them still "in_stock".
const FILES = [
  ['6', 'vendor-kept-not-scrap'],
  ['1', 'rented-no-customer'],
  ['3', 'not-deployed-with-customer'],
  ['4', 'scrapped-no-history'],
  ['2', 'in-stock-not-qc-passed'],
];
const ACTIONABLE = new Set([
  'TO_SOLD', 'SET_CUSTOMER', 'TO_IN_REPAIR', 'SET_QC_PENDING', 'MARK_PASSED',
  'CLEAR_CUSTOMER_DC', 'CLEAR_CUSTOMER', 'BACKFILL_SCRAP_AUDIT', 'CANCEL_TICKET', 'TO_RETURNED_TO_VENDOR',
]);
const OPEN_TICKET = ['in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair'];

function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

class Stale extends Error {}
const stale = (why) => { throw new Stale(why); };
const nz = (v) => (v === '' || v == null ? null : v);
const same = (a, b) => String(a ?? '') === String(b ?? '');

async function lockSerial(db, id) {
  const r = await db.query('SELECT * FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
  return r.rows[0] || null;
}
async function lockTicket(db, id) {
  const r = await db.query('SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE', [id]);
  return r.rows[0] || null;
}
const audit = (db, v, description, metadata) => logTtsplEvent({
  ttsplId: v.inventory_asset_code || v.extra?.ttspl_id, vendorSerialId: v.serial_id, eventType: 'stock_cleanup',
  description, metadata: { ...metadata, source: `ST-D4 ${TAG}` }, actorUserId: ACTOR_ID, actorName: ACTOR_NAME, db,
});

// One row. Returns a short note; throws Stale to skip.
async function applyRow(db, csvNo, r, backup) {
  const code = r.fix_code;
  const serialId = Number(r.serial_id);
  const v = await lockSerial(db, serialId);
  if (!v) stale('laptop not found');
  const entry = { csv: csvNo, fix_code: code, serial_id: serialId, ttspl_id: r.ttspl_id, before: v };
  const why = `ST-D4 clean-up (${TAG}, CSV ${csvNo})`;

  switch (code) {
    case 'TO_SOLD':
    case 'SET_CUSTOMER': {
      if (v.inventory_status !== 'rented' || v.current_customer_id != null) stale(`now ${v.inventory_status}, customer ${v.current_customer_id}`);
      const customerId = Number(r.new_customer_id);
      if (!customerId || !r.new_dc_number) stale('no customer / DC in the CSV');
      const toStatus = code === 'TO_SOLD' ? 'sold' : 'rented';
      backup.push(entry);
      await transitionAsset(db, {
        serialId, toStatus, customerId, dcNumber: r.new_dc_number, entityCode: nz(r.new_entity),
        deliveredAt: nz(r.new_date),
        reason: code === 'TO_SOLD'
          ? `${why}: sold on ${r.new_dc_number} ${r.new_date} to customer ${customerId} — was "rented" with no customer after the 21 Sep canonicalisation (ERP out_stock)`
          : `${why}: customer ${customerId} restored from ${r.new_dc_number} — lost in the 21 Sep canonicalisation`,
        actorUserId: ACTOR_ID, actorName: ACTOR_NAME, caller: CALLER,
      });
      if (toStatus === 'sold') {
        await stampOnDelivery(db, serialId, { status: 'sold', dcNumber: r.new_dc_number, saleDate: nz(r.new_date) });
      }
      return `${v.inventory_status} -> ${toStatus}, customer ${customerId}, ${r.new_dc_number}`;
    }

    case 'TO_IN_REPAIR': {
      if (v.inventory_status !== 'in_stock') stale(`now ${v.inventory_status}`);
      const ticketId = Number(r.open_ticket_id);
      const t = ticketId ? await lockTicket(db, ticketId) : null;
      if (!t || !OPEN_TICKET.includes(t.status)) stale(`floor ticket #${ticketId} no longer open`);
      backup.push(entry);
      await transitionAsset(db, {
        serialId, toStatus: 'in_repair', reason: `${why}: on floor ticket #${ticketId} — was in stock (sellable) while being worked on`,
        actorUserId: ACTOR_ID, actorName: ACTOR_NAME, caller: CALLER,
      });
      await db.query(`INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'cleanup_in_repair', $3)`,
        [ticketId, ACTOR_ID, `${why}: laptop set to "in repair" — it showed "in stock" while on this ticket.`]);
      return `in_stock -> in_repair (ticket #${ticketId})`;
    }

    case 'SET_QC_PENDING':
    case 'MARK_PASSED': {
      if (v.inventory_status !== 'in_stock' || !same(v.qc_status, r.qc_status)) stale(`now ${v.inventory_status} / qc ${v.qc_status}`);
      const open = await db.query(`SELECT ticket_id FROM tickets WHERE vendor_serial_id = $1 AND status NOT IN ('completed', 'cancelled') LIMIT 1`, [serialId]);
      if (code === 'SET_QC_PENDING' && open.rows[0]) stale(`floor ticket #${open.rows[0].ticket_id} opened since the report`);
      const to = code === 'SET_QC_PENDING' ? 'qc_pending' : 'passed';
      backup.push(entry);
      await db.query(
        `UPDATE vendor_serial_numbers
            SET qc_status = $2, updated_at = NOW(),
                extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('stock_cleanup_at', NOW(), 'stock_cleanup_qc_from', $3::text)
          WHERE serial_id = $1`,
        [serialId, to, v.qc_status]);
      await audit(db, v, `${why}: QC status ${v.qc_status} -> ${to}`, { from_qc_status: v.qc_status, to_qc_status: to });
      return `qc ${v.qc_status} -> ${to}`;
    }

    case 'CLEAR_CUSTOMER_DC':
    case 'CLEAR_CUSTOMER': {
      if (v.inventory_status !== r.current_status || !same(v.current_customer_id, r.current_customer_id) || !same(v.current_dc_number, r.current_dc_number)) {
        stale(`now ${v.inventory_status}, customer ${v.current_customer_id}, DC ${v.current_dc_number}`);
      }
      backup.push(entry);
      const clearDc = code === 'CLEAR_CUSTOMER_DC';
      const clearEntity = clearDc && v.inventory_status === 'in_stock';
      await db.query(
        `UPDATE vendor_serial_numbers
            SET current_customer_id = NULL,
                current_dc_number = CASE WHEN $2 THEN NULL ELSE current_dc_number END,
                current_entity = CASE WHEN $3 THEN NULL ELSE current_entity END,
                updated_at = NOW()
          WHERE serial_id = $1`,
        [serialId, clearDc, clearEntity]);
      await audit(db, v, `${why}: ${v.inventory_status} laptop no longer points at customer ${v.current_customer_id ?? '-'}${clearDc ? ` / DC ${v.current_dc_number ?? '-'}` : ''}`,
        { cleared_customer_id: v.current_customer_id, cleared_dc_number: clearDc ? v.current_dc_number : undefined, cleared_entity: clearEntity ? v.current_entity : undefined });
      return `cleared customer ${v.current_customer_id ?? '-'}${clearDc ? ` + DC ${v.current_dc_number ?? '-'}` : ''}${clearEntity ? ' + entity' : ''}`;
    }

    case 'BACKFILL_SCRAP_AUDIT': {
      if (v.inventory_status !== 'scrapped') stale(`now ${v.inventory_status}`);
      const has = await db.query(`SELECT 1 FROM inventory_status_transitions WHERE serial_id = $1 AND to_status = 'scrapped' LIMIT 1`, [serialId]);
      if (has.rows[0]) stale('already has a scrapped transition');
      if (!r.backfill_date) stale('no date');
      backup.push({ ...entry, inserted: 'inventory_status_transitions' });
      const ins = await db.query(
        `INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, actor_user_id, created_at)
         VALUES ($1, $2, NULL, 'scrapped', $3, $4, $5) RETURNING transition_id`,
        [serialId, v.inventory_asset_code || v.extra?.ttspl_id || null,
          `Backfill: scrapped before audit (${r.backfill_source}) — ${why}`.slice(0, 255),
          nz(r.backfill_actor_user_id) ? Number(r.backfill_actor_user_id) : null, r.backfill_date]);
      entry.inserted_transition_id = ins.rows[0].transition_id;
      return `transition #${ins.rows[0].transition_id} -> scrapped @ ${r.backfill_date.slice(0, 10)}`;
    }

    case 'CANCEL_TICKET': {
      if (v.inventory_status !== 'scrapped') stale(`laptop now ${v.inventory_status}`);
      const ticketId = Number(r.ticket_id);
      const t = await lockTicket(db, ticketId);
      if (!t || !OPEN_TICKET.includes(t.status)) stale(`ticket #${ticketId} is ${t ? t.status : 'missing'}`);
      backup.push({ ...entry, ticket_before: t });
      await db.query(`UPDATE tickets SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE ticket_id = $1`, [ticketId]);
      await db.query(`INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'closed_in_cleanup', $3)`,
        [ticketId, ACTOR_ID, `${why}: laptop is scrapped — the floor ticket was left open.`]);
      return `ticket #${ticketId} ${t.status} -> cancelled`;
    }

    case 'TO_RETURNED_TO_VENDOR': {
      if (v.inventory_status !== 'scrapped') stale(`now ${v.inventory_status}`);
      const item = (await db.query(
        `SELECT dc_number, replacement_serial_number, replacement_ttspl_id, replacement_dc_number
           FROM vendor_repair_dc_items WHERE serial_id = $1 AND item_status = 'replacement_received'
          ORDER BY id DESC LIMIT 1`, [serialId])).rows[0];
      if (!item || item.dc_number !== r.vendor_repair_dc) stale('vendor repair item no longer replacement_received on that challan');
      backup.push(entry);
      await transitionAsset(db, {
        serialId, toStatus: 'returned_to_vendor', dcNumber: item.dc_number,
        reason: `${why}: correction — vendor replacement on ${item.replacement_dc_number}, the vendor kept the original. `
          + 'Old code marked it scrapped; allowOverride because scrapped is terminal in the state machine.',
        allowOverride: true, actorUserId: ACTOR_ID, actorName: ACTOR_NAME, caller: CALLER,
      });
      // Same qc_status / extra that vendorRepairDcService writes for a vendor replacement today (D9).
      await db.query(
        `UPDATE vendor_serial_numbers
            SET qc_status = 'returned_to_vendor', updated_at = NOW(),
                extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb
          WHERE serial_id = $1`,
        [serialId, JSON.stringify({
          location: 'with_vendor', vendor_repair_dc: item.dc_number,
          replaced_by_serial: item.replacement_serial_number, replaced_by_ttspl: item.replacement_ttspl_id,
          replacement_dc_number: item.replacement_dc_number, stock_cleanup_at: new Date().toISOString(),
        })]);
      return `scrapped -> returned_to_vendor (${item.dc_number})`;
    }

    default:
      stale(`fix_code ${code} is not actionable`);
  }
  return '';
}

(async () => {
  const plan = [];
  const excluded = {};
  for (const [n, slug] of FILES) {
    if (ONLY && !ONLY.has(n)) continue;
    const file = path.join(DIR, `stock-cleanup-${n}-${slug}-${TAG}.csv`);
    if (!fs.existsSync(file)) { console.log(`(missing ${path.basename(file)} — skipped)`); continue; }
    for (const r of parseCsv(fs.readFileSync(file, 'utf8'))) {
      const conf = (r.confidence || '').toLowerCase();
      const ok = ACTIONABLE.has(r.fix_code)
        && (conf === 'high' || (INCLUDE_MEDIUM && conf === 'medium'))
        && !/^(no|n)$/i.test(r.approve || '');
      if (ok) plan.push([n, r]);
      else {
        const k = `${n}:${r.fix_code} [${conf}]${ACTIONABLE.has(r.fix_code) ? ' — not selected' : ' — no action'}`;
        excluded[k] = (excluded[k] || 0) + 1;
      }
    }
  }

  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN (rolled back)'} — tag ${TAG}, ${INCLUDE_MEDIUM ? 'high + medium' : 'high only'}, ${plan.length} rows selected`);
  const counts = {};
  const problems = [];
  const backup = [];
  const bump = (k, f) => { counts[k] = counts[k] || { applied: 0, stale: 0, failed: 0 }; counts[k][f] += 1; };

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const [n, r] of plan) {
      const key = `${n}:${r.fix_code}`;
      await db.query('SAVEPOINT row');
      try {
        await applyRow(db, n, r, backup);
        await db.query('RELEASE SAVEPOINT row');
        bump(key, 'applied');
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT row');
        // A backup entry pushed before the failure describes a change that was rolled back.
        if (backup.length && backup[backup.length - 1].serial_id === Number(r.serial_id)
            && backup[backup.length - 1].fix_code === r.fix_code) backup.pop();
        if (e instanceof Stale) { bump(key, 'stale'); problems.push(`stale  ${key} ${r.ttspl_id || r.serial_id}: ${e.message}`); } else { bump(key, 'failed'); problems.push(`FAILED ${key} ${r.ttspl_id || r.serial_id}: ${e.message}`); }
      }
    }

    console.log('\nCSV:fix_code                     applied  stale  failed');
    for (const [k, c] of Object.entries(counts).sort()) {
      console.log(`  ${k.padEnd(30)} ${String(c.applied).padStart(7)} ${String(c.stale).padStart(6)} ${String(c.failed).padStart(7)}`);
    }
    if (problems.length) console.log(`\nSkipped / failed (${problems.length}):\n  ${problems.join('\n  ')}`);
    console.log('\nNot selected:');
    for (const [k, c] of Object.entries(excluded).sort()) console.log(`  ${k}: ${c}`);

    if (COMMIT) {
      const dir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `stock-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({ tag: TAG, include_medium: INCLUDE_MEDIUM, at: new Date().toISOString(), rows: backup }, null, 1));
      console.log(`\nBackup of ${backup.length} rows' before-values: ${file}`);
      await db.query('COMMIT');
      console.log('COMMITTED.');
    } else {
      await db.query('ROLLBACK');
      console.log(`\nDry run: ${backup.length} rows would be backed up; nothing written, transaction rolled back. Re-run with --commit to apply.`);
    }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
