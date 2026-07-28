import api from '../../utils/api';

const base = '/part-requests';

export const createPartRequest = (body) => api.post(base, body);
export const uploadPartRequestPhotos = (files) => {
  const form = new FormData();
  (files || []).forEach((f) => form.append('photos', f));
  // Do not set Content-Type — axios/browser must add multipart boundary.
  return api.post(`${base}/upload-photos`, form);
};
export const listPartRequests = (params) => api.get(base, { params });
export const getTicketPartRequests = (ticketId) => api.get(`${base}/ticket/${ticketId}`);
export const getPartRequest = (id) => api.get(`${base}/${id}`);
export const getWarehouseQueue = () => api.get(`${base}/warehouse-queue`);
export const getProcurementQueue = () => api.get(`${base}/procurement-queue`);
export const getPartCostSummary = (ttsplId) => api.get(`${base}/cost-summary/${ttsplId}`);
export const listPartInstances = (params) => api.get(`${base}/instances`, { params });
export const addPartInstances = (body) => api.post(`${base}/instances`, body);
export const updatePartInstance = (instanceId, body) => api.patch(`${base}/instances/${instanceId}`, body);

export const approvePartRequest = (id, body) => api.patch(`${base}/${id}/approve`, body);
export const rejectPartRequest = (id, body) => api.patch(`${base}/${id}/reject`, body);
export const escalatePartRequest = (id, body) => api.patch(`${base}/${id}/escalate`, body);
export const linkRequestToSpo = (id, body) => api.patch(`${base}/${id}/link-spo`, body);
export const markPartReceived = (id, body) => api.patch(`${base}/${id}/received`, body);
export const attachPartToRequest = (id, body) => api.post(`${base}/${id}/attach`, body);
export const cancelPartRequest = (id) => api.patch(`${base}/${id}/cancel`);
