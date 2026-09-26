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
