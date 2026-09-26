/**
 * Support lead's queue (claude/carret-support.md step 4): every open ticket,
 * sorted into who acts next, with its SLA. One lane per ticket, the most
 * pressing one:
 *   ready_to_return   a customer's laptop is repaired — raise the Service DC
 *   lead_turn         the lead decides: replacement / pickup asked for, a pickup
 *                     not dispatched, a replacement waiting
 *   needs_technician  nobody assigned yet
 *   in_progress       with a technician / the warehouse / the floor
 */
const pool = require('../config/db');
const { deriveItemCurrentStep } = require('./supportTicketFlow');
const { slaForTickets } = require('./supportSlaService');

const LEAD_STEPS = new Set(['replacement_required', 'pending_dispatch', 'picked_up_for_repair', 'approved', 'flagged']);

function laneOf(items) {
  const live = items.filter((i) => !['cancelled', 'removed'].includes(i.status));
  if (live.some((i) => i.item_type === 'pickup' && i.status === 'awaiting_service_return' && i.repair_ready_at && !i.service_dc_number)) return 'ready_to_return';
  if (live.some((i) => LEAD_STEPS.has(i.step))) return 'lead_turn';
  if (live.some((i) => i.step === 'unassigned' || (!i.assigned_to && !i.pickup_assigned_to && i.item_type !== 'replacement'))) return 'needs_technician';
  return 'in_progress';
}

async function deskQueue({ allowedCustomerTypes = null } = {}) {
  const params = [];
  let scope = '';
  const { isRestricted } = require('./customerAccessScope');
  if (isRestricted(allowedCustomerTypes)) {
    params.push(allowedCustomerTypes);
    scope = `AND EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = t.customer_id AND c.customer_type = ANY($1::text[]))`;
  }
  const tickets = (await pool.query(
    `SELECT t.id, t.customer_id, t.customer_name, t.priority, t.status, t.created_at, t.last_activity_at,
            t.ticket_category, t.return_dc_number,
            COALESCE(NULLIF(t.ticket_phone_override, ''), t.customer_phone) AS phone
       FROM support_tickets t
      WHERE t.status IN ('open', 'in_progress') ${scope}`,
    params
  )).rows;
  const ids = tickets.map((t) => t.id);
  const items = ids.length ? (await pool.query(
    `SELECT i.*, ua.name AS assignee_name, up.name AS pickup_assignee_name
       FROM support_ticket_items i
       LEFT JOIN users ua ON ua.user_id = i.assigned_to
       LEFT JOIN users up ON up.user_id = i.pickup_assigned_to
      WHERE i.ticket_id = ANY($1::int[])
      ORDER BY i.id`,
    [ids]
  )).rows : [];
  const byTicket = new Map();
  for (const i of items) {
    const list = byTicket.get(i.ticket_id) || [];
    list.push({ ...i, step: deriveItemCurrentStep(i) });
    byTicket.set(i.ticket_id, list);
  }
  const sla = await slaForTickets(ids);
  const rows = tickets.map((t) => {
    const its = byTicket.get(t.id) || [];
    return {
      ...t,
      lane: laneOf(its),
      sla: sla.get(t.id) || null,
      laptops: its.filter((i) => !['cancelled', 'removed'].includes(i.status)).map((i) => ({
        item_id: i.id,
        type: i.item_type,
        ttspl: i.ttspl_id || i.unique_serial_number,
        model: [i.brand, i.model].filter(Boolean).join(' '),
        step: i.step,
        assignee: i.assignee_name || i.pickup_assignee_name || null,
        appointment: i.visit_scheduled_at,
        repair_ready_at: i.repair_ready_at,
        issue: i.issue_category_label,
      })),
    };
  });
  const rank = { breached: 0, at_risk: 1, on_track: 2, paused: 3, met: 4, 'n/a': 5 };
  rows.sort((a, b) => (rank[a.sla?.resolve?.state] ?? 9) - (rank[b.sla?.resolve?.state] ?? 9)
    || new Date(a.created_at) - new Date(b.created_at));
  const lanes = { ready_to_return: 0, lead_turn: 0, needs_technician: 0, in_progress: 0 };
  for (const r of rows) lanes[r.lane] += 1;
  const requests = (await pool.query(`SELECT COUNT(*)::int AS n FROM support_requests WHERE status = 'pending'`)).rows[0].n;
  return { lanes, requests_pending: requests, tickets: rows };
}

module.exports = { deskQueue, laneOf };
