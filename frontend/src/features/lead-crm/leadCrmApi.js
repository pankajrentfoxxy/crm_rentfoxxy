import api from '../../utils/api';

export const getLeads = (params) => api.get('/leads', { params });
export const getLead = (id) => api.get(`/leads/${id}`);
export const createLead = (data) => api.post('/leads', data);
export const updateLeadStatus = (id, data) => api.put(`/leads/${id}/status`, data);
export const updateLeadBasic = (id, data) => api.put(`/leads/${id}/basic`, data);
export const updateLeadProfile = (id, data) => api.put(`/leads/${id}/profile`, data);
export const convertToCustomer = (id, data) => api.post(`/leads/${id}/convert`, data);
export const getLeadConversion = (id) => api.get(`/leads/${id}/conversion`);
export const getLeadStages = () => api.get('/leads/stages');
export const addLeadRemark = (id, data) => api.post(`/leads/${id}/remarks`, data);
export const updateFollowUp = (id, data) => api.put(`/leads/${id}/follow-up`, data);
export const sendLeadQuotation = (id, data) => api.post(`/leads/${id}/send-quotation`, data);
export const getLeadAddresses = (id) => api.get(`/leads/${id}/addresses`);
export const addLeadAddress = (id, data) => api.post(`/leads/${id}/addresses`, data);
export const exportLeadsCsv = (params) => api.get('/leads/export-csv', { params, responseType: 'blob' });
export const importLeadsCsv = (formData) => api.post('/leads/upload', formData);
export const assignLeads = (data) => api.post('/leads/assign', data);
export const runResearch = (id) => api.post(`/leads/${id}/research`);
export const getFollowUps = (params) => api.get('/leads/follow-ups', { params });
export const getUsers = () => api.get('/users');

export const getCustomers = (params) => api.get('/customer-management/customers', { params });
export const getCustomer = (id) => api.get(`/customer-management/customers/${id}`);
export const createCustomer = (data) => api.post('/customer-management/customers', data);
export const updateCustomer = (id, data) => api.put(`/customer-management/customers/${id}`, data);
export const verifyCustomerKyc = (id) => api.put(`/customer-management/customers/${id}/verify-kyc`);
export const getCustomerLaptops = (id) => api.get(`/customer-management/customers/${id}/laptops`);
export const getCustomerAddresses = (id) => api.get(`/customer-management/customers/${id}/addresses`);
export const addCustomerAddress = (id, data) => api.post(`/customer-management/customers/${id}/addresses`, data);
export const deleteCustomerAddress = (id, addressId) => api.delete(`/customer-management/customers/${id}/addresses/${addressId}`);
export const setDefaultCustomerAddress = (id, addressId) => api.patch(`/customer-management/customers/${id}/addresses/${addressId}/default`);

export const getCustomerDocuments = (customerId) => api.get(`/customer-documents/${customerId}`);
export const uploadCustomerDocument = (customerId, formData) =>
  api.post(`/customer-documents/${customerId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const deleteCustomerDocument = (customerId, docId) =>
  api.delete(`/customer-documents/${customerId}/${docId}`);
