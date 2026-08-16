import api from '../../utils/api';

const BASE = '/support/v2';

export const fetchSupportV2Health = () => api.get(`${BASE}/health`);
export const fetchSupportV2Badges = () => api.get(`${BASE}/badges`);

export const fetchTaxonomyTree = () => api.get(`${BASE}/taxonomy/catalog/tree`);
export const searchTaxonomy = (q) => api.get(`${BASE}/taxonomy/catalog/search`, { params: { q } });
export const fetchCatalogStats = (id) => api.get(`${BASE}/taxonomy/catalog/${id}/stats`);
export const createCatalogNode = (data) => api.post(`${BASE}/taxonomy/catalog`, data);
export const patchCatalogNode = (id, data) => api.patch(`${BASE}/taxonomy/catalog/${id}`, data);
export const deleteCatalogNode = (id) => api.delete(`${BASE}/taxonomy/catalog/${id}`);

export const fetchSlaPolicies = () => api.get(`${BASE}/sla/policies`);
export const createSlaPolicy = (data) => api.post(`${BASE}/sla/policies`, data);
export const patchSlaPolicy = (id, data) => api.patch(`${BASE}/sla/policies/${id}`, data);
export const fetchSlaCalendars = () => api.get(`${BASE}/sla/calendars`);
export const addSlaHoliday = (calendarId, data) => api.post(`${BASE}/sla/calendars/${calendarId}/holidays`, data);
export const previewSla = (data) => api.post(`${BASE}/sla/preview`, data);
export const fetchSlaBreaches = () => api.get(`${BASE}/sla/breaches`);
export const fetchApprovals = (params) => api.get(`${BASE}/approvals`, { params });

export const listTickets = (params) => api.get(`${BASE}/tickets`, { params });
export const getTicket = (id) => api.get(`${BASE}/tickets/${id}`);
export const listWorkOrders = (params) => api.get(`${BASE}/work-orders`, { params });
export const listEvents = (ticketId) => api.get(`${BASE}/events/${ticketId}`);

export const listViews = () => api.get(`${BASE}/views`);
export const createView = (data) => api.post(`${BASE}/views`, data);
export const deleteView = (id) => api.delete(`${BASE}/views/${id}`);
export const getTicketCounts = () => api.get(`${BASE}/tickets/counts`);
export const fetchQueueMeta = () => api.get(`${BASE}/queue-meta`);
export const fetchDashboard = () => api.get(`${BASE}/dashboard`);
export const bulkAssign = (data) => api.post(`${BASE}/tickets/bulk-assign`, data);

export const searchCustomers = (q) => api.get(`${BASE}/customers/search`, { params: { q } });
export const getCustomerContext = (id) => api.get(`${BASE}/customers/${id}/context`);
export const getCustomerAssets = (id) => api.get(`${BASE}/customers/${id}/assets`);
export const searchTickets = (q) => api.get(`${BASE}/tickets/search`, { params: { q } });
export const repeatCheck = (params) => api.get(`${BASE}/lines/0/repeat-check`, { params });
export const createTicket = (data) => api.post(`${BASE}/tickets`, data);
export const patchTicket = (id, data) => api.patch(`${BASE}/tickets/${id}`, data);
export const classifyTicket = (id, data) => api.post(`${BASE}/tickets/${id}/classify`, data);
export const overridePriority = (id, data) => api.post(`${BASE}/tickets/${id}/priority-override`, data);
export const assignTicket = (id, data) => api.post(`${BASE}/tickets/${id}/assign`, data);
export const pauseTicket = (id, data) => api.post(`${BASE}/tickets/${id}/pause`, data);
export const resumeTicket = (id) => api.post(`${BASE}/tickets/${id}/resume`);
export const resolveTicket = (id, data) => api.post(`${BASE}/tickets/${id}/resolve`, data);
export const closeTicket = (id, data) => api.post(`${BASE}/tickets/${id}/close`, data);
export const reopenTicket = (id, data) => api.post(`${BASE}/tickets/${id}/reopen`, data);
export const cancelTicket = (id, data) => api.post(`${BASE}/tickets/${id}/cancel`, data);
export const linkTicket = (id, data) => api.post(`${BASE}/tickets/${id}/link`, data);
export const commentTicket = (id, data) => api.post(`${BASE}/tickets/${id}/comment`, data);
export const resolveLine = (lineId, data) => api.post(`${BASE}/lines/${lineId}/resolve`, data);
export const setFoundIssue = (lineId, data) => api.post(`${BASE}/lines/${lineId}/found`, data);
export const fetchResolutionCodes = () => api.get(`${BASE}/taxonomy/resolution-codes`);
export const fetchRootCauses = () => api.get(`${BASE}/taxonomy/root-causes`);
export const fetchActionCodes = () => api.get(`${BASE}/taxonomy/action-codes`);

export const createWorkOrder = (ticketId, data) => api.post(`${BASE}/tickets/${ticketId}/work-orders`, data);
export const getWorkOrder = (woId) => api.get(`${BASE}/work-orders/${woId}`);
export const patchWorkOrder = (woId, data) => api.patch(`${BASE}/work-orders/${woId}`, data);
export const assignWorkOrder = (woId, data) => api.post(`${BASE}/work-orders/${woId}/assign`, data);
export const acceptWorkOrder = (woId, headers) => api.post(`${BASE}/work-orders/${woId}/accept`, {}, { headers });
export const enRouteWorkOrder = (woId, headers) => api.post(`${BASE}/work-orders/${woId}/en-route`, {}, { headers });
export const onSiteWorkOrder = (woId, headers) => api.post(`${BASE}/work-orders/${woId}/on-site`, {}, { headers });
export const completeWoStep = (woId, code, data, headers) => api.post(`${BASE}/work-orders/${woId}/steps/${code}`, data, { headers });
export const verifyWoOtp = (woId, data, headers) => api.post(`${BASE}/work-orders/${woId}/verify-otp`, data, { headers });
export const completeWorkOrder = (woId, data, headers) => api.post(`${BASE}/work-orders/${woId}/complete`, data, { headers });
export const failWorkOrder = (woId, data, headers) => api.post(`${BASE}/work-orders/${woId}/fail`, data, { headers });
export const cancelWorkOrder = (woId, data) => api.post(`${BASE}/work-orders/${woId}/cancel`, data);
export const getWorkOrderDocument = (woId) => api.get(`${BASE}/work-orders/${woId}/document`);
export const saveWorkOrderCondition = (woId, data) => api.post(`${BASE}/work-orders/${woId}/condition`, data);
export const submitWarehouseReceipt = (woId, data) => api.post(`${BASE}/work-orders/${woId}/warehouse-receipt`, data);
export const createBulkReturn = (data) => api.post(`${BASE}/returns/bulk`, data);
export const getBulkReturn = (groupId) => api.get(`${BASE}/returns/bulk/${groupId}`);
export const fetchReturnCatalog = () => api.get(`${BASE}/returns/catalog`);
export const previewBulkReturn = (data) => api.post(`${BASE}/returns/preview`, data);
export const decideApproval = (id, data) => api.post(`${BASE}/approvals/${id}/decide`, data);
export const fetchReplacementContext = (lineId) => api.get(`${BASE}/lines/${lineId}/replacement-context`);
export const fetchReplacementCandidates = (lineId) => api.get(`${BASE}/replacements/candidates`, { params: { line_id: lineId } });
export const createReplacement = (lineId, data) => api.post(`${BASE}/lines/${lineId}/replacement`, data);
export const patchReplacement = (id, data) => api.patch(`${BASE}/replacements/${id}`, data);
export const waiveCollect = (id, data) => api.post(`${BASE}/replacements/${id}/waive-collect`, data);
export const cancelReplacement = (id) => api.post(`${BASE}/replacements/${id}/cancel`);

export const fetchCompatibleParts = (serialId) => api.get(`${BASE}/parts/compatible`, { params: { serial_id: serialId } });
export const createPartRequest = (data) => api.post(`${BASE}/parts/requests`, data);
export const listPartRequests = (params) => api.get(`${BASE}/parts/requests`, { params });
export const fetchPartsQueue = (params) => api.get(`${BASE}/parts/queue`, { params });
export const approvePartRequest = (id, data) => api.post(`${BASE}/parts/requests/${id}/approve`, data);
export const rejectPartRequest = (id, data) => api.post(`${BASE}/parts/requests/${id}/reject`, data);
export const escalatePartRequest = (id) => api.post(`${BASE}/parts/requests/${id}/escalate`);
export const issuePartRequest = (id, data) => api.post(`${BASE}/parts/requests/${id}/issue`, data);
export const consumePartRequest = (id, data) => api.post(`${BASE}/parts/requests/${id}/consume`, data);
export const returnUnusedPart = (id) => api.post(`${BASE}/parts/requests/${id}/return-unused`);
export const cancelPartRequest = (id) => api.post(`${BASE}/parts/requests/${id}/cancel`);

export const fetchMyBucket = (params) => api.get(`${BASE}/me/bucket`, { params });
export const fetchMyBucketSummary = () => api.get(`${BASE}/me/bucket/summary`);
export const syncMyBucket = (data) => api.post(`${BASE}/me/bucket/sync`, data);
export const fetchDispatchBoard = (params) => api.get(`${BASE}/dispatch/board`, { params });
export const dispatchAssign = (data) => api.post(`${BASE}/dispatch/assign`, data);
export const dispatchAutoAssign = (data) => api.post(`${BASE}/dispatch/auto-assign`, data);
export const fetchDispatchCapacity = (params) => api.get(`${BASE}/dispatch/capacity`, { params });

export const fetchSupportReport = (name, params) => api.get(`${BASE}/reports/${name}`, { params });
export const downloadSupportReport = (name, params) =>
  api.get(`${BASE}/reports/${name}/export`, { params, responseType: 'blob' });
export const fetchSupportSettings = () => api.get(`${BASE}/settings`);
export const patchSupportSettings = (data) => api.patch(`${BASE}/settings`, data);
export const patchSupportTemplate = (id, data) => api.patch(`${BASE}/settings/templates/${id}`, data);

export function uploadAttachments(ticketId, files, extras = {}) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  Object.entries(extras).forEach(([k, v]) => {
    if (v != null) fd.append(k, v);
  });
  const url = ticketId ? `${BASE}/tickets/${ticketId}/attachments` : `${BASE}/attachments/staging`;
  return api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}
