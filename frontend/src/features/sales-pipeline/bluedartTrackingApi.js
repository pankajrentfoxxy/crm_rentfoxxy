import api from '../../utils/api';

const base = '/bluedart-awb-tracking';

export function getBluedartTrackingStatus() {
  return api.get(`${base}/status`);
}

export function listBluedartAwbRegistry(params) {
  return api.get(`${base}/registry`, { params });
}

export function trackBluedartAwbs(payload) {
  return api.post(`${base}/track`, payload);
}

export function syncBluedartPendingAwbs() {
  return api.post(`${base}/sync-pending`);
}
