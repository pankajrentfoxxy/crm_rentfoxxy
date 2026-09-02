import api from '../../utils/api';

const base = '/vendor-billing';

export const listBillableVendors = () => api.get(`${base}/vendors`);
export const listVendorBills = (p) => api.get(`${base}/bills`, { params: p });
export const getVendorBill = (id) => api.get(`${base}/bills/${id}`);
export const generateVendorBill = (d) => api.post(`${base}/bills/generate`, d);
export const approveVendorBill = (id) => api.patch(`${base}/bills/${id}/approve`);
export const markVendorBillPaid = (id, d) => api.patch(`${base}/bills/${id}/paid`, d);
export const listDebitNotes = (p) => api.get(`${base}/debit-notes`, { params: p });
export const createDebitNote = (d) => api.post(`${base}/debit-notes`, d);
export const approveDebitNote = (id) => api.patch(`${base}/debit-notes/${id}/approve`);
