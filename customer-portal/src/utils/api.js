import axios from 'axios';

/**
 * Local dev: Cursor forwards 127.0.0.1:5001 to a different backend, while nodemon
 * binds 0.0.0.0:5001. Hitting 127.0.0.1 (or `localhost`, which resolves to it)
 * reaches the wrong server, which rejects every portal session as invalid. Use
 * 127.0.0.2 to reach the local backend, matching the CRM frontend.
 */
function localDevApiHost() {
  if (typeof window === 'undefined') return '127.0.0.2';
  const pageHost = window.location.hostname;
  if (pageHost.startsWith('192.168.')) return pageHost;
  return '127.0.0.2';
}

export function getApiUrl() {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
    return `http://${localDevApiHost()}:5001/api`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, '')}/api`;
  }
  return 'http://localhost:5001/api';
}

const api = axios.create({
  baseURL: `${getApiUrl()}/customer-portal`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/login')) {
      localStorage.removeItem('cp_token');
      localStorage.removeItem('cp_customer');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

export async function downloadInvoicePdf(invoiceId, filename = 'invoice.pdf') {
  const res = await api.get(`/invoices/${invoiceId}/pdf`, {
    responseType: 'blob',
    params: { format: 'laptop_details' },
  });
  const type = res.headers['content-type'] || '';
  if (type.includes('application/json')) {
    const text = await res.data.text?.() || '';
    let message = 'Failed to download invoice PDF';
    try { message = JSON.parse(text).message || message; } catch { /* keep */ }
    throw new Error(message);
  }
  const disposition = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const url = window.URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
