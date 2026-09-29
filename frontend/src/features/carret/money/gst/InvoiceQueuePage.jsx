import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Input, Money, Notice, Panel, Segmented, StatTile, StatusChip, Tabs,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  downloadSaleOrderInvoice, fetchDcInvoiceQueue, fetchEinvoiceQueue, fetchSaleInvoiceQueue,
} from './gstApi';
import { DcEwayDrawer, DcInvoiceDrawer, SaleInvoiceDrawer } from './AttachDrawers';
import {
  InvoiceAmount, dcPath, errMsg, fmt, invoiceSub, soPath,
} from './gstShared';

/**
 * Finance → GST & e-way → Invoice & e-way queue.
 *
 * One page for the three old accounts queues (DC Invoice, Sale Invoice Queue,
 * E-Invoice Queue). They are the same list — a document waiting for a number
 * that comes from outside the CRM (Zoho invoice, e-way bill, IRN), with the
 * party, date and amount — and the same person works them, so they are tabs of
 * one page rather than three menu entries:
 *
 *   DC invoices     sale challans and a new customer's first challan: Zoho /
 *                   e-invoice number + PDF (+ e-way bill when the laptops are
 *                   worth ≥ ₹50,000). Pending, or Attached to correct one.
 *   Value e-way     challans that need only an e-way bill (a first-time
 *                   customer's demo, or any challan flagged for one).
 *   Sale in place   laptops sold where they already are — no challan, so the
 *                   invoice is attached to the sales order.
 *   E-invoice (IRN) delivered sale challans with no IRN from the GSP. Read-only
 *                   in this pass (MD8): the Zoho GSP call is not changed or
 *                   offered here — see the notice on the tab.
 *
 * Amounts are the invoice total from the challan's billing with the CGST+SGST /
 * IGST split for its place of supply (MD7). A number on file is only changed by
 * an explicit Replace with a reason; duplicates are refused by the server.
 */

const TABS = [
  { key: 'dc', label: 'DC invoices' },
  { key: 'eway', label: 'Value e-way' },
  { key: 'sale', label: 'Sale in place' },
  { key: 'irn', label: 'E-invoice (IRN)' },
];

const DC_STATUSES = ['pending', 'processing', 'dispatch_ready', 'in_transit', 'reached', 'shipped', 'delivered'];
const isSaleRow = (r) => ['sale', 'sales'].includes(String(r.quotation_type || '').toLowerCase()) || r.entity_code === 'gorefurbo';

function inDateRange(value, from, to) {
  if (!from && !to) return true;
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  if (from && d < new Date(`${from}T00:00:00`)) return false;
  if (to && d > new Date(`${to}T23:59:59.999`)) return false;
  return true;
}

function matches(row, q, keys) {
  if (!q) return true;
  const hay = keys.map((k) => row[k]).filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

const byNewest = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);

function DateRange({ from, to, onChange }) {
  return (
    <div className="flex items-center" style={{ gap: '6px' }}>
      <label className="sr-only" htmlFor="gst-from">From</label>
      <Input id="gst-from" type="date" value={from || ''} onChange={(e) => onChange('from', e.target.value)} style={{ width: 'auto' }} />
      <span className="text-ink-3">to</span>
      <label className="sr-only" htmlFor="gst-to">To</label>
      <Input id="gst-to" type="date" value={to || ''} onChange={(e) => onChange('to', e.target.value)} style={{ width: 'auto' }} />
    </div>
  );
}

export default function InvoiceQueuePage() {
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  // Mirrors the backend gates: canUploadSaleDcCompliance and canUploadDcValueEway.
  const canAttachInvoice = [['delivery_challans', 'edit'], ['dispatch_ops', 'edit'], ['dispatch', 'edit'], ['einvoice_ewb', 'create'], ['einvoice_ewb', 'edit']]
    .some(([s, a]) => hasPermission(s, a));
  const canAttachEway = user?.role === 'accounts' || hasPermission('dc_eway_bill', 'edit') || hasPermission('dc_eway_bill', 'create');

  // ?tab=dc|eway|sale|irn opens that tab (the Today dashboard links to IRN).
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (['dc', 'eway', 'sale', 'irn'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'dc'));
  const [dcMode, setDcMode] = useState('pending');
  const [saleMode, setSaleMode] = useState('pending');
  const [filters, setFilters] = useState({});
  const [data, setData] = useState({ dc: null, eway: null, sale: null, irn: null });
  const [threshold, setThreshold] = useState(50000);
  const [attachDc, setAttachDc] = useState(null);
  const [attachEway, setAttachEway] = useState(null);
  const [attachSale, setAttachSale] = useState(null);
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    try {
      if (tab === 'dc' || tab === 'eway') {
        setData((d) => ({ ...d, dc: null, eway: tab === 'eway' ? null : d.eway }));
        const params = tab === 'dc' && dcMode === 'attached' ? { status: 'attached', search: filters.search || undefined } : {};
        const { data: res } = await fetchDcInvoiceQueue(params);
        if (res.eway_threshold) setThreshold(Number(res.eway_threshold));
        if (params.status === 'attached') {
          setData((d) => ({ ...d, dc: res.queue || [] }));
        } else {
          setData((d) => ({ ...d, dc: res.queue || [], eway: res.demo_eway || [] }));
          setCounts((c) => ({ ...c, dc: (res.queue || []).length, eway: (res.demo_eway || []).filter((r) => r.eway_status !== 'uploaded').length }));
        }
      } else if (tab === 'sale') {
        setData((d) => ({ ...d, sale: null }));
        const { data: res } = await fetchSaleInvoiceQueue(saleMode);
        setData((d) => ({ ...d, sale: res.data || [] }));
        if (saleMode === 'pending') setCounts((c) => ({ ...c, sale: (res.data || []).length }));
      } else {
        setData((d) => ({ ...d, irn: null }));
        const { data: res } = await fetchEinvoiceQueue();
        setData((d) => ({ ...d, irn: res.queue || [] }));
        setCounts((c) => ({ ...c, irn: (res.queue || []).length }));
      }
    } catch (e) {
      toast.error(errMsg(e, 'Could not load the queue'));
      setData((d) => ({ ...d, [tab]: [] }));
    }
    // attached-DC search is server-side; a keystroke must not refetch the others
  }, [tab, dcMode, saleMode, dcMode === 'attached' && tab === 'dc' ? filters.search : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(load, tab === 'dc' && dcMode === 'attached' && filters.search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setFilters({}); }, [tab]);

  // The sale-in-place count is cheap; fetch it once so its tile is not blank
  // until the tab is opened. (The IRN list values every challan, so it waits.)
  useEffect(() => {
    fetchSaleInvoiceQueue('pending')
      .then(({ data: res }) => setCounts((c) => ({ ...c, sale: (res.data || []).length })))
      .catch(() => {});
  }, []);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const q = String(filters.search || '').trim().toLowerCase();

  const rows = useMemo(() => {
    const src = data[tab];
    if (!src) return null;
    let out = src.filter((r) => inDateRange(r.created_at, filters.from, filters.to));
    if (tab === 'dc') {
      out = out.filter((r) => matches(r, q, ['dc_number', 'sales_order_number', 'customer_name', 'einvoice_number', 'irn', 'eway_bill_number']));
      if (filters.kind === 'sale') out = out.filter(isSaleRow);
      if (filters.kind === 'first_order') out = out.filter((r) => !isSaleRow(r));
      if (filters.status) out = out.filter((r) => String(r.status || '').toLowerCase() === filters.status);
      if (filters.eway === 'required') out = out.filter((r) => r.requires_eway_bill);
      if (filters.eway === 'not_required') out = out.filter((r) => !r.requires_eway_bill);
      if (filters.mail === 'sent') out = out.filter((r) => r.accounts_notified_at);
      if (filters.mail === 'pending') out = out.filter((r) => !r.accounts_notified_at);
    } else if (tab === 'eway') {
      out = out.filter((r) => matches(r, q, ['dc_number', 'sales_order_number', 'customer_name', 'laptops', 'eway_bill_number']));
      if (filters.state) out = out.filter((r) => r.eway_status === filters.state);
    } else if (tab === 'sale') {
      out = out.filter((r) => matches(r, q, ['sales_order_number', 'customer_name', 'sale_invoice_number']));
    } else {
      out = out.filter((r) => matches(r, q, ['dc_number', 'customer_name']));
    }
    return tab === 'dc' && dcMode === 'attached' ? out : [...out].sort(byNewest);
  }, [data, tab, q, filters, dcMode]);

  const filterDefs = useMemo(() => {
    const search = { key: 'search', label: 'Search', type: 'search' };
    if (tab === 'dc') {
      return [
        { ...search, placeholder: 'DC, SO, customer, invoice or e-way no.' },
        { key: 'kind', label: 'Type', options: [{ value: 'sale', label: 'Sale' }, { value: 'first_order', label: 'First challan' }] },
        { key: 'status', label: 'Challan', options: DC_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
        { key: 'eway', label: 'E-way', options: [{ value: 'required', label: 'Required' }, { value: 'not_required', label: 'Not required' }] },
        { key: 'mail', label: 'Accounts mail', options: [{ value: 'sent', label: 'Sent' }, { value: 'pending', label: 'Not sent' }] },
      ];
    }
    if (tab === 'eway') {
      return [
        { ...search, placeholder: 'DC, SO, customer, laptop or e-way no.' },
        { key: 'state', label: 'E-way', options: [{ value: 'pending', label: 'Pending' }, { value: 'uploaded', label: 'On file' }] },
      ];
    }
    if (tab === 'sale') return [{ ...search, placeholder: 'SO, customer or invoice no.' }];
    return [{ ...search, placeholder: 'DC or customer' }];
  }, [tab]);

  const downloadSalePdf = async (so) => {
    try {
      const { data: blob } = await downloadSaleOrderInvoice(so);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${so.replace(/\//g, '_')}-invoice.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errMsg(e, 'No invoice PDF attached'));
    }
  };

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  const columns = useMemo(() => {
    const amountCol = {
      key: 'amount', header: 'Invoice value', numeric: true,
      render: (r) => <InvoiceAmount row={r} estimate={r.amount ?? r.order_value} />,
      sub: (r) => invoiceSub(r),
    };
    if (tab === 'dc') {
      return [
        { key: 'dc_number', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.sales_order_number || null },
        { key: 'created_at', header: 'Date', render: (r) => <DateTime value={r.created_at} /> },
        { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || '—', sub: (r) => (isSaleRow(r) ? 'sale' : 'first challan') },
        { key: 'status', header: 'Challan status', render: (r) => <StatusChip status={String(r.status || '').toLowerCase()} /> },
        { key: 'quantity', header: 'Qty', numeric: true, render: (r) => Number(r.quantity || 0) },
        amountCol,
        {
          key: 'eway', header: 'E-way',
          render: (r) => (r.requires_eway_bill ? (r.eway_bill_number ? <DocNumber value={r.eway_bill_number} /> : <span style={{ color: 'var(--alert-serious)' }}>Required</span>) : <span className="text-ink-3">Not needed</span>),
          sub: (r) => (r.eway_value != null ? `laptops ${fmt(r.eway_value)}` : null),
        },
        {
          key: 'einvoice_number', header: 'Invoice no.',
          render: (r) => (r.einvoice_number ? <DocNumber value={r.einvoice_number} /> : <span className="text-ink-3">Not attached</span>),
          sub: (r) => (r.accounts_notified_at ? 'Accounts mailed' : null),
        },
        {
          key: 'act', header: '', align: 'right',
          render: (r) => (canAttachInvoice
            ? <Button variant="quiet" onClick={stop(() => setAttachDc(r))}>{r.einvoice_number ? 'Replace / update' : 'Attach'}</Button>
            : null),
        },
      ];
    }
    if (tab === 'eway') {
      return [
        { key: 'dc_number', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.sales_order_number || null },
        { key: 'created_at', header: 'Date', render: (r) => <DateTime value={r.created_at} /> },
        { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || '—' },
        { key: 'laptops', header: 'Laptops', render: (r) => <span className="font-mono">{r.laptops || '—'}</span> },
        {
          key: 'value', header: 'Laptops worth', numeric: true,
          render: (r) => <Money value={r.eway_value ?? r.amount} />,
          sub: (r) => ((r.dispatch_mode === 'inhouse' || r.dispatch_mode === 'porter') ? `${r.dispatch_mode} · ${r.vehicle_number || 'no vehicle'}` : null),
        },
        {
          key: 'eway_bill_number', header: 'E-way bill',
          render: (r) => (r.eway_status === 'uploaded' ? <DocNumber value={r.eway_bill_number} /> : <span style={{ color: 'var(--alert-serious)' }}>Pending</span>),
          sub: (r) => (r.eway_bill_date ? `dated ${String(r.eway_bill_date).slice(0, 10)}` : null),
        },
        {
          key: 'act', header: '', align: 'right',
          render: (r) => (canAttachEway
            ? <Button variant="quiet" onClick={stop(() => setAttachEway(r))}>{r.eway_bill_number ? 'Replace / update' : 'Upload'}</Button>
            : null),
        },
      ];
    }
    if (tab === 'sale') {
      return [
        { key: 'sales_order_number', header: 'Sales order', render: (r) => <DocNumber value={r.sales_order_number} /> },
        { key: 'created_at', header: 'Date', render: (r) => <DateTime value={r.created_at} /> },
        { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}`, sub: (r) => r.reasons || null },
        { key: 'qty', header: 'Qty', numeric: true, render: (r) => Number(r.qty || 0) },
        amountCol,
        {
          key: 'sale_invoice_number', header: 'Invoice no.',
          render: (r) => (r.sale_invoice_number ? <DocNumber value={r.sale_invoice_number} /> : <span className="text-ink-3">Not attached</span>),
          sub: (r) => (r.sale_invoice_uploaded_at ? `attached ${String(r.sale_invoice_uploaded_at).slice(0, 10)}` : null),
        },
        {
          key: 'act', header: '', align: 'right',
          render: (r) => (
            <div className="flex justify-end" style={{ gap: '6px' }}>
              {r.has_pdf && <Button variant="quiet" onClick={stop(() => downloadSalePdf(r.sales_order_number))}>PDF</Button>}
              {canAttachInvoice && <Button variant="quiet" onClick={stop(() => setAttachSale(r))}>{r.sale_invoice_number ? 'Replace / update' : 'Attach'}</Button>}
            </div>
          ),
        },
      ];
    }
    return [
      { key: 'dc_number', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} /> },
      { key: 'created_at', header: 'Date', render: (r) => <DateTime value={r.created_at} /> },
      { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || '—' },
      amountCol,
      { key: 'irn', header: 'IRN', render: (r) => (r.irn ? <DocNumber value={r.irn} /> : <span className="text-ink-3">Not generated</span>) },
      { key: 'eway_bill_number', header: 'E-way bill', render: (r) => (r.eway_bill_number ? <DocNumber value={r.eway_bill_number} /> : <span className="text-ink-3">—</span>) },
    ];
  }, [tab, canAttachInvoice, canAttachEway]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRowClick = (r) => {
    if (tab === 'sale') navigate(soPath(r.sales_order_number));
    else navigate(dcPath(r.dc_number));
  };

  const tabs = TABS.map((t) => ({ ...t, count: counts[t.key] }));
  const loading = rows === null;
  const pendingValue = (tab === 'dc' && dcMode === 'pending') || (tab === 'sale' && saleMode === 'pending')
    ? (rows || []).reduce((a, r) => a + Number(r.invoice?.grand_total || 0), 0)
    : null;
  const estimates = (rows || []).filter((r) => r.amount_is_estimate).length;

  return (
    <DeskShell
      title="Invoice & e-way queue"
      breadcrumb="Finance · GST & e-way"
      subtitle="Documents waiting for a Zoho invoice, e-way bill or IRN number. Amounts are the invoice value with its CGST + SGST or IGST split."
    >
      <div className="c-stack">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <StatTile label="DC invoices pending" value={counts.dc ?? null} />
          <StatTile label="Value e-way pending" value={counts.eway ?? null} family={counts.eway ? 'offcycle' : undefined} />
          <StatTile label="Sale in place pending" value={counts.sale ?? null} />
          <StatTile label="Shown — invoice value" value={loading ? null : (pendingValue != null ? <Money value={pendingValue} /> : (rows || []).length)} delta={pendingValue != null ? `${(rows || []).length} documents` : 'documents'} />
        </div>

        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        {tab === 'dc' && (
          <Segmented
            label="Which challans"
            value={dcMode}
            onChange={setDcMode}
            options={[{ value: 'pending', label: 'Waiting for paperwork' }, { value: 'attached', label: 'Invoice attached' }]}
          />
        )}
        {tab === 'sale' && (
          <Segmented
            label="Which orders"
            value={saleMode}
            onChange={setSaleMode}
            options={[{ value: 'pending', label: 'Waiting for invoice' }, { value: 'attached', label: 'Invoice attached' }]}
          />
        )}
        {tab === 'eway' && (
          <Notice tone="info">
            Challans that need only an e-way bill: a first-time customer&apos;s demo, or any challan whose laptops are worth {fmt(threshold)} or more and was flagged for one. Every e-way bill across challans, vendor and scrap documents is in <a href="/carret/money/gst/eway-bills" onClick={(e) => { e.preventDefault(); navigate('/carret/money/gst/eway-bills'); }}>E-way bills</a>.
          </Notice>
        )}
        {tab === 'irn' && (
          <Notice tone="warn" title="Read-only in this pass">
            IRN generation through the Zoho GSP is not offered here: the GSP request still uses a fixed 9 + 9 split,
            the challan number as the invoice number and a non-NIC e-way payload, and live has no GSP credentials.
            Until that is fixed, attach the Zoho e-invoice number on the DC invoices tab.
          </Notice>
        )}
        {estimates > 0 && (
          <Notice tone="warn">{estimates} {estimates === 1 ? 'row shows' : 'rows show'} an estimated amount — the challan&apos;s billing could not be resolved.</Notice>
        )}

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={loading ? '' : `${rows.length} shown`}
              right={<DateRange from={filters.from} to={filters.to} onChange={onFilter} />}
            />
          )}
        >
          {loading ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.dc_number || r.sales_order_number}
              onRowClick={onRowClick}
              empty={(
                <EmptyState
                  title={(data[tab] || []).length ? 'Nothing matches the filters' : 'Nothing waiting here'}
                  action={(data[tab] || []).length ? <Button variant="quiet" onClick={onClear}>Clear filters</Button> : null}
                />
              )}
            />
          )}
        </Panel>
      </div>

      <DcInvoiceDrawer row={attachDc} onClose={() => setAttachDc(null)} onSaved={load} />
      <DcEwayDrawer row={attachEway} onClose={() => setAttachEway(null)} onSaved={load} />
      <SaleInvoiceDrawer row={attachSale} onClose={() => setAttachSale(null)} onSaved={load} />
    </DeskShell>
  );
}
