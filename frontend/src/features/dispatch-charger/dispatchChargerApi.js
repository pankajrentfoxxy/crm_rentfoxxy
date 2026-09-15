import api from '../../utils/api';

const base = '/dispatch-chargers';

export function fetchTicketCharger(ticketId) {
  return api.get(`${base}/ticket/${ticketId}`);
}

export function markChargerAlreadyWithCustomer(ticketId, remarks) {
  return api.post(`${base}/ticket/${ticketId}/already-with-customer`, { remarks });
}

export function raiseChargerRequest(ticketId, remarks) {
  return api.post(`${base}/ticket/${ticketId}/request`, { remarks });
}

export function cancelChargerRequest(requestId, remarks) {
  return api.post(`${base}/${requestId}/cancel`, { remarks });
}

export function attachDispatchCharger(requestId, payload) {
  const body = typeof payload === 'string' ? { adapter_scan: payload, scan_code: payload } : payload;
  return api.post(`${base}/${requestId}/attach`, body);
}

export function scanDispatchQcCharger(ticketId, payload) {
  return api.post(`${base}/ticket/${ticketId}/qc-scan`, payload);
}

export function fetchChargerWarehouseQueue(status = 'pending') {
  return api.get(`${base}/warehouse-queue`, { params: { status } });
}

export function fetchAvailableChargers(search, extras = {}) {
  return api.get(`${base}/available-units`, { params: { search, ...extras } });
}

export function approveChargerHandover(requestId, payload) {
  return api.post(`${base}/${requestId}/approve-handover`, payload);
}

export function fetchPickupCharger(itemId) {
  return api.get(`${base}/pickup/${itemId}`);
}

export function scanPickupCharger(itemId, payload) {
  return api.post(`${base}/pickup/${itemId}/scan`, payload);
}

export function fetchReturnDcChargers(rdcNumber) {
  return api.get(`${base}/return-dc/${encodeURIComponent(rdcNumber)}`);
}

export function scanReturnDcCharger(rdcNumber, payload) {
  return api.post(`${base}/return-dc/${encodeURIComponent(rdcNumber)}/scan`, payload);
}
