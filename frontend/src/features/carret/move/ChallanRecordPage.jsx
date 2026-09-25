import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, EmptyState, Field, FlowSteps,
  KeyValue, Money, Notice, Section, StatusChip, Tabs, Textarea, Drawer,
} from '../../../components/carret';
import api from '../../../utils/api';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelDC, downloadDcRentalInvoicePdf, getDC, getDcQcStatus, regenerateDcPdf,
} from '../../sales-pipeline/salesPipelineApi';
import { downloadBlob } from '../../sales-pipeline/salesPipelineUtils';
import { AddressText } from '../sell/CustomerAddresses';
import { configText } from '../sell/LineItemsEditor';
import { openPdf, parseJson } from '../sell/sellShared';
import ChallanPaperwork, { paperworkState } from './ChallanPaperwork';
import { DispatchEditDrawer, DispatchSummary, modeOf } from './ChallanDispatch';
import ChallanDelivery from './ChallanDelivery';

/**
 * Move → Delivery challan record.
 *
 * "What is stopping this challan?" is the first thing on the page: the same
 * pre-flight the gate runs (Dispatch QC, e-way bill, AWB, state), shown to the
 * desk before the guard hits it, each with the action that clears it. Then the
 * paperwork, the dispatch details and the delivery — every one on the endpoint
 * the old detail page used.
 */
const SO_DC_EDIT = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement', 'delivery_challans'];
const OUT = ['in_transit', 'shipped', 'reached'];
const MODE_LABEL = { inhouse: 'By hand', courier: 'Courier', porter: 'Porter' };

export default function ChallanRecordPage() {
  const { dcNumber } = useParams();
  const dc = decodeURIComponent(dcNumber || '');
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const isSuper = user?.role === 'super_admin';
  const canEdit = SO_DC_EDIT.some((s) => hasPermission(s, 'edit'));

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [qc, setQc] = useState(null);
  const [pre, setPre] = useState(null);
  const [tab, setTab] = useState('overview');
  const [editDispatch, setEditDispatch] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    getDC(dc)
      .then(({ data }) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e?.response?.data?.message || 'Could not load the challan.', data: null }));
    getDcQcStatus(dc).then(({ data }) => setQc(data)).catch(() => setQc(null));
    api.get(`/guard-gate/preflight/${encodeURIComponent(dc)}`).then(({ data }) => setPre(data)).catch(() => setPre(null));
  }, [dc]);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const lines = d?.lines || [];
  const head = lines[0] || {};
  const status = String(head.status || '').toLowerCase();
  const mode = modeOf(head);
  const paper = paperworkState(d);
  const units = lines.flatMap((l) => (l.serials_detail || []).map((s) => ({ ...s, line: l })));
  const qcTotal = Number(qc?.total_count) || 0;
  const qcPassed = qcTotal - (Number(qc?.pending_count) || 0) - (Number(qc?.failed_count) || 0);
  const out = OUT.includes(status);
  const isSale = Boolean(d?.is_sale);
  const cancellable = isSuper && !['delivered', 'rejected', 'cancelled'].includes(status) && head.movement_type !== 'return';

  const onPdf = async () => {
    setBusy('pdf');
    try { const { data } = await regenerateDcPdf(dc); openPdf(data?.pdf_path); } catch (e) { toast.error(e?.response?.data?.message || 'The challan PDF is locked.'); } finally { setBusy(''); }
  };
  const onInvoice = async () => {
    setBusy('inv');
    try { const res = await downloadDcRentalInvoicePdf(dc); downloadBlob(res.data, `${d.rental_invoice?.invoice_number || 'invoice'}.pdf`); } catch (e) { toast.error('The invoice PDF is not available.'); } finally { setBusy(''); }
  };
  const onCancel = async () => {
    setBusy('cancel');
    try { await cancelDC(dc, { reason: cancelReason.trim() || undefined }); toast.success('Challan cancelled — laptops back on the order'); setCancelOpen(false); load(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not cancel.'); } finally { setBusy(''); }
  };

  // What is stopping it, in plain words, each with its fix.
  const blockers = [];
  if (status === 'dispatch_ready' || status === 'pending') {
    (pre?.failures || []).forEach((f) => {
      let action = null;
      if (/DISPATCH_QC/.test(f.code)) action = <Button variant="quiet" onClick={() => navigate(`/carret/sell/sales-orders/${encodeURIComponent(head.sales_order_number)}`)}>Open the order</Button>;
      if (f.code === 'EWAY_MISSING') action = <Button variant="quiet" onClick={() => setTab('paperwork')}>Paperwork</Button>;
      if (f.code === 'AWB_MISSING') action = <Button variant="quiet" onClick={() => setTab('dispatch')}>Dispatch</Button>;
      blockers.push({ key: f.code, text: f.message, action });
    });
    if (!pre && !paper.done) blockers.push({ key: 'paper', text: 'Paperwork is still missing.', action: <Button variant="quiet" onClick={() => setTab('paperwork')}>Paperwork</Button> });
  }

  const flow = [
    { key: 'so', label: 'Sales order', sub: head.sales_order_number, state: 'done', onClick: head.sales_order_number ? () => navigate(`/carret/sell/sales-orders/${encodeURIComponent(head.sales_order_number)}`) : undefined },
    { key: 'qc', label: 'Dispatch QC', sub: qcTotal ? `${qcPassed}/${qcTotal} passed` : 'at attach', state: qc?.any_failed ? 'blocked' : (qc && !qc.all_passed && qcTotal ? 'current' : 'done') },
    { key: 'dc', label: 'Challan', sub: dc, state: status === 'cancelled' ? 'blocked' : 'done' },
    { key: 'paper', label: 'Paperwork', sub: paper.none ? 'not needed' : (paper.done ? 'on file' : 'missing'), state: paper.done ? 'done' : 'blocked', onClick: () => setTab('paperwork') },
    { key: 'gate', label: 'Gate', sub: head.dispatched_at ? 'out' : (blockers.length ? `${blockers.length} to fix` : 'ready'), state: head.dispatched_at || out || ['delivered', 'rejected'].includes(status) ? 'done' : (blockers.length ? 'blocked' : 'current') },
    { key: 'del', label: status === 'rejected' ? 'Refused' : 'Delivered', sub: status === 'delivered' ? 'done' : (status === 'rejected' ? 'refused' : '—'), state: status === 'delivered' ? 'done' : (status === 'rejected' ? 'blocked' : (out ? 'current' : 'todo')), onClick: () => setTab('delivery') },
  ];

  const actions = d && (
    <>
      {(d.can_download_pdf || isSuper) && <Button onClick={onPdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'Opening…' : 'Challan PDF'}</Button>}
      {!d.can_download_pdf && !isSuper && <Button disabled title="Locked until the paperwork is on file">PDF locked</Button>}
      {d.rental_invoice?.invoice_id && <Button onClick={onInvoice} disabled={busy === 'inv'}>Invoice {d.rental_invoice.invoice_number}</Button>}
      {status === 'dispatch_ready' && hasPermission('guard_gate_checking', 'view') && (
        <Button variant={blockers.length ? 'secondary' : 'primary'} onClick={() => navigate(`/carret/move/gate?dc=${encodeURIComponent(dc)}`)}>Open at the gate</Button>
      )}
      {cancellable && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel challan</Button>}
    </>
  );

  const billing = parseJson(head.customer_billing_address);
  const shipping = parseJson(head.delivery_address) || parseJson(head.customer_shipping_address);
  const totals = d?.totals || {};

  return (
    <DeskShell title={dc} breadcrumb="Move / Delivery challans" subtitle={head.customer_name}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this challan" body={state.error} action={<Button onClick={() => navigate('/carret/move/challans')}>Back to challans</Button>} />}
      {d && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={dc}
            type={`Delivery challan · ${MODE_LABEL[mode] || mode}${head.dc_purpose === 'service_return' ? ' · service return' : ''}`}
            entity={head.entity_code}
            status={status}
            actions={actions}
            meta={[
              { label: 'Customer', value: head.customer_name },
              { label: 'Sales order', value: head.sales_order_number && <Link to={`/carret/sell/sales-orders/${encodeURIComponent(head.sales_order_number)}`}><DocNumber value={head.sales_order_number} /></Link> },
              { label: 'Created', value: <DateTime value={head.created_at} /> },
              { label: 'Laptops', value: units.length },
            ]}
          />
          <FlowSteps steps={flow} />

          {blockers.length > 0 && (
            <Notice tone="crit" title={`The gate will refuse this challan — ${blockers.length} thing${blockers.length === 1 ? '' : 's'} to fix`}>
              <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '4px', marginTop: '4px' }}>
                {blockers.map((b) => (
                  <li key={b.key} className="flex items-center flex-wrap" style={{ gap: '8px' }}>{b.text}{b.action}</li>
                ))}
              </ul>
            </Notice>
          )}
          {status === 'dispatch_ready' && pre?.ok && <Notice tone="good" title="Clear to go out">Everything the gate checks is in place. The guard can scan it out.</Notice>}
          {status === 'cancelled' && <Notice tone="serious" title="Cancelled">This challan was cancelled. Its laptops went back to the order.</Notice>}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Laptops & billing', count: units.length },
              { key: 'dispatch', label: 'Dispatch' },
              { key: 'paperwork', label: 'Paperwork', count: paper.none ? undefined : (paper.done ? '✓' : '!') },
              { key: 'delivery', label: 'Delivery' },
            ]}
          />

          {tab === 'overview' && (
            <div className="c-split">
              <div className="c-stack">
                <Section title="Laptops on this challan">
                  <DataTable
                    rows={units}
                    rowKey={(u, i) => u.ttspl || u.serial_number || i}
                    columns={[
                      { key: 't', header: 'Laptop', render: (u) => <Link to={`/carret/stock/assets/${encodeURIComponent(u.ttspl || u.serial_number)}`}><DocNumber value={u.ttspl || u.serial_number} /></Link>, sub: (u) => u.serial_number },
                      { key: 'c', header: 'Configuration', render: (u) => configText({ brand: u.brand, model_name: u.model, processor: u.processor, generation: u.generation, ram: u.ram, storage: u.storage, gpu: u.gpu, screen_size: u.screen_size }) },
                      {
                        key: 'q', header: 'Dispatch QC',
                        render: (u) => {
                          const t = (qc?.tickets || []).find((x) => x.ttspl_id === u.ttspl || String(x.serial_id) === String(u.serial_id));
                          if (!t) return <span className="text-ink-3">—</span>;
                          return <StatusChip status={t.status === 'qc_passed' ? 'approved' : t.status === 'qc_failed' ? 'rejected' : 'pending'} title={t.stage_name} />;
                        },
                      },
                    ]}
                    empty={<EmptyState title="No laptops listed" />}
                  />
                </Section>
                <Section title="Addresses">
                  <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                    <div><div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div><AddressText address={billing} /></div>
                    <div><div className="c-label" style={{ marginBottom: '6px' }}>Deliver to{head.is_wfh ? ' (work from home)' : ''}</div><AddressText address={shipping} /></div>
                  </div>
                </Section>
              </div>
              <aside className="c-stack">
                <Section title="Billing">
                  <div className="c-totals">
                    <div><span>Subtotal</span><span><Money value={totals.subtotal} /></span></div>
                    {totals.gst_type === 'intra'
                      ? (<><div><span>CGST</span><span><Money value={totals.cgst} /></span></div><div><span>SGST</span><span><Money value={totals.sgst} /></span></div></>)
                      : <div><span>IGST</span><span><Money value={totals.igst} /></span></div>}
                    <div><span>Shipping</span><span><Money value={totals.shipping} /></span></div>
                    <div><span>Security</span><span><Money value={totals.security} /></span></div>
                    <div className="is-grand"><span>Total</span><span><Money value={totals.grand_total} /></span></div>
                  </div>
                </Section>
                <Section title="Details">
                  <KeyValue cols={1} items={[
                    { label: 'Type', value: isSale ? 'Sale' : 'Rental' },
                    { label: 'GSTIN', value: head.gst_number && <DocNumber value={head.gst_number} /> },
                    head.support_ticket_id && { label: 'Support ticket', value: `#${head.support_ticket_id}` },
                    d.rental_invoice?.invoice_number && { label: 'First invoice', value: d.rental_invoice.invoice_number },
                  ]}
                  />
                </Section>
              </aside>
            </div>
          )}

          {tab === 'dispatch' && (
            <DispatchSummary dc={dc} head={head} detail={d} canEdit={canEdit} onEdit={() => setEditDispatch(true)} onChanged={load} />
          )}
          {tab === 'paperwork' && <ChallanPaperwork dc={dc} status={status} detail={d} onChanged={load} />}
          {tab === 'delivery' && <ChallanDelivery dc={dc} head={head} detail={d} onChanged={load} />}
        </div>
      )}

      <DispatchEditDrawer open={editDispatch} dc={dc} so={head.sales_order_number} head={head} onClose={() => setEditDispatch(false)} onSaved={load} />
      <Drawer
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${dc}?`}
        footer={<div className="flex justify-end" style={{ gap: '8px' }}><Button variant="quiet" onClick={() => setCancelOpen(false)}>Keep it</Button><Button variant="primary" onClick={onCancel} disabled={busy === 'cancel'}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel challan'}</Button></div>}
      >
        <div className="c-stack">
          <Notice tone="warn">The laptops go back to the order (still attached and reserved). {isSale ? 'Cancel the e-invoice separately with Accounts.' : ''}</Notice>
          <Field label="Reason"><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}
