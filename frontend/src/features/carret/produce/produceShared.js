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

export const configText = (t) => [t.brand, t.model, t.processor, t.ram, t.storage].filter(Boolean).join(' · ');
export const MANAGER_ROLES = ['manager', 'admin', 'super_admin', 'floor_manager'];
export const isFloorLead = (user) => MANAGER_ROLES.includes(String(user?.role || '').toLowerCase());

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
