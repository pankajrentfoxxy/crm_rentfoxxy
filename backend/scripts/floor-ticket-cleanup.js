#!/usr/bin/env node
/**
 * PD10 — one-time clean-up of open floor tickets.
 *
 * On QA (26 Sep 2026) 489 tickets were open but only 44 of their laptops were
 * "in repair": 127 showed "in stock" (sellable while on the floor), 302
 * "returned", and 11 were rented / sold / scrapped / back with the vendor.
 *
 * Step 1 — report (read-only). Every open ticket gets ONE proposed action and
 * why, in a CSV the floor manager reviews in Excel:
 *   node scripts/floor-ticket-cleanup.js --csv <file>
 *
 * Step 2 — apply what was approved. Put "yes" in the Approve column for each
 * row to apply, then:
 *   node scripts/floor-ticket-cleanup.js --apply <reviewed.csv> [--dry-run]
 * A row is applied only if the ticket is still in the state the report saw
 * (its action is recomputed and must match), so nothing stale is applied.
 *
 * Actions
 *   CLOSE        laptop is rented, sold, scrapped or back with the vendor, or
 *                already at Inventory — the ticket is closed (no laptop change)
 *   TO_IN_REPAIR laptop is on the floor but marked in stock / returned — it is
 *                set to "in repair" through the state machine; ticket stays
 *   KEEP         nothing to change (in repair, or a sales-order Dispatch QC)
 *   CHECK        added to any of the above when nothing happened for 60+ days:
 *                someone should confirm where the laptop physically is
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const pool = require('../config/db');
const { transitionAsset } = require('../services/inventoryStateMachine');

const STALE_DAYS = 60;
const GONE = new Set(['rented', 'sold', 'on_demo', 'in_transit', 'scrapped', 'returned_to_vendor']);

function decide(row) {
  const inv = row.inventory_status || null;
  const stage = row.stage_name || '';
  if (!row.vendor_serial_id) return { action: 'KEEP', why: 'No laptop record linked — check the ticket by hand' };
  if (GONE.has(inv)) return { action: 'CLOSE', why: `Laptop is ${inv.replace(/_/g, ' ')} — the floor ticket was left open` };
  if (stage === 'Inventory') return { action: 'CLOSE', why: 'Ticket is at Inventory but was never closed' };
  if (['reserved', 'dispatch_ready'].includes(inv)) {
    return { action: 'KEEP', why: row.ticket_type === 'sales_order_qc' ? 'Sales-order laptop in Dispatch QC' : 'Laptop is reserved on an order — check with dispatch' };
  }
  if (['in_stock', 'returned', null].includes(inv)) {
    return {
      action: 'TO_IN_REPAIR',
      why: stage === 'Pending Inventory'
        ? `Passed QC2, waiting to be scanned into a slot — shows "${inv || 'no status'}", should be "in repair" until received`
        : `On the floor at ${stage} but shows "${inv || 'no status'}" — could be sold while being worked on`,
    };
  }
  return { action: 'KEEP', why: `Laptop is ${String(inv).replace(/_/g, ' ')} — correct for a floor ticket` };
}

async function load(db) {
  const { rows } = await db.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.ticket_type, t.status, t.created_at, t.vendor_serial_id,
            s.stage_name, v.inventory_status, u.name AS assigned_to,
            -- Real work only: updated_at moves on any edit (data fixes included).
            COALESCE(GREATEST(
              (SELECT MAX(a.created_at) FROM activities a WHERE a.ticket_id = t.ticket_id),
              (SELECT MAX(h.created_at) FROM production_ticket_history h WHERE h.ticket_id = t.ticket_id),
              (SELECT MAX(w.start_time) FROM work_logs w WHERE w.ticket_id = t.ticket_id)
            ), t.created_at) AS last_activity
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN vendor_serial_numbers v ON v.serial_id = t.vendor_serial_id AND v.deleted_at IS NULL
       LEFT JOIN users u ON u.user_id = t.assigned_user_id
      WHERE t.status NOT IN ('completed', 'cancelled')
      ORDER BY t.ticket_id`
  );
  return rows.map((r) => {
    const d = decide(r);
    const idle = r.last_activity ? Math.floor((Date.now() - new Date(r.last_activity)) / 86400000) : null;
    return { ...r, ...d, idle_days: idle, check: idle != null && idle >= STALE_DAYS };
  });
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const HEADER = ['Approve', 'Ticket', 'TTSPL', 'Serial', 'Stage', 'Laptop status now', 'Proposed action', 'Why', 'Days since last activity', 'Check where it is', 'Assigned to', 'Ticket type', 'Opened'];

function toCsv(rows) {
  const out = [HEADER.join(',')];
  for (const r of rows) {
    out.push([
      r.action === 'KEEP' ? '' : 'yes', r.ticket_id, r.ttspl_id, r.serial_number, r.stage_name, r.inventory_status || '',
      r.action, r.why, r.idle_days, r.check ? 'CHECK' : '', r.assigned_to || '', r.ticket_type || '',
      r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
    ].map(csvCell).join(','));
  }
  return `${out.join('\n')}\n`;
}

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

async function applyRow(client, r, note) {
  if (r.action === 'CLOSE') {
    await client.query(
      `UPDATE tickets SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE ticket_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [r.ticket_id]
    );
    await client.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, NULL, 'closed_in_cleanup', $2)`,
      [r.ticket_id, `Floor clean-up (PD10): ${r.why}. ${note}`]
    );
  } else if (r.action === 'TO_IN_REPAIR') {
    await transitionAsset(client, {
      serialId: r.vendor_serial_id,
      toStatus: 'in_repair',
      reason: `Floor clean-up (PD10): on floor ticket #${r.ticket_id} at ${r.stage_name}`,
      caller: 'scripts/floor-ticket-cleanup',
    });
    await client.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, NULL, 'cleanup_in_repair', $2)`,
      [r.ticket_id, `Floor clean-up (PD10): laptop set to "in repair" — ${r.why}. ${note}`]
    );
  }
}

(async () => {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const rows = await load(pool);

  if (arg('--apply')) {
    const reviewed = parseCsv(fs.readFileSync(arg('--apply'), 'utf8'));
    const approved = new Map(reviewed.filter((r) => /^(yes|y)$/i.test(r.Approve)).map((r) => [Number(r.Ticket), r['Proposed action']]));
    const dry = args.includes('--dry-run');
    const note = `Approved in ${require('path').basename(arg('--apply'))}.`;
    let done = 0; const skipped = [];
    for (const r of rows) {
      if (!approved.has(Number(r.ticket_id)) || r.action === 'KEEP') continue;
      if (approved.get(Number(r.ticket_id)) !== r.action) { skipped.push(`${r.ticket_id}: now ${r.action}, reviewed as ${approved.get(Number(r.ticket_id))}`); continue; }
      if (dry) { done += 1; continue; }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await applyRow(client, r, note);
        await client.query('COMMIT');
        done += 1;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        skipped.push(`${r.ticket_id}: ${e.message}`);
      } finally {
        client.release();
      }
    }
    console.log(`${dry ? 'Would apply' : 'Applied'} ${done} of ${approved.size} approved rows.`);
    if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
  } else {
    const out = arg('--csv');
    if (out) fs.writeFileSync(out, toCsv(rows));
    const by = {};
    for (const r of rows) by[r.action] = (by[r.action] || 0) + 1;
    console.log(`Open tickets: ${rows.length}`);
    for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v}`);
    console.log(`  of which no activity for ${STALE_DAYS}+ days (CHECK): ${rows.filter((r) => r.check).length}`);
    if (out) console.log(`Wrote ${out}`);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
