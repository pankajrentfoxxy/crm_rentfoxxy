import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, KeyValue, Money,
  Notice, Section, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  fetchGrns, fetchPurchaseOrder, listPoActivities, patchPurchaseOrderStatus,
} from '../../vendor-management/vendorManagementApi';
import { isManagerUser } from '../../vendor-management/vendorMgmtUi';
import { errMsg } from './procureShared';
import {
  PO_BASE, isRentalType, lineConfig, openPoPdf, poQty, poStatus, poTypeLabel,
} from './poShared';

/**
 * Procure → Purchase order record.
 *
 * The next step leads: submit a draft, approve (someone other than the
 * person who raised it — D1), wait for the vendor, receive. Changing an
 * approved PO is an AMENDMENT that goes back for approval; a PO with nothing
 * received can be CANCELLED; a part-received one is SHORT-CLOSED (D2).
 */
const OPEN_STATES = ['approved', 'sent', 'vendor_accepted', 'processing'];
const REASON_ACTIONS = {
  reject: { title: 'Send back to the person who raised it', label: 'Send back', hint: 'Say what needs to change. They edit it and send it again.' },
  amend: { title: 'Amend this purchase order', label: 'Start amendment', hint: 'It goes back to draft. After editing it needs approval again, and the vendor is sent the amended PO.' },
  cancel: { title: 'Cancel this purchase order', label: 'Cancel PO', hint: 'Nothing has been received on it. Orders waiting on it go back to “no PO yet” on the To-buy list.' },
  close: { title: 'Short-close this purchase order', label: 'Short-close', hint: 'What was received stays. No more laptops will be received on this PO.' },
};

export default function PurchaseOrderRecordPage() {
  const { poId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');
  const manager = isManagerUser(user);

  const [state, setState] = useState({ loading: true, error: null, po: null });
  const [tab, setTab] = useState('lines');
  const [grns, setGrns] = useState(null);
  const [activity, setActivity] = useState(null);
  const [busy, setBusy] = useState('');
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState('');
  const [openDeliveries, setOpenDeliveries] = useState(null);

  const load = useCallback(() => {
    fetchPurchaseOrder(poId)
      .then(({ data }) => setState({ loading: false, error: null, po: data.data }))
      .catch((e) => setState({ loading: false, error: errMsg(e, 'Could not load the purchase order.'), po: null }));
    fetchGrns(poId).then(({ data }) => setGrns(data.data || [])).catch(() => setGrns([]));
    api.get('/vendor-management/deliveries', { params: { po_id: poId, status: 'arrived,receiving' } })
      .then(({ data }) => setOpenDeliveries(data.data || [])).catch(() => setOpenDeliveries([]));
  }, [poId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== 'activity') return;
    listPoActivities(poId, { limit: 100 }).then(({ data }) => setActivity(data.activities || [])).catch(() => setActivity([]));
  }, [tab, poId]);

  const po = state.po;
  const st = poStatus(po);
  const rental = isRentalType(po?.purchase_order_type);
  const qty = poQty(po);
  const lines = po?.line_items || [];

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); setActivity(null); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(''); }
  };
  const submit = () => run('submit', () => patchPurchaseOrderStatus(poId, 'pending_approval'), 'Sent for approval');
  const approve = () => run('approve', () => patchPurchaseOrderStatus(poId, 'approved'), 'Approved — the PO is emailed to the vendor');
  const pdf = () => run('pdf', () => openPoPdf(poId));

  const confirmReason = async () => {
    const r = reason.trim();
    if (r.length < 3) { toast.error('Give a reason'); return; }
    const k = reasonFor;
    const ok = await run(k, () => {
      if (k === 'reject') return patchPurchaseOrderStatus(poId, 'rejected', { rejection_reason: r });
      const path = { amend: 'amend', cancel: 'cancel', close: 'short-close' }[k];
      return api.post(`${PO_BASE}/${poId}/${path}`, { reason: r });
    }, { reject: 'Sent back', amend: 'Amendment started — edit the PO, then send it for approval', cancel: 'Purchase order cancelled', close: 'Purchase order short-closed' }[k]);
    if (ok) {
      setReasonFor(null); setReason('');
      if (k === 'amend') navigate(`/carret/procure/purchase-orders/${poId}/edit`);
    }
  };

  // The one thing to do next.
  let next = null;
  if (po) {
    if (['draft', 'pending', ''].includes(st)) {
      next = <Notice tone="info" title={Number(po.amendment_no) > 0 ? `Amendment ${po.amendment_no} — draft` : 'Draft'} action={canEdit && <Button variant="primary" disabled={busy === 'submit'} onClick={submit}>Send for approval</Button>}>{po.amend_reason && Number(po.amendment_no) > 0 ? `Why: ${po.amend_reason}. ` : ''}Check the lines and prices, then send it to a manager to approve.</Notice>;
    } else if (st === 'pending_approval') {
      next = (
        <Notice
          tone="warn"
          title="Waiting for a manager’s approval"
          action={manager && canEdit && (
            <div className="flex" style={{ gap: '8px' }}>
              <Button variant="primary" disabled={busy === 'approve'} onClick={approve}>Approve and send to vendor</Button>
              <Button onClick={() => setReasonFor('reject')}>Send back</Button>
            </div>
          )}
        >
          Someone other than the person who raised it must approve it. Approving emails the PO to {po.vendor_display_name || 'the vendor'}.
        </Notice>
      );
    } else if (st === 'rejected' || st === 'vendor_rejected') {
      next = <Notice tone="serious" title={st === 'rejected' ? 'Sent back by the approver' : 'The vendor declined it'} action={canEdit && <Button variant="primary" onClick={() => navigate(`/carret/procure/purchase-orders/${poId}/edit`)}>Edit and resend</Button>}>{po.rejection_reason || 'No reason recorded.'}</Notice>;
    } else if (['approved', 'sent', 'vendor_accepted'].includes(st)) {
      next = (
        <Notice tone={st === 'vendor_accepted' ? 'good' : 'info'} title={st === 'vendor_accepted' ? 'The vendor accepted — waiting for delivery' : 'With the vendor'}>
          {po.sent_to_vendor_at ? <>Emailed <DateTime value={po.sent_to_vendor_at} />. </> : 'The email to the vendor has not gone yet — send the PDF yourself if needed. '}
          {po.expected_delivery_date ? <>Due <DateTime value={po.expected_delivery_date} />. </> : ''}
          When the laptops arrive, the guard logs them under Vendor arrivals and the warehouse receives them there.
        </Notice>
      );
    } else if (st === 'processing') {
      next = <Notice tone="info" title={`Receiving — ${qty.received} of ${qty.ordered} in`}>If the vendor will not send the rest, a manager can short-close the PO.</Notice>;
    } else if (st === 'completed') {
      next = <Notice tone="good" title="Fully received">{qty.received} of {qty.ordered} laptops received.</Notice>;
    } else if (st === 'closed') {
      next = <Notice tone="info" title={`Short-closed with ${qty.received} of ${qty.ordered} received`}>{po.close_reason}</Notice>;
    } else if (st === 'cancelled') {
      next = <Notice tone="serious" title="Cancelled">{po.cancel_reason || ''}</Notice>;
    }
  }

  const canCancel = canEdit && po && !['cancelled', 'completed', 'closed', 'processing'].includes(st) && qty.received === 0 && (!OPEN_STATES.includes(st) || manager);
  const actions = po && (
    <>
      <Button onClick={pdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'Opening…' : 'PDF'}</Button>
      {canEdit && ['draft', 'pending', 'rejected', 'vendor_rejected', ''].includes(st) && <Button onClick={() => navigate(`/carret/procure/purchase-orders/${poId}/edit`)}>Edit</Button>}
      {canEdit && OPEN_STATES.includes(st) && qty.received === 0 && <Button onClick={() => setReasonFor('amend')}>Amend</Button>}
      {canEdit && OPEN_STATES.includes(st) && (openDeliveries || []).map((dv) => (
        <Button key={dv.delivery_id} variant="primary" onClick={() => navigate(`/carret/procure/arrivals/${dv.delivery_id}`)}>Receive {dv.delivery_number}</Button>
      ))}
      {canEdit && OPEN_STATES.includes(st) && openDeliveries && !openDeliveries.length && (
        <Button variant="quiet" onClick={() => navigate(`/carret/procure/arrivals?po=${poId}`)}>Log an arrival</Button>
      )}
      {manager && canEdit && OPEN_STATES.includes(st) && qty.received > 0 && <Button variant="quiet" onClick={() => setReasonFor('close')}>Short-close</Button>}
      {canCancel && <Button variant="quiet" onClick={() => setReasonFor('cancel')}>Cancel PO</Button>}
    </>
  );

  const flow = po && [
    { key: 'd', label: 'Draft', state: ['draft', 'pending', '', 'rejected', 'vendor_rejected'].includes(st) ? 'current' : 'done' },
    { key: 'a', label: 'Approval', state: st === 'pending_approval' ? 'current' : (['draft', 'pending', '', 'rejected', 'vendor_rejected'].includes(st) ? 'todo' : 'done') },
    { key: 'v', label: 'With vendor', state: ['approved', 'sent', 'vendor_accepted'].includes(st) ? 'current' : (['processing', 'completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'r', label: 'Receiving', sub: qty.ordered ? `${qty.received} / ${qty.ordered}` : undefined, state: st === 'processing' ? 'current' : (['completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'c', label: st === 'closed' ? 'Short-closed' : 'Received', state: ['completed', 'closed'].includes(st) ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  const lineCols = [
    { key: 'cfg', header: 'Laptop', render: (l) => lineConfig(l) || '—', sub: (l) => l.remarks || null },
    { key: 'qty', header: 'Ordered', numeric: true, render: (l) => l.quantity },
    {
      key: 'got',
      header: 'Received',
      numeric: true,
      render: (l) => {
        const got = Number(l.receivedQty) || 0;
        const want = Number(l.quantity) || 0;
        return <span style={{ color: got >= want ? 'var(--alert-good)' : got ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{got}</span>;
      },
    },
    { key: 'rate', header: rental ? 'Rent / month' : 'Price', numeric: true, render: (l) => <Money value={l.rate} /> },
    rental
      ? { key: 'm', header: 'Lock-in', render: (l) => (l.vendor_locking_period ? `${l.vendor_locking_period} months` : '—'), sub: (l) => (l.asset_value ? <>asset <Money value={l.asset_value} /></> : null) }
      : { key: 'w', header: 'Warranty', render: (l) => (l.warranty ? `${l.warranty} months` : '—') },
    { key: 'amt', header: 'Amount', numeric: true, render: (l) => <Money value={(Number(l.quantity) || 0) * (Number(l.rate) || 0)} /> },
  ];

  const gst = po ? Number(po.total_amount || 0) - Number(po.sub_total_amount || 0) : 0;

  return (
    <DeskShell title={po?.purchase_order_number || 'Purchase order'} breadcrumb="Procure / Purchase orders" subtitle={po?.vendor_display_name}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this purchase order" body={state.error} action={<Button onClick={() => navigate('/carret/procure/purchase-orders')}>Back to purchase orders</Button>} />}
      {po && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={po.purchase_order_number}
            type={`Purchase order · ${poTypeLabel(po.purchase_order_type)}${Number(po.amendment_no) > 0 ? ` · amendment ${po.amendment_no}` : ''}`}
            status={st}
            actions={actions}
            meta={[
              { label: 'Vendor', value: po.vendor_display_name },
              { label: 'Date', value: <DateTime value={po.purchase_order_date} /> },
              { label: 'Deliver by', value: po.expected_delivery_date ? <DateTime value={po.expected_delivery_date} /> : '—' },
              { label: rental ? 'Total per month' : 'Total', value: <Money value={po.total_amount} /> },
              { label: 'Received', value: `${qty.received} / ${qty.ordered}` },
            ]}
          />
          <FlowSteps steps={flow} />
          {next}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'lines', label: 'Laptops', count: qty.ordered },
              { key: 'grns', label: 'Receipts (GRN)', count: grns ? grns.length : undefined },
              { key: 'details', label: 'Details' },
              { key: 'activity', label: 'Activity' },
            ]}
          />

          {tab === 'lines' && (
            <Section title="What was ordered">
              <DataTable columns={lineCols} rows={lines} rowKey={(l, i) => l.product_detail_id || i} />
              <div className="c-stack" style={{ gap: '4px', textAlign: 'right', marginTop: '12px' }}>
                <div>{rental ? 'Rent per month' : 'Subtotal'} <Money value={po.sub_total_amount} /></div>
                {po.is_same_state
                  ? <div className="text-ink-3">CGST 9% <Money value={gst / 2} /> · SGST 9% <Money value={gst / 2} /></div>
                  : <div className="text-ink-3">IGST 18% <Money value={gst} /></div>}
                <div><strong>{rental ? 'Total per month' : 'Total'} <Money value={po.total_amount} /></strong></div>
              </div>
            </Section>
          )}

          {tab === 'grns' && (
            <Section title="Receipts against this PO">
              {grns === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={[
                    { key: 'no', header: 'GRN', render: (g) => <DocNumber value={g.grn_number || `GRN-${g.grn_id}`} /> },
                    { key: 'when', header: 'Received', render: (g) => <DateTime value={g.created_at} /> },
                    { key: 'dl', header: 'Delivery', render: (g) => g.meta?.delivery_number || (g.delivery_id ? `#${g.delivery_id}` : <span className="text-ink-3">before gate logging</span>), sub: (g) => g.vendor_challan_no || null },
                    { key: 'bill', header: 'Vendor invoice', render: (g) => g.vendor_invoice_no || g.bill_name || <span className="text-ink-3">not given</span> },
                  ]}
                  rows={grns}
                  rowKey={(g) => g.grn_id}
                  onRowClick={(g) => navigate(g.delivery_id ? `/carret/procure/arrivals/${g.delivery_id}` : `/vendor-management/purchase-orders/${poId}/grn-detail`)}
                  empty={<EmptyState title="Nothing received yet" />}
                />
              )}
            </Section>
          )}

          {tab === 'details' && (
            <Section title="Details">
              <KeyValue items={[
                { label: 'Vendor', value: po.vendor_display_name },
                { label: 'Vendor email', value: po.vendor_email },
                { label: 'Vendor phone', value: po.vendor_phone },
                { label: 'Deliver to (state)', value: String(po.po_state || '').replace(/_/g, ' ') },
                { label: 'GST', value: po.is_same_state ? 'CGST + SGST (same state)' : 'IGST (other state)' },
                { label: 'Submitted', value: po.submitted_at ? <DateTime value={po.submitted_at} /> : null },
                { label: 'Approved', value: po.approved_at ? <DateTime value={po.approved_at} /> : null },
                { label: 'Sent to vendor', value: po.sent_to_vendor_at ? <DateTime value={po.sent_to_vendor_at} /> : null },
                { label: 'Vendor invoice', value: po.vendor_invoice_number },
                { label: 'Terms / remarks', value: po.remarks },
              ]}
              />
            </Section>
          )}

          {tab === 'activity' && (
            <Section title="Activity">
              {activity === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={[
                    { key: 'when', header: 'When', render: (a) => <DateTime value={a.created_at} /> },
                    { key: 'what', header: 'What', render: (a) => a.title || a.action, sub: (a) => a.remarks || a.description || null },
                    { key: 'who', header: 'Who', render: (a) => a.created_by_name || 'system' },
                  ]}
                  rows={activity}
                  rowKey={(a) => a.id}
                  empty={<EmptyState title="Nothing recorded yet" />}
                />
              )}
            </Section>
          )}
        </div>
      )}

      <Drawer
        open={Boolean(reasonFor)}
        onClose={() => { setReasonFor(null); setReason(''); }}
        title={REASON_ACTIONS[reasonFor]?.title}
        footer={<Button variant="primary" disabled={Boolean(busy)} onClick={confirmReason}>{busy ? 'Saving…' : REASON_ACTIONS[reasonFor]?.label}</Button>}
      >
        <p className="text-ink-2" style={{ marginBottom: '12px' }}>{REASON_ACTIONS[reasonFor]?.hint}</p>
        <Field label="Reason" required hint="Recorded on the PO’s activity">
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Drawer>
    </DeskShell>
  );
}

