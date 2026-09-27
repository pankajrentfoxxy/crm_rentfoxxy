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
