import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Section, Segmented, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  attachServiceOrderInvoice, cancelServiceOrder, decideServiceCharge, fetchServiceCharges, fetchServiceOrders,
  raiseServiceOrder, serviceOrderInvoiceUrl,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Money → Service billing (gorefurbo) — claude/carret-lockin-warranty.md, W2.
 * Charges on SOLD laptops (out-of-warranty parts and service / labour) that
 * Support raised: Accounts approve them, raise one service order (SVO) per
 * customer, make the invoice in Zoho and attach it here — like an in-place sale.
 */
export default function ServiceBillingPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('customer_billing', 'edit');
  const canCreate = hasPermission('customer_billing', 'create');
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reject, setReject] = useState(null);
  const [inv, setInv] = useState(null);

  const load = useCallback(() => {
    setRows(null);
    const req = tab === 'orders' ? fetchServiceOrders({}) : fetchServiceCharges({ status: tab });
    req.then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn) => {
    setBusy(key);
    try { const { data } = await fn(); toast.success(data.message); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(null); }
  };

  const byCustomer = useMemo(() => {
    if (tab !== 'approved') return [];
    const m = new Map();
    for (const r of rows || []) {
      const g = m.get(r.customer_id) || { customer_id: r.customer_id, customer_name: r.customer_name, lines: [] };
      g.lines.push(r);
      m.set(r.customer_id, g);
    }
    return [...m.values()];
  }, [rows, tab]);

  const chargeCols = [
    { key: 'd', header: 'Charge', render: (r) => r.description, sub: (r) => <Link to={`/carret/serve/tickets/${r.ticket_id}`}>Ticket #{r.ticket_id}</Link> },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name, sub: (r) => (r.warranty_end_date ? `warranty ended ${String(r.warranty_end_date).slice(0, 10)}` : 'no warranty') },
    { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} />, sub: (r) => `+ ${r.gst_rate}% GST` },
    { key: 'w', header: 'Added', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.added_by_name },
    {
      key: 'x',
      header: '',
      render: (r) => (canEdit && r.status === 'pending' ? (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
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
    { key: 's', header: 'Invoice', render: (o) => (o.invoice_number || (o.status === 'cancelled' ? 'Cancelled' : 'Awaiting invoice')), sub: (o) => (o.invoice_uploaded_at ? <DateTime value={o.invoice_uploaded_at} /> : null) },
    {
      key: 'x',
      header: '',
      render: (o) => (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          {canEdit && o.status === 'awaiting_invoice' && <Button variant="primary" onClick={() => setInv({ order: o, number: '', file: null })}>Attach invoice</Button>}
          {canEdit && o.status === 'awaiting_invoice' && <Button variant="quiet" disabled={busy === `c${o.id}`} onClick={() => act(`c${o.id}`, () => cancelServiceOrder(o.id))}>Cancel</Button>}
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

  return (
    <DeskShell title="Service billing (gorefurbo)" breadcrumb="Finance">
      <div className="c-stack">
        <Notice tone="info">
          Sold laptops out of warranty get paid repair only. Support adds the service charge and the charged parts on the ticket;
          approve them here, raise one service order per customer, make the invoice in Zoho and attach it to the order.
        </Notice>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: 'To approve' }, { value: 'approved', label: 'To bill' }, { value: 'orders', label: 'Service orders' }, { value: 'rejected', label: 'Rejected' },
          ]}
        />
        {rows === null ? <EmptyState title="Loading…" /> : tab === 'orders' ? (
          <DataTable columns={orderCols} rows={rows} rowKey={(o) => o.id} empty={<EmptyState title="No service orders yet" />} />
        ) : tab === 'approved' ? (
          byCustomer.length === 0 ? <EmptyState title="Nothing approved to bill" /> : byCustomer.map((g) => {
            const sub = g.lines.reduce((s, l) => s + Number(l.amount), 0);
            return (
              <Section
                key={g.customer_id}
                title={`${g.customer_name} · ${g.lines.length} · ₹${sub.toLocaleString('en-IN')} + GST`}
                actions={canCreate && (
                  <Button variant="primary" disabled={busy === `o${g.customer_id}`} onClick={() => act(`o${g.customer_id}`, () => raiseServiceOrder(g.customer_id, g.lines.map((l) => l.id)))}>
                    Raise service order
                  </Button>
                )}
              >
                <DataTable columns={chargeCols.filter((c) => c.key !== 'c' && c.key !== 'x')} rows={g.lines} rowKey={(l) => l.id} />
              </Section>
            );
          })
        ) : (
          <DataTable columns={tab === 'rejected' ? chargeCols.filter((c) => c.key !== 'x').concat([{ key: 'n', header: 'Why', render: (r) => r.decision_note }]) : chargeCols} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title="Nothing here" />} />
        )}
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
            <Field label="Invoice PDF"><input type="file" accept="application/pdf,image/*" onChange={(e) => setInv({ ...inv, file: e.target.files?.[0] || null })} /></Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
