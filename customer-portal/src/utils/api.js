import axios from 'axios';

export function getApiUrl() {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  const host = window.location.hostname;
  if (host === 'localhost' || host.startsWith('192.168.')) {
    return `http://${host}:5001/api`;
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
  const { data } = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
