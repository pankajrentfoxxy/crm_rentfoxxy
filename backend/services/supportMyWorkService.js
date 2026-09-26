/**
 * Technician "My work" (claude/carret-support.md, S2/S4): every support job
 * assigned to me — complaint visits and return pickups — with the one next step,
 * the customer's contact and address, the appointment and the SLA. Deliveries
 * (Service DC / replacement) and my parts come from their own existing feeds;
 * the phone screen merges them.
 */
const pool = require('../config/db');
const { deriveItemCurrentStep } = require('./supportTicketFlow');
const { slaForTickets } = require('./supportSlaService');

// What the technician does next, by the flow step the item is at.
const NEXT = {
  // complaint
  assigned: { key: 'arrive', label: 'Arrived at the customer' },
  verify_ttspl: { key: 'arrive', label: 'Scan the laptop' },
  visited: { key: 'result', label: 'Record the result' },
  working: { key: 'result', label: 'Record the result' },
  fixed_pending_pod: { key: 'result', label: 'Add the photo' },
  pod_uploaded: { key: 'otp', label: 'Customer OTP' },
};
const PICKUP_NEXT = {
  assigned: { key: 'arrive', label: 'Arrived at the customer' },
  reached: { key: 'pickup_photo', label: 'Photo + scan laptop and charger' },
  pod_uploaded: { key: 'otp', label: 'Customer OTP' },
  gate_inward: { key: 'drop', label: 'Drop at the warehouse gate' },
};

function addressText(a) {
  if (!a) return '';
  if (typeof a === 'string') {
    try { return addressText(JSON.parse(a)); } catch { return a; }
  }
  return [a.address || a.line1, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

async function myWork(userId) {
  const rows = (await pool.query(
    `SELECT i.*, t.customer_name, t.priority, t.customer_id,
            COALESCE(NULLIF(t.ticket_phone_override, ''), t.customer_phone) AS phone, t.ticket_alt_phone,
            t.ticket_address, t.pickup_address, t.top_level_remarks
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
      WHERE (i.assigned_to = $1 OR i.pickup_assigned_to = $1)
        AND t.status NOT IN ('closed', 'cancelled')
        AND i.status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled', 'removed', 'delivered')`,
    [userId]
  )).rows;
  const sla = await slaForTickets(rows.map((r) => r.ticket_id));
  const jobs = [];
  for (const r of rows) {
    const step = deriveItemCurrentStep(r);
    const next = (r.item_type === 'pickup' ? PICKUP_NEXT[step] : NEXT[step]) || null;
    if (!next) continue; // lead's turn (replacement, repair at the warehouse…) — not the technician's job
    const s = sla.get(r.ticket_id);
    jobs.push({
      item_id: r.id,
      ticket_id: r.ticket_id,
      kind: r.item_type === 'pickup' ? 'pickup' : 'visit',
      step,
      next,
      customer: r.customer_name,
      phone: r.phone,
      alt_phone: r.ticket_alt_phone || null,
      address: addressText(r.item_type === 'pickup' ? (r.pickup_address || r.ticket_address) : (r.ticket_address || r.pickup_address)),
      appointment: r.visit_scheduled_at,
      priority: r.priority || 'normal',
      laptop: { ttspl: r.ttspl_id || r.unique_serial_number, serial: r.serial_number, brand: r.brand, model: r.model },
      issue: r.issue_category_label || null,
      remarks: r.remarks || r.top_level_remarks || null,
      return_dc_number: r.return_dc_number || null,
      visited_at: r.visited_at,
      outcome: r.outcome,
      has_photo: Boolean(r.pod_image_path || r.proof_of_completion_path),
      otp_sent_at: r.customer_otp_sent_at || null,
      sla: s ? { state: s.resolve.state, due_at: s.resolve.due_at, visit_state: s.visit.state, visit_due_at: s.visit.due_at, paused: s.paused } : null,
    });
  }
  const rank = { breached: 0, at_risk: 1, on_track: 2, paused: 3 };
  jobs.sort((a, b) => {
    const ta = a.appointment ? new Date(a.appointment).getTime() : Infinity;
    const tb = b.appointment ? new Date(b.appointment).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return (rank[a.sla?.state] ?? 9) - (rank[b.sla?.state] ?? 9);
  });
  return jobs;
}

module.exports = { myWork };
