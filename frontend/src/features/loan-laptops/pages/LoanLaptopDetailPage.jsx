import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, CircleDot, FileText, Laptop, RefreshCw, ShieldCheck, Wrench, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { usePermission } from '../../../hooks/usePermission';
import { PageHeader, Button, Card, SectionLoader } from '../../../components/ui/primitives';
import { getBackendOrigin } from '../../../utils/api';
import LoanStatusBadge, { PolicyBadge } from '../components/LoanStatusBadge';
import DispatchFields, { EMPTY_DISPATCH, dispatchIsComplete } from '../components/DispatchFields';
import {
  getLoan, approveLoan, rejectLoan, createLoanDc, regenerateLoanDcPdf, markRepairCompleted,
  recordDecision, approveConversion, rejectConversion, cancelLoan, errorMessage,
} from '../loanLaptopApi';
import {
  LOAN_STATUS, CONFIRMATION_METHODS, formatMoney, formatDate, todayIst, specLine,
} from '../loanConstants';

const MAIN_PATH = ['requested', 'pending_approval', 'approved', 'dc_generated', 'dispatched', 'loan_active', 'decision_pending'];
const CANCELLABLE = new Set(['requested', 'pending_approval', 'approved', 'dc_generated']);
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px]';
const label = 'block text-xs font-semibold text-slate-600 mb-1';

function Field({ name, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm border-b border-slate-100 last:border-0">
      <span className="text-slate-500 shrink-0">{name}</span>
      <span className="text-slate-900 text-right min-w-0 break-words">{children ?? '—'}</span>
    </div>
  );
}

function Stepper({ status, approvalRequired, decision }) {
  const steps = MAIN_PATH.filter((s) => s !== 'pending_approval' || approvalRequired);
  const end = decision === 'keep_loan' || ['conversion_pending_approval', 'converted'].includes(status)
    ? ['conversion_pending_approval', 'converted']
    : ['return_in_progress', 'returned'];
  const all = [...steps, ...end];
  const idx = all.indexOf(status === 'repair_completed' ? 'decision_pending' : status);
  if (['rejected', 'cancelled'].includes(status)) {
    return <p className="text-sm text-red-700 font-medium">This loan was {status}.</p>;
  }
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {all.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const current = i === idx;
        return (
          <li key={s} className="flex items-center gap-1.5 shrink-0 text-xs">
            {done ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              : <CircleDot className={`w-4 h-4 ${current ? 'text-blue-600' : 'text-slate-300'}`} />}
            <span className={current ? 'font-semibold text-blue-700' : done ? 'text-slate-700' : 'text-slate-400'}>
              {LOAN_STATUS[s]?.label || s}
            </span>
            {i < all.length - 1 && <span className="text-slate-300 px-1">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function LaptopCard({ title, laptop, badge, extra }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {badge}
      </div>
      {laptop ? (
        <>
          <p className="font-mono font-semibold text-slate-900">{laptop.ttspl_id}</p>
          <p className="text-xs text-slate-500 mb-2">{laptop.serial_number}</p>
          <p className="text-sm text-slate-700 mb-3">{specLine(laptop.spec)}</p>
          <Field name="Inventory status">{laptop.inventory_status}</Field>
          <Field name="Rent start">{laptop.rent_start_date ? formatDate(laptop.rent_start_date) : 'Not billed'}</Field>
          {laptop.rent_end_date && <Field name="Rent end">{formatDate(laptop.rent_end_date)}</Field>}
          <Field name="Monthly rate">{laptop.rent_start_date ? formatMoney(laptop.rent_monthly_rate) : '—'}</Field>
          {extra}
        </>
      ) : <p className="text-sm text-slate-500">Not found</p>}
    </Card>
  );
}

function ActionCard({ title, icon: Icon, tone = 'blue', children }) {
  const tones = { blue: 'border-blue-200 bg-blue-50/40', amber: 'border-amber-200 bg-amber-50/40', green: 'border-emerald-200 bg-emerald-50/40' };
  return (
    <section className={`rounded-2xl border p-4 ${tones[tone] || tones.blue}`}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 mb-3">
        {Icon && <Icon className="w-5 h-5" />}{title}
      </h2>
      {children}
    </section>
  );
}

export default function LoanLaptopDetailPage() {
  const { id } = useParams();
  const { hasPermission } = usePermission();
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Form state for whichever action is showing.
  const [price, setPrice] = useState('');
  const [remarks, setRemarks] = useState('');
  const [dispatch, setDispatch] = useState(EMPTY_DISPATCH);
  const [decision, setDecision] = useState('');
  const [confirmation, setConfirmation] = useState({ method: '', confirmed_by: '', reference: '' });
  const [createSdc, setCreateSdc] = useState(true);
  const [sdcDispatch, setSdcDispatch] = useState(EMPTY_DISPATCH);
  const [effectiveDate, setEffectiveDate] = useState(todayIst());
  const [retro, setRetro] = useState(false);
  const [retroReason, setRetroReason] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await getLoan(id);
      setLoan(data.data);
      const l = data.data;
      if (l.status === 'conversion_pending_approval') {
        setPrice(String(l.proposed_rent_monthly_rate ?? l.approved_rent_monthly_rate ?? ''));
        setEffectiveDate(String(l.proposed_effective_date || todayIst()).slice(0, 10));
      } else if (l.status === 'pending_approval') {
        setPrice(String(l.original_rent_monthly_rate ?? ''));
      } else if (l.status === 'decision_pending') {
        setPrice(String(l.approved_rent_monthly_rate ?? l.original_rent_monthly_rate ?? ''));
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load loan'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.data?.already ? 'Already done — nothing changed' : success);
      setRemarks('');
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-4"><SectionLoader /></div>;
  if (!loan) return <div className="p-4 text-sm text-slate-500">Loan request not found.</div>;

  const can = (section, action) => hasPermission(section, action);
  const canSupport = can('loan_laptops', 'edit');
  const canAccounts = can('loan_laptop_approval', 'edit');
  const canIssue = can('delivery_challans', 'edit');
  const docs = loan.documents || [];
  const loanDc = docs.find((d) => d.dc_number === loan.loan_dc_number);
  const confirmationText = loan.customer_confirmation
    ? `${CONFIRMATION_METHODS.find((m) => m.value === loan.customer_confirmation.method)?.label || loan.customer_confirmation.method} — ${loan.customer_confirmation.confirmed_by}${loan.customer_confirmation.reference ? ` (${loan.customer_confirmation.reference})` : ''}`
    : null;

  const promptReason = (title) => {
    const reason = window.prompt(title);
    return reason && reason.trim() ? reason.trim() : null;
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <Link to="/loan-laptops" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> Loan laptops
      </Link>
      <PageHeader
        title={loan.request_number}
        subtitle={`${loan.customer_name || `Customer #${loan.customer_id}`} · Support ticket #${loan.ticket_id}`}
        icon={Laptop}
        actions={(
          <>
            <LoanStatusBadge status={loan.status} />
            <Link to={`/support/tickets/${loan.ticket_id}`}><Button variant="secondary" size="sm">Open ticket</Button></Link>
          </>
        )}
      >
        <Stepper status={loan.status} approvalRequired={loan.approval_required} decision={loan.customer_decision} />
      </PageHeader>

      {/* ── Next action ─────────────────────────────────────────────────── */}
      {loan.status === 'pending_approval' && (
        canAccounts ? (
          <ActionCard title="Accounts approval" icon={ShieldCheck} tone="amber">
            <p className="text-sm text-slate-700 mb-3">
              {loan.policy_rule_name || 'Replacement policy'} — set the monthly rental that applies <strong>only if the customer later keeps this laptop</strong>.
              Nothing is charged while it is on loan.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Approved monthly rental (₹)</label>
                <input className={input} type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                <p className="text-xs text-slate-500 mt-1">Original laptop rate: {formatMoney(loan.original_rent_monthly_rate)}</p>
              </div>
              <div>
                <label className={label}>Remarks</label>
                <input className={input} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="success" loading={busy} disabled={!(Number(price) > 0)}
                onClick={() => run(() => approveLoan(loan.id, { approved_rent_monthly_rate: Number(price), remarks }), 'Loan approved')}>
                Approve loan
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => {
                const reason = promptReason('Why is this loan rejected?');
                if (reason) run(() => rejectLoan(loan.id, reason), 'Loan rejected');
              }}>Reject</Button>
            </div>
          </ActionCard>
        ) : <ActionCard title="Waiting for Accounts approval" icon={ShieldCheck} tone="amber"><p className="text-sm text-slate-700">{loan.policy_rule_name}</p></ActionCard>
      )}

      {loan.status === 'approved' && (
        canIssue ? (
          <ActionCard title="Generate Loan DC" icon={FileText}>
            <p className="text-sm text-slate-700 mb-3">
              Issues <span className="font-mono">{loan.loan_ttspl_id}</span> on its own Loan DC (no Sales Order). It then goes out through the guard gate and
              delivery POD like any DC.
            </p>
            <DispatchFields value={dispatch} onChange={setDispatch} label="Delivery to the customer" />
            <div className="mt-4">
              <Button loading={busy} disabled={!dispatchIsComplete(dispatch)}
                onClick={() => run(() => createLoanDc(loan.id, dispatch), 'Loan DC generated')}>
                Generate Loan DC
              </Button>
            </div>
          </ActionCard>
        ) : <ActionCard title="Approved — waiting for warehouse to issue the Loan DC" icon={FileText}><p className="text-sm text-slate-700">Warehouse / dispatch generate the Loan DC.</p></ActionCard>
      )}

      {['dc_generated', 'dispatched'].includes(loan.status) && (
        <ActionCard title={loan.status === 'dc_generated' ? 'Loan DC ready at warehouse' : 'Out for delivery'} icon={FileText}>
          <p className="text-sm text-slate-700">
            {loan.loan_dc_number} goes through the guard gate (outward) and is delivered from the Delivery Register with POD/OTP.
            On delivery the laptop becomes <strong>on loan</strong> — still not billed.
          </p>
        </ActionCard>
      )}

      {loan.status === 'loan_active' && (
        <ActionCard title="Original laptop repair" icon={Wrench} tone="green">
          {loan.repair_status?.done ? (
            <p className="text-sm text-emerald-800 mb-3">The original laptop is repaired and back in stock.</p>
          ) : (
            <ul className="text-sm text-slate-700 mb-3 list-disc pl-5">
              {(loan.repair_status?.reasons || ['Repair still in progress']).map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {canSupport && (
            <div className="flex flex-wrap gap-2">
              <Button variant="success" loading={busy} disabled={!loan.repair_status?.done}
                onClick={() => run(() => markRepairCompleted(loan.id, {}), 'Repair completed — record the customer decision')}>
                Mark repair completed
              </Button>
              {!loan.repair_status?.done && loan.repair_status?.original_received && (
                <Button variant="secondary" disabled={busy} onClick={() => {
                  const reason = promptReason('Override: explain why the repair is complete although the checks above fail');
                  if (reason) run(() => markRepairCompleted(loan.id, { override: true, remarks: reason }), 'Repair completed (override)');
                }}>Override</Button>
              )}
            </div>
          )}
        </ActionCard>
      )}

      {loan.status === 'decision_pending' && canSupport && (
        <ActionCard title="Customer decision" icon={RefreshCw} tone="green">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {[
              ['return_loan', 'Takes the repaired laptop back', 'Original goes back on a Service DC; the loan laptop is collected on a Return DC.'],
              ['keep_loan', 'Keeps the loan laptop', 'Accounts approve price + effective date; then it becomes their active rented laptop.'],
            ].map(([value, title, hint]) => (
              <button key={value} type="button" onClick={() => setDecision(value)}
                className={`text-left rounded-xl border p-3 ${decision === value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500 mt-1">{hint}</p>
              </button>
            ))}
          </div>
          {decision && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={label}>Customer confirmed by {decision === 'keep_loan' ? '(required)' : ''}</label>
                  <select className={input} value={confirmation.method} onChange={(e) => setConfirmation({ ...confirmation, method: e.target.value })}>
                    <option value="">Select…</option>
                    {CONFIRMATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Customer contact</label>
                  <input className={input} placeholder="Name / designation" value={confirmation.confirmed_by} onChange={(e) => setConfirmation({ ...confirmation, confirmed_by: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Reference</label>
                  <input className={input} placeholder="Email subject, call time…" value={confirmation.reference} onChange={(e) => setConfirmation({ ...confirmation, reference: e.target.value })} />
                </div>
              </div>
              {decision === 'return_loan' ? (
                <>
                  <DispatchFields value={dispatch} onChange={setDispatch} label="Collect the loan laptop by" />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={createSdc} onChange={(e) => setCreateSdc(e.target.checked)} />
                    Also create the Service DC to send the repaired laptop back now
                  </label>
                  {createSdc && <DispatchFields value={sdcDispatch} onChange={setSdcDispatch} label="Deliver the repaired laptop by" />}
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Proposed effective date</label>
                    <input className={input} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Proposed monthly rental (₹)</label>
                    <input className={input} type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </div>
                </div>
              )}
              <Button
                loading={busy}
                disabled={
                  decision === 'return_loan'
                    ? !dispatchIsComplete(dispatch) || (createSdc && !dispatchIsComplete(sdcDispatch))
                    : !confirmation.method || !confirmation.confirmed_by.trim()
                }
                onClick={() => run(() => recordDecision(loan.id, {
                  decision,
                  confirmation: confirmation.method ? confirmation : null,
                  return_pickup: decision === 'return_loan' ? dispatch : undefined,
                  service_dc: decision === 'return_loan' && createSdc ? { create: true, ...sdcDispatch } : undefined,
                  proposed_effective_date: decision === 'keep_loan' ? effectiveDate : undefined,
                  proposed_rent_monthly_rate: decision === 'keep_loan' && price ? Number(price) : undefined,
                }), decision === 'keep_loan' ? 'Sent to Accounts for approval' : 'Loan return pickup created')}
              >
                {decision === 'keep_loan' ? 'Send to Accounts' : 'Create loan return pickup'}
              </Button>
            </div>
          )}
        </ActionCard>
      )}

      {loan.status === 'return_in_progress' && (
        <ActionCard title="Loan laptop coming back" icon={RefreshCw}>
          <p className="text-sm text-slate-700">
            Pickup ticket <Link className="text-blue-700 underline" to={`/support/tickets/${loan.loan_return_ticket_id}`}>#{loan.loan_return_ticket_id}</Link> on
            Return DC {loan.loan_return_dc_number}. The loan closes when the warehouse signs for the laptop; it then goes through QC back to stock.
          </p>
        </ActionCard>
      )}

      {loan.status === 'conversion_pending_approval' && (
        canAccounts ? (
          <ActionCard title="Approve: customer keeps the loan laptop" icon={ShieldCheck} tone="amber">
            <p className="text-sm text-slate-700 mb-3">
              On approval {loan.loan_ttspl_id} becomes the customer&apos;s active rented laptop from the effective date, and{' '}
              {loan.original_ttspl_id}&apos;s rent ends the day before (unused prepaid days go to a pending credit note).
            </p>
            {confirmationText && <p className="text-xs text-slate-600 mb-3">Customer confirmation: {confirmationText}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Monthly rental (₹)</label>
                <input className={input} type="number" min="1" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className={label}>Effective date (billing starts)</label>
                <input className={input} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
            </div>
            {effectiveDate < todayIst() && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm text-amber-900">
                  <input type="checkbox" checked={retro} onChange={(e) => setRetro(e.target.checked)} />
                  I authorise charging rent from this past date
                </label>
                {retro && <input className={input} placeholder="Reason for the retroactive date" value={retroReason} onChange={(e) => setRetroReason(e.target.value)} />}
              </div>
            )}
            <div className="mt-3">
              <label className={label}>Remarks</label>
              <input className={input} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="success" loading={busy}
                disabled={!(Number(price) > 0) || !effectiveDate || (effectiveDate < todayIst() && (!retro || !retroReason.trim()))}
                onClick={() => run(() => approveConversion(loan.id, {
                  rent_monthly_rate: Number(price),
                  effective_date: effectiveDate,
                  retroactive_authorized: effectiveDate < todayIst() ? retro : false,
                  retroactive_reason: retroReason || undefined,
                  remarks,
                }), 'Converted — billing starts on the effective date')}>
                Approve and activate rental
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => {
                const reason = promptReason('Why is the conversion rejected? (returns to customer decision)');
                if (reason) run(() => rejectConversion(loan.id, reason), 'Sent back to customer decision');
              }}>Reject</Button>
            </div>
          </ActionCard>
        ) : <ActionCard title="Customer keeps the laptop — waiting for Accounts" icon={ShieldCheck} tone="amber"><p className="text-sm text-slate-700">Accounts approve the rental price and effective date.</p></ActionCard>
      )}

      {/* ── Details ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LaptopCard title="Loan laptop" laptop={loan.loan_laptop} badge={<LoanStatusBadge status={loan.status} />} />
        <LaptopCard
          title={loan.status === 'converted' ? 'Replaced customer laptop'
            : loan.status === 'returned' ? 'Customer laptop (repaired)' : 'Customer laptop under repair'}
          laptop={loan.original_laptop}
          extra={(
            <>
              {loan.original_rent_end_date && <Field name="Replaced from">{formatDate(loan.conversion_effective_date)}</Field>}
              {loan.original_pickup && (
                <>
                  <p className="text-xs font-semibold text-slate-600 mt-3 mb-1">Repair pickup (tracked separately)</p>
                  <Field name="Pickup status">{loan.original_pickup.status}</Field>
                  <Field name="Method">{[loan.original_pickup.method, loan.original_pickup.courier_name].filter(Boolean).join(' · ') || null}</Field>
                  {loan.original_pickup.awb_number && <Field name="AWB">{loan.original_pickup.awb_number}</Field>}
                  <Field name="Return DC">{loan.original_pickup.return_dc_number}</Field>
                  <Field name="Collected from customer">{loan.original_pickup.picked_up_at ? formatDate(loan.original_pickup.picked_up_at) : (loan.original_pickup.collected ? 'Yes' : 'Not yet')}</Field>
                  <Field name="Received at warehouse">{loan.original_pickup.warehouse_received_at ? formatDate(loan.original_pickup.warehouse_received_at) : 'Not yet'}</Field>
                </>
              )}
            </>
          )}
        />
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-slate-800">Policy &amp; pricing</h3>
            <PolicyBadge decision={loan.policy_decision} />
          </div>
          <Field name="Rule">{loan.policy_rule_name}</Field>
          <Field name="Original rate">{formatMoney(loan.original_rent_monthly_rate)}</Field>
          <Field name="Approved rate (if kept)">{formatMoney(loan.approved_rent_monthly_rate)}</Field>
          {loan.approved_by_name && <Field name="Approved by">{loan.approved_by_name}</Field>}
          {loan.status === 'converted' && (
            <>
              <Field name="Rental rate">{formatMoney(loan.conversion_rent_monthly_rate)}</Field>
              <Field name="Billing from">{formatDate(loan.conversion_effective_date)}</Field>
              <Field name="Original rent ends">{formatDate(loan.original_rent_end_date)}</Field>
              {loan.retroactive_authorized && <Field name="Retroactive">{loan.retroactive_reason}</Field>}
              {loan.original_credit_note_id && <Field name="Credit note">#{loan.original_credit_note_id} (pending)</Field>}
              <Field name="Approved by">{loan.conversion_approved_by_name}</Field>
            </>
          )}
          {loan.rejection_reason && <Field name="Rejected">{loan.rejection_reason}</Field>}
          {loan.cancellation_reason && <Field name="Cancelled">{loan.cancellation_reason}</Field>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
            {loan.loan_dc_number && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => regenerateLoanDcPdf(loan.id), 'Loan DC PDF regenerated')}>
                Regenerate PDF
              </Button>
            )}
          </div>
          {docs.length === 0 ? <p className="text-sm text-slate-500">No documents yet</p> : docs.map((d) => (
            <div key={d.dc_number} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{d.dc_number}</p>
                <p className="text-xs text-slate-500">
                  {d.dc_purpose === 'loan' ? 'Loan DC' : d.dc_purpose === 'loan_return' ? 'Loan return DC' : d.dc_purpose === 'service_return' ? 'Service DC (original)' : d.dc_purpose}
                  {' · '}{d.status}{d.delivered_at ? ` · delivered ${formatDate(d.delivered_at)}` : ''}
                </p>
              </div>
              {d.pdf_path && (
                <a href={`${getBackendOrigin()}/${d.pdf_path}`} target="_blank" rel="noreferrer" className="text-blue-700 text-xs font-semibold shrink-0">PDF</a>
              )}
            </div>
          ))}
          {loanDc && <p className="text-xs text-slate-500 mt-2">Loan DCs carry no price and never start rent.</p>}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Request</h3>
          <Field name="Raised by">{loan.created_by_name}</Field>
          <Field name="Raised">{formatDate(loan.created_at, true)}</Field>
          <Field name="Deliver to">{[loan.delivery_address?.address, loan.delivery_address?.city, loan.delivery_address?.pincode].filter(Boolean).join(', ')}</Field>
          <Field name="Contact">{[loan.contact_name, loan.contact_phone].filter(Boolean).join(' · ')}</Field>
          {loan.delivered_at && <Field name="Delivered">{formatDate(loan.delivered_at, true)}</Field>}
          {loan.customer_decision && <Field name="Decision">{loan.customer_decision === 'keep_loan' ? 'Keeps loan laptop' : 'Takes original back'}</Field>}
          {confirmationText && <Field name="Confirmed">{confirmationText}</Field>}
          {loan.request_remarks && <Field name="Remarks">{loan.request_remarks}</Field>}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Status history</h3>
        <ol className="space-y-3">
          {(loan.events || []).map((ev) => (
            <li key={ev.id} className="flex gap-3 text-sm">
              <span className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-slate-900">
                  <span className="font-medium">{ev.action.replace(/_/g, ' ')}</span>
                  {ev.to_status && <span className="text-slate-500"> → {LOAN_STATUS[ev.to_status]?.label || ev.to_status}</span>}
                </p>
                <p className="text-xs text-slate-500">{formatDate(ev.created_at, true)}{ev.actor_name ? ` · ${ev.actor_name}` : ''}</p>
                {ev.detail?.reason && <p className="text-xs text-slate-600 mt-0.5">{ev.detail.reason}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {CANCELLABLE.has(loan.status) && canSupport && (
        <div className="flex justify-end">
          <Button variant="ghost" icon={XCircle} disabled={busy} onClick={() => {
            const reason = promptReason('Cancel this loan? Give a reason (the laptop goes back to stock).');
            if (reason) run(() => cancelLoan(loan.id, reason), 'Loan cancelled');
          }}>Cancel loan</Button>
        </div>
      )}
    </div>
  );
}
