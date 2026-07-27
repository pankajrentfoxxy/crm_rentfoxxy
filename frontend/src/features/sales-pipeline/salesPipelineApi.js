import api from '../../utils/api';

const base = '/sales-management';

const encSo = (n) => encodeURIComponent(n);
const encDc = (n) => encodeURIComponent(n);

export const listQuotations = (p) => api.get(`${base}/quotations`, { params: p });
export const getQuotation = (n) => api.get(`${base}/quotations/${n}`);
export const createQuotation = (d) => api.post(`${base}/quotations`, d);
export const updateQuotationStatus = (n, d) => api.patch(`${base}/quotations/${n}/status`, d);
export const getQuotationMeta = (p) => api.get(`${base}/quotations/meta/add`, { params: p });

export const listSalesOrders = (p) => api.get(`${base}/sales-orders`, { params: p });
export const getSalesOrder = (n) => api.get(`${base}/sales-orders/${encSo(n)}`);
export const getSalesOrderFull = (n) => api.get(`${base}/sales-orders/${encSo(n)}/full`);
export const listSoActivities = (n, p) => api.get(`${base}/sales-orders/${encSo(n)}/activities`, { params: p });
export const logSoDocumentActivity = (n, d) => api.post(`${base}/sales-orders/${encSo(n)}/activities`, d);
export const createSalesOrder = (d) => api.post(`${base}/sales-orders`, d);
export const cancelSalesOrder = (n) => api.patch(`${base}/sales-orders/${encSo(n)}/cancel`);
export const getSalesOrderMeta = (p) => api.get(`${base}/sales-orders/meta/add`, { params: p });
export const listPayments = (n) => api.get(`${base}/sales-orders/${encSo(n)}/payments`);
export const recordPayment = (n, d) => api.post(`${base}/sales-orders/${encSo(n)}/payments`, d);

export const listDCs = (p) => api.get(`${base}/delivery-challans`, { params: p });
export const getDC = (n) => api.get(`${base}/delivery-challans/${encDc(n)}`);
export const createDC = (d) => api.post(`${base}/delivery-challans`, d);
// Phase 15 — create one DC per delivery-address group
export const createDcsByAddress = (data) => api.post(`${base}/create-dcs-by-address`, data);
export const updateDC = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}`, d);
export const regenerateDcPdf = (n) => api.post(`${base}/delivery-challans/${encDc(n)}/pdf`);
export const regenerateQuotationPdf = (n) => api.post(`${base}/quotations/${n}/pdf`);
export const regenerateSalesOrderPdf = (n) => api.post(`${base}/sales-orders/${encSo(n)}/pdf`);
export const getDCMeta = (so) => api.get(`${base}/delivery-challans/meta/add`, { params: { sales_order_number: so } });
export const getDcQcStatus = (n) => api.get(`${base}/delivery-challans/${encDc(n)}/qc-status`);
export const createDcQcTickets = (n) => api.post(`${base}/delivery-challans/${encDc(n)}/qc-ticket`);
export const dispatchDC = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/dispatch`, d);
export const updateDcAssignment = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/assignment`, d);
export const markDelivered = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/delivered`, d);
export const markRejected = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/rejected`, d);
export const cancelDC = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/cancel`, d || {});
export const uploadSaleDcCompliance = (n, formData) => api.post(
  `${base}/delivery-challans/${encDc(n)}/sale-compliance`,
  formData,
  { headers: { 'Content-Type': 'multipart/form-data' } }
);
export const markCustomerRejected = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/customer-rejected`, d);
export const sendWarehouseReturnOtp = (n) => api.post(`${base}/delivery-challans/${encDc(n)}/warehouse-return-otp`);
export const verifyWarehouseReturnOtp = (n, d) => api.post(`${base}/delivery-challans/${encDc(n)}/warehouse-return-otp/verify`, d);
export const markCourierRejected = (n, d) => api.patch(`${base}/delivery-challans/${encDc(n)}/courier-rejected`, d);

export const listReturnDCs = (p) => api.get(`${base}/return-dc`, { params: p });
export const getReturnDcDetail = (rdcNumber) => api.get(`${base}/return-dc/${encodeURIComponent(rdcNumber)}/detail`);
export const regenerateReturnDcPdf = (rdcNumber) => api.post(`${base}/return-dc/${encodeURIComponent(rdcNumber)}/pdf`);
export const downloadReturnDcPdf = (rdcNumber) => api.get(`${base}/return-dc/${encodeURIComponent(rdcNumber)}/download-pdf`, { responseType: 'blob' });
export const confirmReturnDcWarehouse = (rdcNumber, data) =>
  api.post(`${base}/return-dc/${encodeURIComponent(rdcNumber)}/warehouse-confirm`, data);

export const getDeliveryCounts = () => api.get('/delivery-register-management/counts');
export const listByStatus = (status, p) => api.get(`/delivery-register-management/${status}`, { params: p });
export const sendDeliveryOtp = (dcNumber, d) => api.post(`${base}/delivery-challans/${encDc(dcNumber)}/send-otp`, d || {});
export const verifyDeliveryOtp = (dcNumber, d) => api.post(`${base}/delivery-challans/${encDc(dcNumber)}/verify-otp`, d);
export const getAvailableSerials = (p) => api.get(`${base}/inventory/available-serials`, { params: p });

// SO-level serial allocation (attach laptops -> QC ticket each)
export const listSoSerials = (so) => api.get(`${base}/sales-orders/${encSo(so)}/serials`);
export const attachSoSerial = (so, d) => api.post(`${base}/sales-orders/${encSo(so)}/serials`, d);
export const detachSoSerial = (so, allocId) => api.delete(`${base}/sales-orders/${encSo(so)}/serials/${allocId}`);

// Phase 13 — per-serial delivery addresses
export const updateSoSerialAddress = (allocationId, d) =>
  api.patch(`${base}/so-serials/${allocationId}/address`, d);
export const bulkUpdateSoSerialAddresses = (so, d) =>
  api.patch(`${base}/sales-orders/${encSo(so)}/serial-addresses`, d);
// Phase 14 — line-level delivery address (before serials attached)
export const updateSoLineAddress = (lineId, d) =>
  api.patch(`${base}/so-lines/${lineId}/address`, d);
export const updateSoLineConfig = (lineId, d) =>
  api.patch(`${base}/so-lines/${lineId}/config`, d);
export const updateSoLineRate = (lineId, d) =>
  api.patch(`${base}/so-lines/${lineId}/rate`, d);
export const updateSoLineHsn = (lineId, d) =>
  api.patch(`${base}/so-lines/${lineId}/hsn`, d);
export const updateDcHsn = (dcNumber, d) =>
  api.patch(`${base}/delivery-challans/${encodeURIComponent(dcNumber)}/hsn`, d);

// Phase 13 — delivery flow
export const listDeliveryFlow = (params) => api.get(`${base}/delivery-flow`, { params });
export const getMyDeliveries = () => api.get(`${base}/my-deliveries`);
export const markReached = (dcNumber, d) => api.patch(`${base}/delivery-challans/${encDc(dcNumber)}/reached`, d);
export const verifySerialAndGenerateOtp = (dcNumber, d) =>
  api.post(`${base}/delivery-challans/${encDc(dcNumber)}/verify-serial`, d);
export const submitDeliveryWithPod = (dcNumber, formData) =>
  api.post(`${base}/delivery-challans/${encDc(dcNumber)}/deliver`, formData);
export const adminDeliverOverride = (dcNumber, formData) =>
  api.patch(`${base}/delivery-challans/${encDc(dcNumber)}/admin-deliver`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const getOperationCounts = () => api.get(`${base}/counts`);
export const saveCustomerShippingAddress = (id, d) => api.post(`${base}/customers/${id}/shipping-address`, d);
export const getCustomerDetail = (customerId) => api.get(`/customer-management/customers/${customerId}`);
export const getCustomerAddresses = (customerId) => api.get(`/customer-management/customers/${customerId}/addresses`);
