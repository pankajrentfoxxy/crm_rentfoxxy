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

/* ---- Pickup / replacement / Service DC (same endpoints as the old ticket screen) ---- */
const tkt = (id, suffix) => `/support/tickets/${id}${suffix}`;
export const fetchPickupContext = (customerId, code) => api.get(`/support/customers/${customerId}/pickup-context`, { params: { ttspl: code } });
export const createPickup = (ticketId, body) => api.post(tkt(ticketId, '/pickup'), body);
export const assignPickup = (ticketId, body) => api.post(tkt(ticketId, '/assign-return-pickup'), body);
export const changePickupAssignment = (ticketId, body) => api.patch(tkt(ticketId, '/return-pickup-assignment'), body);
export const cancelPickup = (ticketId, body) => api.post(tkt(ticketId, '/cancel-return-pickup'), body);
export const setCourierDetails = (itemId, body) => api.patch(item(itemId, '/courier-details'), body);
export const fetchReplacementContext = (ticketId) => api.get(tkt(ticketId, '/replacement-context'));
export const startReplacement = (ticketId, body) => api.post(tkt(ticketId, '/replacements'), body);
export const moveToReplacement = (itemId, reason) => api.post(item(itemId, '/move-to-replacement'), { reason });
export const fetchSwapContext = (ticketId) => api.get(tkt(ticketId, '/repair-swap-context'));
export const startSwap = (ticketId, body) => api.post(tkt(ticketId, '/replacements/swap-from-repair'), body);
export const fetchRedeliveryContext = (ticketId) => api.get(tkt(ticketId, '/return-redelivery-context'));
export const startRedelivery = (ticketId, body) => api.post(tkt(ticketId, '/return-redelivery'), body);
export const fetchResendContext = (ticketId) => api.get(tkt(ticketId, '/resend-laptop-context'));
export const resendLaptop = (ticketId, reason) => api.post(tkt(ticketId, '/resend-laptop'), { reason });
export const fetchServiceDcEligibility = (ticketId) => api.get(tkt(ticketId, '/service-dc/eligibility'));
export const createServiceDc = (ticketId, body) => api.post(tkt(ticketId, '/service-dc'), body);
export const regenerateServiceDcPdf = (sdc) => api.post(`/support/service-dc/${encodeURIComponent(sdc)}/pdf`, {});
export const changeServiceDcTechnician = (sdc, body) => api.patch(`/support/service-dc/${encodeURIComponent(sdc)}/technician`, body);

/* Parts desk (warehouse) — the same /support-parts endpoints the old queue uses. */
const sp = '/support-parts';
export const fetchPartsQueue = () => api.get(`${sp}/warehouse-queue`);
export const fetchPartUnits = (r, showAll) => api.get('/part-requests/instances', {
  params: { part_id: r.part_id, status: 'in_stock', limit: 500, for_request_id: r.id, for_request_kind: 'support', include_incompatible: showAll ? 'true' : undefined },
});
export const approvePartsToTechnician = (body) => api.post(`${sp}/requests/approve-and-challan`, body);
export const signPartChallan = (challanId, body) => api.post(`${sp}/challans/${challanId}/sign-and-issue`, body);
export const approvePartsToCustomer = (body) => api.post(`${sp}/requests/approve-and-customer-dc`, body);
export const setPartPrice = (reqId, amount) => api.patch(`${sp}/requests/${reqId}/price`, { amount });
export const cancelPartRequest = (reqId) => api.patch(`${sp}/requests/${reqId}/cancel`);
export const acceptPartReturn = (reqId, body) => api.patch(`${sp}/requests/${reqId}/accept-return`, body);
export const resolvePartMove = (reqId, action) => api.patch(`${sp}/requests/${reqId}/resolve-reassign`, { action });
export const fetchPartDcsAwaitingCourier = () => api.get(`${sp}/part-dcs-awaiting-courier`);
export const setPartDcCourier = (dc, body) => api.patch(`${sp}/part-dcs/${encodeURIComponent(dc)}/courier`, body);
export const markPartDcDelivered = (dc) => api.patch(`${sp}/part-dcs/${encodeURIComponent(dc)}/delivered`);
export const fetchPartReturnDcsPending = () => api.get(`${sp}/part-return-dcs-pending`);
export const receivePartReturnDc = (dc) => api.patch(`${sp}/part-return-dcs/${encodeURIComponent(dc)}/receive`, {});
