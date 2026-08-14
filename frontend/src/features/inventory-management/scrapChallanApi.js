import api from '../../utils/api';

const base = '/scrap-challans';

export function fetchScrapChallanList(params) {
  return api.get(`${base}/dc`, { params });
}

export function fetchScrapChallan(challanNumber) {
  return api.get(`${base}/dc/${encodeURIComponent(challanNumber)}`);
}

export function createScrapChallan(body) {
  return api.post(`${base}/create`, body);
}

export function dispatchScrapChallan(challanNumber, body) {
  return api.post(`${base}/dc/${encodeURIComponent(challanNumber)}/dispatch`, body, { timeout: 120000 });
}

export function cancelDraftScrapChallan(challanNumber) {
  return api.post(`${base}/dc/${encodeURIComponent(challanNumber)}/cancel`);
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

export async function downloadScrapChallanPdf(challanNumber) {
  const response = await api.get(`${base}/dc/${encodeURIComponent(challanNumber)}/pdf`, {
    responseType: 'blob',
  });
  const safe = String(challanNumber).replace(/[^\w-]+/g, '_');
  downloadBlobResponse(response, `SCRAP_${safe}.pdf`);
}
