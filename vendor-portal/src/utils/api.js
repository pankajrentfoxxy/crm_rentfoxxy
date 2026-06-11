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
  baseURL: getApiUrl(),
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vendor_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
