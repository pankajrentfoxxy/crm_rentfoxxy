import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input,
  KeyValue, Money, Notice, Section, Segmented, Select, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  approveConversion, approveLoan, cancelLoan, createLoanDc, getLoan, markRepairCompleted, recordDecision,
  regenerateLoanDcPdf, rejectConversion, rejectLoan,
} from '../../../loan-laptops/loanLaptopApi';
import { openPdf } from '../../sell/sellShared';
import DispatchFields, { dispatchBody, dispatchError, emptyDispatch } from '../DispatchFields';
import { fetchTechnicians } from '../serveApi';
import { errMsg } from '../serveShared';
import {
  CONFIRMATION_METHODS, DC_PURPOSE_LABEL, LOAN_STATUS, LoanChip, PolicyChip, loanFlow, specLine, todayIst,
} from './loanShared';

/**
 * Serve → a loan laptop (LNR/yy-yy/NNNN).
 *
 * One card says what happens next and who does it; everything below is the
 * record. Same endpoints and rules as the old loan page: Accounts approve the
 * loan and the rental price that applies only if the customer keeps it;
 * warehouse raises the Loan DC (delivery_challans edit); Support marks the
 * repair done and records the customer's decision.
 */
const CANCELLABLE = new Set(['requested', 'pending_approval', 'approved', 'dc_generated']);

const DECISIONS = [
  { value: 'return_loan', label: 'Takes their laptop back' },
  { value: 'keep_loan', label: 'Keeps the loan laptop' },
];

function laptopItems(l, { converted = false } = {}) {
  if (!l) return [{ label: 'Laptop', value: 'Not found' }];
  return [
    { label: 'TTSPL', value: <DocNumber value={l.ttspl_id || '—'} /> },
    { label: 'Serial', value: l.serial_number },
    { label: 'Configuration', value: specLine(l.spec) },
    { label: 'Inventory', value: String(l.inventory_status || '—').replace(/_/g, ' ') },
    { label: 'Rent from', value: l.rent_start_date ? <DateTime value={l.rent_start_date} /> : (converted ? '—' : 'Not billed') },
    ...(l.rent_end_date ? [{ label: 'Rent to', value: <DateTime value={l.rent_end_date} /> }] : []),
    { label: 'Monthly rent', value: l.rent_start_date ? <Money value={l.rent_monthly_rate} /> : '—' },
  ];
}

export default function LoanRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [loan, setLoan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [techs, setTechs] = useState([]);

  // Forms for whichever step is showing.
  const [price, setPrice] = useState('');
  const [remarks, setRemarks] = useState('');
  const [dispatch, setDispatch] = useState(emptyDispatch());
  const [decision, setDecision] = useState('');
  const [confirmation, setConfirmation] = useState({ method: '', confirmed_by: '', reference: '' });
  const [createSdc, setCreateSdc] = useState(true);
  const [sdcDispatch, setSdcDispatch] = useState(emptyDispatch());
  const [effectiveDate, setEffectiveDate] = useState(todayIst());
  const [retro, setRetro] = useState(false);
  const [retroReason, setRetroReason] = useState('');
  const [reasonFor, setReasonFor] = useState(null); // { title, hint, action, ok }
  const [reason, setReason] = useState('');

  const load = useCallback(() => getLoan(id)
    .then(({ data }) => {
      const l = data.data;
      setLoan(l);
      setError('');
      if (l.status === 'conversion_pending_approval') {
        setPrice(String(l.proposed_rent_monthly_rate ?? l.approved_rent_monthly_rate ?? ''));
        setEffectiveDate(String(l.proposed_effective_date || todayIst()).slice(0, 10));
      } else if (l.status === 'pending_approval') {
        setPrice(String(l.original_rent_monthly_rate ?? ''));
      } else if (l.status === 'decision_pending') {
        setPrice(String(l.approved_rent_monthly_rate ?? l.original_rent_monthly_rate ?? ''));
      }
    })
    .catch((e) => setError(errMsg(e, 'Could not load the loan'))), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchTechnicians().then(({ data }) => setTechs(data.technicians || [])).catch(() => {}); }, []);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.data?.already ? 'Already done — nothing changed' : ok);
      setRemarks('');
      await load();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const askReason = (title, hint, action, ok) => { setReason(''); setReasonFor({ title, hint, action, ok }); };

  if (error) {
    return (
      <DeskShell title="Loan laptop" breadcrumb="Support / Loan laptops">
        <EmptyState title="Could not load" body={error} action={<Button onClick={() => navigate('/carret/serve/loans')}>Back</Button>} />
      </DeskShell>
    );
  }
  if (!loan) return <DeskShell title="Loan laptop" breadcrumb="Support / Loan laptops"><EmptyState title="Loading…" /></DeskShell>;

  const canSupport = hasPermission('loan_laptops', 'edit');
  const canAccounts = hasPermission('loan_laptop_approval', 'edit');
  const canIssue = hasPermission('delivery_challans', 'edit');
  const docs = loan.documents || [];
  const today = todayIst();
  const conf = loan.customer_confirmation;
  const confText = conf
    ? `${CONFIRMATION_METHODS.find((m) => m.value === conf.method)?.label || conf.method} — ${conf.confirmed_by}${conf.reference ? ` (${conf.reference})` : ''}`
    : null;
  const pickup = loan.original_pickup;
  const ended = ['rejected', 'cancelled'].includes(loan.status);
  const dispatchMissing = dispatchError(dispatch, { needAddress: false });
  const sdcMissing = createSdc ? dispatchError(sdcDispatch, { needAddress: false }) : null;

  /* ------------------------------------------------------------ next step */
  let next = null;
  if (loan.status === 'pending_approval') {
    next = canAccounts ? (
      <Section title="Accounts approval">
        <p style={{ marginBottom: '8px' }}>
          {loan.policy_rule_name || 'The replacement policy'} asks for approval. Set the monthly rent that applies
          {' '}<strong>only if the customer later keeps this laptop</strong>. Nothing is charged while it is on loan.
        </p>
        <FormGrid cols={2}>
          <Field label="Monthly rent if kept (₹)" required hint={`The customer's laptop is at ₹${Number(loan.original_rent_monthly_rate || 0).toLocaleString('en-IN')}/month`}>
            <Input type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </FormGrid>
        <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '12px' }}>
          <Button variant="primary" disabled={busy || !(Number(price) > 0)} onClick={() => run(() => approveLoan(loan.id, { approved_rent_monthly_rate: Number(price), remarks }), 'Loan approved — warehouse raises the Loan DC')}>Approve loan</Button>
          <Button disabled={busy} onClick={() => askReason('Reject this loan', 'The laptop goes back to stock and Support is told why.', (r) => rejectLoan(loan.id, r), 'Loan rejected')}>Reject</Button>
        </div>
      </Section>
    ) : <Notice tone="warn" title="Waiting for Accounts">{loan.policy_rule_name || 'The replacement policy'} needs Accounts to approve this loan.</Notice>;
  } else if (loan.status === 'approved') {
    next = canIssue ? (
      <Section title="Raise the Loan DC">
        <p style={{ marginBottom: '8px' }}>
          <DocNumber value={loan.loan_ttspl_id} /> goes out on its own Loan DC — no Sales Order, no price. It then goes through
          the gate and is delivered with OTP / POD like any challan.
        </p>
        <DispatchFields value={dispatch} onChange={setDispatch} technicians={techs} showAddress={false} />
        <div style={{ marginTop: '12px' }}>
          <Button variant="primary" disabled={busy || Boolean(dispatchMissing)} title={dispatchMissing || undefined} onClick={() => run(() => createLoanDc(loan.id, dispatchBody(dispatch)), 'Loan DC raised')}>Raise Loan DC</Button>
        </div>
      </Section>
    ) : <Notice tone="info" title="Approved — waiting for the warehouse">Warehouse / dispatch raise the Loan DC.</Notice>;
  } else if (['dc_generated', 'dispatched'].includes(loan.status)) {
    next = (
      <Notice tone="info" title={loan.status === 'dc_generated' ? 'Loan DC ready at the warehouse' : 'Out for delivery'}>
        {loan.loan_dc_number} goes through the gate (outward) and is delivered from the delivery register with OTP / POD.
        On delivery the laptop is <strong>on loan</strong> — still not billed.
      </Notice>
    );
  } else if (loan.status === 'loan_active') {
    const done = loan.repair_status?.done;
    next = (
      <Section title="The customer's laptop">
        {done
          ? <Notice tone="good" title="Repaired and back in stock">Mark the repair done, then record what the customer wants.</Notice>
          : (
            <ul style={{ paddingLeft: '18px', listStyle: 'disc', marginBottom: '8px' }}>
              {(loan.repair_status?.reasons || ['Repair still in progress']).map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        {canSupport && (
          <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '8px' }}>
            <Button variant="primary" disabled={busy || !done} onClick={() => run(() => markRepairCompleted(loan.id, {}), 'Repair done — record the customer decision')}>Mark repair done</Button>
            {!done && loan.repair_status?.original_received && (
              <Button disabled={busy} onClick={() => askReason('Mark the repair done anyway', 'Say why the repair is finished although the checks above are not met.', (r) => markRepairCompleted(loan.id, { override: true, remarks: r }), 'Repair done (override)')}>Override</Button>
            )}
          </div>
        )}
      </Section>
    );
  } else if (loan.status === 'decision_pending') {
    next = canSupport ? (
      <Section title="What does the customer want?">
        <Segmented label="Customer decision" value={decision} onChange={setDecision} options={DECISIONS} />
        <p className="text-ink-3" style={{ margin: '8px 0 12px' }}>
          {decision === 'keep_loan'
            ? 'Accounts approve the rent and the date it starts; the loan laptop then becomes their rented laptop and the old one comes off rent the day before.'
            : decision === 'return_loan'
              ? 'The repaired laptop goes back on a Service DC; the loan laptop is collected on a Return DC.'
              : 'Pick one.'}
        </p>
        {decision && (
          <div className="c-stack">
            <FormGrid cols={3}>
              <Field label="Customer confirmed by" required={decision === 'keep_loan'}>
                <Select value={confirmation.method} onChange={(e) => setConfirmation({ ...confirmation, method: e.target.value })} placeholder="Choose…" options={CONFIRMATION_METHODS} />
              </Field>
              <Field label="Who at the customer" required={decision === 'keep_loan'}>
                <Input placeholder="Name / designation" value={confirmation.confirmed_by} onChange={(e) => setConfirmation({ ...confirmation, confirmed_by: e.target.value })} />
              </Field>
              <Field label="Reference"><Input placeholder="Email subject, call time…" value={confirmation.reference} onChange={(e) => setConfirmation({ ...confirmation, reference: e.target.value })} /></Field>
            </FormGrid>
            {decision === 'return_loan' ? (
              <>
                <div className="text-ink-2" style={{ fontWeight: 600 }}>Collect the loan laptop</div>
                <DispatchFields value={dispatch} onChange={setDispatch} technicians={techs} showAddress={false} />
                <Checkbox label="Also raise the Service DC to send the repaired laptop back now" checked={createSdc} onChange={(e) => setCreateSdc(e.target.checked)} />
                {createSdc && (
                  <>
                    <div className="text-ink-2" style={{ fontWeight: 600 }}>Deliver the repaired laptop</div>
                    <DispatchFields value={sdcDispatch} onChange={setSdcDispatch} technicians={techs} showAddress={false} />
                  </>
                )}
              </>
            ) : (
              <FormGrid cols={2}>
                <Field label="Rent starts (proposed)" required><Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></Field>
                <Field label="Monthly rent (proposed, ₹)"><Input type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              </FormGrid>
            )}
            <div>
              <Button
                variant="primary"
                disabled={busy || (decision === 'return_loan'
                  ? Boolean(dispatchMissing || sdcMissing)
                  : !confirmation.method || !confirmation.confirmed_by.trim())}
                onClick={() => run(() => recordDecision(loan.id, {
                  decision,
                  confirmation: confirmation.method ? confirmation : null,
                  return_pickup: decision === 'return_loan' ? dispatchBody(dispatch) : undefined,
                  service_dc: decision === 'return_loan' && createSdc ? { create: true, ...dispatchBody(sdcDispatch) } : undefined,
                  proposed_effective_date: decision === 'keep_loan' ? effectiveDate : undefined,
                  proposed_rent_monthly_rate: decision === 'keep_loan' && price ? Number(price) : undefined,
                }), decision === 'keep_loan' ? 'Sent to Accounts' : 'Return pickup raised for the loan laptop')}
              >
                {decision === 'keep_loan' ? 'Send to Accounts' : 'Raise the return pickup'}
              </Button>
            </div>
          </div>
        )}
      </Section>
    ) : <Notice tone="info" title="Waiting for the customer's decision">Support records whether the customer takes their laptop back or keeps the loan one.</Notice>;
  } else if (loan.status === 'return_in_progress') {
    next = (
      <Notice
        tone="info"
        title="The loan laptop is coming back"
        action={<Button onClick={() => navigate(`/carret/serve/tickets/${loan.loan_return_ticket_id}`)}>Pickup ticket #{loan.loan_return_ticket_id}</Button>}
      >
        On Return DC {loan.loan_return_dc_number}. The loan closes when the warehouse receives it; it then goes through QC back to stock.
      </Notice>
    );
  } else if (loan.status === 'conversion_pending_approval') {
    const past = effectiveDate < today;
    next = canAccounts ? (
      <Section title="Approve: the customer keeps the loan laptop">
        <p style={{ marginBottom: '8px' }}>
          On approval <DocNumber value={loan.loan_ttspl_id} /> is the customer&apos;s rented laptop from the date below, and
          {' '}<DocNumber value={loan.original_ttspl_id} />&apos;s rent ends the day before (unused prepaid days go to a pending credit note).
        </p>
        {confText && <p className="text-ink-3" style={{ marginBottom: '8px' }}>Customer confirmed: {confText}</p>}
        <FormGrid cols={2}>
          <Field label="Monthly rent (₹)" required><Input type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Rent starts" required><Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></Field>
          <Field label="Remarks" span={2}><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </FormGrid>
        {past && (
          <Notice tone="warn" title="This date is in the past">
            <Checkbox label="I authorise charging rent from this past date" checked={retro} onChange={(e) => setRetro(e.target.checked)} />
            {retro && <Field label="Why" required><Input value={retroReason} onChange={(e) => setRetroReason(e.target.value)} /></Field>}
          </Notice>
        )}
        <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '12px' }}>
          <Button
            variant="primary"
            disabled={busy || !(Number(price) > 0) || !effectiveDate || (past && (!retro || !retroReason.trim()))}
            onClick={() => run(() => approveConversion(loan.id, {
              rent_monthly_rate: Number(price),
              effective_date: effectiveDate,
              retroactive_authorized: past ? retro : false,
              retroactive_reason: retroReason || undefined,
              remarks,
            }), 'Converted — rent starts on the date given')}
          >
            Approve and start rent
          </Button>
          <Button disabled={busy} onClick={() => askReason('Reject keeping the loan laptop', 'It goes back to Support for the customer decision.', (r) => rejectConversion(loan.id, r), 'Sent back to the customer decision')}>Reject</Button>
        </div>
      </Section>
    ) : <Notice tone="warn" title="The customer keeps it — waiting for Accounts">Accounts approve the rent and the date it starts.</Notice>;
  } else if (loan.status === 'converted') {
    next = (
      <Notice tone="good" title="Kept by the customer — now a rental">
        Rent ₹{Number(loan.conversion_rent_monthly_rate || 0).toLocaleString('en-IN')}/month from <DateTime value={loan.conversion_effective_date} />;
        {' '}{loan.original_ttspl_id}&apos;s rent ended <DateTime value={loan.original_rent_end_date} />.
      </Notice>
    );
  } else if (ended) {
    next = (
      <Notice tone="crit" title={`This loan was ${loan.status}`}>
        {loan.rejection_reason || loan.cancellation_reason || ''}
      </Notice>
    );
  }

  return (
    <DeskShell title={loan.request_number} breadcrumb="Support / Loan laptops" subtitle={loan.customer_name || `Customer #${loan.customer_id}`}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={loan.request_number}
          type="Loan laptop"
          actions={(
            <>
              <LoanChip status={loan.status} />
              <Button onClick={() => navigate(`/carret/serve/tickets/${loan.ticket_id}`)}>Ticket #{loan.ticket_id}</Button>
              {CANCELLABLE.has(loan.status) && canSupport && (
                <Button variant="quiet" disabled={busy} onClick={() => askReason('Cancel this loan', 'The laptop goes back to stock; an open Loan DC is cancelled.', (r) => cancelLoan(loan.id, r), 'Loan cancelled')}>Cancel loan</Button>
              )}
              <Button variant="quiet" onClick={() => navigate(`/loan-laptops/${loan.id}`)}>Old view</Button>
            </>
          )}
          meta={[
            { label: 'Customer', value: loan.customer_name },
            { label: 'Loan laptop', value: <DocNumber value={loan.loan_ttspl_id || '—'} /> },
            { label: 'Their laptop', value: <DocNumber value={loan.original_ttspl_id || '—'} /> },
            { label: 'Loan DC', value: loan.loan_dc_number ? <DocNumber value={loan.loan_dc_number} /> : '—' },
            { label: 'Raised', value: <DateTime value={loan.created_at} /> },
            { label: 'Raised by', value: loan.created_by_name || '—' },
          ]}
        />
        {!ended && <FlowSteps steps={loanFlow(loan)} />}
        {next}

        <div className="c-split">
          <Section title="Loan laptop">
            <KeyValue cols={2} items={laptopItems(loan.loan_laptop, { converted: loan.status === 'converted' })} />
          </Section>
          <Section title={loan.status === 'converted' ? 'Laptop it replaced' : loan.status === 'returned' ? "Customer's laptop (repaired)" : "Customer's laptop (in repair)"}>
            <KeyValue cols={2} items={laptopItems(loan.original_laptop)} />
          </Section>
        </div>

        {pickup && (
          <Section title="Repair pickup of the customer's laptop">
            <p className="text-ink-3" style={{ marginBottom: '8px' }}>Tracked on its own — the loan can go out before this pickup.</p>
            <KeyValue cols={3} items={[
              { label: 'Pickup', value: String(pickup.status || '—').replace(/_/g, ' ') },
              { label: 'How', value: [pickup.method, pickup.courier_name].filter(Boolean).join(' · ') || '—' },
              { label: 'AWB', value: pickup.awb_number || '—' },
              { label: 'Return DC', value: pickup.return_dc_number ? <DocNumber value={pickup.return_dc_number} /> : '—' },
              { label: 'Collected', value: pickup.picked_up_at ? <DateTime value={pickup.picked_up_at} /> : (pickup.collected ? 'Yes' : 'Not yet') },
              { label: 'At warehouse', value: pickup.warehouse_received_at ? <DateTime value={pickup.warehouse_received_at} /> : 'Not yet' },
            ]}
            />
          </Section>
        )}

        <div className="c-split">
          <Section title="Policy and price">
            <div style={{ marginBottom: '8px' }}><PolicyChip decision={loan.policy_decision} /></div>
            <KeyValue cols={2} items={[
              { label: 'Rule', value: loan.policy_rule_name },
              { label: 'Their laptop rent', value: <Money value={loan.original_rent_monthly_rate} /> },
              { label: 'Rent if kept', value: loan.approved_rent_monthly_rate != null ? <Money value={loan.approved_rent_monthly_rate} /> : '—' },
              { label: 'Approved by', value: loan.approved_by_name || '—' },
              ...(loan.status === 'converted' ? [
                { label: 'Rent now', value: <Money value={loan.conversion_rent_monthly_rate} /> },
                { label: 'Rent from', value: <DateTime value={loan.conversion_effective_date} /> },
                { label: 'Old laptop rent ends', value: <DateTime value={loan.original_rent_end_date} /> },
                { label: 'Conversion approved by', value: loan.conversion_approved_by_name || '—' },
                ...(loan.retroactive_authorized ? [{ label: 'Back-dated because', value: loan.retroactive_reason }] : []),
                ...(loan.original_credit_note_id ? [{ label: 'Credit note', value: `#${loan.original_credit_note_id} (pending)` }] : []),
              ] : []),
            ]}
            />
          </Section>
          <Section title="Delivery and decision">
            <KeyValue cols={2} items={[
              { label: 'Deliver to', value: [loan.delivery_address?.address, loan.delivery_address?.city, loan.delivery_address?.pincode].filter(Boolean).join(', ') || '—' },
              { label: 'Contact', value: [loan.contact_name, loan.contact_phone].filter(Boolean).join(' · ') || '—' },
              { label: 'Delivered', value: loan.delivered_at ? <DateTime value={loan.delivered_at} /> : '—' },
              { label: 'Decision', value: loan.customer_decision === 'keep_loan' ? 'Keeps the loan laptop' : loan.customer_decision === 'return_loan' ? 'Takes their laptop back' : '—' },
              { label: 'Confirmed', value: confText || '—' },
              { label: 'Remarks', value: loan.request_remarks || '—' },
            ]}
            />
          </Section>
        </div>

        <Section
          title="Challans"
          actions={loan.loan_dc_number && <Button variant="quiet" disabled={busy} onClick={() => run(() => regenerateLoanDcPdf(loan.id), 'Loan DC PDF made again')}>Remake Loan DC PDF</Button>}
        >
          {docs.length === 0 ? <EmptyState title="No challans yet" /> : (
            <DataTable
              columns={[
                { key: 'n', header: 'Challan', render: (d) => <DocNumber value={d.dc_number} />, sub: (d) => DC_PURPOSE_LABEL[d.dc_purpose] || d.dc_purpose },
                { key: 's', header: 'Status', render: (d) => String(d.status || '—').replace(/_/g, ' ') },
                { key: 'd', header: 'Delivered', render: (d) => (d.delivered_at ? <DateTime value={d.delivered_at} /> : '—') },
                { key: 'p', header: '', render: (d) => (d.pdf_path ? <Button variant="quiet" onClick={(e) => { e.stopPropagation(); openPdf(d.pdf_path); }}>PDF</Button> : null) },
              ]}
              rows={docs}
              rowKey={(d) => d.dc_number}
            />
          )}
          <p className="text-ink-3" style={{ marginTop: '8px' }}>A Loan DC carries no price and never starts rent.</p>
        </Section>

        <Section title="History">
          {(loan.events || []).length === 0 ? <EmptyState title="Nothing yet" /> : (
            <DataTable
              columns={[
                { key: 'w', header: 'When', render: (ev) => <DateTime value={ev.created_at} /> },
                {
                  key: 'a',
                  header: 'What',
                  render: (ev) => `${String(ev.action).replace(/_/g, ' ')}${ev.to_status ? ` → ${LOAN_STATUS[ev.to_status]?.label || ev.to_status}` : ''}`,
                  sub: (ev) => ev.detail?.reason || null,
                },
                { key: 'u', header: 'Who', render: (ev) => ev.actor_name || '—' },
              ]}
              rows={[...(loan.events || [])].reverse()}
              rowKey={(ev) => ev.id}
            />
          )}
        </Section>
      </div>

      <Drawer
        open={Boolean(reasonFor)}
        onClose={() => setReasonFor(null)}
        title={reasonFor?.title}
        footer={(
          <Button
            variant="primary"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => { if (await run(() => reasonFor.action(reason.trim()), reasonFor.ok)) setReasonFor(null); }}
          >
            {reasonFor?.title}
          </Button>
        )}
      >
        {reasonFor?.hint && <p style={{ marginBottom: '8px' }}>{reasonFor.hint}</p>}
        <Field label="Why" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Drawer>
    </DeskShell>
  );
}
