/** Small shared bits for the Carret Serve screens. */
export const TECH_TABS = [
  { to: '/carret/serve/my-work', label: 'My work' },
  { to: '/carret/move/my-deliveries', label: 'Deliveries' },
  { to: '/carret/serve/my-parts', label: 'My parts' },
];

export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;

export const SLA_TONE = { breached: 'var(--alert-crit)', at_risk: 'var(--alert-warn)', on_track: 'var(--ink-3)', paused: 'var(--ink-3)', met: 'var(--ok, #15803d)' };
export const SLA_LABEL = { breached: 'Late', at_risk: 'Due soon', on_track: 'On time', paused: 'Paused', met: 'Met' };

export function when(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function mapsLink(address, fallback) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || fallback || '')}`;
}

export function withGps(cb) {
  if (!navigator.geolocation) { cb(null, null); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => cb(String(p.coords.latitude), String(p.coords.longitude)),
    () => cb(null, null),
    { timeout: 10000, maximumAge: 60000 }
  );
}

export const LANES = [
  { key: 'needs_technician', label: 'Needs a technician' },
  { key: 'lead_turn', label: 'Your decision' },
  { key: 'ready_to_return', label: 'Repaired — send back' },
  { key: 'in_progress', label: 'In progress' },
];

/** The step a laptop is at, in the lead's words. */
export const STEP_LABEL = {
  unassigned: 'Assign a technician',
  assigned: 'Technician on the way',
  verify_ttspl: 'Technician at site',
  visited: 'Technician at site',
  working: 'No fault found',
  fixed_pending_pod: 'Fixed — photo pending',
  pod_uploaded: 'Waiting for customer OTP',
  otp_verified: 'Closed',
  replacement_required: 'Pickup / replacement asked for',
  picked_up_for_repair: 'Collected for repair',
  pending_dispatch: 'Pickup to dispatch',
  reached: 'Technician at site',
  customer_otp: 'Collected',
  gate_inward: 'On the way to the gate',
  gate_inward_done: 'At the gate',
  awaiting_service_return: 'In repair at the warehouse',
  service_dc_pending: 'Going back to the customer',
  warehouse_confirmed: 'Done',
  approved: 'Replacement to send',
  dispatched: 'Replacement on the way',
  delivered_pending_otp: 'Replacement delivered',
};

export function slaText(sla) {
  if (!sla || !sla.resolve || sla.resolve.state === 'n/a') return '—';
  const s = sla.resolve;
  if (s.state === 'breached') return 'Late';
  if (sla.paused) return `Paused (${sla.paused_for})`;
  const h = Math.floor((s.left_minutes || 0) / 60);
  const m = (s.left_minutes || 0) % 60;
  return `${h}h ${m}m left`;
}
