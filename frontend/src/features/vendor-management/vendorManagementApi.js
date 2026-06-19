import api from '../../utils/api';
import { mergeAssetCatalog } from './vendorMgmtUi';

const base = '/vendor-management';

/** Backend validates limit max 200 on list endpoints */
export const API_LIST_MAX = 200;

async function fetchAllPages(requestFn, params = {}) {
  const rows = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data } = await requestFn({ ...params, page, limit: API_LIST_MAX });
    if (!data?.success) {
      const msg = data?.errors?.[0]?.msg || data?.message || 'Request failed';
      throw new Error(msg);
    }
    rows.push(...(data.data || []));
    totalPages = data.pagination?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return rows;
}

export function fetchAllVendors(params) {
  return fetchAllPages((p) => api.get(`${base}/vendors`, { params: p }), params);
}

export function fetchAllPurchaseOrders(params) {
  return fetchAllPages((p) => api.get(`${base}/purchase-orders`, { params: p }), params);
}

/** Admin/staff API calls (uses default JWT from localStorage) */
export function fetchVendors(params) {
  return api.get(`${base}/vendors`, { params });
}

export function fetchVendor(id) {
  return api.get(`${base}/vendors/${id}`);
}

export function fetchVendorLookup(vendor_id) {
  return api.get(`${base}/vendors/info`, { params: { vendor_id } });
}

export function createVendor(formData) {
  return api.post(`${base}/vendors`, formData);
}

export function updateVendor(id, formData) {
  const fd = formData instanceof FormData ? formData : (() => {
    const fd2 = new FormData();
    Object.entries(formData || {}).forEach(([k, v]) => fd2.append(k, v == null ? '' : v));
    return fd2;
  })();
  return api.put(`${base}/vendors/${id}`, fd);
}

export function deleteVendor(id) {
  return api.delete(`${base}/vendors/${id}`);
}

export function loginAsVendor({ vendor_id, vendor_email }) {
  return api.post(`${base}/vendors/login-as`, { vendor_id, vendor_email });
}

export function fetchPurchaseOrders(params) {
  return api.get(`${base}/purchase-orders`, { params });
}

export function fetchNextPoNumber() {
  return api.get(`${base}/purchase-orders/next-number`);
}

/** Next PO number + approved vendor list (+ contact fields) */
export async function fetchPurchaseOrderFormMeta() {
  const res = await api.get(`${base}/purchase-orders/form-meta`);
  if (res?.data?.success) {
    res.data.asset_catalog = mergeAssetCatalog(res.data.asset_catalog);
  }
  return res;
}

export function createPurchaseOrder(body) {
  return api.post(`${base}/purchase-orders`, body);
}

export function fetchPurchaseOrder(id) {
  return api.get(`${base}/purchase-orders/${id}`);
}

/** Laravel addProductReceived: vendor + PO stats + lines with received counts + GRNs */
export function fetchProductReceivedContext(poId) {
  return api.get(`${base}/purchase-orders/${poId}/product-received`);
}

/** Record one serial against a PO line (creates / reuses GRN; sets extra.line_index + product_detail_id) */
export function receivePoLineSerial(poId, body) {
  return api.post(`${base}/purchase-orders/${poId}/product-received/receive`, body);
}

/** Multi-unit receive: rental start date + N serials + auto TTSPL codes per unit */
export function receivePoLineBulk(poId, body) {
  return api.post(`${base}/purchase-orders/${poId}/product-received/receive-bulk`, body);
}

/** Sequential receive — one unit at a time with TTSPL + ticket */
export function receivePoLineUnit(poId, body) {
  return api.post(`${base}/purchase-orders/${poId}/product-received/receive-unit`, body);
}

/** Create laptop-side capture link for auto serial read */
export function createGrnCaptureToken(poId, body) {
  return api.post(`${base}/purchase-orders/${poId}/grn-capture-tokens`, body);
}

/** Poll capture token until serial is submitted from laptop */
export function fetchGrnCaptureTokenStatus(token) {
  return api.get(`${base}/grn-capture-tokens/${token}`);
}

// ── GRN Access Numbers (admin) ────────────────────────────────────
export function listGrnAccessNumbers(params = {}) {
  return api.get('/grn-access', { params });
}
export function fetchGrnAccessAttempts(params = {}) {
  return api.get('/grn-access/attempts', { params });
}
export function expireGrnAccessNumber(id) {
  return api.patch(`/grn-access/${id}/expire`);
}
export function deleteGrnAccessNumber(id) {
  return api.delete(`/grn-access/${id}`);
}

/** Laravel view_purchase_order_detail: vendor + KPIs + grouped GRNs */
export function fetchGeneratedGrnOverview(poId) {
  return api.get(`${base}/purchase-orders/${poId}/generated-grn`);
}

/** Laravel admin.sellers.getGRNDetails — serial/product cards for one GRN */
export function fetchGrnReceivedProducts(poId, grnId) {
  return api.get(`${base}/purchase-orders/${poId}/grns/${grnId}/received-products`);
}

/** PO workflow: pending_approval | approved | rejected (with rejection_reason) */
export function patchPurchaseOrderStatus(id, status, extra = {}) {
  return api.patch(`${base}/purchase-orders/${id}/status`, { status, ...extra });
}

export function uploadGrnBill(poId, grnId, formData) {
  return api.post(`${base}/purchase-orders/${poId}/grns/${grnId}/bills`, formData);
}

export function updateVendorPortalAccess(id, body) {
  return api.patch(`${base}/vendors/${id}/portal-access`, body);
}

export function uploadPurchaseOrderBills(id, formData) {
  return api.post(`${base}/purchase-orders/${id}/bills`, formData);
}

export function fetchSpareOrders(params) {
  return api.get(`${base}/spare-parts-orders`, { params });
}

export function fetchNextSpoNumber() {
  return api.get(`${base}/spare-parts-orders/next-number`);
}

/** Next SP-PO number + vendors + brands + spare parts catalog (Laravel add_po_parts parity). */
export function fetchSparePartsFormMeta() {
  return api.get(`${base}/spare-parts-orders/form-meta`);
}

export function fetchSparePartsOrder(id) {
  return api.get(`${base}/spare-parts-orders/${id}`);
}

export function patchSparePartsOrderStatus(id, status) {
  return api.patch(`${base}/spare-parts-orders/${id}/status`, { status });
}

export function uploadSparePartsOrderBills(id, formData) {
  return api.post(`${base}/spare-parts-orders/${id}/bills`, formData);
}

export function createSparePartsOrder(body) {
  return api.post(`${base}/spare-parts-orders`, body);
}

/** Laravel addProductpartsReceived: vendor + spare PO + lines with received counts + GRNs */
export function fetchSpareProductReceivedContext(spoId) {
  return api.get(`${base}/spare-parts-orders/${spoId}/product-received`);
}

export function receiveSpareLineSerial(spoId, body) {
  return api.post(`${base}/spare-parts-orders/${spoId}/product-received/receive`, body);
}

/** Multi-unit spare receive: qty + serials[] + backend TTSPL codes */
export function receiveSpareLineBulk(spoId, body) {
  return api.post(`${base}/spare-parts-orders/${spoId}/product-received/receive-bulk`, body);
}

export function createSpareGrn(spoId, meta = {}) {
  return api.post(`${base}/spare-parts-orders/${spoId}/grns`, { meta });
}

/** Spare PO GRN overview (Laravel view_parts_purchase_order_detail) */
export function fetchSpareGeneratedGrnOverview(spoId) {
  return api.get(`${base}/spare-parts-orders/${spoId}/generated-grn`);
}

export function fetchSpareGrnReceivedProducts(spoId, grnId) {
  return api.get(`${base}/spare-parts-orders/${spoId}/grns/${grnId}/received-products`);
}

export function fetchGrns(poId) {
  return api.get(`${base}/purchase-orders/${poId}/grns`);
}

export function createGrn(poId, meta = {}) {
  return api.post(`${base}/purchase-orders/${poId}/grns`, { meta });
}

export function fetchSerials(grnId, poId) {
  return api.get(`${base}/grns/${grnId}/purchase-orders/${poId}/serial-numbers`);
}

export function createSerial(payload) {
  return api.post(`${base}/serial-numbers`, payload);
}

export function updateSerial(payload) {
  return api.put(`${base}/serial-numbers/update`, payload);
}

export function fetchBilling(params) {
  return api.get(`${base}/billing`, { params });
}

export function createBilling(payload) {
  return api.post(`${base}/billing`, payload);
}

export function fetchReplacedProducts(params) {
  return api.get(`${base}/replaced-products`, { params });
}

/** Live PO serial rows marked as replacement (Laravel inventory-list replace) */
export function fetchReplacedInventorySerials(params) {
  return api.get(`${base}/replaced-products/inventory-serials`, { params });
}

export function createReplaced(payload) {
  return api.post(`${base}/replaced-products`, payload);
}
