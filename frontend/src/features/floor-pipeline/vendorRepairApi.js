import api from '../../utils/api';

const base = '/vendor-repair';

export function fetchDiagnosisFailedTickets() {
  return api.get(`${base}/diagnosis-failed`);
}

export function createOutForRepairDc(body) {
  return api.post(`${base}/out-for-repair`, body);
}

export function fetchVendorRepairDc(dcNumber) {
  return api.get(`${base}/dc/${encodeURIComponent(dcNumber)}`);
}

export function signVendorRepairDispatch(dcNumber, body) {
  return api.post(`${base}/dc/${encodeURIComponent(dcNumber)}/dispatch-sign`, body);
}

export function receiveVendorRepairBack(dcNumber, body) {
  return api.post(`${base}/dc/${encodeURIComponent(dcNumber)}/receive-back`, body);
}

export function vendorRepairPdfUrl(dcNumber) {
  const origin = api.defaults.baseURL || '';
  return `${origin}${base}/dc/${encodeURIComponent(dcNumber)}/pdf`;
}

export function markDiagnosisFailed(ticketId, body) {
  return api.patch(`/tickets/${ticketId}/diagnosis-failed`, body);
}

export function fetchOutForRepairInventory(params) {
  return api.get(`${base}/inventory`, { params });
}

export function receiveErpRepairBack(serialId, body = {}) {
  return api.post(`${base}/inventory/erp/${serialId}/receive-back`, body);
}

export function fetchOutForRepairInventoryCount() {
  return api.get(`${base}/inventory/count`);
}

function downloadBlobResponse(response, fallbackName) {
  const blob = new Blob([response.data], {
    type: response.headers['content-type'] || 'application/octet-stream',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  const disposition = response.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportOutForRepairExcel(params) {
  const response = await api.get(`${base}/inventory/export.xlsx`, {
    params,
    responseType: 'blob',
  });
  downloadBlobResponse(response, 'out_for_repair_inventory.xlsx');
}

export async function exportOutForRepairPdf(params) {
  const response = await api.get(`${base}/inventory/export.pdf`, {
    params,
    responseType: 'blob',
  });
  downloadBlobResponse(response, 'out_for_repair_inventory.pdf');
}
