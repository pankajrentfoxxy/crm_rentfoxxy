import api from '../../utils/api';

export const getLeads = (params) => api.get('/leads', { params });
export const getLead = (id) => api.get(`/leads/${id}`);
export const getLeadRecentActivity = (id, limit = 5) =>
  api.get(`/leads/${id}/recent-activity`, { params: { limit } });
export const createLead = (data) => api.post('/leads', data);
export const updateLeadStatus = (id, data) => api.put(`/leads/${id}/status`, data);
export const updateLeadBasic = (id, data) => api.put(`/leads/${id}/basic`, data);
export const updateLeadProfile = (id, data) => api.put(`/leads/${id}/profile`, data);
export const convertToCustomer = (id, data) => api.post(`/leads/${id}/convert`, data);
export const getLeadConversion = (id) => api.get(`/leads/${id}/conversion`);
export const getLeadStages = () => api.get('/leads/stages');
export const addLeadRemark = (id, data) => api.post(`/leads/${id}/remarks`, data);
export const updateLeadRemark = (id, remarkId, data) => api.put(`/leads/${id}/remarks/${remarkId}`, data);
export const deleteLeadRemark = (id, remarkId) => api.delete(`/leads/${id}/remarks/${remarkId}`);
export const updateFollowUp = (id, data) => api.put(`/leads/${id}/follow-up`, data);
export const sendLeadQuotation = (id, data) => api.post(`/leads/${id}/send-quotation`, data);
export const fetchQuotationEmailConfig = () => api.get('/leads/quotation-email-config');
export const getLeadAddresses = (id) => api.get(`/leads/${id}/addresses`);
export const addLeadAddress = (id, data) => api.post(`/leads/${id}/addresses`, data);
export const exportLeadsCsv = (params) => api.get('/leads/export-csv', { params, responseType: 'blob' });
export const importLeadsCsv = (formData) => api.post('/leads/upload', formData);
export const assignLeads = (data) => api.post('/leads/assign', data);
export const runResearch = (id) => api.post(`/leads/${id}/research`);
export const getFollowUps = (params) => api.get('/leads/follow-ups', { params });
export const getFollowUpReminders = () => api.get('/leads/follow-up-reminders');
export const ackFollowUpReminder = (leadId, data) =>
  api.post(`/leads/follow-up-reminders/${leadId}/ack`, data);
export const getAssignableUsers = () => api.get('/leads/assignable-users');
/** @deprecated use getAssignableUsers */
export const getUsers = () => getAssignableUsers();

export const getCustomers = (params) => api.get('/customer-management/customers', { params });
export const getCustomerIds = (params) => api.get('/customer-management/customers/ids', { params });
export const exportCustomersExcel = (params = {}) =>
  api.get('/customer-management/customers/export.xlsx', { params, responseType: 'blob' });
export const exportCustomerAssetsExcel = () =>
  api.get('/customer-management/customers/assets/export.xlsx', { responseType: 'blob' });
export const getCustomer = (id) => api.get(`/customer-management/customers/${id}`);
export const createCustomer = (data) => api.post('/customer-management/customers', data);
export const updateCustomer = (id, data) => api.put(`/customer-management/customers/${id}`, data);
export const updateCustomerStatus = (id, status) =>
  api.patch(`/customer-management/customers/${id}/status`, { status });
export const bulkUpdateCustomerType = (data) =>
  api.patch('/customer-management/customers/bulk-customer-type', data);
export const verifyCustomerKyc = (id) => api.put(`/customer-management/customers/${id}/verify-kyc`);
export const getCustomerLaptops = (id, params) => api.get(`/customer-management/customers/${id}/laptops`, { params });
export const getCustomerTickets = (id, params) =>
  api.get(`/customer-management/customers/${id}/tickets`, { params });
export const getCustomerRentalSummary = (id) =>
  api.get(`/customer-management/customers/${id}/rental-summary`);
export const getCustomerAssetActivity = (customerId, params) =>
  api.get(`/customer-management/customers/${customerId}/assets/activity`, { params });
export const updateCustomerAsset = (customerId, serialId, body) =>
  api.patch(`/customer-management/customers/${customerId}/laptops/${serialId}`, body);
export const getCustomerAddresses = (id) => api.get(`/customer-management/customers/${id}/addresses`);
export const addCustomerAddress = (id, data) => api.post(`/customer-management/customers/${id}/addresses`, data);
export const updateCustomerAddress = (id, addressId, data) =>
  api.put(`/customer-management/customers/${id}/addresses/${addressId}`, data);
export const deleteCustomerAddress = (id, addressId) => api.delete(`/customer-management/customers/${id}/addresses/${addressId}`);
export const setDefaultCustomerAddress = (id, addressId) => api.patch(`/customer-management/customers/${id}/addresses/${addressId}/default`);

export const enableCustomerPortal = (id, data) => api.patch(`/customer-management/customers/${id}/portal-access`, data);

export const getCustomerDocuments = (customerId) => api.get(`/customer-documents/${customerId}`);
export const uploadCustomerDocument = (customerId, formData) =>
  api.post(`/customer-documents/${customerId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const deleteCustomerDocument = (customerId, docId) =>
  api.delete(`/customer-documents/${customerId}/${docId}`);
