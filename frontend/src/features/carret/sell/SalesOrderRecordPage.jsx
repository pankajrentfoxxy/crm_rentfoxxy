import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field,
  FlowSteps, FormGrid, Input, KeyValue, Money, Notice, Section, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelSalesOrder, getSalesOrderFull, listSoActivities, logSoDocumentActivity, recordPayment,
  regenerateSalesOrderPdf,
} from '../../sales-pipeline/salesPipelineApi';
import { confirmInPlaceSale } from '../../../utils/saleInPlaceApi';
import { acceptDispatchWorkflow, fetchDispatchWorkflow } from '../../../utils/dispatchWorkflowApi';
import { formatSupplyStateLabel } from '../../sales-pipeline/salesPipelineUtils';
import { configText } from './LineItemsEditor';
import { AddressText } from './CustomerAddresses';
import SoLaptopsPanel from './SoLaptopsPanel';
import { LineEditDrawer, ShippingEditDrawer, useLineEditRights } from './SoLineEdits';
import { SO_SECTIONS, openPdf, parseJson } from './sellShared';

/**
 * Sell → Sales order record.
 *
 * The flow strip across the top is the order's whole journey — quotation,
 * order, laptops & QC, challan, gate, delivered — and the primary button is
 * always the next step on it. Everything the old page did is here: PDF, edit
 * (until a challan exists), attach and QC, per-laptop addresses, challans,
 * payments, activity, cancel, and confirming a sale in place.
 */
const TYPE = { sale: 'Sale', sales: 'Sale', rental: 'Rental', demo: 'Demo' };
const PAYMENT_TYPES = ['advance', 'security_deposit', 'monthly', 'partial', 'final'];
const PAYMENT_MODES = ['bank_transfer', 'cheque', 'upi', 'cash', 'other'];
const human = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function SalesOrderRecordPage() {
  const { soNumber } = useParams();
  const so = decodeURIComponent(soNumber || '');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEditSo = SO_SECTIONS.some((s) => hasPermission(s, 'edit'));
  const canCreateDc = [...SO_SECTIONS, 'delivery_challans'].some((s) => hasPermission(s, 'create'));
  const canPay = hasPermission('payment_records', 'create');
  const canSeePay = hasPermission('payment_records', 'view');

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [wf, setWf] = useState(null);
  const [activity, setActivity] = useState(null);
  const [lineEdit, setLineEdit] = useState(null);
  const [shipEdit, setShipEdit] = useState(false);
  const rights = useLineEditRights();

  const load = useCallback(() => {
    getSalesOrderFull(so)
      .then(({ data }) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e?.response?.data?.message || 'Could not load the order.', data: null }));
    fetchDispatchWorkflow(so).then(({ data }) => setWf(data?.workflow || null)).catch(() => setWf(null));
  }, [so]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== 'activity') return;
    listSoActivities(so, { limit: 100 }).then(({ data }) => setActivity(data?.activities || [])).catch(() => setActivity([]));
  }, [tab, so]);

  const d = state.data;
  const lines = d?.lines || [];
  const head = lines[0] || {};
  const cancelled = String(d?.status) === 'cancelled';
  const inPlace = head.fulfillment_mode === 'in_place';
  const isReplacement = Boolean(d?.is_replacement_order);
  const dcs = d?.delivery_challans || [];
  const qty = Number(d?.laptop_qty) || 0;
  const attached = Number(d?.attached_count) || 0;
  const delivered = Number(d?.delivered_count) || 0;
  const dispatched = Number(d?.dispatched_count) || 0;
  const billing = parseJson(head.customer_billing_address);
  const shipping = parseJson(head.customer_shipping_address);
  const totals = d?.totals || {};
  const summary = d?.summary || {};
  const canEditOrder = canEditSo && !cancelled && !dcs.length && !inPlace && !isReplacement;

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error(e?.response?.data?.message || e.message || 'That did not work.'); } finally { setBusy(''); }
  };

  const onPdf = () => run('pdf', async () => {
    const { data } = await regenerateSalesOrderPdf(so);
    openPdf(data?.pdf_path);
    logSoDocumentActivity(so, { action: 'pdf_downloaded' }).catch(() => {});
  });

  // Next step, by where the order is.
  const hasQuote = head.quotation_number && head.quotation_number !== 'N/A';
  let nextStep = null;
  if (cancelled) nextStep = <Notice tone="serious" title="Cancelled">{d?.refusal_status || 'This order is cancelled; its laptops went back to stock.'}</Notice>;
  else if (inPlace) {
    nextStep = delivered >= qty && qty
      ? <Notice tone="good" title="Sale confirmed">The customer keeps the laptops; there is no challan for a sale in place.</Notice>
      : <Notice tone="info" title="Sale in place" action={attached > 0 && canEditSo && <Button variant="primary" onClick={() => setConfirm({ title: 'Confirm this sale?', body: 'The attached laptops become sold to this customer, rent stops, and the sale invoice queue picks it up. No challan or e-way bill.', label: 'Confirm sale', tone: 'good', go: () => run('inplace', () => confirmInPlaceSale(so), 'Sale confirmed') })}>Confirm sale</Button>}>Attach the laptops the customer already holds, then confirm the sale.</Notice>;
  } else if (delivered >= qty && qty) nextStep = <Notice tone="good" title="Delivered">Every laptop on this order has been delivered.</Notice>;
  else if (attached < qty) nextStep = <Notice tone="info" title={`${qty - attached} laptop${qty - attached === 1 ? '' : 's'} still to attach`} action={<Button variant="primary" onClick={() => setTab('laptops')}>Attach laptops</Button>}>Attaching a laptop reserves it and opens its Dispatch QC check.</Notice>;
  else if (d?.refusal_status) nextStep = <Notice tone="serious" title={d.refusal_status}>A challan on this order was refused by the customer.</Notice>;

  const flow = [
    { key: 'q', label: 'Quotation', sub: hasQuote ? head.quotation_number : 'none', state: 'done', onClick: hasQuote ? () => navigate(`/carret/sell/quotations/${encodeURIComponent(head.quotation_number)}`) : undefined },
    { key: 'so', label: 'Sales order', sub: so, state: cancelled ? 'blocked' : 'done' },
    { key: 'lap', label: 'Laptops & QC', sub: `${attached}/${qty} attached`, state: cancelled ? 'todo' : (attached >= qty && qty ? 'done' : 'current'), onClick: () => setTab('laptops') },
    { key: 'dc', label: 'Challan', sub: dcs.length ? `${dcs.length} challan${dcs.length === 1 ? '' : 's'}` : (inPlace ? 'not needed' : '—'), state: inPlace ? 'done' : (dcs.length ? 'done' : (attached ? 'current' : 'todo')), onClick: () => setTab('dcs') },
    { key: 'gate', label: 'Gate', sub: `${dispatched + delivered}/${qty} out`, state: inPlace ? 'done' : (dispatched + delivered >= qty && qty ? 'done' : (dcs.length ? 'current' : 'todo')) },
    { key: 'del', label: 'Delivered', sub: `${delivered}/${qty}`, state: delivered >= qty && qty ? 'done' : (dispatched ? 'current' : 'todo') },
  ];

  const actions = d && (
    <>
      <Button onClick={onPdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'Opening…' : 'PDF'}</Button>
      {canEditOrder && <Button onClick={() => navigate(`/carret/sell/sales-orders/${encodeURIComponent(so)}/edit`)}>Edit</Button>}
      {canPay && !cancelled && <Button onClick={() => setPayOpen(true)}>Record payment</Button>}
      {!cancelled && !inPlace && canCreateDc && attached > 0 && (
        <Button variant="primary" onClick={() => navigate(`/carret/move/challans/new?so=${encodeURIComponent(so)}`)}>Create challan</Button>
      )}
      {d?.can_cancel && canEditSo && !cancelled && (
        <Button variant="quiet" onClick={() => setConfirm({
          title: `Cancel ${so}?`,
          body: 'Attached laptops go back to stock, their Dispatch QC tickets are cancelled and the order lines close. This cannot be undone.',
          label: 'Cancel order', tone: 'crit', go: () => run('cancel', () => cancelSalesOrder(so), 'Order cancelled'),
        })}
        >{d?.refusal_status ? 'Cancel order (refused)' : 'Cancel order'}
        </Button>
      )}
    </>
  );

  const lineCols = [
    { key: 'cfg', header: 'Configuration', render: (l) => configText(l) || '—', sub: (l) => l.remark || null },
    { key: 'hsn', header: 'HSN/SAC', render: (l) => (l.hsn_code ? <DocNumber value={l.hsn_code} /> : '—') },
    { key: 'term', header: 'Terms', render: (l) => (TYPE[String(head.quotation_type).toLowerCase()] === 'Sale'
      ? [l.technical_warranty && `${l.technical_warranty}m warranty`, l.battery_charger_warranty && `${l.battery_charger_warranty}m battery`].filter(Boolean).join(' · ') || '—'
      : (l.locking_period ? `${l.locking_period}m lock-in` : '—')) },
    { key: 'qty', header: 'Qty', numeric: true, render: (l) => l.main_qty ?? l.quantity },
    { key: 'rate', header: 'Rate', numeric: true, render: (l) => <Money value={l.rate} /> },
    { key: 'amt', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount ?? (Number(l.rate) || 0) * (Number(l.main_qty ?? l.quantity) || 0)} /> },
    {
      key: 'st', header: '', align: 'right',
      render: (l) => {
        if (l.status === 'cancelled') return <StatusChip status="cancelled" />;
        if (cancelled) return null;
        return (
          <span className="flex justify-end flex-wrap" style={{ gap: '2px' }}>
            {rights.rateConfig && <Button variant="quiet" onClick={() => setLineEdit({ mode: 'rate', line: l })}>Rate</Button>}
            {rights.rateConfig && <Button variant="quiet" onClick={() => setLineEdit({ mode: 'config', line: l })}>Config</Button>}
            {rights.hsn && <Button variant="quiet" onClick={() => setLineEdit({ mode: 'hsn', line: l })}>HSN</Button>}
            {rights.cancelUnits && <Button variant="quiet" onClick={() => setLineEdit({ mode: 'cancel', line: l })}>Cancel units</Button>}
          </span>
        );
      },
    },
  ];

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'laptops', label: 'Laptops & QC', count: `${attached}/${qty}` },
    ...(inPlace ? [] : [{ key: 'dcs', label: 'Challans', count: dcs.length }]),
    ...(canSeePay ? [{ key: 'payments', label: 'Payments', count: (d?.payments || []).length }] : []),
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <DeskShell title={so} breadcrumb="Sell / Sales orders" subtitle={head.customer_name}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this order" body={state.error} action={<Button onClick={() => navigate('/carret/sell/sales-orders')}>Back to orders</Button>} />}
      {d && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={so}
            type={`Sales order · ${isReplacement ? 'Replacement' : (TYPE[String(head.quotation_type).toLowerCase()] || head.quotation_type)}${inPlace ? ' · in place' : ''}`}
            entity={head.entity_code}
            status={cancelled ? 'cancelled' : (d.status === 'pending' ? 'confirmed' : d.status)}
            actions={actions}
            meta={[
              { label: 'Customer', value: head.customer_name },
              { label: 'Raised', value: <DateTime value={head.created_at} /> },
              { label: 'Laptops', value: `${qty} ordered · ${attached} attached · ${delivered} delivered` },
              { label: 'Value', value: <Money value={totals.grand_total} /> },
            ]}
          />
          <FlowSteps steps={flow} />
          {nextStep}

          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'overview' && (
            <div className="c-split">
              <div className="c-stack">
                <Section title="Lines">
                  <DataTable columns={lineCols} rows={lines} rowKey={(l) => l.id || l.line_id} />
                </Section>
                <Section
                  title="Addresses"
                  actions={canEditSo && !cancelled && !inPlace && <Button variant="quiet" onClick={() => setShipEdit(true)}>Edit shipping</Button>}
                >
                  <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                    <div><div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div><AddressText address={billing} /></div>
                    <div><div className="c-label" style={{ marginBottom: '6px' }}>Ship to{head.is_wfh ? ' (work from home)' : ''}</div><AddressText address={shipping} empty={inPlace ? 'Not shipped — sale in place' : 'Not set'} /></div>
                  </div>
                </Section>
                {wf && (
                  <Section title="Dispatch team">
                    <KeyValue items={[
                      { label: 'Stage', value: human(wf.status) },
                      { label: 'Owner', value: wf.assigned_user_name },
                      { label: 'Accept by', value: wf.acceptance_due_at && <DateTime value={wf.acceptance_due_at} /> },
                      { label: 'QC due', value: wf.qc_due_at && <span style={wf.qc_overdue ? { color: 'var(--alert-crit)' } : undefined}><DateTime value={wf.qc_due_at} />{wf.qc_overdue ? ' · overdue' : ''}</span> },
                      wf.purchase_request_status && { label: 'Purchase request', value: human(wf.purchase_request_status) },
                    ]}
                    />
                    {wf.status === 'waiting_acceptance' && ['dispatch_pending_orders', 'dispatch_workflow'].some((s) => hasPermission(s, 'edit')) && (
                      <div style={{ marginTop: '12px' }}>
                        <Button variant="primary" onClick={() => run('accept', () => acceptDispatchWorkflow(so), 'Order accepted by dispatch')} disabled={busy === 'accept'}>Accept for dispatch</Button>
                      </div>
                    )}
                  </Section>
                )}
              </div>
              <aside className="c-stack">
                <Section title="Totals">
                  <div className="c-totals">
                    <div><span>Subtotal</span><span><Money value={totals.subtotal} /></span></div>
                    {totals.gst_type === 'intra'
                      ? (<><div><span>CGST</span><span><Money value={totals.cgst} /></span></div><div><span>SGST</span><span><Money value={totals.sgst} /></span></div></>)
                      : <div><span>IGST</span><span><Money value={totals.igst} /></span></div>}
                    <div><span>Shipping</span><span><Money value={totals.shipping} /></span></div>
                    <div><span>Security deposit</span><span><Money value={totals.security} /></span></div>
                    <div className="is-grand"><span>Grand total</span><span><Money value={totals.grand_total} /></span></div>
                    {canSeePay && <div><span>Collected</span><span><Money value={summary.total_paid} /></span></div>}
                    {canSeePay && <div><span>Balance due</span><span><Money value={summary.balance_due} /></span></div>}
                  </div>
                </Section>
                <Section title="Details">
                  <KeyValue cols={1} items={[
                    { label: 'Quotation', value: hasQuote ? <Link to={`/carret/sell/quotations/${encodeURIComponent(head.quotation_number)}`}><DocNumber value={head.quotation_number} /></Link> : 'Raised without a quotation' },
                    { label: 'GSTIN', value: head.gst_number && <DocNumber value={head.gst_number} /> },
                    { label: 'Place of supply', value: head.supply_state && formatSupplyStateLabel(head.supply_state) },
                    { label: 'Email', value: head.customer_email },
                    { label: 'Phone', value: head.customer_mobile },
                    d.support_ticket_id && { label: 'Support ticket', value: `#${d.support_ticket_id}` },
                  ]}
                  />
                </Section>
              </aside>
            </div>
          )}

          {tab === 'laptops' && (
            <SoLaptopsPanel soNumber={so} billing={billing} cancelled={cancelled} inPlace={inPlace} onChanged={load} />
          )}

          {tab === 'dcs' && (
            <Section
              title="Delivery challans"
              actions={!cancelled && canCreateDc && attached > 0 && <Button variant="primary" onClick={() => navigate(`/carret/move/challans/new?so=${encodeURIComponent(so)}`)}>Create challan</Button>}
            >
              <DataTable
                rows={dcs}
                rowKey={(c) => c.dc_number}
                onRowClick={(c) => navigate(`/carret/move/challans/${encodeURIComponent(c.dc_number)}`)}
                columns={[
                  { key: 'dc', header: 'Challan', render: (c) => <DocNumber value={c.dc_number} /> },
                  { key: 'st', header: 'Status', render: (c) => <StatusChip status={c.status} /> },
                  { key: 'mode', header: 'Mode', render: (c) => human(c.dispatch_mode || c.ship_by) },
                  { key: 'cr', header: 'Created', render: (c) => <DateTime value={c.created_at} /> },
                  { key: 'out', header: 'Left the gate', render: (c) => <DateTime value={c.dispatched_at} /> },
                ]}
                empty={<EmptyState title="No challan yet" body={attached ? 'Laptops that passed Dispatch QC can go on a challan now.' : 'Attach laptops first; a challan needs at least one that passed Dispatch QC.'} />}
              />
            </Section>
          )}

          {tab === 'payments' && (
            <Section title="Payments" actions={canPay && !cancelled && <Button variant="primary" onClick={() => setPayOpen(true)}>Record payment</Button>}>
              <DataTable
                rows={d.payments || []}
                rowKey={(p, i) => p.id || p.payment_id || i}
                columns={[
                  { key: 'd', header: 'Date', render: (p) => <DateTime value={p.payment_date} /> },
                  { key: 't', header: 'Type', render: (p) => human(p.payment_type) },
                  { key: 'a', header: 'Amount', numeric: true, render: (p) => <Money value={p.amount} /> },
                  { key: 'm', header: 'Mode', render: (p) => human(p.payment_mode) },
                  { key: 'r', header: 'Reference', render: (p) => p.reference_number || '—' },
                  { key: 'b', header: 'Recorded by', render: (p) => p.recorded_by_name || p.created_by_name || '—' },
                ]}
                empty={<EmptyState title="No payment recorded" />}
              />
            </Section>
          )}

          {tab === 'activity' && (
            <Section title="Activity">
              {activity === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  rows={activity}
                  rowKey={(a, i) => a.id || i}
                  columns={[
                    { key: 'w', header: 'When', render: (a) => <DateTime value={a.created_at} /> },
                    { key: 'x', header: 'What', render: (a) => a.title || human(a.action || a.activity_type), sub: (a) => a.description || a.remarks || null },
                    { key: 'b', header: 'By', render: (a) => a.created_by_name || '—', sub: (a) => a.created_by_role || null },
                  ]}
                  empty={<EmptyState title="Nothing recorded yet" />}
                />
              )}
            </Section>
          )}
        </div>
      )}

      <PaymentDrawer open={payOpen} so={so} onClose={() => setPayOpen(false)} onSaved={load} />
      <LineEditDrawer
        mode={lineEdit?.mode}
        line={lineEdit?.line}
        quotationType={String(head.quotation_type || '').toLowerCase()}
        onClose={() => setLineEdit(null)}
        onSaved={load}
      />
      <ShippingEditDrawer
        open={shipEdit}
        so={so}
        address={shipping}
        charge={head.shiping_charges}
        onClose={() => setShipEdit(false)}
        onSaved={load}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.go()}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
      />
    </DeskShell>
  );
}

function PaymentDrawer({ open, so, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const blank = { payment_type: 'advance', amount: '', payment_date: today, payment_mode: 'bank_transfer', reference_number: '', notes: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!(Number(f.amount) > 0)) { toast.error('Enter an amount above 0'); return; }
    setBusy(true);
    try {
      await recordPayment(so, { ...f, amount: Number(f.amount) });
      toast.success('Payment recorded');
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record payment"
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record'}</Button>
        </div>
      )}
    >
      <FormGrid cols={2}>
        <Field label="Type" required><Select value={f.payment_type} onChange={set('payment_type')} options={PAYMENT_TYPES.map((v) => ({ value: v, label: human(v) }))} /></Field>
        <Field label="Amount (₹)" required><Input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Date" required><Input type="date" value={f.payment_date} onChange={set('payment_date')} /></Field>
        <Field label="Mode" required><Select value={f.payment_mode} onChange={set('payment_mode')} options={PAYMENT_MODES.map((v) => ({ value: v, label: human(v) }))} /></Field>
        <Field label="Reference" span={2}><Input value={f.reference_number} onChange={set('reference_number')} placeholder="UTR, cheque number…" /></Field>
        <Field label="Notes" span={2}><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </FormGrid>
    </Drawer>
  );
}
