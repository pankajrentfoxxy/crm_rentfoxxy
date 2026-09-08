import api from '../../utils/api';

const base = '/physical-parts';

export const PHYSICAL_RECEIVER_TYPES = [
  { value: 'scrap_buyer', label: 'Scrap buyer' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'technician', label: 'Technician' },
  { value: 'warehouse', label: 'Internal warehouse' },
  { value: 'other', label: 'Other' },
];

export const PHYSICAL_CONDITIONS = [
  { value: 'dead', label: 'Dead' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'unusable', label: 'Unusable' },
  { value: 'unknown', label: 'Unknown' },
];

export const PHYSICAL_INWARD_REASONS = [
  'Found in warehouse — no CRM record',
  'Unlabeled leftover after repair',
  'Returned without asset tag',
  'Other',
];

export function fetchPhysicalPartCounts() {
  return api.get(`${base}/counts`);
}

export function fetchPhysicalParts(params) {
  return api.get(base, { params });
}

export function fetchPhysicalPart(dpNumber) {
  return api.get(`${base}/${encodeURIComponent(dpNumber)}`);
}

export function fetchPhysicalInwards(params) {
  return api.get(`${base}/inwards`, { params });
}

export function fetchPhysicalInward(inwardNumber) {
  return api.get(`${base}/inwards/${encodeURIComponent(inwardNumber)}`);
}

export function fetchPhysicalOutwards(params) {
  return api.get(`${base}/outwards`, { params });
}

export function fetchPhysicalOutward(outwardNumber) {
  return api.get(`${base}/outwards/${encodeURIComponent(outwardNumber)}`);
}

export function createPhysicalInward(body) {
  return api.post(`${base}/inward`, body);
}

export function createPhysicalOutward(body) {
  return api.post(`${base}/outward`, body);
}

export function dispatchPhysicalOutward(outwardNumber, body) {
  return api.post(`${base}/outwards/${encodeURIComponent(outwardNumber)}/dispatch`, body, { timeout: 120000 });
}

export function cancelDraftPhysicalOutward(outwardNumber) {
  return api.post(`${base}/outwards/${encodeURIComponent(outwardNumber)}/cancel`);
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

export async function downloadPhysicalOutwardPdf(outwardNumber) {
  const response = await api.get(`${base}/outwards/${encodeURIComponent(outwardNumber)}/pdf`, {
    responseType: 'blob',
  });
  const safe = String(outwardNumber).replace(/[^\w-]+/g, '_');
  downloadBlobResponse(response, `POUT_${safe}.pdf`);
}

export async function uploadPhysicalPartPhotos(files) {
  const fd = new FormData();
  for (const file of files) fd.append('photos', file);
  const { data } = await api.post(`${base}/photos`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
