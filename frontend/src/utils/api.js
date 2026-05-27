import axios from 'axios';

// API Configuration - Production: set REACT_APP_API_URL in Vercel (e.g. https://your-backend.railway.app/api)
export function getApiUrl() {
    if (process.env.REACT_APP_API_URL) {
        return process.env.REACT_APP_API_URL;
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host.startsWith('192.168.')) {
        return `http://${host}:5001/api`;
    }
    // Production CRM: nginx proxies /api to backend (same origin)
    if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin.replace(/\/$/, '')}/api`;
    }
    return process.env.NODE_ENV === 'production'
        ? (process.env.REACT_APP_API_URL || '')
        : `http://localhost:5001/api`;
}

/** Backend origin without `/api` (for `/uploads/...` URLs). */
export function getBackendOrigin() {
    return getApiUrl().replace(/\/?api\/?$/i, '');
}

const API_URL = getApiUrl();
// const API_URL = 'https://crm.rentfoxxy.com/api';

const api = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // For FormData, let the browser set Content-Type with boundary (don't use application/json)
    if (config.data instanceof FormData && config.headers) {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
    }
    return config;
});

export default api;
