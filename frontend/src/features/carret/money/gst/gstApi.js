import api from '../../../../utils/api';

/**
 * Finance → GST & e-way. Every call is an existing endpoint except the e-way
 * register and the number-change history (both read-only, einvoice_ewb view).
 */
const enc = (n) => encodeURIComponent(n);

// Queues (GET /api/finance-overview/*, section einvoice_ewb view)
export const fetchDcInvoiceQueue = (params = {}) => api.get('/finance-overview/dc-invoice-queue', { params });
export const fetchSaleInvoiceQueue = (status = 'pending') => api.get('/finance-overview/sale-invoice-queue', { params: { status } });
export const fetchEinvoiceQueue = () => api.get('/finance-overview/einvoice-queue');
export const fetchEwayRegister = (params = {}) => api.get('/finance-overview/eway-bills', { params });
export const fetchNumberChanges = (docType, docNumber) => api.get('/finance-overview/number-changes', {
  params: { doc_type: docType, doc_number: docNumber },
});

// Writes — the same endpoints the challan page and the old queues use.
export const uploadDcInvoice = (dcNumber, formData) => api.post(
  `/sales-management/delivery-challans/${enc(dcNumber)}/sale-compliance`,
  formData,
  { headers: { 'Content-Type': 'multipart/form-data' } },
);
export const uploadDcEway = (dcNumber, formData) => api.post(
  `/sales-management/delivery-challans/${enc(dcNumber)}/demo-eway`,
  formData,
  { headers: { 'Content-Type': 'multipart/form-data' } },
);
export const uploadSaleOrderInvoice = (soNumber, formData) => api.post(
  `/sales-management/sales-orders/${enc(soNumber)}/sale-invoice`,
  formData,
);
export const downloadSaleOrderInvoice = (soNumber) => api.get(
  `/sales-management/sales-orders/${enc(soNumber)}/sale-invoice/pdf`,
  { responseType: 'blob' },
);
