import api from '../../utils/api';

const base = '/customer-billing';
const einvBase = '/einvoice';

export const listInvoices = (p) => api.get(`${base}/invoices`, { params: p });
export const listInvoiceCoverage = (p) => api.get(`${base}/invoices/coverage`, { params: p });
export const getInvoice = (id) => api.get(`${base}/invoices/${id}`);
export const generateInvoice = (d) => api.post(`${base}/invoices/generate`, d);
export const generateInvoicesBulk = (d) => api.post(`${base}/invoices/generate-bulk`, d);
export const sendInvoice = (id, d) => api.post(`${base}/invoices/${id}/send`, d);
export const markInvoicePaid = (id, d) => api.patch(`${base}/invoices/${id}/paid`, d);
export const downloadInvoicePdf = (id, { format } = {}) => api.get(`${base}/invoices/${id}/pdf`, {
  params: format ? { format } : undefined,
  responseType: 'blob',
});
export const downloadInvoicesZip = ({ month, year, format } = {}) => api.get(`${base}/invoices/pdf-zip`, {
  params: { month, year, ...(format ? { format } : {}) },
  responseType: 'blob',
  timeout: 15 * 60 * 1000,
});
export const listCreditNotes = (p) => api.get(`${base}/credit-notes`, { params: p });
export const createCreditNote = (d) => api.post(`${base}/credit-notes`, d);
export const approveCreditNote = (id) => api.patch(`${base}/credit-notes/${id}/approve`);
export const approveCreditNotesBulk = (ids) => api.post(`${base}/credit-notes/approve-bulk`, { ids });
export const listSecurityDeposits = (p) => api.get(`${base}/security-deposits`, { params: p });
export const recordSecurityDeposit = (d) => api.post(`${base}/security-deposits`, d);
export const refundSecurityDeposit = (id, d) => api.patch(`${base}/security-deposits/${id}/refund`, d);

export const generateEInvoice = (dcNumber) => api.post(`${einvBase}/dc/${encodeURIComponent(dcNumber)}/generate`);
export const generateEWayBill = (dcNumber, d) => api.post(`${einvBase}/dc/${encodeURIComponent(dcNumber)}/ewb`, d);
export const getDcEInvoiceStatus = (dcNumber) => api.get(`${einvBase}/dc/${encodeURIComponent(dcNumber)}/status`);
export const sendEInvoiceEmail = (dcNumber, d) => api.post(`${einvBase}/dc/${encodeURIComponent(dcNumber)}/send-email`, d);
export const cancelEInvoice = (dcNumber, d) => api.post(`${einvBase}/dc/${encodeURIComponent(dcNumber)}/cancel`, d);
