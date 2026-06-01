import api from '../../utils/api';

const base = '/qc-management';

export function fetchQcOrders(status, params) {
  return api.get(`${base}/orders/${encodeURIComponent(status)}`, { params });
}

export function fetchQcStatusCounts() {
  return api.get(`${base}/orders/counts`);
}

export function fetchPendingPoProducts(poId, status) {
  const seg = status ? `/${encodeURIComponent(status)}` : '';
  return api.get(`${base}/pending-orders/${poId}${seg}`);
}

export function fetchQcOrderDetails(body) {
  return api.post(`${base}/order-details`, body);
}

export function submitQcCheck(payload) {
  return api.post(`${base}/qc-check`, payload);
}

export function submitHardwareQcCheck(payload) {
  return api.post(`${base}/hardware-qc-check`, payload);
}
