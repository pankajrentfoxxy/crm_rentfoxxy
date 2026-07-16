import axios from 'axios';

/** Local dev: Cursor often forwards 127.0.0.1:5001 to remote; nodemon binds 0.0.0.0:5001. Use 127.0.0.2 to hit local. */
function localDevApiHost() {
    if (typeof window === 'undefined') return '127.0.0.2';
    const pageHost = window.location.hostname;
    if (pageHost === 'localhost' || pageHost === '127.0.0.1') return '127.0.0.2';
    if (pageHost.startsWith('192.168.')) return pageHost;
    return '127.0.0.2';
}

// API Configuration - Production: set REACT_APP_API_URL in Vercel (e.g. https://your-backend.railway.app/api)
export function getApiUrl() {
    if (process.env.REACT_APP_API_URL) {
        return process.env.REACT_APP_API_URL;
    }
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
        const port = process.env.REACT_APP_DEV_API_PORT || '5001';
        return `http://${localDevApiHost()}:${port}/api`;
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
