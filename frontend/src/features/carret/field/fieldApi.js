/** Field technician day, travel and report (migration 438). */
import api from '../../../utils/api';

export const fetchFieldDay = () => api.get('/field/day');
export const startFieldDay = (body) => api.post('/field/day/start', body);
export const endFieldDay = (body) => api.post('/field/day/end', body);
export const fetchMyReport = (params) => api.get('/field/my-report', { params });
export const fetchFieldTeam = (params) => api.get('/field/team', { params });
export const addFieldPlace = (body) => api.post('/field/places', body);

/** What each kind of task is called, and its colour (dashboards and reports). */
export const TASK_KINDS = [
  { key: 'visit', label: 'Complaint visits', short: 'Visits', color: '#2563eb' },
  { key: 'return_pickup', label: 'Return pickups', short: 'Returns', color: '#d97706' },
  { key: 'repair_pickup', label: 'Repair pickups', short: 'Repairs', color: '#7c3aed' },
  { key: 'delivery', label: 'Deliveries', short: 'Deliveries', color: '#059669' },
  { key: 'vendor', label: 'Vendor hand-overs', short: 'Vendor', color: '#0891b2' },
];
export const kindOf = (key) => TASK_KINDS.find((k) => k.key === key) || { label: key, short: key, color: '#64748b' };

const ymd = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
/** Today / This week (Mon–) / This month / custom, as from–to IST dates. */
export function periodRange(period, custom = {}) {
  const now = new Date();
  const today = ymd(now);
  if (period === 'week') {
    const ist = new Date(now.getTime() + 330 * 60000);
    const dow = (ist.getUTCDay() + 6) % 7;
    return { from: ymd(new Date(now.getTime() - dow * 86400000)), to: today };
  }
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (period === 'custom') return { from: custom.from || today, to: custom.to || today };
  return { from: today, to: today };
}

export const fmtKm = (v) => `${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
