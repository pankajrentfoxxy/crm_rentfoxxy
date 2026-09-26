/** Carret Serve — technician and lead calls over the existing support APIs (claude/carret-support.md). */
import api from '../../../utils/api';

const item = (id, suffix) => `/support/items/${id}${suffix}`;

export const fetchMyWork = () => api.get('/support/my-work');
export const fetchTicket = (ticketId) => api.get(`/support/tickets/${ticketId}`);
export const markArrived = (id, body) => api.post(item(id, '/visit'), body);
export const verifyLaptop = (id, code) => api.post(item(id, '/verify-ttspl'), { ttspl_input: code });
export const setOutcome = (id, body) => api.post(item(id, '/set-outcome'), body);
export const uploadPhoto = (id, file) => {
  const fd = new FormData();
  fd.append('pod', file);
  return api.post(item(id, '/pod'), fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const workDone = (id) => api.post(item(id, '/work-done'), {});
export const sendOtp = (id) => api.post(item(id, '/send-otp'), {});
export const verifyVisitOtp = (id, otp) => api.post(item(id, '/verify-otp'), { otp });
export const verifyPickupOtp = (id, otp) => api.post(item(id, '/verify-pickup-otp'), { otp });
export const fetchMyParts = () => api.get('/support-parts/bucket');
export const markPartFitted = (reqId, body) => api.patch(`/support-parts/requests/${reqId}/mark-used`, body);

/* ---- Lead desk ---- */
export const fetchDeskQueue = () => api.get('/support/desk/queue');
export const fetchTicketSla = (ticketId) => api.get(`/support/tickets/${ticketId}/sla`);
export const fetchTicketWfh = (ticketId) => api.get(`/support/tickets/${ticketId}/wfh`);
export const fetchTechnicians = () => api.get('/support/technicians');
export const assignItem = (itemId, userId) => api.patch(item(itemId, '/assign'), { assigned_to: userId });
export const setAppointment = (itemId, when) => api.patch(item(itemId, '/appointment'), { visit_scheduled_at: when || null });
export const chargeWfh = (itemId) => api.post(item(itemId, '/wfh-charge'), {});
export const holdTicket = (ticketId, note) => api.post(`/support/tickets/${ticketId}/hold`, { reason: 'customer', note });
export const releaseHold = (ticketId) => api.post(`/support/tickets/${ticketId}/release-hold`, {});
export const searchCustomers = (search) => api.get('/support/customers', { params: { search, limit: 20 } });
export const fetchCustomerLaptops = (customerId) => api.get(`/support/customers/${customerId}/assets`);
export const fetchCategories = () => api.get('/support/categories');
export const createTicket = (body) => api.post('/support/tickets', body);
export const fetchSlaBoard = () => api.get('/support/sla/board');
export const fetchCsatSummary = (days = 90) => api.get('/support/csat/summary', { params: { days } });
export const fetchChargesToBill = (customerId) => api.get('/support-parts/charges-to-bill', { params: { customer_id: customerId || undefined } });
export const addChargesToInvoice = (invoiceId, ids) => api.post('/support-parts/charges/add-to-invoice', { invoice_id: invoiceId, extra_line_ids: ids });
export const markPartChargeable = (reqId, chargeable, reason) => api.patch(`/support-parts/requests/${reqId}/chargeable`, { chargeable, reason });
