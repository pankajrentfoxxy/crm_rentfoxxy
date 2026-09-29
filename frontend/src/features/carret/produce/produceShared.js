/** Shared bits for the Carret Production screens. */
import api from '../../../utils/api';

export const T = '/tickets';

export const errMsg = (e, fallback = 'That did not work.') => {
  const d = e?.response?.data;
  return d?.message || d?.errors?.[0]?.msg || e?.message || fallback;
};

/** The floor in process order (the board's tabs and the record's flow). */
export const FLOW = [
  { key: 'Floor Manager', label: 'Triage' },
  { key: 'Diagnosis', label: 'Diagnosis' },
  { key: 'Repair', label: 'Repair', stages: ['Chip Level Repair', 'Body & Paint', 'Procurement'] },
  { key: 'Assembly & Software', label: 'Assembly' },
  { key: 'Final Testing', label: 'Testing' },
  { key: 'QC1', label: 'QC1' },
  { key: 'QC2', label: 'QC2' },
  { key: 'Pending Inventory', label: 'Into stock' },
];
export const stageLabel = (s) => ({
  'Floor Manager': 'Triage (floor manager)',
  'Pending Inventory': 'Waiting to go into stock',
  'Assembly & Software': 'Assembly & software',
}[s] || s);

/**
 * "Dell Latitude 5420 · i7 · 11th Gen · 16 GB · 512 SSD". Generation was
 * missing (29 Sep 2026); the brand is not repeated when the model already
 * starts with it, and a bare RAM number gets its GB.
 */
export const configText = (t) => {
  const brand = String(t.brand || '').trim();
  const model = String(t.model || t.model_name || '').trim();
  const gen = String(t.generation || '').trim();
  const n = /^\d+\s*(st|nd|rd|th)?$/i.test(gen) ? parseInt(gen, 10) : null;
  const ord = n == null ? '' : ([11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
  const genText = n == null ? gen : `${n}${ord} Gen`;
  const ram = String(t.ram || '').trim();
  return [
    model && brand && model.toLowerCase().startsWith(brand.toLowerCase()) ? null : brand,
    model,
    t.processor,
    genText && genText.toLowerCase() !== String(t.processor || '').trim().toLowerCase() ? genText : null,
    /^\d+$/.test(ram) ? `${ram} GB` : ram,
    t.storage,
  ].filter(Boolean).join(' · ');
};
export const MANAGER_ROLES = ['manager', 'admin', 'super_admin', 'floor_manager'];
export const isFloorLead = (user) => user?.is_superadmin === true || MANAGER_ROLES.includes(String(user?.role || '').toLowerCase());

export const fetchBoard = (params) => api.get(`${T}/floor-board`, { params });
export const fetchTicket = (id) => api.get(`${T}/${id}`);
export const claimTicket = (id) => api.post(`${T}/${id}/claim`);
export const holdTicket = (id, reason) => api.post(`${T}/${id}/hold`, { reason });
export const releaseTicket = (id, reason) => api.post(`${T}/${id}/release`, { reason });
export const dismantleTicket = (id, body) => api.post(`${T}/${id}/dismantle`, body);
export const moveStage = (id, body) => api.post(`${T}/${id}/move-stage`, body);
export const startWork = (id, body) => api.post(`${T}/${id}/work/start`, body);
export const endWork = (id, body = {}) => api.post(`${T}/${id}/work/end`, body);
export const activeWork = (id) => api.get(`${T}/${id}/work/active`);

/**
 * A part request that still counts on the ticket: waiting, being bought,
 * ready, or fitted. Cancelled, refused and returned requests are history —
 * they must not inflate the Parts count (ticket 5334 showed 2 for 1 part).
 */
export const ACTIVE_PART_STATUSES = ['pending', 'escalated', 'ordered', 'received', 'approved', 'attached'];
export const activePartRequests = (list) => (list || []).filter((r) => ACTIVE_PART_STATUSES.includes(r.status));
