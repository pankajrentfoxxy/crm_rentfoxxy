import api from './api';

/**
 * Sale in Place (PHASE 21) — a customer keeps a laptop they hold on rent because
 * it is lost, damaged beyond repair, or they want to buy it. Fulfilled without any
 * movement: no delivery challan and no e-way bill.
 */

export const SALE_IN_PLACE_REASONS = [
  { value: 'lost', label: 'Lost by customer' },
  { value: 'damaged', label: 'Damaged beyond repair' },
  { value: 'buyout', label: 'Customer buyout' },
];

/** Stops rent, stops vendor rent where applicable, and raises the credit note. */
export async function reportSaleInPlace(customerId, payload) {
  const { data } = await api.post(`/customer-management/customers/${customerId}/sale-in-place`, payload);
  return data;
}

/** Billing address, delivered addresses and laptop details for the SO step. */
export async function fetchSaleInPlacePrefill(customerId, serialIds) {
  const { data } = await api.get(`/customer-management/customers/${customerId}/sale-in-place/prefill`, {
    params: { serial_ids: serialIds.join(',') },
  });
  return data;
}

/**
 * Stop rent and raise the sale-in-place Sales Order in one step. Owned laptops
 * are sold at once; vendor-rented ones once their vendor buyout is recorded.
 */
export async function createSaleInPlaceOrder(customerId, payload) {
  const { data } = await api.post(`/customer-management/customers/${customerId}/sale-in-place/sale-order`, payload);
  return data;
}

export async function fetchSaleInPlaceCases(customerId) {
  const { data } = await api.get(`/customer-management/customers/${customerId}/sale-in-place`);
  return data;
}

/** Record the vendor's buyout bill for a unit we were renting from them. */
export async function recordVendorBuyout(serialId, payload) {
  const { data } = await api.post(`/vendor-management/serials/${serialId}/buyout`, payload);
  return data;
}

/** Replaces dispatch + delivery for an in-place order. */
export async function confirmInPlaceSale(soNumber) {
  const { data } = await api.post(
    `/sales-management/sales-orders/${encodeURIComponent(soNumber)}/confirm-in-place-sale`
  );
  return data;
}

/** Accounts attach the Zoho invoice number + PDF against the sales order. */
export async function uploadSaleInvoice(soNumber, { invoiceNumber, file }) {
  const form = new FormData();
  form.append('sale_invoice_number', invoiceNumber);
  if (file) form.append('sale_invoice_pdf', file);
  const { data } = await api.post(
    `/sales-management/sales-orders/${encodeURIComponent(soNumber)}/sale-invoice`,
    form
  );
  return data;
}

export async function fetchSaleInvoiceQueue(status = 'pending') {
  const { data } = await api.get('/finance-overview/sale-invoice-queue', { params: { status } });
  return data;
}

/** The invoice PDF is not publicly served — it streams through an authed route. */
export async function downloadSaleInvoicePdf(soNumber) {
  const res = await api.get(
    `/sales-management/sales-orders/${encodeURIComponent(soNumber)}/sale-invoice/pdf`,
    { responseType: 'blob' }
  );
  return res.data;
}
