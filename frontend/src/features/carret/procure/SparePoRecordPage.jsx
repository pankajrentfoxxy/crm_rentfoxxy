import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, KeyValue, Money, Notice, Section, Textarea,
} from '../../../components/carret';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { fetchSparePartsOrder } from '../../vendor-management/vendorManagementApi';
import { isManagerUser } from '../../vendor-management/vendorMgmtUi';
import { errMsg } from './procureShared';
import { SPO_BASE, poQty, poStatus, spareLineName } from './poShared';

/**
 * Procure → Spare-parts order record. Same flow and rules as a laptop PO
 * (D13): draft → waiting approval (a manager other than the person who raised
 * it) → with vendor → receiving → received; cancel or short-close with a
 * reason. Receiving still happens on the parts receive screen.
 *
 * No "Amend" here yet: spare orders have no edit form (the parts order form
 * only creates), so an amendment would be stuck in draft. To change an
 * approved order with nothing received, cancel it and raise a new one.
 */
const OPEN = ['approved', 'processing'];
const ACTIONS = {
  reject: { title: 'Send back', label: 'Send back', hint: 'Say what needs to change.' },
  cancel: { title: 'Cancel this order', label: 'Cancel order', hint: 'Nothing has been received. Part requests waiting on it go back to “no order yet”.' },
  close: { title: 'Short-close this order', label: 'Short-close', hint: 'What was received stays; nothing more will be received on it.' },
};

export default function SparePoRecordPage() {
  const { spoId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const canEdit = ['vendor_management', 'parts_procurement'].some((s) => hasPermission(s, 'edit'));
  const manager = isManagerUser(user);

  const [state, setState] = useState({ loading: true, error: null, po: null });
  const [busy, setBusy] = useState('');
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    fetchSparePartsOrder(spoId)
      .then(({ data }) => setState({ loading: false, error: null, po: data.data }))
      .catch((e) => setState({ loading: false, error: errMsg(e, 'Could not load the order.'), po: null }));
  }, [spoId]);
  useEffect(() => { load(); }, [load]);

  const po = state.po;
  const st = poStatus(po);
  const qty = poQty(po);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(''); }
  };
  const setStatus = (to, ok, extra = {}) => run(to, () => api.patch(`${SPO_BASE}/${spoId}/status`, { status: to, ...extra }), ok);
  const confirmReason = async () => {
    const r = reason.trim();
    if (r.length < 3) { toast.error('Give a reason'); return; }
    const k = reasonFor;
    const ok = k === 'reject'
      ? await setStatus('rejected', 'Sent back', { rejection_reason: r })
      : await run(k, () => api.post(`${SPO_BASE}/${spoId}/${{ cancel: 'cancel', close: 'short-close' }[k]}`, { reason: r }),
        { cancel: 'Order cancelled', close: 'Order short-closed' }[k]);
    if (ok) { setReasonFor(null); setReason(''); }
  };

  let next = null;
  if (po) {
    if (['draft', ''].includes(st)) next = <Notice tone="info" title={Number(po.amendment_no) > 0 ? `Amendment ${po.amendment_no} — draft` : 'Draft'} action={canEdit && <Button variant="primary" disabled={Boolean(busy)} onClick={() => setStatus('pending', 'Sent for approval')}>Send for approval</Button>}>{po.amend_reason ? `Why: ${po.amend_reason}. ` : ''}Send it to a manager to approve.</Notice>;
    else if (st === 'pending') {
      next = (
        <Notice tone="warn" title="Waiting for a manager’s approval" action={manager && canEdit && (
          <div className="flex" style={{ gap: '8px' }}>
            <Button variant="primary" disabled={Boolean(busy)} onClick={() => setStatus('approved', 'Approved')}>Approve</Button>
            <Button onClick={() => setReasonFor('reject')}>Send back</Button>
          </div>
        )}
        >
          Someone other than the person who raised it must approve it.
        </Notice>
      );
    } else if (st === 'rejected') next = <Notice tone="serious" title="Sent back">{po.rejection_reason || 'No reason recorded.'}</Notice>;
    else if (st === 'approved') next = <Notice tone="info" title="With the vendor">Receive the parts on the parts receive screen when they arrive.</Notice>;
    else if (st === 'processing') next = <Notice tone="info" title={`Receiving — ${qty.received} of ${qty.ordered} in`}>If nothing more is coming, a manager can short-close it.</Notice>;
    else if (st === 'completed') next = <Notice tone="good" title="Fully received" />;
    else if (st === 'closed') next = <Notice tone="info" title={`Short-closed with ${qty.received} of ${qty.ordered} received`}>{po.close_reason}</Notice>;
    else if (st === 'cancelled') next = <Notice tone="serious" title="Cancelled">{po.cancel_reason}</Notice>;
  }

  const actions = po && (
    <>
      {canEdit && OPEN.includes(st) && <Button onClick={() => navigate(`/vendor-management/spare-parts-po/${spoId}/receive`)}>Receive parts</Button>}
      {manager && canEdit && OPEN.includes(st) && qty.received > 0 && <Button variant="quiet" onClick={() => setReasonFor('close')}>Short-close</Button>}
      {canEdit && !['cancelled', 'completed', 'closed', 'processing'].includes(st) && qty.received === 0 && (!OPEN.includes(st) || manager) && (
        <Button variant="quiet" onClick={() => setReasonFor('cancel')}>Cancel order</Button>
      )}
    </>
  );

  const before = ['draft', '', 'rejected'].includes(st);
  const flow = po && [
    { key: 'd', label: 'Draft', state: before ? 'current' : 'done' },
    { key: 'a', label: 'Approval', state: st === 'pending' ? 'current' : (before ? 'todo' : 'done') },
    { key: 'v', label: 'With vendor', state: st === 'approved' ? 'current' : (['processing', 'completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'r', label: 'Receiving', sub: qty.ordered ? `${qty.received} / ${qty.ordered}` : undefined, state: st === 'processing' ? 'current' : (['completed', 'closed'].includes(st) ? 'done' : 'todo') },
    { key: 'c', label: st === 'closed' ? 'Short-closed' : 'Received', state: ['completed', 'closed'].includes(st) ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  return (
    <DeskShell title={po?.purchase_order_number || 'Spare-parts order'} breadcrumb="Procure / Spare-parts orders" subtitle={po?.vendor_display_name}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this order" body={state.error} action={<Button onClick={() => navigate('/carret/procure/spare-parts-orders')}>Back</Button>} />}
      {po && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={po.purchase_order_number}
            type={`Spare-parts order${Number(po.amendment_no) > 0 ? ` · amendment ${po.amendment_no}` : ''}`}
            status={st === 'pending' ? 'pending_approval' : st}
            actions={actions}
            meta={[
              { label: 'Vendor', value: po.vendor_display_name },
              { label: 'Date', value: <DateTime value={po.purchase_order_date} /> },
              { label: 'Total', value: <Money value={po.total_amount} /> },
              { label: 'Received', value: `${qty.received} / ${qty.ordered}` },
            ]}
          />
          <FlowSteps steps={flow} />
          {next}
          <Section title="Parts ordered">
            <DataTable
              rows={po.line_items || []}
              rowKey={(l, i) => i}
              columns={[
                { key: 'p', header: 'Part', render: (l) => spareLineName(l) || '—', sub: (l) => l.category_label || l.category || null },
                { key: 'q', header: 'Ordered', numeric: true, render: (l) => l.quantity },
                { key: 'g', header: 'Received', numeric: true, render: (l) => Number(l.receivedQty) || 0 },
                { key: 'r', header: 'Rate', numeric: true, render: (l) => <Money value={l.rate} /> },
                { key: 'w', header: 'Warranty', render: (l) => (l.warranty_months ? `${l.warranty_months} months` : '—') },
                { key: 'a', header: 'Amount', numeric: true, render: (l) => <Money value={(Number(l.quantity) || 0) * (Number(l.rate) || 0)} /> },
              ]}
            />
            <div style={{ textAlign: 'right', marginTop: '12px' }}>
              Subtotal <Money value={po.sub_total_amount} /> · {po.is_same_state ? 'CGST + SGST' : 'IGST'} · <strong>Total <Money value={po.total_amount} /></strong>
            </div>
          </Section>
          <Section title="Details">
            <KeyValue items={[
              { label: 'Deliver to (state)', value: String(po.po_state || '').replace(/_/g, ' ') },
              { label: 'Vendor bill', value: po.bill_name },
              { label: 'Remarks', value: po.remarks },
            ]}
            />
          </Section>
        </div>
      )}
      <Drawer
        open={Boolean(reasonFor)}
        onClose={() => { setReasonFor(null); setReason(''); }}
        title={ACTIONS[reasonFor]?.title}
        footer={<Button variant="primary" disabled={Boolean(busy)} onClick={confirmReason}>{busy ? 'Saving…' : ACTIONS[reasonFor]?.label}</Button>}
      >
        <p className="text-ink-2" style={{ marginBottom: '12px' }}>{ACTIONS[reasonFor]?.hint}</p>
        <Field label="Reason" required><Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Drawer>
    </DeskShell>
  );
}
