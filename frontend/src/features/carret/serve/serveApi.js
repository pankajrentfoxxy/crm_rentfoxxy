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
