import api from './api';

export function fetchDispatchWorkflow(soNumber) {
  return api.get(`/dispatch-workflow/${encodeURIComponent(soNumber)}`);
}

export function acceptDispatchWorkflow(soNumber) {
  return api.post(`/dispatch-workflow/${encodeURIComponent(soNumber)}/accept`);
}

export function fetchDispatchDashboard() {
  return api.get('/dispatch-workflow/dashboard');
}

export function fetchDispatchPendingOrders() {
  return api.get('/dispatch-workflow/pending-orders');
}

export function fetchDispatchPendingAlerts() {
  return api.get('/dispatch-workflow/pending-alerts');
}

export function fetchDispatchMatchingSerials(params) {
  return api.get('/dispatch-workflow/inventory/matching-serials', { params });
}

export function snoozeDispatchAlert(soNumber, { remark, snoozeMinutes } = {}) {
  return api.post(`/dispatch-workflow/${encodeURIComponent(soNumber)}/snooze-alert`, {
    remark,
    snoozeMinutes,
  });
}

export function fetchDispatchPendingQcAlerts() {
  return api.get('/dispatch-workflow/pending-qc-alerts');
}

export function snoozeDispatchQcAlert(soNumber, { remark, snoozeMinutes } = {}) {
  return api.post(`/dispatch-workflow/${encodeURIComponent(soNumber)}/snooze-qc-alert`, {
    remark,
    snoozeMinutes,
  });
}
