/**
 * The Today dashboard's tiles: what each number is, the list it opens, and the
 * section(s) that must allow it (the same ones the list's route guard and API
 * enforce). The numbers come from GET /api/dashboard/today, which computes a
 * block only for sections the user may view; the page also hides a tile the
 * user cannot open, so a tile never leads to "access denied".
 *
 * Links carry the list's own filters (dates are IST days), so the list opens
 * on exactly the rows the tile counted.
 */
export const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
const FLOOR = ['floor_pipeline', 'floor_tickets'];

/**
 * Money screens still on the old UI. Builders 1–3 are rebuilding them; the
 * lead repoints these to the new paths when they land.
 */
export const MONEY_LINKS = {
  invoices: '/carret/money/invoices',
  payments: '/carret/money/invoices',
  ageing: '/carret/money/ageing',
  vendorBills: '/vendor-billing/bills',
  creditNotes: '/customer-billing/credit-notes',
  debitNotes: '/vendor-billing/debit-notes',
  einvoiceQueue: '/finance/einvoice-queue',
};

const q = (path, params) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
};

/**
 * @param {string} date   the IST day shown (YYYY-MM-DD)
 * @param {string} from   first day of that month
 * @param {string} dayLabel  "today" or "on 28 Sep"
 * Each block: { key, title, tiles: [{ key, label, to, sections, family, note, money }] }
 */
export function buildBlocks({ date, from, dayLabel }) {
  const created = (path, extra = {}) => ({
    day: q(path, { ...extra, created_from: date, created_to: date }),
    month: q(path, { ...extra, created_from: from, created_to: date }),
  });
  const leads = created('/carret/sell/leads', { stage: 'all' });
  const quotes = created('/carret/sell/quotations');
  const orders = created('/carret/sell/sales-orders');
  const sold = created('/carret/sell/sales-orders', { entity: 'gorefurbo' });

  return [
    {
      key: 'leads',
      title: 'Leads',
      tiles: [
        { key: 'new_day', label: `New leads ${dayLabel}`, to: leads.day, sections: ['leads'] },
        { key: 'new_month', label: 'New leads this month', to: leads.month, sections: ['leads'] },
        { key: 'follow_ups_today', label: 'Follow-ups due today', to: '/carret/sell/leads?follow_up=today', sections: ['leads'], family: 'moving' },
        { key: 'follow_ups_overdue', label: 'Follow-ups overdue', to: '/carret/sell/leads?follow_up=overdue', sections: ['leads'], family: 'offcycle' },
      ],
    },
    {
      key: 'quotations',
      title: 'Quotations',
      tiles: [
        { key: 'day', label: `Quotations ${dayLabel}`, to: quotes.day, sections: ['sales_quotations'], money: true },
        { key: 'month', label: 'Quotations this month', to: quotes.month, sections: ['sales_quotations'], money: true },
      ],
    },
    {
      key: 'sales_orders',
      title: 'Sales orders',
      tiles: [
        { key: 'day', label: `Sales orders ${dayLabel}`, to: orders.day, sections: SO_SECTIONS, money: true, note: 'all statuses' },
        { key: 'month', label: 'Sales orders this month', to: orders.month, sections: SO_SECTIONS, money: true, note: 'all statuses' },
      ],
    },
    {
      key: 'sales',
      title: 'Sales (gorefurbo)',
      tiles: [
        { key: 'day', label: `Sold ${dayLabel}`, to: sold.day, sections: SO_SECTIONS, money: true, family: 'closed', note: 'sale orders' },
        { key: 'month', label: 'Sold this month', to: sold.month, sections: SO_SECTIONS, money: true, family: 'closed', note: 'sale orders' },
      ],
    },
    {
      key: 'dispatch',
      title: 'Dispatch',
      tiles: [
        { key: 'to_accept', label: 'Orders to accept', to: '/carret/move/orders-to-accept', sections: ['dispatch_pending_orders'], family: 'moving' },
        { key: 'dispatch_qc', label: 'Dispatch QC pending', to: '/carret/produce/floor?stage=Dispatch%20QC', sections: FLOOR, family: 'moving' },
        { key: 'at_gate', label: 'Challans waiting at the gate', to: '/carret/move/challans?status=dispatch_ready', sections: ['delivery_challans'], family: 'moving' },
        { key: 'delivered', label: `Delivered ${dayLabel}`, to: q('/carret/move/challans', { status: 'delivered', delivered_on: date }), sections: ['delivery_challans'], family: 'earning', note: 'challans' },
      ],
    },
    {
      key: 'rentals',
      title: 'Rentals',
      tiles: [
        { key: 'on_rent', label: 'Laptops on rent', to: '/carret/stock/assets?status=rented', sections: ['inventory_management'], family: 'earning' },
        { key: 'with_customer', label: 'With customers', to: '/carret/stock/assets?view=with_customer', sections: ['inventory_management'], family: 'earning', note: 'rented, demo and sold' },
        { key: 'went_on_rent', label: `Went on rent ${dayLabel}`, to: q('/carret/stock/assets', { moved_to: 'rented', moved_on: date }), sections: ['inventory_management'], family: 'earning', note: 'from status history' },
        { key: 'came_back', label: `Came back ${dayLabel}`, to: q('/carret/stock/assets', { moved_to: 'returned', moved_on: date }), sections: ['inventory_management'], family: 'offcycle', note: 'rent stopped' },
        { key: 'returns_due', label: 'Returns on the way', to: '/carret/move/return-challans', sections: ['return_dc'], family: 'moving', note: 'open return challans' },
      ],
    },
    {
      key: 'stock',
      title: 'Stock',
      tiles: [
        { key: 'ready', label: 'Ready stock', to: '/carret/stock/ready', sections: ['inventory_management', 'ready_to_rent_location'], family: 'idle', ready: true },
        { key: 'in_repair', label: 'In repair', to: '/carret/stock/assets?status=in_repair', sections: ['inventory_management'], family: 'offcycle' },
        { key: 'returned', label: 'Returned, not yet back in stock', to: '/carret/stock/assets?status=returned', sections: ['inventory_management'], family: 'offcycle' },
        { key: 'qc_failed', label: 'Failed QC', to: '/carret/stock/assets?status=qc_failed', sections: ['inventory_management'], family: 'offcycle' },
        { key: 'reserved', label: 'Reserved on orders', to: '/carret/stock/assets?status=reserved', sections: ['inventory_management'], family: 'moving' },
        { key: 'floor', label: 'On the floor', to: '/carret/produce/floor', sections: FLOOR, stages: true },
      ],
    },
    {
      key: 'support',
      title: 'Support',
      tiles: [
        { key: 'open', label: 'Open tickets', to: '/carret/serve/queue', sections: ['support_tickets'] },
        { key: 'breached', label: 'Past SLA', to: '/carret/serve/insights', sections: ['support_tickets'], family: 'offcycle' },
        { key: 'at_risk', label: 'Due soon (SLA)', to: '/carret/serve/insights', sections: ['support_tickets'], family: 'moving' },
      ],
    },
    {
      key: 'money',
      title: 'Money',
      tiles: [
        { key: 'invoiced_month', label: 'Invoiced for this month', to: MONEY_LINKS.invoices, sections: ['customer_billing'], money: true, note: 'billing month, not cancelled' },
        { key: 'collected_day', label: `Collected ${dayLabel}`, to: MONEY_LINKS.payments, sections: ['customer_billing'], money: true, family: 'earning', note: 'payments' },
        { key: 'collected_month', label: 'Collected this month', to: MONEY_LINKS.payments, sections: ['customer_billing'], money: true, family: 'earning', note: 'payments' },
        { key: 'outstanding', label: 'Outstanding', to: MONEY_LINKS.ageing, sections: ['customer_billing'], money: true, ageing: true, family: 'offcycle' },
        { key: 'drafts', label: 'Draft invoices', to: MONEY_LINKS.invoices, sections: ['customer_billing'], money: true },
        { key: 'vendor_bills_to_approve', label: 'Vendor bills to approve', to: MONEY_LINKS.vendorBills, sections: ['vendor_billing_mgmt'], money: true, family: 'moving' },
        { key: 'vendor_bills_to_pay', label: 'Vendor bills to pay', to: MONEY_LINKS.vendorBills, sections: ['vendor_billing_mgmt'], money: true, family: 'moving', note: 'approved, unpaid' },
        { key: 'credit_notes_pending', label: 'Credit notes to approve', to: MONEY_LINKS.creditNotes, sections: ['credit_notes'], money: true },
        { key: 'debit_notes_pending', label: 'Debit notes to approve', to: MONEY_LINKS.debitNotes, sections: ['debit_notes'], money: true },
        { key: 'einvoice_queue', label: 'Sale challans without e-invoice', to: MONEY_LINKS.einvoiceQueue, sections: ['einvoice_ewb'] },
      ],
    },
  ];
}
