import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, Input, Money, Notice, Panel,
  StatTile, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  attachServiceOrderInvoice, cancelServiceOrder, decideServiceCharge, fetchServiceCharges, fetchServiceOrders,
  raiseServiceOrder, serviceOrderInvoiceUrl,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Finance → Service billing (gorefurbo) — claude/carret-lockin-warranty.md, W2.
 * Charges on SOLD laptops (out-of-warranty parts and service / labour) that
 * Support raised: Accounts approve them, raise one service order (SVO) per
 * customer, make the invoice in Zoho and attach it here — like an in-place sale.
 */
const TABS = [
  { key: 'pending', label: 'To approve' }, { key: 'approved', label: 'To bill' }, { key: 'orders', label: 'Service orders' }, { key: 'rejected', label: 'Rejected' },
];
const ORDER_CHIP = {
  awaiting_invoice: { status: 'pending', label: 'Awaiting invoice' },
  invoiced: { status: 'completed', label: 'Invoiced' },
  cancelled: { status: 'cancelled', label: 'Cancelled' },
};
const enc = encodeURIComponent;
const sumOf = (list, key) => (list || []).reduce((s, r) => s + Number(r[key] || 0), 0);
const has = (q, ...vals) => vals.some((v) => v && String(v).toLowerCase().includes(q));

export default function ServiceBillingPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('customer_billing', 'edit');
  const canCreate = hasPermission('customer_billing', 'create');
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null); // { pending, approved, orders } — the tiles, whatever the tab
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);
  const [reject, setReject] = useState(null);
  const [inv, setInv] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(() => {
    setRows(null);
    const req = tab === 'orders' ? fetchServiceOrders({}) : fetchServiceCharges({ status: tab });
    req.then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  // The same list calls the tabs make, once each, so every tile has a real
  // figure. A failure leaves the tiles blank rather than showing zero.
  const loadSummary = useCallback(() => {
    Promise.all([fetchServiceCharges({ status: 'pending' }), fetchServiceCharges({ status: 'approved' }), fetchServiceOrders({})])
      .then(([p, a, o]) => setSummary({ pending: p.data.data || [], approved: a.data.data || [], orders: o.data.data || [] }))
      .catch(() => setSummary(null));
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const act = async (key, fn) => {
    setBusy(key);
    try { const { data } = await fn(); toast.success(data.message); load(); loadSummary(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(null); }
  };

  // Search runs over the loaded tab: charge, customer, laptop, ticket; for orders the order and invoice numbers.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows || !q) return rows;
    return rows.filter((r) => (tab === 'orders'
      ? has(q, r.order_number, r.customer_name, r.invoice_number)
      : has(q, r.description, r.customer_name, r.asset_code, r.ticket_id && `#${r.ticket_id}`)));
  }, [rows, search, tab]);

  // Grouped from the searched rows for display; raising an order still takes
  // every approved charge of that customer (rows), never only the matches.
  const byCustomer = useMemo(() => {
    if (tab !== 'approved') return [];
    const m = new Map();
    for (const r of shown || []) {
      const g = m.get(r.customer_id) || { customer_id: r.customer_id, customer_name: r.customer_name, lines: [] };
      g.lines.push(r);
      m.set(r.customer_id, g);
    }
    return [...m.values()];
  }, [shown, tab]);

  const ordersIn = (status) => (summary ? summary.orders.filter((o) => o.status === status) : null);
  const awaiting = ordersIn('awaiting_invoice');
  const invoiced = ordersIn('invoiced');

  const laptopCol = {
    key: 'l', header: 'Laptop',
    render: (r) => (r.asset_code ? <Link to={`/carret/stock/assets/${enc(r.asset_code)}`}><DocNumber value={r.asset_code} /></Link> : '—'),
  };
  const chargeCols = [
    { key: 'd', header: 'Charge', render: (r) => r.description, sub: (r) => <Link to={`/carret/serve/tickets/${r.ticket_id}`}>Ticket #{r.ticket_id}</Link> },
    laptopCol,
    { key: 'c', header: 'Customer', render: (r) => r.customer_name, sub: (r) => (r.warranty_end_date ? `warranty ended ${String(r.warranty_end_date).slice(0, 10)}` : 'no warranty') },
    { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} />, sub: (r) => `+ ${r.gst_rate}% GST` },
    { key: 'w', header: 'Added', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.added_by_name },
    {
      key: 'x',
      header: '',
      render: (r) => (canEdit && r.status === 'pending' ? (
        <div className="c-row-actions">
          <Button variant="primary" disabled={busy === r.id} onClick={() => act(r.id, () => decideServiceCharge(r.id, { approve: true }))}>Approve</Button>
          <Button variant="quiet" onClick={() => setReject({ row: r, note: '' })}>Reject</Button>
        </div>
      ) : null),
    },
  ];

  const orderCols = [
    { key: 'n', header: 'Service order', render: (o) => <DocNumber value={o.order_number} />, sub: (o) => o.customer_name },
    { key: 'l', header: 'Lines', render: (o) => (o.lines || []).map((l) => l.description).join('; ') },
    { key: 'a', header: 'Total', numeric: true, render: (o) => <Money value={o.grand_total} />, sub: (o) => `${Number(o.subtotal).toLocaleString('en-IN')} + ${o.gst_type === 'inter' ? `IGST ${o.igst}` : `CGST ${o.cgst} + SGST ${o.sgst}`}` },
    {
      key: 's', header: 'Invoice',
      render: (o) => { const c = ORDER_CHIP[o.status] || { status: o.status }; return <StatusChip status={c.status} label={c.label} />; },
      sub: (o) => (o.invoice_number ? <>{o.invoice_number}{o.invoice_uploaded_at ? <> · <DateTime value={o.invoice_uploaded_at} /></> : null}</> : null),
    },
    {
      key: 'x',
      header: '',
      render: (o) => (
        <div className="c-row-actions">
          {canEdit && o.status === 'awaiting_invoice' && <Button variant="primary" onClick={() => setInv({ order: o, number: '', file: null })}>Attach invoice</Button>}
          {canEdit && o.status === 'awaiting_invoice' && <Button variant="quiet" disabled={busy === `c${o.id}`} onClick={() => setCancelling(o)}>Cancel</Button>}
          {o.invoice_pdf_path && (
            <Button
              variant="quiet"
              onClick={async () => {
                try {
                  const res = await api.get(serviceOrderInvoiceUrl(o.id), { responseType: 'blob' });
                  window.open(URL.createObjectURL(res.data), '_blank');
                } catch (e) { toast.error(errMsg(e)); }
              }}
            >
              Invoice
            </Button>
          )}
        </div>
      ),
    },
  ];

  const empty = (title) => (search
    ? <EmptyState title="Nothing matches the search" action={<Button variant="quiet" onClick={() => setSearch('')}>Clear search</Button>} />
    : <EmptyState title={title} />);
  const countLabel = !shown ? '…' : tab === 'orders'
    ? `${shown.length} order${shown.length === 1 ? '' : 's'}`
    : `${shown.length} charge${shown.length === 1 ? '' : 's'}${tab === 'approved' ? ` · ${byCustomer.length} customer${byCustomer.length === 1 ? '' : 's'}` : ''}`;

  return (
    <DeskShell
      title="Service Billing (gorefurbo)"
      breadcrumb="Finance"
      subtitle="Paid repairs on sold laptops out of warranty — approve, raise a service order, attach the Zoho invoice."
    >
      <div className="c-stack">
        <div className="c-tiles">
          <StatTile label="Charges to approve" value={summary ? summary.pending.length : null} delta={summary ? <Money value={sumOf(summary.pending, 'amount')} /> : null} />
          <StatTile label="Approved — to bill" value={summary ? summary.approved.length : null} delta={summary ? <Money value={sumOf(summary.approved, 'amount')} /> : null} family="moving" />
          <StatTile label="Orders awaiting invoice" value={awaiting ? awaiting.length : null} delta={awaiting ? <Money value={sumOf(awaiting, 'grand_total')} /> : null} />
          <StatTile label="Invoiced" value={invoiced ? invoiced.length : null} delta={invoiced ? <Money value={sumOf(invoiced, 'grand_total')} /> : null} family="earning" />
        </div>

        <Notice tone="info">
          Support adds the service charge and the charged parts on the ticket; approve them here, raise one service order per customer,
          make the invoice in Zoho and attach it to the order.
        </Notice>

        <Panel
          toolbar={(
            <>
              <Tabs
                tabs={TABS.map((t) => ({ ...t, count: summary && t.key !== 'rejected' ? (t.key === 'orders' ? summary.orders.length : summary[t.key].length) : null }))}
                value={tab}
                onChange={(v) => { setTab(v); setSearch(''); }}
              />
              <FilterBar
                filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: tab === 'orders' ? 'Order, customer or invoice' : 'Charge, customer, laptop or ticket' }]}
                values={{ search }}
                onChange={(k, v) => setSearch(v)}
                onClear={() => setSearch('')}
                count={countLabel}
              />
            </>
          )}
        >
          {shown === null ? <EmptyState title="Loading…" /> : tab === 'orders' ? (
            <DataTable columns={orderCols} rows={shown} rowKey={(o) => o.id} empty={empty('No service orders yet')} />
          ) : tab === 'approved' ? (
            byCustomer.length === 0 ? empty('Nothing approved to bill') : byCustomer.map((g) => (
              <div key={g.customer_id} className="c-listgroup">
                <div className="c-listgroup-h">
                  <span className="c-listgroup-t">
                    {g.customer_name}
                    <small>{g.lines.length} charge{g.lines.length === 1 ? '' : 's'} · <Money value={sumOf(g.lines, 'amount')} /> + GST</small>
                  </span>
                  {canCreate && (
                    <Button variant="primary" disabled={busy === `o${g.customer_id}`} onClick={() => act(`o${g.customer_id}`, () => raiseServiceOrder(g.customer_id, rows.filter((l) => l.customer_id === g.customer_id).map((l) => l.id)))}>
                      Raise service order
                    </Button>
                  )}
                </div>
                <DataTable columns={chargeCols.filter((c) => c.key !== 'c' && c.key !== 'x')} rows={g.lines} rowKey={(l) => l.id} />
              </div>
            ))
          ) : (
            <DataTable
              columns={tab === 'rejected' ? chargeCols.filter((c) => c.key !== 'x').concat([{ key: 'n', header: 'Why', render: (r) => r.decision_note }]) : chargeCols}
              rows={shown}
              rowKey={(r) => r.id}
              empty={empty(tab === 'pending' ? 'Nothing to approve' : 'Nothing here')}
            />
          )}
        </Panel>
      </div>

      <Drawer open={Boolean(reject)} onClose={() => setReject(null)} title="Reject charge" footer={<Button variant="primary" disabled={!reject || reject.note.trim().length < 3} onClick={async () => { if (await act(reject.row.id, () => decideServiceCharge(reject.row.id, { approve: false, note: reject.note.trim() }))) setReject(null); }}>Reject</Button>}>
        {reject && (
          <div className="c-stack">
            <p>{reject.row.description} — ₹{Number(reject.row.amount).toLocaleString('en-IN')}</p>
            <Field label="Why" required><Textarea rows={3} value={reject.note} onChange={(e) => setReject({ ...reject, note: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(inv)} onClose={() => setInv(null)} title={`Attach invoice — ${inv?.order?.order_number || ''}`} footer={<Button variant="primary" disabled={!inv || !inv.number.trim()} onClick={async () => { if (await act(`i${inv.order.id}`, () => attachServiceOrderInvoice(inv.order.id, inv.number.trim(), inv.file))) setInv(null); }}>Attach</Button>}>
        {inv && (
          <div className="c-stack">
            <p>{inv.order.customer_name} · ₹{Number(inv.order.grand_total).toLocaleString('en-IN')} incl. GST</p>
            <Field label="Zoho invoice number" required><Input value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} /></Field>
            <Field label="Invoice PDF" hint="PDF or image of the Zoho invoice"><Input type="file" accept="application/pdf,image/*" onChange={(e) => setInv({ ...inv, file: e.target.files?.[0] || null })} /></Field>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={() => act(`c${cancelling.id}`, () => cancelServiceOrder(cancelling.id))}
        title={`Cancel ${cancelling?.order_number || 'this service order'}?`}
        body="Its charges go back to To bill, so they can be put on a new service order."
        confirmLabel="Cancel order"
      />
    </DeskShell>
  );
}
