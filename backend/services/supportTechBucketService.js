/**
 * Technician bucket for the support lead (claude/carret-support.md rework D).
 *
 * One row per technician with everything they are holding or owe right now:
 *   visits    — complaint jobs not finished
 *   to_collect — pickups assigned, laptop not collected yet
 *   in_hand   — laptops collected from the customer, not in at the gate yet
 *   deliveries — Service DC / replacement DCs out with them, not delivered
 *   parts     — parts issued to them (fit, return or move)
 *   old_parts — faulty parts they took out and must bring back
 * Each entry says since when, so the lead sees what is sitting too long.
 * Read-only; the same tables the old parts bucket and laptop bucket read.
 */
const pool = require('../config/db');

const DONE = ['resolved', 'closed', 'inventory_updated', 'cancelled', 'removed'];
const ageDays = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null);

async function techBucketBoard(db = pool, { userId = null } = {}) {
  const only = userId ? Number(userId) : null;

  const items = (await db.query(
    `SELECT i.id, i.ticket_id, i.item_type, i.pickup_type, i.status,
            COALESCE(NULLIF(i.unique_serial_number, ''), i.ttspl_id, i.serial_number) AS ttspl,
            NULLIF(TRIM(CONCAT_WS(' ', i.brand, i.model)), '') AS model,
            i.assigned_to, i.pickup_assigned_to, i.return_dc_number,
            i.created_at, i.visit_scheduled_at, i.visited_at, i.work_done_at,
            COALESCE(i.customer_otp_verified_at, i.picked_up_at) AS collected_at,
            i.warehouse_received_at, i.gate_inward_at,
            t.customer_name
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
      WHERE t.status NOT IN ('closed', 'cancelled')
        AND i.status <> ALL($1::text[])
        AND i.item_type IN ('complaint', 'pickup')
        AND COALESCE(i.pickup_assigned_to, i.assigned_to) IS NOT NULL
        AND ($2::int IS NULL OR COALESCE(i.pickup_assigned_to, i.assigned_to) = $2)`,
    [DONE, only]
  )).rows;

  const deliveries = (await db.query(
    `SELECT dc_number, MAX(COALESCE(delivery_person_id, assigned_user_id)) AS user_id,
            MAX(customer_name) AS customer_name, MAX(dc_purpose) AS purpose, MAX(status) AS status,
            MAX(COALESCE(dispatched_at, created_at)) AS since,
            SUM(COALESCE(main_qty, quantity, 0))::int AS qty
       FROM delivery_challan_lines
      WHERE COALESCE(movement_type, 'outbound') = 'outbound'
        AND dc_purpose IN ('service_return', 'replacement')
        AND LOWER(COALESCE(status, '')) NOT IN ('delivered', 'rejected', 'cancelled')
        AND COALESCE(delivery_person_id, assigned_user_id) IS NOT NULL
        AND ($1::int IS NULL OR COALESCE(delivery_person_id, assigned_user_id) = $1)
      GROUP BY dc_number`,
    [only]
  )).rows;

  const parts = (await db.query(
    `SELECT spr.id, spr.request_number, spr.status, spr.assigned_to_tech AS user_id, spr.support_ticket_id AS ticket_id,
            spr.ttspl_id AS ttspl, p.part_name, pi.prt_id, spr.issued_at, spr.return_requested_at,
            spr.reassign_requested_at, st.customer_name
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
       JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.status IN ('issued', 'return_requested')
        AND ($1::int IS NULL OR spr.assigned_to_tech = $1)`,
    [only]
  )).rows;

  const oldParts = (await db.query(
    `SELECT spr.id, spr.request_number, spr.assigned_to_tech AS user_id, spr.support_ticket_id AS ticket_id,
            spr.ttspl_id AS ttspl, p.part_name, opi.prt_id, spr.old_part_collected_at, st.customer_name
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances opi ON opi.instance_id = spr.old_part_instance_id
       JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.old_part_status = 'with_tech'
        AND ($1::int IS NULL OR spr.assigned_to_tech = $1)`,
    [only]
  )).rows;

  const ids = new Set([
    ...items.map((i) => i.pickup_assigned_to || i.assigned_to),
    ...deliveries.map((d) => d.user_id),
    ...parts.map((p) => p.user_id),
    ...oldParts.map((p) => p.user_id),
  ].filter(Boolean).map(Number));
  const users = ids.size
    ? (await db.query('SELECT user_id, name, mobile_no AS phone, role FROM users WHERE user_id = ANY($1::int[])', [[...ids]])).rows
    : [];

  const board = users.map((u) => {
    const mine = (row) => Number(row) === u.user_id;
    const myItems = items.filter((i) => mine(i.pickup_assigned_to || i.assigned_to));
    const visits = myItems.filter((i) => i.item_type === 'complaint').map((i) => ({
      item_id: i.id, ticket_id: i.ticket_id, ttspl: i.ttspl, model: i.model, customer: i.customer_name,
      step: i.work_done_at ? 'Waiting for the customer OTP' : i.visited_at ? 'On site / result pending' : 'Not visited yet',
      appointment: i.visit_scheduled_at, since: i.created_at, days: ageDays(i.created_at),
    }));
    const pickups = myItems.filter((i) => i.item_type === 'pickup');
    const toCollect = pickups.filter((i) => !i.collected_at).map((i) => ({
      item_id: i.id, ticket_id: i.ticket_id, ttspl: i.ttspl, model: i.model, customer: i.customer_name,
      return_dc_number: i.return_dc_number, kind: i.pickup_type || 'pickup', since: i.created_at, days: ageDays(i.created_at),
    }));
    const inHand = pickups.filter((i) => i.collected_at && !i.warehouse_received_at && !i.gate_inward_at).map((i) => ({
      item_id: i.id, ticket_id: i.ticket_id, ttspl: i.ttspl, model: i.model, customer: i.customer_name,
      return_dc_number: i.return_dc_number, kind: i.pickup_type || 'pickup', since: i.collected_at, days: ageDays(i.collected_at),
    }));
    const outForDelivery = deliveries.filter((d) => mine(d.user_id)).map((d) => ({
      dc_number: d.dc_number, customer: d.customer_name, purpose: d.purpose === 'service_return' ? 'Service DC' : 'Replacement',
      qty: d.qty, status: d.status, since: d.since, days: ageDays(d.since),
    }));
    const myParts = parts.filter((p) => mine(p.user_id)).map((p) => ({
      request_id: p.id, request_number: p.request_number, ticket_id: p.ticket_id, ttspl: p.ttspl, part: p.part_name, prt_id: p.prt_id,
      customer: p.customer_name,
      state: p.status === 'return_requested' ? 'Bringing it back' : p.reassign_requested_at ? 'Asked to move to another ticket' : 'To fit',
      since: p.issued_at, days: ageDays(p.issued_at),
    }));
    const myOld = oldParts.filter((p) => mine(p.user_id)).map((p) => ({
      request_id: p.id, request_number: p.request_number, ticket_id: p.ticket_id, ttspl: p.ttspl, part: p.part_name, prt_id: p.prt_id,
      customer: p.customer_name, since: p.old_part_collected_at, days: ageDays(p.old_part_collected_at),
    }));
    const all = [...visits, ...toCollect, ...inHand, ...outForDelivery, ...myParts, ...myOld];
    return {
      user_id: u.user_id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      counts: {
        visits: visits.length,
        to_collect: toCollect.length,
        in_hand: inHand.length,
        deliveries: outForDelivery.length,
        parts: myParts.length,
        old_parts: myOld.length,
      },
      oldest_days: all.reduce((m, x) => Math.max(m, x.days || 0), 0),
      visits,
      to_collect: toCollect,
      in_hand: inHand,
      deliveries: outForDelivery,
      parts: myParts,
      old_parts: myOld,
    };
  });
  board.sort((a, b) => (b.counts.in_hand + b.counts.old_parts) - (a.counts.in_hand + a.counts.old_parts) || b.oldest_days - a.oldest_days);
  return board;
}

module.exports = { techBucketBoard };
