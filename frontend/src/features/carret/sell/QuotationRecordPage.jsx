import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, ConfirmDialog, EmptyState,
  Field, FlowSteps, FormGrid, Input, KeyValue, Money, Notice, Section, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  getQuotation, regenerateQuotationPdf, sendQuotationEmail, updateQuotationStatus,
} from '../../sales-pipeline/salesPipelineApi';
import { configText, lineAmount } from './LineItemsEditor';
import { AddressText } from './CustomerAddresses';
import { SO_CREATE_SECTIONS, parseJson, openPdf } from './sellShared';

/**
 * Sell → Quotation record.
 *
 * The next step is always the loudest thing on the page: send a draft, record
 * the customer's yes, then raise the order. An order can only be raised from an
 * ACCEPTED quotation (Part 4.3) — the old screen offered "Create SO" on an
 * approved one and the server then refused it, so here the button only appears
 * when it will work, and an approved quotation says what is still missing.
 */
const label = (s) => (s === 'pending' ? 'draft' : s);

export default function QuotationRecordPage() {
  const { quotationNumber } = useParams();
  const qn = decodeURIComponent(quotationNumber || '');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('sales_quotations', 'edit');
  const canCreateSo = SO_CREATE_SECTIONS.some((s) => hasPermission(s, 'create'));

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [send, setSend] = useState({ to: '', cc: '' });
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: !s.data, error: null }));
    getQuotation(qn)
      .then(({ data }) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e?.response?.data?.message || 'Could not load the quotation.', data: null }));
  }, [qn]);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const lines = data?.lines || [];
  const head = lines[0] || {};
  const status = String(head.status || 'pending').toLowerCase();
  const isSale = ['sale', 'sales'].includes(String(head.quotation_type).toLowerCase());
  const orders = (data?.sales_orders || []).filter((o) => !o.cancelled);

  const subtotal = lines.reduce((s, l) => s + lineAmount({ quantity: l.quantity ?? l.main_quantity, rate: l.rate }), 0);
  const shipping = Number(head.shiping_charges) || 0;
  const security = Number(head.security_amount) || 0;

  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  const onPdf = () => run('pdf', async () => {
    let path = head.pdf_path;
    if (!path) {
      const { data: r } = await regenerateQuotationPdf(qn);
      path = r?.pdf_path;
    }
    if (!path) throw new Error('No PDF is available for this quotation yet.');
    openPdf(path);
  });

  const onSend = () => {
    if (!/^\S+@\S+\.\S+$/.test(send.to.trim())) { toast.error('Enter a valid email address'); return; }
    run('send', async () => {
      const { data: r } = await sendQuotationEmail(qn, { email: send.to.trim(), cc: send.cc });
      setSendOpen(false);
      toast.success(r?.message || `Sent to ${send.to.trim()}`);
    });
  };

  const setStatus = (to, ok) => run(to, () => updateQuotationStatus(qn, { status: to }), ok);

  // The one thing to do next, by status.
  let next = null;
  if (status === 'rejected') {
    next = <Notice tone="serious" title="Rejected">This quotation is closed. Raise a new one to quote again.</Notice>;
  } else if (status === 'accepted') {
    next = orders.length
      ? <Notice tone="good" title="Order raised">Sales order {orders.map((o) => o.sales_order_number).join(', ')} was raised from this quotation.</Notice>
      : <Notice tone="good" title="Accepted — ready for a sales order" action={canCreateSo && <Button variant="primary" onClick={() => navigate(`/carret/sell/sales-orders/new?quotation=${encodeURIComponent(qn)}`)}>Create sales order</Button>}>
          Accepted {head.accepted_at ? <DateTime value={head.accepted_at} /> : ''}. The order will copy the customer, lines and charges.
        </Notice>;
  } else if (status === 'approved') {
    next = <Notice tone="info" title="Approved internally — waiting for the customer">An order needs the customer’s acceptance. They can accept from the emailed link, or record it here once they confirm.</Notice>;
  } else if (status === 'sent') {
    next = <Notice tone="info" title="Sent — waiting for the customer">Sent {head.quotation_sent_at ? <DateTime value={head.quotation_sent_at} /> : ''}. The customer can accept from the emailed link.</Notice>;
  } else {
    next = <Notice tone="info" title="Draft">Send it to the customer when it is ready.</Notice>;
  }

  const actions = data && (
    <>
      <Button onClick={onPdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'Opening…' : 'PDF'}</Button>
      {canEdit && status !== 'rejected' && (
        <Button
          variant={status === 'pending' ? 'primary' : 'secondary'}
          onClick={() => { setSend({ to: head.customer_email || '', cc: '' }); setSendOpen(true); }}
        >
          {status === 'pending' ? 'Send to customer' : 'Resend'}
        </Button>
      )}
      {canEdit && ['pending', 'sent'].includes(status) && (
        <Button onClick={() => setConfirm({
          title: 'Approve this quotation?', body: 'Marks it approved internally. The customer still has to accept it before an order can be raised.',
          label: 'Approve', tone: 'good', go: () => setStatus('approved', 'Approved'),
        })}
        >Approve
        </Button>
      )}
      {canEdit && ['pending', 'sent', 'approved'].includes(status) && (
        <Button onClick={() => setConfirm({
          title: 'Record the customer’s acceptance?', body: 'Use this when the customer confirmed by phone, WhatsApp or email rather than the link. It is recorded against your name.',
          label: 'Customer accepted', tone: 'good', go: () => setStatus('accepted', 'Recorded as accepted'),
        })}
        >Customer accepted
        </Button>
      )}
      {canEdit && status !== 'rejected' && !(status === 'accepted' && orders.length) && (
        <Button variant="quiet" onClick={() => setConfirm({
          title: 'Reject this quotation?', body: 'A rejected quotation is closed for good. To quote again you raise a new one.',
          label: 'Reject', tone: 'crit', go: () => setStatus('rejected', 'Rejected'),
        })}
        >Reject
        </Button>
      )}
    </>
  );

  const flow = [
    { key: 'q', label: 'Quotation', sub: label(status), state: status === 'rejected' ? 'blocked' : (status === 'accepted' ? 'done' : 'current') },
    { key: 'so', label: 'Sales order', sub: orders[0]?.sales_order_number, state: orders.length ? 'done' : (status === 'accepted' ? 'current' : 'todo'), onClick: orders[0] ? () => navigate(`/carret/sell/sales-orders/${encodeURIComponent(orders[0].sales_order_number)}`) : undefined },
    { key: 'lap', label: 'Laptops & QC', state: 'todo' },
    { key: 'dc', label: 'Challan', state: 'todo' },
    { key: 'gate', label: 'Gate', state: 'todo' },
    { key: 'del', label: 'Delivered', state: 'todo' },
  ];

  const columns = [
    { key: 'cfg', header: 'Configuration', render: (l) => configText({ ...l }) || '—', sub: (l) => l.remark || null },
    isSale
      ? { key: 'w', header: 'Warranty', render: (l) => [l.technical_warranty && `${l.technical_warranty}m technical`, l.battery_charger_warranty && `${l.battery_charger_warranty}m battery`].filter(Boolean).join(' · ') || '—' }
      : { key: 'lock', header: 'Lock-in', render: (l) => (l.locking_period ? `${l.locking_period} months` : '—') },
    { key: 'qty', header: 'Qty', numeric: true, render: (l) => l.quantity ?? l.main_quantity },
    { key: 'rate', header: isSale ? 'Price' : 'Monthly rent', numeric: true, render: (l) => <Money value={l.rate} /> },
    { key: 'amt', header: 'Amount', numeric: true, render: (l) => <Money value={lineAmount({ quantity: l.quantity ?? l.main_quantity, rate: l.rate })} /> },
  ];

  return (
    <DeskShell title={qn} breadcrumb="Sell / Quotations" subtitle={head.company_name || head.customer_name}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this quotation" body={state.error} action={<Button onClick={() => navigate('/carret/sell/quotations')}>Back to quotations</Button>} />}
      {data && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={qn}
            type={`Quotation · ${isSale ? 'Sale' : String(head.quotation_type || 'rental').replace(/^\w/, (c) => c.toUpperCase())}`}
            entity={head.entity_code || (isSale ? 'gorefurbo' : 'rentfoxxy')}
            status={label(status)}
            actions={actions}
            meta={[
              { label: 'Customer', value: head.company_name || head.customer_name },
              { label: 'Raised', value: <DateTime value={head.created_at} /> },
              { label: 'Sent', value: head.quotation_sent_at ? <DateTime value={head.quotation_sent_at} /> : '—' },
              { label: 'Accepted', value: head.accepted_at ? <DateTime value={head.accepted_at} /> : '—' },
            ]}
          />
          <FlowSteps steps={flow} />
          {next}

          <div className="c-split">
            <div className="c-stack">
              <Section title={`Laptops · ${lines.reduce((n, l) => n + (Number(l.quantity ?? l.main_quantity) || 0), 0)}`}>
                <DataTable columns={columns} rows={lines} rowKey={(l, i) => l.id || i} />
              </Section>
              <Section title="Addresses">
                <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                  <div><div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div><AddressText address={parseJson(head.customer_billing_address)} empty="Not set (prospect)" /></div>
                  <div><div className="c-label" style={{ marginBottom: '6px' }}>Ship to</div><AddressText address={parseJson(head.customer_shipping_address)} empty="Not set" /></div>
                </div>
              </Section>
            </div>
            <aside className="c-stack">
              <Section title="Totals">
                <div className="c-totals">
                  <div><span>{isSale ? 'Laptops' : 'Monthly rent'}</span><span><Money value={subtotal} /></span></div>
                  {!isSale && <div><span>Security deposit</span><span><Money value={security} /></span></div>}
                  <div><span>Shipping</span><span><Money value={shipping} /></span></div>
                  <div className="is-grand"><span>{isSale ? 'Total' : 'First payment'}</span><span><Money value={subtotal + security + shipping} /></span></div>
                </div>
              </Section>
              <Section title="Contact">
                <KeyValue cols={1} items={[
                  { label: 'Contact person', value: head.contact_name || head.contact_person_name },
                  { label: 'Phone', value: head.customer_mobile },
                  { label: 'Email', value: head.customer_email },
                  { label: 'GSTIN', value: head.gst_number && <DocNumber value={head.gst_number} /> },
                  { label: 'Place of supply', value: head.supply_state && String(head.supply_state).replace(/[_-]/g, ' ') },
                  head.source_lead_id && { label: 'Lead', value: <Link to={`/lead-crm/leads/${head.source_lead_id}`}>#{head.source_lead_id}</Link> },
                  head.status_updated_by_name && { label: 'Status set by', value: head.status_updated_by_name },
                ]}
                />
              </Section>
              {orders.length > 0 && (
                <Section title="Sales orders">
                  {orders.map((o) => (
                    <div key={o.sales_order_number} className="flex items-center" style={{ gap: '8px', padding: '4px 0' }}>
                      <Link to={`/carret/sell/sales-orders/${encodeURIComponent(o.sales_order_number)}`}><DocNumber value={o.sales_order_number} /></Link>
                      <span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}><DateTime value={o.created_at} /></span>
                      <StatusChip status="confirmed" />
                    </div>
                  ))}
                </Section>
              )}
            </aside>
          </div>
        </div>
      )}

      <Drawer
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={status === 'pending' ? 'Send quotation' : 'Resend quotation'}
        footer={(
          <div className="flex justify-end" style={{ gap: '8px' }}>
            <Button variant="quiet" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onSend} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Send'}</Button>
          </div>
        )}
      >
        <FormGrid cols={1}>
          <Field label="To" required>
            <Input type="email" value={send.to} onChange={(e) => setSend((s) => ({ ...s, to: e.target.value }))} />
          </Field>
          <Field label="CC" hint="Comma-separated. Your own address and the sales desk are copied automatically.">
            <Input value={send.cc} onChange={(e) => setSend((s) => ({ ...s, cc: e.target.value }))} />
          </Field>
        </FormGrid>
        <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: '12px' }}>
          The email carries the PDF and a link the customer can use to accept.
        </p>
      </Drawer>

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
