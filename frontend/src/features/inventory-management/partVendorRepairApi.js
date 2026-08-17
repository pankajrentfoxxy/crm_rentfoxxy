import api from '../../utils/api';

const base = '/part-vendor-repair';

export function fetchPartVendorRepairDcList(params) {
  return api.get(`${base}/dc`, { params });
}

export function fetchPartVendorRepairDc(dcNumber) {
  return api.get(`${base}/dc/${encodeURIComponent(dcNumber)}`);
}

export function createPartVendorReturnDc(body) {
  return api.post(`${base}/return`, body);
}

export function fetchDefectiveEligibleForVendorReturn(params) {
  return api.get(`${base}/defective-eligible`, { params });
}

export function dispatchPartVendorReturnDc(dcNumber, body) {
  return api.post(`${base}/dc/${encodeURIComponent(dcNumber)}/dispatch-sign`, body, { timeout: 120000 });
}

export function receivePartVendorReturnDc(dcNumber, body) {
  return api.post(`${base}/dc/${encodeURIComponent(dcNumber)}/receive-back`, body, { timeout: 120000 });
}

export function fetchPartVendorQcPending(params) {
  return api.get(`${base}/qc-pending`, { params });
}

export function passPartVendorQc(instanceId, body = {}) {
  return api.post(`${base}/qc-pending/${encodeURIComponent(instanceId)}/pass`, body);
}

export function failPartVendorQc(instanceId, body = {}) {
  return api.post(`${base}/qc-pending/${encodeURIComponent(instanceId)}/fail`, body);
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

export async function downloadPartVendorRepairPdf(dcNumber) {
  const response = await api.get(`${base}/dc/${encodeURIComponent(dcNumber)}/pdf`, {
    responseType: 'blob',
  });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  downloadBlobResponse(response, `VRDC_PART_${safe}.pdf`);
}
