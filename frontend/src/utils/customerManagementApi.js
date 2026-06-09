import api from './api';

export async function fetchCustomerManagementList(params = {}) {
  const { data } = await api.get('/customer-management/customers', { params });
  return data;
}

export async function fetchCustomerManagementMeta() {
  const { data } = await api.get('/customer-management/customers/meta/add');
  return data;
}

export async function fetchCustomerManagement(customerId) {
  const { data } = await api.get(`/customer-management/customers/${customerId}`);
  return data;
}

export async function createCustomerManagement(formData) {
  const { data } = await api.post('/customer-management/customers', formData);
  return data;
}

export async function deleteCustomerManagement(customerId) {
  const { data } = await api.delete(`/customer-management/customers/${customerId}`);
  return data;
}
