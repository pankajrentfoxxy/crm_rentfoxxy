import api from './api';

export async function fetchOperationCounts() {
  const { data } = await api.get('/sales-management/counts');
  return data;
}

export async function fetchQuotations(params = {}) {
  const { data } = await api.get('/sales-management/quotations', { params });
  return data;
}

export async function fetchQuotationMeta() {
  const { data } = await api.get('/sales-management/quotations/meta/add');
  return data;
}

export async function fetchQuotation(quotationNumber) {
  const { data } = await api.get(`/sales-management/quotations/${quotationNumber}`);
  return data;
}

export async function createQuotation(payload) {
  const { data } = await api.post('/sales-management/quotations', payload);
  return data;
}

export async function updateQuotationStatus(quotationNumber, status) {
  const { data } = await api.patch(`/sales-management/quotations/${quotationNumber}/status`, { status });
  return data;
}

export async function fetchSalesOrders(params = {}) {
  const { data } = await api.get('/sales-management/sales-orders', { params });
  return data;
}

export async function fetchSalesOrderMeta(params = {}) {
  const { data } = await api.get('/sales-management/sales-orders/meta/add', { params });
  return data;
}

export async function createSalesOrder(payload) {
  const { data } = await api.post('/sales-management/sales-orders', payload);
  return data;
}

export async function fetchSalesOrder(salesOrderNumber) {
  const { data } = await api.get(`/sales-management/sales-orders/${salesOrderNumber}`);
  return data;
}

export async function fetchDeliveryChallans(params = {}) {
  const { data } = await api.get('/sales-management/delivery-challans', { params });
  return data;
}

export async function fetchDeliveryChallanMeta(salesOrderNumber) {
  const { data } = await api.get('/sales-management/delivery-challans/meta/add', {
    params: { sales_order_number: salesOrderNumber },
  });
  return data;
}

export async function fetchDeliveryChallan(dcNumber) {
  const { data } = await api.get(`/sales-management/delivery-challans/${dcNumber}`);
  return data;
}

export async function createDeliveryChallan(payload) {
  const { data } = await api.post('/sales-management/delivery-challans', payload);
  return data;
}

export async function fetchAvailableSerials(params = {}) {
  const { data } = await api.get('/sales-management/inventory/available-serials', { params });
  return data;
}

export async function sendDeliveryOtp(dcNumber, body) {
  const { data } = await api.post(`/sales-management/delivery-challans/${dcNumber}/send-otp`, body);
  return data;
}

export async function verifyDeliveryOtp(dcNumber, body) {
  const { data } = await api.post(`/sales-management/delivery-challans/${dcNumber}/verify-otp`, body);
  return data;
}

export async function submitDeliveryRegister(dcNumber, body) {
  const { data } = await api.post(`/sales-management/delivery-challans/${dcNumber}/delivery-register`, body);
  return data;
}

export async function fetchReturnDeliveryChallans() {
  const { data } = await api.get('/sales-management/return-dc');
  return data;
}

export async function assignReturnDcNumber(ticketId) {
  const { data } = await api.post(`/sales-management/return-dc/tickets/${ticketId}/assign-number`);
  return data;
}

export async function saveCustomerShippingAddress(customerId, payload) {
  const { data } = await api.post(`/sales-management/customers/${customerId}/shipping-address`, payload);
  return data;
}
