import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, Drawer, Field, FormGrid, Input, Notice, Select, Textarea,
} from '../../../../components/carret';
import {
  completeFollowUp, fetchLeadStages, updateLeadStatus, winLead,
} from './leadApi';
import { CLOSED_STATUSES, OUTCOMES, STATUS_HINT, addDaysIst, leadErr, todayIst } from './leadShared';
import { MONTH_CHOICES } from '../sellShared';
import LeadGstFields from './LeadGstFields';

/**
 * The three things done to a lead (claude/carret-lead.md):
 *  - FollowUpDrawer: what happened on the call + the next date (required
 *    unless the lead is lost / won).
 *  - StatusDrawer: move the lead; Rejected / Gone ask the lost reason; Deal
 *    and Demo go to WinDrawer instead (they create the customer).
 *  - WinDrawer: Deal / Demo and the customer in one step.
 */

export function FollowUpDrawer({ lead, open, onClose, onDone }) {
  const [f, setF] = useState({ outcome: '', notes: '', next_date: addDaysIst(2), next_time: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ outcome: '', notes: '', next_date: addDaysIst(2), next_time: '' }); }, [open]);
  if (!lead) return null;
  const closed = CLOSED_STATUSES.includes(lead.status) || lead.status === 'Deal';
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await completeFollowUp(lead.leadId || lead.lead_id, { ...f, next_date: closed ? undefined : f.next_date, next_time: f.next_time || undefined });
      toast.success(data.message || 'Saved');
      onDone?.();
      onClose();
    } catch (e) { toast.error(leadErr(e)); } finally { setBusy(false); }
  };
  const quick = [[1, 'Tomorrow'], [2, 'In 2 days'], [7, 'Next week']];
  return (
    <Drawer open={open} onClose={onClose} title={`Follow-up — ${lead.companyName || lead.company_name || lead.name}`} footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}>
      <div className="c-stack">
        <Field label="What happened" required>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {OUTCOMES.map((o) => (
              <button key={o.value} type="button" className="c-btn" onClick={() => setF({ ...f, outcome: o.value })} style={{ borderWidth: f.outcome === o.value ? 2 : 1, borderColor: f.outcome === o.value ? 'var(--accent)' : undefined }}>{o.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Note" required={f.outcome !== 'no_answer'}>
          <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What they said, what they need, what you promised" />
        </Field>
        {closed ? <Notice tone="info">This lead is {lead.status.toLowerCase()} — no next follow-up.</Notice> : (
          <>
            <FormGrid cols={2}>
              <Field label="Next follow-up" required><Input type="date" min={todayIst()} value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field>
              <Field label="Time (optional)"><Input type="time" value={f.next_time} onChange={(e) => setF({ ...f, next_time: e.target.value })} /></Field>
            </FormGrid>
            <div className="flex" style={{ gap: 6 }}>
              {quick.map(([n, label]) => <Button key={n} variant="quiet" onClick={() => setF({ ...f, next_date: addDaysIst(n) })}>{label}</Button>)}
            </div>
            {f.outcome === 'not_interested' && <Notice tone="warn">If they are not buying, change the status to Rejected with the reason instead.</Notice>}
          </>
        )}
      </div>
    </Drawer>
  );
}

let stageCache = null;
export function StatusDrawer({ lead, open, onClose, onDone, onWin }) {
  const [stages, setStages] = useState(stageCache);
  const [f, setF] = useState({ status: '', lead_stage: '', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!stageCache) fetchLeadStages().then(({ data }) => { stageCache = Object.fromEntries((data.stages || []).map((s) => [s.status, s.stages])); setStages(stageCache); }).catch(() => setStages({}));
  }, []);
  useEffect(() => { if (open) setF({ status: '', lead_stage: '', notes: '' }); }, [open]);
  if (!lead) return null;
  const converted = Boolean(lead.customerId);
  const statuses = ['Pending', 'Call Back', 'Hold', 'Cold', 'Warm', 'Hot', 'Demo', 'Deal', 'Repeat', 'Rejected', 'Gone'].filter((s) => s !== lead.status);
  const list = stages?.[f.status] || [];
  const noStage = ['Call Back', 'Demo', 'Pending'].includes(f.status);
  const isWin = ['Deal', 'Demo'].includes(f.status) && !converted;
  const save = async () => {
    if (isWin) { onClose(); onWin(f.status); return; }
    if (!f.status) { toast.error('Choose the new status'); return; }
    if (!noStage && list.length && !f.lead_stage) { toast.error(CLOSED_STATUSES.includes(f.status) ? 'Choose why it was lost' : 'Choose the stage'); return; }
    if (f.notes.trim().length < 3) { toast.error('Add a short note'); return; }
    setBusy(true);
    try {
      await updateLeadStatus(lead.leadId, { status: f.status, lead_stage: noStage ? undefined : f.lead_stage || undefined, notes: f.notes.trim(), gst_number: lead.gstNumber || lead.research?.gst || undefined });
      toast.success(`Now ${f.status}`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(leadErr(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={onClose} title={`Change status — now ${lead.status}${lead.leadStage && lead.leadStage !== lead.status ? ` · ${lead.leadStage}` : ''}`} footer={<Button variant="primary" disabled={busy} onClick={save}>{isWin ? `Next: customer details for ${f.status}` : 'Save'}</Button>}>
      <div className="c-stack">
        <Field label="New status" required>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, lead_stage: '' })} placeholder="Choose…" options={statuses.map((s) => ({ value: s, label: `${s} — ${STATUS_HINT[s] || ''}` }))} />
        </Field>
        {isWin && <Notice tone="info">{f.status} creates the customer: you’ll fill GST, billing and shipping address and the finance contact next.</Notice>}
        {!isWin && !noStage && list.length > 0 && (
          <Field label={CLOSED_STATUSES.includes(f.status) ? 'Why it was lost' : 'Stage'} required>
            <Select value={f.lead_stage} onChange={(e) => setF({ ...f, lead_stage: e.target.value })} placeholder="Choose…" options={list} />
          </Field>
        )}
        {!isWin && <Field label="Note" required><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>}
      </div>
    </Drawer>
  );
}

const pickAddr = (lead) => {
  const billing = typeof lead.billingAddress === 'string' ? lead.billingAddress : (lead.billingAddress?.address || '');
  return { billing_address: billing || lead.research?.address || '', billing_city: lead.city || lead.research?.city || '', billing_state: lead.state || lead.research?.state || '', billing_pincode: lead.pincode || lead.research?.pincode || '' };
};

export function WinDrawer({ lead, status = 'Deal', open, onClose, onDone }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !lead) return;
    setF({
      status,
      gst_number: lead.gstNumber || lead.research?.gst || '',
      company_name: lead.companyName || '',
      trade_name: lead.tradeName || '',
      company_type: lead.companyType || '',
      customer_name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      pan_number: lead.panNumber || '',
      ...pickAddr(lead),
      shipping_same_as_billing: true,
      shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
      spock_person_name: lead.name || '', spock_person_email: lead.email || '', spock_person_mobile: lead.phone || '',
      finance_contact_email: '', finance_contact_mobile: '',
      security_deposit_months: '',
      notes: '',
    });
  }, [open, lead, status]);
  if (!lead || !f) return null;
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.security_deposit_months === '') { toast.error('Choose the security deposit agreed with the customer'); return; }
    setBusy(true);
    try {
      const { data } = await winLead(lead.leadId, { ...f, gst_number: f.gst_number.trim().toUpperCase(), security_deposit_months: Number(f.security_deposit_months) });
      toast.success(data.message || `${f.status} — customer created`);
      onDone?.(data);
      onClose();
    } catch (e) { toast.error(leadErr(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={onClose} title={`Mark as ${f.status} — ${lead.companyName || lead.name}`} width="44rem" footer={<Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Mark as ${f.status} and create the customer`}</Button>}>
      <div className="c-stack">
        <Notice tone="info">This creates (or updates) the customer with these details and their billing / shipping addresses — the sales order and delivery challans use them. Details already looked up from the GSTIN on the lead are filled in.</Notice>
        <Field label="Won as"><Select value={f.status} onChange={s('status')} options={[{ value: 'Deal', label: 'Deal' }, { value: 'Demo', label: 'Demo' }]} /></Field>
        <LeadGstFields
          value={f}
          required
          onChange={(patch) => setF((x) => ({ ...x, ...patch }))}
          addr={{ address: 'billing_address', city: 'billing_city', state: 'billing_state', pincode: 'billing_pincode' }}
        />
        <FormGrid cols={2}>
          <Field label="Contact name"><Input value={f.customer_name} onChange={s('customer_name')} /></Field>
          <Field label="Contact phone"><Input value={f.phone} onChange={s('phone')} inputMode="numeric" /></Field>
          <Field label="Billing address" required span={2}><Textarea rows={2} value={f.billing_address} onChange={s('billing_address')} /></Field>
          <Field label="City" required><Input value={f.billing_city} onChange={s('billing_city')} /></Field>
          <Field label="State" required hint="Decides CGST+SGST or IGST on quotes"><Input value={f.billing_state} onChange={s('billing_state')} /></Field>
          <Field label="Pincode" required><Input value={f.billing_pincode} onChange={(e) => setF({ ...f, billing_pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" /></Field>
        </FormGrid>
        <Checkbox label="Ship to the billing address" checked={f.shipping_same_as_billing} onChange={(e) => setF({ ...f, shipping_same_as_billing: e.target.checked })} />
        {!f.shipping_same_as_billing && (
          <FormGrid cols={3}>
            <Field label="Shipping address" required span={3}><Textarea rows={2} value={f.shipping_address} onChange={s('shipping_address')} /></Field>
            <Field label="City" required><Input value={f.shipping_city} onChange={s('shipping_city')} /></Field>
            <Field label="State" required><Input value={f.shipping_state} onChange={s('shipping_state')} /></Field>
            <Field label="Pincode" required><Input value={f.shipping_pincode} onChange={(e) => setF({ ...f, shipping_pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" /></Field>
          </FormGrid>
        )}
        <div className="c-label">Point of contact (for orders and invoices)</div>
        <FormGrid cols={3}>
          <Field label="Name" required><Input value={f.spock_person_name} onChange={s('spock_person_name')} /></Field>
          <Field label="Email" required><Input type="email" value={f.spock_person_email} onChange={s('spock_person_email')} /></Field>
          <Field label="Mobile" required><Input value={f.spock_person_mobile} onChange={(e) => setF({ ...f, spock_person_mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" /></Field>
          <Field label="Finance email (optional)"><Input type="email" value={f.finance_contact_email} onChange={s('finance_contact_email')} /></Field>
          <Field label="Finance mobile (optional)"><Input value={f.finance_contact_mobile} onChange={(e) => setF({ ...f, finance_contact_mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" /></Field>
        </FormGrid>
        <Field label="Security deposit" required hint="Every new sales order for this customer starts with it; Sales can lower or remove it on an order, or change it on the customer later.">
          <Select value={f.security_deposit_months} onChange={s('security_deposit_months')} placeholder="Choose…" options={MONTH_CHOICES} />
        </Field>
        <Field label="Note (optional)"><Textarea rows={2} value={f.notes} onChange={s('notes')} placeholder="e.g. PO received, 10 laptops for 12 months" /></Field>
      </div>
    </Drawer>
  );
}
