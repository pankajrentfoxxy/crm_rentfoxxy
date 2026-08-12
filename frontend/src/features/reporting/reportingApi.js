import api from '../../utils/api';

export const getManagerDashboard = () => api.get('/analytics/manager-dashboard');
export const getSalesDashboard = () => api.get('/analytics/sales-dashboard');
export const getRevenueReport = (p) => api.get('/reports/revenue', { params: p });
export const getInventoryReport = (p) => api.get('/reports/inventory-utilisation', { params: p });
export const getLeadConversion = (p) => api.get('/reports/lead-conversion', { params: p });
export const getSalespersonReport = (p) => api.get('/reports/salesperson', { params: p });
export const getCollectionsReport = (p) => api.get('/reports/collections', { params: p });
export const getVendorSpendReport = (p) => api.get('/reports/vendor-spend', { params: p });
export const getTechnicianReport = (p) => api.get('/reports/technician-performance', { params: p });
export const getLaptopReport = (p) => api.get('/reports/laptop-report', { params: p });
export const getLaptopReportTickets = (p) => api.get('/reports/laptop-report/tickets', { params: p });
export const getProductionQcReport = (p) => api.get('/reports/production-qc', { params: p });
export const getProductionQcReportDetail = (historyId) =>
  api.get(`/reports/production-qc/${encodeURIComponent(historyId)}`);
export const getProductionQcReportFilters = () => api.get('/reports/production-qc/filters');
export const downloadProductionQcReportPdf = (p) =>
  api.get('/reports/production-qc/pdf', { params: p, responseType: 'blob' });
export const downloadProductionQcReportDetailPdf = (historyId) =>
  api.get(`/reports/production-qc/${encodeURIComponent(historyId)}/pdf`, { responseType: 'blob' });
export const getSalesOrderReport = (p) => api.get('/reports/sales-order-report', { params: p });
export const getSalesOrderReportDrilldown = (p) => api.get('/reports/sales-order-report/drilldown', { params: p });
export const exportReport = (d) => api.post('/reports/export', d, { responseType: 'blob' });
