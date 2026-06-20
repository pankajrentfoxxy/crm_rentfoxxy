import api from '../../utils/api';

const BASE = '/support-parts';

export const raiseSupportPartRequest = (data) =>
  api.post(`${BASE}/requests`, data);

export const listSupportPartRequests = (params) =>
  api.get(`${BASE}/requests`, { params });

export const approveAndGenerateChallan = (requestIds) =>
  api.post(`${BASE}/requests/approve-and-challan`, { request_ids: requestIds });

export const markPartUsed = (requestId) =>
  api.patch(`${BASE}/requests/${requestId}/mark-used`);

export const returnPart = (requestId, data) =>
  api.post(`${BASE}/requests/${requestId}/return`, data);

export const acceptReturn = (requestId, data) =>
  api.patch(`${BASE}/requests/${requestId}/accept-return`, data);

export const getChallan = (challanId) =>
  api.get(`${BASE}/challans/${challanId}`);

export const signAndIssueChallan = (challanId, data) =>
  api.post(`${BASE}/challans/${challanId}/sign-and-issue`, data);

export const getTechnicianBucket = () =>
  api.get(`${BASE}/bucket`);

export const getSupportPartsWarehouseQueue = () =>
  api.get(`${BASE}/warehouse-queue`);

export const requestPartReassign = (requestId, data) =>
  api.post(`${BASE}/requests/${requestId}/request-reassign`, data);

export const resolvePartReassign = (requestId, action) =>
  api.patch(`${BASE}/requests/${requestId}/resolve-reassign`, { action });

export const getPartsHistory = (params) =>
  api.get(`${BASE}/history`, { params });
