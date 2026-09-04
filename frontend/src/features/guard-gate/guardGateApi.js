import api from '../../utils/api';

export const getGuardDashboard = (params) => api.get('/guard-gate/dashboard', { params });
export const getGuardHistory = (params) => api.get('/guard-gate/history', { params });
export const getGateReport = (params) => api.get('/guard-gate/report', { params });
export const getGateReportColumnValues = (params) => api.get('/guard-gate/report/column-values', { params });
export const resolveGateScan = (payload) => api.post('/guard-gate/resolve', payload);
export const scanGateUnit = (sessionId, payload) => api.post(`/guard-gate/sessions/${sessionId}/scan`, payload);
export const confirmGateSession = (sessionId, payload) => api.post(`/guard-gate/sessions/${sessionId}/confirm`, payload);
export const getGateSession = (sessionId) => api.get(`/guard-gate/sessions/${sessionId}`);
