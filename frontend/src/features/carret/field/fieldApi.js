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

// Tasks — one at a time, in the lead's order (migration 439).
export const fetchFieldTasks = (userId) => api.get('/field/tasks', { params: userId ? { user_id: userId } : {} });
export const saveFieldTaskOrder = (userId, keys) => api.put('/field/tasks/order', { user_id: userId, keys });
export const releaseFieldTask = (userId, key) => api.post('/field/tasks/release', { user_id: userId, key });
export const warehouseStop = (body) => api.post('/field/day/warehouse', body);
export const TASK_KIND_COLOR = { visit: '#2563eb', pickup: '#d97706', return: '#d97706', delivery: '#059669', vendor: '#0891b2' };

// Task board (migration 440): the plan — order, day and time — per technician.
export const fetchTaskBoard = () => api.get('/field/board');
export const saveFieldTaskPlan = (userId, items) => api.put('/field/tasks/plan', { user_id: userId, items });
export const planFieldTask = (body) => api.post('/field/tasks/plan-one', body);
export const TASK_KIND_LABEL = { visit: 'Visit', pickup: 'Pickup', return: 'Return pickup', delivery: 'Delivery', vendor: 'Vendor' };
/** "Sat 18 Oct" for an IST yyyy-mm-dd. */
export const fmtDay = (ymd) => (ymd ? new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
/** "2:30 pm" for "14:30". */
export const fmtHm = (hm) => {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// Check in again after a check-out; a lead checks someone in (migration 441).
export const resumeFieldDay = () => api.post('/field/day/resume');
export const reopenFieldDay = (userId) => api.post('/field/day/reopen', { user_id: userId });
export const startFieldDayFor = (userId, placeId) => api.post('/field/day/start-for', { user_id: userId, place_id: placeId || undefined });
