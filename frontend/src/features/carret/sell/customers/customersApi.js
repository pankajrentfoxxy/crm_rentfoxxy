/** Customers in the new UI (backend controllers/customerOverviewController.js + existing customer APIs). */
import api from '../../../../utils/api';

const cm = '/customer-management';
export const fetchCustomers = (params) => api.get(`${cm}/overview/customers`, { params });
export const fetchCustomer = (id) => api.get(`${cm}/overview/customers/${id}`);
export const fetchCustomerOrders = (id) => api.get(`${cm}/overview/customers/${id}/orders`);
export const fetchCustomerLaptops = (id, params) => api.get(`${cm}/customers/${id}/laptops`, { params });
export const customerLaptopsExportUrl = (id, lifecycle) => `${cm}/customers/${id}/laptops/export.xlsx?lifecycle=${lifecycle}`;
export const fetchCustomerTickets = (id) => api.get(`${cm}/customers/${id}/tickets`);
export const fetchCustomerAddresses = (id) => api.get(`${cm}/customers/${id}/addresses`);
export const setCustomerTag = (id, customerType, reason) => api.put(`${cm}/customers/${id}`, { customer_type: customerType, customer_type_reason: reason });
export const fetchStatement = (id) => api.get(`/customer-billing/customers/${id}/statement`);

export const TAG_LABEL = { rental: 'Rental', sales: 'Sales', both: 'Rental + Sales' };
export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;
export const fetchClosureCheck = (id) => api.get(`${cm}/overview/customers/${id}/closure`);
export const closeCustomerAccount = (id, body) => api.post(`${cm}/overview/customers/${id}/close`, body);

/* ---- Profile, addresses, documents, portal (the APIs of the old /lead-crm/customers/:id page) ---- */
export const fetchCustomerProfile = (id) => api.get(`${cm}/customers/${id}`);
/** PUT /customers/:id. A change to the GST supply state answers 409 SUPPLY_STATE_CHANGE until confirmed. */
export const updateCustomerProfile = (id, body) => api.put(`${cm}/customers/${id}`, body);
export const setCustomerStatus = (id, status) => api.patch(`${cm}/customers/${id}/status`, { status });
export const verifyCustomerKyc = (id) => api.put(`${cm}/customers/${id}/verify-kyc`);
export const addCustomerAddress = (id, body) => api.post(`${cm}/customers/${id}/addresses`, body);
export const updateCustomerAddress = (id, addressId, body) => api.put(`${cm}/customers/${id}/addresses/${addressId}`, body);
export const deleteCustomerAddress = (id, addressId) => api.delete(`${cm}/customers/${id}/addresses/${addressId}`);
export const setDefaultCustomerAddress = (id, addressId) => api.patch(`${cm}/customers/${id}/addresses/${addressId}/default`);
export const fetchCustomerDocuments = (id) => api.get(`/customer-documents/${id}`);
export const uploadCustomerDocument = (id, formData) => api.post(`/customer-documents/${id}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const deleteCustomerDocument = (id, docId) => api.delete(`/customer-documents/${id}/${docId}`);
/** Enable / disable / reset password / send login email — one PATCH, as the old page. */
export const setPortalAccess = (id, body) => api.patch(`${cm}/customers/${id}/portal-access`, body);
/** Super admin only: a short-lived read-only portal session. */
export const portalLoginAs = (id) => api.post(`${cm}/customers/${id}/portal-login-as`);
export const updateCustomerLaptop = (id, serialId, body) => api.patch(`${cm}/customers/${id}/laptops/${serialId}`, body);
export const fetchCustomerAssetActivity = (id, params) => api.get(`${cm}/customers/${id}/assets/activity`, { params });
