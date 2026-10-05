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

/** Open technician jobs. userId = one person's (as complaint or pickup assignee); null = everyone's. */
async function loadJobs(userId) {
  const rows = (await pool.query(
    `SELECT i.*, t.customer_name, t.priority, t.customer_id, t.ticket_contact_name,
            ua.name AS assignee_name, up.name AS pickup_assignee_name,
            COALESCE(NULLIF(t.ticket_phone_override, ''), t.customer_phone) AS phone, t.ticket_alt_phone,
            t.ticket_address, t.pickup_address, t.top_level_remarks,
            (SELECT COUNT(*)::int FROM support_ticket_items s2
              WHERE i.return_dc_number IS NOT NULL
                AND s2.return_dc_number = i.return_dc_number
                AND s2.item_type = 'pickup'
                AND COALESCE(s2.status, '') NOT IN ('cancelled', 'removed')) AS rdc_laptops
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
       LEFT JOIN users ua ON ua.user_id = i.assigned_to
       LEFT JOIN users up ON up.user_id = i.pickup_assigned_to
      WHERE ($1::int IS NULL OR i.assigned_to = $1 OR i.pickup_assigned_to = $1)
        AND t.status NOT IN ('closed', 'cancelled')
        AND i.status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled', 'removed', 'delivered')`,
    [userId || null]
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
      pickup_type: r.item_type === 'pickup' ? (r.pickup_type || (r.source_item_id ? 'repair' : 'return')) : null,
      step,
      next,
      customer: r.customer_name,
      contact_name: r.ticket_contact_name || null,
      // Pickups go to the pickup assignee; visits to the item assignee.
      assignee_id: (r.item_type === 'pickup' ? (r.pickup_assigned_to || r.assigned_to) : (r.assigned_to || r.pickup_assigned_to)) || null,
      assignee_name: (r.item_type === 'pickup' ? (r.pickup_assignee_name || r.assignee_name) : (r.assignee_name || r.pickup_assignee_name)) || null,
      phone: r.phone,
      alt_phone: r.ticket_alt_phone || null,
      address: addressText(r.item_type === 'pickup' ? (r.pickup_address || r.ticket_address) : (r.ticket_address || r.pickup_address)),
      appointment: r.visit_scheduled_at,
      priority: r.priority || 'normal',
      laptop: { ttspl: r.ttspl_id || r.unique_serial_number, serial: r.serial_number, brand: r.brand, model: r.model },
      issue: r.issue_category_label || null,
      // Issue process (migration 348): a laptop with a reported issue finishes with a finding.
      reported: r.reported_issue_id ? { type_id: r.reported_type_id, subtype_id: r.reported_subtype_id, issue_id: r.reported_issue_id } : null,
      needs_finding: Boolean(r.item_type === 'complaint' && r.reported_issue_id && !r.found_issue_id),
      remarks: r.remarks || r.top_level_remarks || null,
      return_dc_number: r.return_dc_number || null,
      // Laptops on this pickup's Return DC. With more than one, a laptop the
      // customer keeps can move to a later pickup ("Collect later").
      rdc_laptops: r.rdc_laptops || 0,
      collected: Boolean(r.customer_otp_verified_at || r.picked_up_at),
      pickup_scheduled_at: r.pickup_scheduled_at || null,
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

const myWork = (userId) => loadJobs(userId);

/** The lead's view: everyone with open technician jobs, the busiest / latest first. */
async function teamWork() {
  const jobs = await loadJobs(null);
  const byTech = new Map();
  for (const j of jobs) {
    if (!j.assignee_id) continue;
    const t = byTech.get(j.assignee_id) || { user_id: j.assignee_id, name: j.assignee_name, jobs: 0, late: 0, today: 0, visits: 0, pickups: 0 };
    t.jobs += 1;
    if (j.sla?.state === 'breached') t.late += 1;
    if (j.kind === 'pickup') t.pickups += 1; else t.visits += 1;
    if (j.appointment && new Date(j.appointment).toDateString() === new Date().toDateString()) t.today += 1;
    byTech.set(j.assignee_id, t);
  }
  const technicians = [...byTech.values()].sort((a, b) => (b.late - a.late) || (b.jobs - a.jobs) || String(a.name).localeCompare(String(b.name)));
  const assigned = jobs.filter((j) => j.assignee_id);
  return {
    technicians,
    total: assigned.length,
    late: assigned.filter((j) => j.sla?.state === 'breached').length,
    // Ready for a technician but nobody holds them — the lead assigns these from the queue.
    unassigned: jobs.length - assigned.length,
  };
}

module.exports = { myWork, teamWork };
