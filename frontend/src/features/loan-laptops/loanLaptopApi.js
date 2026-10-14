import api from '../../utils/api';

const BASE = '/loan-laptops';

export const listLoans = (params) => api.get(BASE, { params });
export const getLoanCounts = () => api.get(`${BASE}/counts`);
export const getLoan = (id) => api.get(`${BASE}/${id}`);
export const getTicketLoanContext = (ticketId) => api.get(`${BASE}/ticket/${ticketId}/context`);
export const listAvailableLaptops = (pickupItemId, q) =>
  api.get(`${BASE}/available-laptops`, { params: { pickup_item_id: pickupItemId, q } });

export const createLoan = (body) => api.post(BASE, body);
export const approveLoan = (id, body) => api.post(`${BASE}/${id}/approve`, body);
export const rejectLoan = (id, reason) => api.post(`${BASE}/${id}/reject`, { reason });
export const createLoanDc = (id, body) => api.post(`${BASE}/${id}/loan-dc`, body);
export const regenerateLoanDcPdf = (id) => api.post(`${BASE}/${id}/loan-dc/pdf`);
export const markRepairCompleted = (id, body) => api.post(`${BASE}/${id}/repair-completed`, body);
export const recordDecision = (id, body) => api.post(`${BASE}/${id}/decision`, body);
export const approveConversion = (id, body) => api.post(`${BASE}/${id}/approve-conversion`, body);
export const rejectConversion = (id, reason) => api.post(`${BASE}/${id}/reject-conversion`, { reason });
export const cancelLoan = (id, reason) => api.post(`${BASE}/${id}/cancel`, { reason });

export const getPolicy = () => api.get(`${BASE}/policy`);
export const evaluatePolicy = (body) => api.post(`${BASE}/policy/evaluate`, body);
export const createRule = (body) => api.post(`${BASE}/policy/rules`, body);
export const updateRule = (id, body) => api.put(`${BASE}/policy/rules/${id}`, body);
export const deleteRule = (id) => api.delete(`${BASE}/policy/rules/${id}`);
export const upsertTier = (body) => api.put(`${BASE}/policy/tiers`, body);
export const deleteTier = (family) => api.delete(`${BASE}/policy/tiers/${encodeURIComponent(family)}`);

export const errorMessage = (e, fallback = 'Something went wrong') =>
  e?.response?.data?.message || e?.message || fallback;
