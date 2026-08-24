import api from '../../utils/api';

const base = '/finance-overview';

export const getFinanceCounts = () => api.get(`${base}/counts`);
export const getFinanceDashboard = () => api.get(`${base}/dashboard`);
export const getEinvoiceQueue = () => api.get(`${base}/einvoice-queue`);
export const getDcInvoiceQueue = () => api.get(`${base}/dc-invoice-queue`);
