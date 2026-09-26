import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, Field, FormGrid, Input, Notice, Section, Select, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { createLead, fetchAssignableUsers, setFollowUp, updateLeadProfile } from './leadApi';
import {
  BRANDS, GENERATIONS, INQUIRY, PROCESSORS, RAMS, SOURCES, STORAGES, addDaysIst, leadErr, todayIst,
} from './leadShared';

/**
 * Sell → New lead (claude/carret-lead.md). Who they are, what they need, and
 * when to call them next. The owner is picked automatically (round robin)
 * unless a manager chooses one; a sales user who adds a lead owns it.
 */
const EMPTY = {
  company_name: '', name: '', phone: '', email: '', city: '', state: '', source: '', inquiry_type: 'rental',
  quantity_required: '', rental_duration: '', monthly_budget: '', brand: '', processor: '', generation: '', ram: '', storage: '',
  personal_remarks: '', follow_up_date: addDaysIst(1), owner: '',
};

export default function NewLeadPage() {
  const navigate = useNavigate();
  const { user } = usePermission();
  const [f, setF] = useState(EMPTY);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchAssignableUsers().then(({ data }) => setUsers(data.users || [])).catch(() => {}); }, []);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isSales = user?.role === 'sales';

  const save = async () => {
    if (!f.company_name.trim() && !f.name.trim()) { toast.error('Company or contact name'); return; }
    if (!f.phone.trim() && !f.email.trim()) { toast.error('A phone number or email'); return; }
    if (f.phone && !/^\d{10}$/.test(f.phone.replace(/\D/g, '').slice(-10))) { toast.error('Phone must be 10 digits'); return; }
    if (!f.source) { toast.error('Where did the lead come from?'); return; }
    setBusy(true);
    try {
      const { data } = await createLead({
        name: f.name.trim() || f.company_name.trim(), company_name: f.company_name.trim() || undefined, phone: f.phone.trim() || undefined,
        email: f.email.trim() || undefined, city: f.city.trim() || undefined, source: f.source, inquiry_type: f.inquiry_type,
        brand: f.brand || undefined, processor: f.processor || undefined, ram: f.ram || undefined, storage: f.storage || undefined,
        personal_remarks: f.personal_remarks.trim() || undefined,
      });
      const id = data.lead?.leadId || data.lead?.lead_id || data.lead_id;
      if (!id) throw new Error('Lead created but no id came back');
      // The rest of the profile; the owner only when one was chosen (null would un-assign).
      await updateLeadProfile(id, {
        state: f.state || undefined, generation: f.generation || undefined,
        quantity_required: f.quantity_required ? Number(f.quantity_required) : undefined,
        rental_duration: f.rental_duration ? Number(f.rental_duration) : undefined,
        monthly_budget: f.monthly_budget ? Number(f.monthly_budget) : undefined,
        ...(f.owner ? { assigned_user_id: Number(f.owner) } : {}),
      });
      if (f.follow_up_date) await setFollowUp(id, { follow_up_date: f.follow_up_date, notes: 'First call' });
      toast.success(data.duplicate || data.lead?.isDuplicate ? 'Saved — looks like a duplicate of an existing lead' : 'Lead added');
      navigate(`/carret/sell/leads/${id}`);
    } catch (e) {
      toast.error(leadErr(e, 'Could not add the lead'));
      setBusy(false);
    }
  };

  return (
    <DeskShell title="New lead" breadcrumb="Sell / Leads">
      <div className="c-stack">
        <Section title="Who">
          <FormGrid cols={3}>
            <Field label="Company"><Input autoFocus value={f.company_name} onChange={s('company_name')} /></Field>
            <Field label="Contact name"><Input value={f.name} onChange={s('name')} /></Field>
            <Field label="Phone" hint="Phone or email is needed"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+]/g, '').slice(0, 13) })} inputMode="tel" /></Field>
            <Field label="Email"><Input type="email" value={f.email} onChange={s('email')} /></Field>
            <Field label="City"><Input value={f.city} onChange={s('city')} /></Field>
            <Field label="State"><Input value={f.state} onChange={s('state')} /></Field>
            <Field label="Source" required><Select value={f.source} onChange={s('source')} placeholder="Choose…" options={SOURCES} /></Field>
            <Field label="Rent or buy"><Select value={f.inquiry_type} onChange={s('inquiry_type')} options={INQUIRY} /></Field>
            {!isSales && users.length > 0 && (
              <Field label="Owner" hint="Leave empty to share out automatically"><Select value={f.owner} onChange={s('owner')} placeholder="Automatic" options={users.map((u) => ({ value: String(u.user_id), label: u.name }))} /></Field>
            )}
          </FormGrid>
        </Section>
        <Section title="What they need">
          <FormGrid cols={4}>
            <Field label="Laptops"><Input type="number" min="1" value={f.quantity_required} onChange={s('quantity_required')} /></Field>
            <Field label="Months"><Input type="number" min="1" value={f.rental_duration} onChange={s('rental_duration')} /></Field>
            <Field label="Budget / laptop / month (₹)"><Input type="number" min="0" value={f.monthly_budget} onChange={s('monthly_budget')} /></Field>
            <Field label="Brand"><Select value={f.brand} onChange={s('brand')} placeholder="Any" options={BRANDS} /></Field>
            <Field label="Processor"><Select value={f.processor} onChange={s('processor')} placeholder="Any" options={PROCESSORS} /></Field>
            <Field label="Generation"><Select value={f.generation} onChange={s('generation')} placeholder="Any" options={GENERATIONS} /></Field>
            <Field label="RAM"><Select value={f.ram} onChange={s('ram')} placeholder="Any" options={RAMS} /></Field>
            <Field label="Storage"><Select value={f.storage} onChange={s('storage')} placeholder="Any" options={STORAGES} /></Field>
          </FormGrid>
          <Field label="What they said"><Textarea rows={2} value={f.personal_remarks} onChange={s('personal_remarks')} /></Field>
        </Section>
        <Section title="First call">
          <FormGrid cols={3}>
            <Field label="Call them on"><Input type="date" min={todayIst()} value={f.follow_up_date} onChange={s('follow_up_date')} /></Field>
          </FormGrid>
          <Notice tone="info">A lead with an email and phone that match an existing one is kept but marked as a duplicate.</Notice>
          <div className="flex justify-end" style={{ marginTop: 12 }}>
            <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Adding…' : 'Add the lead'}</Button>
          </div>
        </Section>
      </div>
    </DeskShell>
  );
}
