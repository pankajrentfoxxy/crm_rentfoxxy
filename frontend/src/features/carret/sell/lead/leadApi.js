/** Carret Sell → Leads — the existing /api/leads endpoints (claude/carret-lead.md). */
import api from '../../../../utils/api';

const L = '/leads';
export const fetchLeads = (params) => api.get(L, { params });
export const fetchLead = (id) => api.get(`${L}/${id}`);
export const fetchLeadStages = () => api.get(`${L}/stages`);
export const fetchAssignableUsers = () => api.get(`${L}/assignable-users`);
export const createLead = (body) => api.post(L, body);
export const updateLeadProfile = (id, body) => api.put(`${L}/${id}/profile`, body);
export const updateLeadStatus = (id, body) => api.put(`${L}/${id}/status`, body);
export const winLead = (id, body) => api.post(`${L}/${id}/win`, body);
export const convertLead = (id, body) => api.post(`${L}/${id}/convert`, body);
export const completeFollowUp = (id, body) => api.post(`${L}/${id}/follow-ups/complete`, body);
export const setFollowUp = (id, body) => api.put(`${L}/${id}/follow-up`, body);
export const fetchFollowUpLog = (id) => api.get(`${L}/${id}/follow-ups/log`);
export const fetchFollowUpBoard = (params) => api.get(`${L}/follow-ups/board`, { params });
export const assignLeads = (leadIds, userId) => api.post(`${L}/assign`, { lead_ids: leadIds, sales_user_id: userId });
export const addLeadRemark = (id, note) => api.post(`${L}/${id}/remarks`, { note });
export const addLeadAddress = (id, body) => api.post(`${L}/${id}/addresses`, body);
export const runLeadResearch = (id) => api.post(`${L}/${id}/research`);
export const fetchLeadQuotations = (leadId) => api.get('/sales-management/quotations', { params: { source_lead_id: leadId, limit: 50 } });
