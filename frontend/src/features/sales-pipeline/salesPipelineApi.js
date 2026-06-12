import api from '../../utils/api';

const base = '/sales-management';

export const listQuotations = (p) => api.get(`${base}/quotations`, { params: p });
export const getQuotation = (n) => api.get(`${base}/quotations/${n}`);
export const createQuotation = (d) => api.post(`${base}/quotations`, d);
export const updateQuotationStatus = (n, d) => api.patch(`${base}/quotations/${n}/status`, d);
export const getQuotationMeta = () => api.get(`${base}/quotations/meta/add`);

export const listSalesOrders = (p) => api.get(`${base}/sales-orders`, { params: p });
export const getSalesOrder = (n) => api.get(`${base}/sales-orders/${n}`);
export const getSalesOrderFull = (n) => api.get(`${base}/sales-orders/${n}/full`);
export const createSalesOrder = (d) => api.post(`${base}/sales-orders`, d);
export const getSalesOrderMeta = (p) => api.get(`${base}/sales-orders/meta/add`, { params: p });
export const listPayments = (n) => api.get(`${base}/sales-orders/${n}/payments`);
export const recordPayment = (n, d) => api.post(`${base}/sales-orders/${n}/payments`, d);

export const listDCs = (p) => api.get(`${base}/delivery-challans`, { params: p });
export const getDC = (n) => api.get(`${base}/delivery-challans/${n}`);
export const createDC = (d) => api.post(`${base}/delivery-challans`, d);
export const getDCMeta = (so) => api.get(`${base}/delivery-challans/meta/add`, { params: { sales_order_number: so } });
export const getDcQcStatus = (n) => api.get(`${base}/delivery-challans/${n}/qc-status`);
export const createDcQcTickets = (n) => api.post(`${base}/delivery-challans/${n}/qc-ticket`);
export const dispatchDC = (n, d) => api.patch(`${base}/delivery-challans/${n}/dispatch`, d);
export const markDelivered = (n, d) => api.patch(`${base}/delivery-challans/${n}/delivered`, d);
export const markRejected = (n, d) => api.patch(`${base}/delivery-challans/${n}/rejected`, d);

export const listReturnDCs = (p) => api.get(`${base}/return-dc`, { params: p });

export const getDeliveryCounts = () => api.get('/delivery-register-management/counts');
export const listByStatus = (status, p) => api.get(`/delivery-register-management/${status}`, { params: p });
export const sendDeliveryOtp = (dcNumber, d) => api.post(`${base}/delivery-challans/${dcNumber}/send-otp`, d || {});
export const verifyDeliveryOtp = (dcNumber, d) => api.post(`${base}/delivery-challans/${dcNumber}/verify-otp`, d);
export const getAvailableSerials = (p) => api.get(`${base}/inventory/available-serials`, { params: p });
export const getOperationCounts = () => api.get(`${base}/counts`);
export const saveCustomerShippingAddress = (id, d) => api.post(`${base}/customers/${id}/shipping-address`, d);
export const getCustomerDetail = (customerId) => api.get(`/customer-management/customers/${customerId}`);
export const getCustomerAddresses = (customerId) => api.get(`/customer-management/customers/${customerId}/addresses`);
