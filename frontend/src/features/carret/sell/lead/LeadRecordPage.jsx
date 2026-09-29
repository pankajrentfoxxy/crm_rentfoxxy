import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice,
  Section, Select, Tabs, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  addLeadRemark, assignLeads, fetchAssignableUsers, fetchFollowUpLog, fetchLead, fetchLeadQuotations, runLeadResearch,
  updateLeadProfile,
} from './leadApi';
import { FollowUpDrawer, StatusDrawer, WinDrawer } from './LeadDrawers';
import {
  BRANDS, CLOSED_STATUSES, GENERATIONS, INQUIRY, OUTCOMES, PROCESSORS, RAMS, SOURCES, STATUS_HINT, STORAGES,
  istDate, leadErr, need, todayIst,
} from './leadShared';
import LeadStatusChip from './LeadStatusChip';

/**
 * Sell → a lead (claude/carret-lead.md). One page: what they need, where the
 * lead is, the next follow-up and the one thing to do now, the whole timeline
 * (status moves, follow-ups with outcomes, remarks, quotes) and the buttons —
 * Log follow-up, Change status, Send quotation, Mark as Deal (creates the
 * customer). The old lead screen stays under Old view.
 */
const outcomeLabel = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]));
const QUOTE_OK = ['Cold', 'Warm', 'Hot', 'Deal', 'Repeat', 'Hold'];

export default function LeadRecordPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('leads', 'edit');
  const canQuote = hasPermission('sales_quotations', 'create');
  const [lead, setLead] = useState(null);
  const [err, setErr] = useState(null);
  const [log, setLog] = useState([]);
  const [quotes, setQuotes] = useState(null);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('timeline');
  const [drawer, setDrawer] = useState(null); // 'follow' | 'status' | 'win' | 'edit' | 'owner'
  const [winAs, setWinAs] = useState('Deal');
  const [remark, setRemark] = useState('');
  const [edit, setEdit] = useState(null);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchLead(leadId).then(({ data }) => setLead(data.lead)).catch((e) => setErr(leadErr(e, 'Could not load the lead')));
    fetchFollowUpLog(leadId).then(({ data }) => setLog(data.log || [])).catch(() => setLog([]));
    fetchLeadQuotations(leadId).then(({ data }) => setQuotes(data.quotations || data.data || data.rows || [])).catch(() => setQuotes([]));
  }, [leadId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchAssignableUsers().then(({ data }) => setUsers(data.users || [])).catch(() => {}); }, []);

  if (err) return <DeskShell title={`Lead #${leadId}`} breadcrumb="Sell / Leads"><EmptyState title="Could not load" body={err} action={<Button onClick={() => navigate('/carret/sell/leads')}>Back</Button>} /></DeskShell>;
  if (!lead) return <DeskShell title={`Lead #${leadId}`} breadcrumb="Sell / Leads"><EmptyState title="Loading…" /></DeskShell>;

  const closed = CLOSED_STATUSES.includes(lead.status);
  const won = ['Deal', 'Demo', 'Repeat'].includes(lead.status);
  const fuDate = lead.followUpDate ? istDate(lead.followUpDate) : null;
  const overdue = fuDate && fuDate < todayIst();

  // The single most useful thing to do now.
  let next = null;
  if (!closed && !won) {
    if (!lead.assignedUserId) next = { tone: 'warn', text: 'Nobody owns this lead yet.', btn: 'Assign an owner', act: () => setDrawer('owner') };
    else if (!fuDate) next = { tone: 'warn', text: 'No follow-up planned — call them and set the next date.', btn: 'Log a follow-up', act: () => setDrawer('follow') };
    else if (overdue) next = { tone: 'warn', text: `The follow-up was due ${fuDate}. Call them now.`, btn: 'Log the follow-up', act: () => setDrawer('follow') };
    else if (['Warm', 'Hot'].includes(lead.status) && !(quotes || []).length) next = { tone: 'info', text: 'Interested but no quotation yet.', btn: 'Send a quotation', act: () => sendQuote() };
    else if (lead.status === 'Hot') next = { tone: 'info', text: 'At agreement stage — once they confirm, mark it as Deal.', btn: 'Mark as Deal', act: () => { setWinAs('Deal'); setDrawer('win'); } };
  } else if (won && !lead.customerId) {
    next = { tone: 'warn', text: `${lead.status} but no customer yet (from before the new flow).`, btn: 'Create the customer', act: () => { setWinAs(lead.status === 'Demo' ? 'Demo' : 'Deal'); setDrawer('win'); } };
  } else if (won && lead.customerId) {
    next = { tone: 'good', text: 'Won — raise the sales order from the quotation or the customer.', btn: 'Open the customer', act: () => navigate(`/carret/sell/customers/${lead.customerId}`) };
  }

  function sendQuote() {
    if (!QUOTE_OK.includes(lead.status)) { toast.error(`Move the lead to Cold, Warm or Hot first (it is ${lead.status})`); return; }
    navigate('/carret/sell/quotations/new', {
      state: {
        prefill: {
          customer_id: lead.customerId || undefined,
          contact_name: lead.name,
          company_name: lead.companyName || lead.name,
          lead_id: lead.leadId,
          lead_name: lead.companyName || lead.name,
          email: lead.email,
          phone: lead.phone,
          quotation_type: lead.inquiryType === 'sales' ? 'sale' : 'rental',
          line_items: [{
            brand: lead.brand || '', processor: lead.processor || '', generation: lead.generation || '', ram: lead.ram || '', storage: lead.storage || '',
            quantity: lead.quantityRequired || 1, rate: lead.monthlyBudget || '', model_name: lead.modelName || '',
          }],
        },
      },
    });
  }

  const openEdit = () => {
    setEdit({
      name: lead.name || '', company_name: lead.companyName || '', email: lead.email || '', phone: lead.phone || '', whatsapp_number: lead.whatsappNumber || '',
      designation: lead.designation || '', city: lead.city || '', state: lead.state || '', pincode: lead.pincode || '', gst_number: lead.gstNumber || '',
      source: lead.source || '', inquiry_type: lead.inquiryType || 'rental', quantity_required: lead.quantityRequired || '', rental_duration: lead.rentalDuration || '',
      monthly_budget: lead.monthlyBudget || '', brand: lead.brand || '', processor: lead.processor || '', generation: lead.generation || '', ram: lead.ram || '',
      storage: lead.storage || '', use_case: lead.useCase || '', personal_remarks: lead.personalRemarks || '',
    });
    setDrawer('edit');
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      const body = { ...edit };
      ['quantity_required', 'rental_duration', 'monthly_budget'].forEach((k) => { body[k] = body[k] === '' ? null : Number(body[k]); });
      await updateLeadProfile(lead.leadId, body);
      toast.success('Saved');
      setDrawer(null);
      load();
    } catch (e) { toast.error(leadErr(e)); } finally { setBusy(false); }
  };
  const saveOwner = async () => {
    if (!owner) return;
    setBusy(true);
    try { await assignLeads([lead.leadId], Number(owner)); toast.success('Owner changed'); setDrawer(null); load(); } catch (e) { toast.error(leadErr(e)); } finally { setBusy(false); }
  };
  const saveRemark = async () => {
    if (remark.trim().length < 2) return;
    try { await addLeadRemark(lead.leadId, remark.trim()); setRemark(''); load(); } catch (e) { toast.error(leadErr(e)); }
  };

  // Timeline: status moves + follow-ups + remarks, newest first.
  const timeline = [
    ...(lead.activities || []).filter((a) => a.action !== 'follow_up_done').map((a) => ({
      at: a.createdAt, who: a.user?.name,
      what: a.action === 'status_updated' ? `${a.statusFrom || '—'} → ${a.statusTo}${a.stageTo && a.stageTo !== a.statusTo ? ` · ${a.stageTo}` : ''}` : String(a.action).replace(/_/g, ' '),
      note: a.notes,
    })),
    ...log.map((f) => ({ at: f.done_at, who: f.done_by_name, what: `📞 ${outcomeLabel[f.outcome] || f.outcome}${f.next_due_date ? ` · next ${String(f.next_due_date).slice(0, 10)}` : ''}`, note: f.notes })),
    ...(lead.remarks || []).map((r) => ({ at: r.createdAt, who: r.userName, what: 'Remark', note: r.note })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const r = lead.research || {};
  const e = (k) => (ev) => setEdit({ ...edit, [k]: ev.target.value });

  return (
    <DeskShell title={lead.companyName || lead.name} breadcrumb="Sell / Leads" subtitle={STATUS_HINT[lead.status]}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={`Lead #${lead.leadId}`}
          type={`${lead.source || 'Lead'} · ${lead.inquiryType === 'sales' ? 'purchase' : lead.inquiryType || 'rental'}`}
          status={won ? 'approved' : closed ? 'cancelled' : 'pending'}
          actions={canEdit && (
            <>
              {!closed && <Button variant="primary" onClick={() => setDrawer('follow')}>Log follow-up</Button>}
              <Button onClick={() => setDrawer('status')}>Change status</Button>
              {canQuote && !closed && <Button onClick={sendQuote}>Send quotation</Button>}
              {!won && !closed && <Button onClick={() => { setWinAs('Deal'); setDrawer('win'); }}>Mark as Deal</Button>}
              <Button variant="quiet" onClick={openEdit}>Edit</Button>
            </>
          )}
          meta={[
            { label: 'Status', value: <LeadStatusChip status={lead.status} stage={lead.leadStage} /> },
            { label: 'Owner', value: <button type="button" className="c-link" onClick={() => canEdit && setDrawer('owner')} style={{ background: 'none', border: 0, padding: 0, cursor: canEdit ? 'pointer' : 'default', textDecoration: canEdit ? 'underline dotted' : 'none' }}>{lead.assignedUser?.name || 'Unassigned'}</button> },
            { label: 'Next follow-up', value: fuDate ? <span style={{ color: overdue ? 'var(--alert-crit)' : undefined, fontWeight: overdue ? 600 : 400 }}>{fuDate}{lead.followUpTime ? ` ${String(lead.followUpTime).slice(0, 5)}` : ''}{overdue ? ' (overdue)' : ''}</span> : '—' },
            { label: 'Came in', value: <DateTime value={lead.createdAt} /> },
            { label: 'Customer', value: lead.customerId ? <button type="button" onClick={() => navigate(`/carret/sell/customers/${lead.customerId}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>#{lead.customerId}</button> : '—' },
          ]}
        />
        {next && (
          <Notice tone={next.tone} title="What's next" action={canEdit && next.btn ? <Button variant="primary" onClick={next.act}>{next.btn}</Button> : null}>{next.text}</Notice>
        )}

        <div className="c-form-grid" style={{ '--c-cols': 2, alignItems: 'start' }}>
          <Section title="What they need">
            <KeyValue cols={2} items={[
              { label: 'Laptops', value: lead.quantityRequired },
              { label: 'For (months)', value: lead.rentalDuration },
              { label: 'Budget / laptop / month', value: lead.monthlyBudget ? <Money value={lead.monthlyBudget} /> : null },
              { label: 'Use', value: lead.useCase },
              { label: 'Configuration', value: need({ ...lead, quantityRequired: null, rentalDuration: null }) || lead.modelName },
              { label: 'Their words', value: lead.personalRemarks },
            ]}
            />
          </Section>
          <Section title="Contact and company">
            <KeyValue cols={2} items={[
              { label: 'Contact', value: [lead.name, lead.designation].filter(Boolean).join(', ') },
              { label: 'Phone', value: lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : null },
              { label: 'Email', value: lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : null },
              { label: 'WhatsApp', value: lead.whatsappNumber },
              { label: 'City / state', value: [lead.city, lead.state].filter(Boolean).join(', ') },
              { label: 'GSTIN', value: lead.gstNumber || r.gst },
              { label: 'Industry', value: lead.industry || r.industry },
              { label: 'Employees', value: lead.companySize || r.employees },
            ]}
            />
            {canEdit && <Button variant="quiet" style={{ marginTop: 8 }} onClick={() => runLeadResearch(lead.leadId).then(() => { toast.success('Looking the company up…'); setTimeout(load, 4000); }).catch((x) => toast.error(leadErr(x)))}>Look the company up</Button>}
          </Section>
        </div>

        <Tabs tabs={[{ key: 'timeline', label: `Timeline · ${timeline.length}` }, { key: 'quotes', label: `Quotations · ${quotes ? quotes.length : '…'}` }, { key: 'addresses', label: `Addresses · ${(lead.addresses || []).length}` }]} value={tab} onChange={setTab} />
        {tab === 'timeline' && (
          <Section title="Timeline">
            {canEdit && (
              <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
                <Input value={remark} onChange={(ev) => setRemark(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && saveRemark()} placeholder="Add a remark…" />
                <Button onClick={saveRemark}>Add</Button>
              </div>
            )}
            <DataTable
              columns={[
                { key: 'w', header: 'When', render: (t) => <DateTime value={t.at} />, sub: (t) => t.who || null },
                { key: 'a', header: 'What', render: (t) => t.what, sub: (t) => t.note || null },
              ]}
              rows={timeline}
              rowKey={(t, i) => `${t.at}-${i}`}
              empty={<EmptyState title="Nothing yet" />}
            />
          </Section>
        )}
        {tab === 'quotes' && (
          <Section title="Quotations" actions={canQuote && !closed && <Button onClick={sendQuote}>New quotation</Button>}>
            <DataTable
              columns={[
                { key: 'n', header: 'Quotation', render: (q) => <DocNumber value={q.quotation_number} />, sub: (q) => q.quotation_type || null },
                { key: 's', header: 'Status', render: (q) => q.status || '—', sub: (q) => (q.accepted_at ? 'Accepted by the customer' : q.quotation_sent_at ? 'Sent' : null) },
                { key: 't', header: 'Value (before GST)', render: (q) => (q.total_value ? <Money value={q.total_value} /> : '—') },
              ]}
              rows={quotes || []}
              rowKey={(q) => q.quotation_number}
              onRowClick={(q) => navigate(`/carret/sell/quotations/${encodeURIComponent(q.quotation_number)}`)}
              empty={<EmptyState title="No quotation yet" />}
            />
          </Section>
        )}
        {tab === 'addresses' && (
          <Section title="Addresses">
            <DataTable
              columns={[
                { key: 't', header: 'Type', render: (a) => a.address_type || '—' },
                { key: 'a', header: 'Address', render: (a) => a.address, sub: (a) => a.pincode },
                { key: 'c', header: 'Contact', render: (a) => a.concern_person || '—', sub: (a) => a.mobile_no },
              ]}
              rows={lead.addresses || []}
              rowKey={(a) => a.address_id || a.addressId}
              empty={<EmptyState title="No extra addresses — the billing address is taken when you mark it as Deal" />}
            />
          </Section>
        )}
      </div>

      <FollowUpDrawer lead={lead} open={drawer === 'follow'} onClose={() => setDrawer(null)} onDone={load} />
      <StatusDrawer lead={lead} open={drawer === 'status'} onClose={() => setDrawer(null)} onDone={load} onWin={(s) => { setWinAs(s); setDrawer('win'); }} />
      <WinDrawer lead={lead} status={winAs} open={drawer === 'win'} onClose={() => setDrawer(null)} onDone={load} />

      <Drawer open={drawer === 'owner'} onClose={() => setDrawer(null)} title="Owner" footer={<Button variant="primary" disabled={busy || !owner} onClick={saveOwner}>Save</Button>}>
        <Field label="Who follows this lead up">
          <Select value={owner} onChange={(ev) => setOwner(ev.target.value)} placeholder="Choose…" options={users.map((u) => ({ value: String(u.user_id), label: u.name }))} />
        </Field>
      </Drawer>

      <Drawer open={drawer === 'edit'} onClose={() => setDrawer(null)} title="Edit lead" width="44rem" footer={<Button variant="primary" disabled={busy} onClick={saveEdit}>Save</Button>}>
        {edit && (
          <div className="c-stack">
            <FormGrid cols={2}>
              <Field label="Company"><Input value={edit.company_name} onChange={e('company_name')} /></Field>
              <Field label="Contact name"><Input value={edit.name} onChange={e('name')} /></Field>
              <Field label="Phone"><Input value={edit.phone} onChange={e('phone')} /></Field>
              <Field label="Email"><Input type="email" value={edit.email} onChange={e('email')} /></Field>
              <Field label="WhatsApp"><Input value={edit.whatsapp_number} onChange={e('whatsapp_number')} /></Field>
              <Field label="Designation"><Input value={edit.designation} onChange={e('designation')} /></Field>
              <Field label="City"><Input value={edit.city} onChange={e('city')} /></Field>
              <Field label="State"><Input value={edit.state} onChange={e('state')} /></Field>
              <Field label="Pincode"><Input value={edit.pincode} onChange={e('pincode')} /></Field>
              <Field label="GSTIN"><Input value={edit.gst_number} onChange={(ev) => setEdit({ ...edit, gst_number: ev.target.value.toUpperCase().slice(0, 15) })} /></Field>
              <Field label="Source"><Select value={edit.source} onChange={e('source')} placeholder="Choose…" options={[...new Set([edit.source, ...SOURCES].filter(Boolean))]} /></Field>
              <Field label="Rent or buy"><Select value={edit.inquiry_type} onChange={e('inquiry_type')} options={INQUIRY} /></Field>
            </FormGrid>
            <div className="c-label">What they need</div>
            <FormGrid cols={3}>
              <Field label="Laptops"><Input type="number" min="1" value={edit.quantity_required} onChange={e('quantity_required')} /></Field>
              <Field label="Months"><Input type="number" min="1" value={edit.rental_duration} onChange={e('rental_duration')} /></Field>
              <Field label="Budget / laptop / month (₹)"><Input type="number" min="0" value={edit.monthly_budget} onChange={e('monthly_budget')} /></Field>
              <Field label="Brand"><Select value={edit.brand} onChange={e('brand')} placeholder="Any" options={[...new Set([edit.brand, ...BRANDS].filter(Boolean))]} /></Field>
              <Field label="Processor"><Select value={edit.processor} onChange={e('processor')} placeholder="Any" options={[...new Set([edit.processor, ...PROCESSORS].filter(Boolean))]} /></Field>
              <Field label="Generation"><Select value={edit.generation} onChange={e('generation')} placeholder="Any" options={[...new Set([edit.generation, ...GENERATIONS].filter(Boolean))]} /></Field>
              <Field label="RAM"><Select value={edit.ram} onChange={e('ram')} placeholder="Any" options={[...new Set([edit.ram, ...RAMS].filter(Boolean))]} /></Field>
              <Field label="Storage"><Select value={edit.storage} onChange={e('storage')} placeholder="Any" options={[...new Set([edit.storage, ...STORAGES].filter(Boolean))]} /></Field>
              <Field label="Use"><Select value={edit.use_case} onChange={e('use_case')} placeholder="—" options={['Work From Office', 'Work From Home', 'Both']} /></Field>
            </FormGrid>
            <Field label="Notes about them"><Textarea rows={3} value={edit.personal_remarks} onChange={e('personal_remarks')} /></Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
