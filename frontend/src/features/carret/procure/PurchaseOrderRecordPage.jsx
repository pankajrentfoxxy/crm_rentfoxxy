import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, KeyValue, Money,
  Notice, Section, Tabs, Textarea,
} from '../../../components/carret';
import { LAPTOP_CONDITIONS } from '../../../constants/laptopConditions';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import {
  fetchGeneratedGrnOverview, fetchGrns, fetchPurchaseOrder, listPoActivities, patchPurchaseOrderStatus,
} from '../../vendor-management/vendorManagementApi';
import { isManagerUser } from '../../vendor-management/vendorMgmtUi';
import { errMsg } from './procureShared';
import {
  PO_BASE, isRentalType, isSuperAdmin, lineConfig, lineRate, openPoPdf, parseBillFiles, poBillInfo, poQty, poStatus, poTypeLabel,
} from './poShared';
import { LineSpecsDrawer, PoBillsSection, PoReplacementsSection } from './PoRecordParts';

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
const DRAFT_STATES = ['draft', 'pending', ''];
const conditionLabel = (c) => LAPTOP_CONDITIONS.find((x) => x.value === c)?.label || String(c).replace(/_/g, ' ');
const lineReceived = (l) => Number(l.receivedQty ?? l.received_qty) || 0;

export default function PurchaseOrderRecordPage() {
  const { poId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');
  const canDelete = hasPermission('vendor_management', 'delete');
  const manager = isManagerUser(user);
  const superAdmin = isSuperAdmin(user);

  const [state, setState] = useState({ loading: true, error: null, po: null });
  const [tab, setTab] = useState('lines');
  const [grns, setGrns] = useState(null);
  const [activity, setActivity] = useState(null);
  const [busy, setBusy] = useState('');
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState('');
  const [openDeliveries, setOpenDeliveries] = useState(null);
  const [grnStats, setGrnStats] = useState({});
  const [specLine, setSpecLine] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    fetchPurchaseOrder(poId)
      .then(({ data }) => setState({ loading: false, error: null, po: data.data }))
      .catch((e) => setState({ loading: false, error: errMsg(e, 'Could not load the purchase order.'), po: null }));
    fetchGrns(poId).then(({ data }) => setGrns(data.data || [])).catch(() => setGrns([]));
    // Units received per GRN (the plain GRN list has no counts).
    fetchGeneratedGrnOverview(poId)
      .then(({ data }) => setGrnStats(Object.fromEntries((data.data?.grn_rows || []).map((g) => [String(g.grn_id), g]))))
      .catch(() => setGrnStats({}));
    api.get('/vendor-management/deliveries', { params: { po_id: poId, status: 'arrived,receiving' } })
      .then(({ data }) => setOpenDeliveries(data.data || [])).catch(() => setOpenDeliveries([]));
  }, [poId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!['activity', 'details'].includes(tab) || activity !== null) return;
    listPoActivities(poId, { limit: 100 }).then(({ data }) => setActivity(data.activities || [])).catch(() => setActivity([]));
  }, [tab, poId, activity]);

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
  const deleteDraft = async () => {
    setBusy('delete');
    try {
      await api.delete(`${PO_BASE}/${poId}`);
      toast.success('Draft purchase order deleted');
      navigate('/carret/procure/purchase-orders');
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete the draft'));
    } finally {
      setBusy('');
    }
  };

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
      {canDelete && DRAFT_STATES.includes(st) && qty.received === 0 && (
        <Button variant="quiet" disabled={busy === 'delete'} onClick={() => setConfirmDelete(true)}>Delete draft</Button>
      )}
    </>
  );

  const flow = po && [
    { key: 'd', label: 'Draft', state: ['draft', 'pending', '', 'rejected', 'vendor_rejected'].includes(st) ? 'current' : 'done' },
    { key: 'a', label: 'Approval', state: st === 'pending_approval' ? 'current' : (['draft', 'pending', '', 'rejected', 'vendor_rejected'].includes(st) ? 'todo' : 'done') },
    { key: 'v', label: 'With vendor', state: ['approved', 'sent', 'vendor_accepted'].includes(st) ? 'current' : (['processing', 'completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'r', label: 'Receiving', sub: qty.ordered ? `${qty.received} / ${qty.ordered}` : undefined, state: st === 'processing' ? 'current' : (['completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'c', label: st === 'closed' ? 'Short-closed' : 'Received', state: ['completed', 'closed'].includes(st) ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  const rto = String(po?.purchase_order_type || '').toLowerCase() === 'rent_to_own';
  const lineCols = [
    {
      key: 'cfg',
      header: 'Laptop',
      render: (l) => lineConfig(l) || '—',
      sub: (l) => [
        Array.isArray(l.allowed_conditions) && l.allowed_conditions.length ? `accepts: ${l.allowed_conditions.map(conditionLabel).join(', ')}` : null,
        l.remarks || null,
      ].filter(Boolean).join(' · ') || null,
    },
    { key: 'qty', header: 'Ordered', numeric: true, render: (l) => l.quantity },
    {
      key: 'got',
      header: 'Received',
      numeric: true,
      render: (l) => {
        const got = lineReceived(l);
        const want = Number(l.quantity) || 0;
        return <span style={{ color: got >= want ? 'var(--alert-good)' : got ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{got}</span>;
      },
    },
    { key: 'rem', header: 'Remaining', numeric: true, render: (l) => Math.max(0, (Number(l.quantity) || 0) - lineReceived(l)) },
    {
      key: 'rate',
      header: rental ? 'Rent / month' : 'Price',
      numeric: true,
      render: (l) => (
        <>
          <Money value={lineRate(l, po?.purchase_order_type)} />
          {rental && Number(l.asset_value) > 0 && <span className="block text-ink-3" style={{ fontSize: '12.5px' }}>asset <Money value={l.asset_value} /></span>}
        </>
      ),
    },
    rental
      ? { key: 'm', header: 'Lock-in', render: (l) => (l.vendor_locking_period ? `${l.vendor_locking_period} months` : '—') }
      : { key: 'w', header: 'Warranty', render: (l) => (l.warranty ? `${l.warranty} months` : '—') },
    ...((rto || lines.some((l) => l.tenure_months != null && l.tenure_months !== ''))
      ? [{ key: 't', header: 'Tenure', render: (l) => (l.tenure_months != null && l.tenure_months !== '' ? `${l.tenure_months} months` : '—') }]
      : []),
    { key: 'amt', header: 'Amount', numeric: true, render: (l) => <Money value={(Number(l.quantity) || 0) * lineRate(l, po?.purchase_order_type)} /> },
    ...(superAdmin ? [{
      key: 'spec',
      header: '',
      align: 'right',
      render: (_l, i) => <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setSpecLine(i); }}>Fix specs</Button>,
    }] : []),
  ];

  // Who approved / sent it back: the PO row only keeps who raised it, the activity log keeps the decision.
  const decision = (activity || []).find((a) => ['approved', 'rejected'].includes(a.action)) || null;

  const gst = po ? Number(po.total_amount || 0) - Number(po.sub_total_amount || 0) : 0;

  return (
    <DeskShell title={po?.purchase_order_number || 'Purchase order'} breadcrumb="Procurement / Purchase orders" subtitle={po?.vendor_display_name}>
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
              { key: 'bill', label: 'Bill', count: poBillInfo(po).files.length || undefined },
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
          {tab === 'lines' && <PoReplacementsSection replacements={po.replacements} />}

          {tab === 'bill' && (
            <PoBillsSection po={po} canUpload={canEdit} canRemove={canDelete && superAdmin} onChanged={() => { setActivity(null); load(); }} />
          )}

          {tab === 'grns' && (
            <Section title="Receipts against this PO">
              {grns === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={[
                    { key: 'no', header: 'GRN', render: (g) => <DocNumber value={g.grn_number || grnStats[String(g.grn_id)]?.grn_number || `GRN-${g.grn_id}`} /> },
                    { key: 'when', header: 'Received', render: (g) => <DateTime value={g.created_at} /> },
                    {
                      key: 'units',
                      header: 'Laptops',
                      numeric: true,
                      render: (g) => {
                        const s2 = grnStats[String(g.grn_id)];
                        return s2 ? (Number(s2.received_qty) || 0) : '—';
                      },
                      sub: (g) => (Number(grnStats[String(g.grn_id)]?.replacement_qty) > 0 ? `+${grnStats[String(g.grn_id)].replacement_qty} replacement` : null),
                    },
                    { key: 'dl', header: 'Delivery', render: (g) => g.meta?.delivery_number || (g.delivery_id ? `#${g.delivery_id}` : <span className="text-ink-3">before gate logging</span>), sub: (g) => g.vendor_challan_no || g.meta?.vendor_challan_no || null },
                    {
                      key: 'bill',
                      header: 'Bill',
                      render: (g) => {
                        const received = String(g.bill_status || '').toLowerCase() === 'received' || Boolean(g.bill_name);
                        return received ? (g.bill_name || g.vendor_invoice_no || 'Received') : <span className="text-ink-3">{g.vendor_invoice_no || 'pending'}</span>;
                      },
                      sub: (g) => {
                        const n = parseBillFiles(g.bill_files).length;
                        return n ? `${n} file${n === 1 ? '' : 's'}` : null;
                      },
                    },
                  ]}
                  rows={grns}
                  rowKey={(g) => g.grn_id}
                  onRowClick={(g) => navigate(`/carret/procure/purchase-orders/${poId}/grns/${g.grn_id}`)}
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
                { label: 'Vendor address', value: po.vendor_address },
                { label: 'Vendor state', value: po.vendor_state ? String(po.vendor_state).replace(/_/g, ' ') : null },
                { label: 'Deliver to (state)', value: String(po.po_state || '').replace(/_/g, ' ') },
                { label: 'GST', value: po.is_same_state ? 'CGST + SGST (same state)' : 'IGST (other state)' },
                { label: 'Created', value: po.created_at ? <DateTime value={po.created_at} /> : null },
                { label: 'Submitted', value: po.submitted_at ? <DateTime value={po.submitted_at} /> : null },
                { label: 'Approved', value: po.approved_at ? <DateTime value={po.approved_at} /> : null },
                { label: 'Raised by', value: po.status_updated_by_name },
                decision && {
                  label: decision.action === 'approved' ? 'Approved by' : 'Sent back by',
                  value: <>{decision.created_by_name || 'someone'} · <DateTime value={decision.created_at} /></>,
                },
                { label: 'Sent to vendor', value: po.sent_to_vendor_at ? <DateTime value={po.sent_to_vendor_at} /> : null },
                Number(po.amendment_no) > 0 && { label: `Amended (no. ${po.amendment_no})`, value: po.amended_at ? <DateTime value={po.amended_at} /> : 'yes' },
                po.cancelled_at && { label: 'Cancelled', value: <DateTime value={po.cancelled_at} /> },
                po.closed_at && { label: 'Short-closed', value: <DateTime value={po.closed_at} /> },
                { label: 'Vendor invoice', value: po.vendor_invoice_number },
                { label: 'Bill', value: poBillInfo(po).name },
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

      {po && superAdmin && (
        <LineSpecsDrawer
          po={po}
          lineIndex={specLine}
          onClose={() => setSpecLine(null)}
          onSaved={() => { setActivity(null); load(); }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteDraft}
        title={`Delete draft ${po?.purchase_order_number || ''}?`}
        body="The draft is removed from the purchase order list. Use this only for a PO that should never have been raised."
        confirmLabel="Delete draft"
      />
    </DeskShell>
  );
}

