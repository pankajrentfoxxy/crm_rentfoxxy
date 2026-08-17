import api from '../../utils/api';

const BASE = '/support-parts';

export const raiseSupportPartRequest = (data) =>
  api.post(`${BASE}/requests`, data);

export const listSupportPartRequests = (params) =>
  api.get(`${BASE}/requests`, { params });

export const cancelSupportPartRequest = (requestId) =>
  api.patch(`${BASE}/requests/${requestId}/cancel`);

export const approveAndGenerateChallan = (requestIds, instanceMap) =>
  api.post(`${BASE}/requests/approve-and-challan`, {
    request_ids: requestIds,
    ...(instanceMap ? { instance_map: instanceMap } : {}),
  });

export const approveAndGenerateCustomerDc = (payload) =>
  api.post(`${BASE}/requests/approve-and-customer-dc`, payload);

export const getPartCustomerDc = (dcNumber) =>
  api.get(`${BASE}/part-dcs/${encodeURIComponent(dcNumber)}`);

export const markPartCustomerDcDelivered = (dcNumber) =>
  api.patch(`${BASE}/part-dcs/${encodeURIComponent(dcNumber)}/delivered`);

export const updatePartCustomerDcCourier = (dcNumber, data) =>
  api.patch(`${BASE}/part-dcs/${encodeURIComponent(dcNumber)}/courier`, data);

export const listPartDcsAwaitingCourier = () =>
  api.get(`${BASE}/part-dcs-awaiting-courier`);

export const submitOldPartRpdc = (requestIds) =>
  api.post(`${BASE}/old-parts/submit-rpdc`, { request_ids: requestIds });

export const getPartReturnDc = (dcNumber) =>
  api.get(`${BASE}/part-return-dcs/${encodeURIComponent(dcNumber)}`);

export const receivePartReturnDc = (dcNumber, data) =>
  api.patch(`${BASE}/part-return-dcs/${encodeURIComponent(dcNumber)}/receive`, data || {});

export const updatePartReturnDcCourier = (dcNumber, data) =>
  api.patch(`${BASE}/part-return-dcs/${encodeURIComponent(dcNumber)}/courier`, data);

export const listPartReturnDcsPending = () =>
  api.get(`${BASE}/part-return-dcs-pending`);

export const markPartUsed = (requestId, data) =>
  api.patch(`${BASE}/requests/${requestId}/mark-used`, data || {});

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

export const getSupportPartsWarehouseQueue = (params) =>
  api.get(`${BASE}/warehouse-queue`, { params });

export const requestPartReassign = (requestId, data) =>
  api.post(`${BASE}/requests/${requestId}/request-reassign`, data);

export const resolvePartReassign = (requestId, action) =>
  api.patch(`${BASE}/requests/${requestId}/resolve-reassign`, { action });

export const getPartsHistory = (params) =>
  api.get(`${BASE}/history`, { params });

// Phase 20 — technician laptop pickup bucket (lives under the support module).
export const getTechnicianLaptopBucket = () =>
  api.get('/support/tech-bucket/laptops');
