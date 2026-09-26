import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Field, FormGrid, Input, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import { createTicket, fetchCategories, fetchCustomerLaptops, searchCustomers } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Serve → New ticket (support lead, claude/carret-support.md step 4).
 *
 * Customer → the laptops they have with us (work-from-home ones marked: a
 * pickup / replacement to them is chargeable, Rs 799 + GST) → issue + remarks
 * per laptop → priority, visit slot, contact → a complaint ticket. Pickup and
 * replacement tickets are raised from the ticket (Old view) as today.
 */
export default function NewTicketPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [laptops, setLaptops] = useState(null);
  const [wfhCharge, setWfhCharge] = useState(799);
  const [cats, setCats] = useState([]);
  const [picked, setPicked] = useState({}); // id -> { category, remarks }
  const [f, setF] = useState({ priority: 'normal', visit: '', phone: '', alt: '', email: '', address: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchCategories().then(({ data }) => setCats(data.categories || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (customer || q.trim().length < 2) { setCustomers([]); return undefined; }
    const t = setTimeout(() => {
      searchCustomers(q.trim()).then(({ data }) => setCustomers(data.items || [])).catch(() => setCustomers([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, customer]);
  useEffect(() => {
    if (!customer) { setLaptops(null); return; }
    setLaptops(null);
    fetchCustomerLaptops(customer.customer_id)
      .then(({ data }) => { setLaptops(data.assets || []); if (data.wfh_charge) setWfhCharge(data.wfh_charge); })
      .catch((e) => { setLaptops([]); toast.error(errMsg(e, 'Could not load the laptops')); });
    setF((x) => ({ ...x, phone: customer.customer_number || customer.contact_person_number || '' }));
  }, [customer]);

  const toggle = (a) => setPicked((p) => {
    const n = { ...p };
    if (n[a.id]) delete n[a.id]; else n[a.id] = { category: '', remarks: '' };
    return n;
  });
  const setPick = (id, k, v) => setPicked((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const chosen = (laptops || []).filter((a) => picked[a.id]);
  const wfhChosen = chosen.filter((a) => a.is_wfh);

  const save = async () => {
    if (!customer) { toast.error('Choose the customer'); return; }
    if (!chosen.length) { toast.error('Pick the laptop(s) with the problem'); return; }
    for (const a of chosen) {
      if (!picked[a.id].category) { toast.error(`Choose the issue for ${a.unique_serial_number || a.serial_number}`); return; }
      if (picked[a.id].remarks.trim().length < 3) { toast.error(`Describe the problem on ${a.unique_serial_number || a.serial_number}`); return; }
    }
    setBusy(true);
    try {
      const { data } = await createTicket({
        customer_id: customer.customer_id,
        customer_phone: f.phone || undefined,
        ticket_phone_override: f.phone || undefined,
        ticket_alt_phone: f.alt || undefined,
        ticket_email: f.email || undefined,
        ticket_address: f.address || undefined,
        top_level_remarks: f.note || undefined,
        priority: f.priority,
        ticket_category: 'complaint',
        visit_scheduled_at: f.visit ? `${f.visit}:00+05:30` : undefined,
        items: chosen.map((a) => {
          const cat = cats.find((c) => String(c.id) === String(picked[a.id].category));
          const [brand, ...rest] = String(a.model_name || '').split(' ');
          return {
            item_type: 'complaint',
            serial_number: a.serial_number,
            unique_serial_number: a.unique_serial_number,
            brand: brand || null,
            model: rest.join(' ') || null,
            ram: a.ram,
            storage: a.storage,
            generation: a.generation,
            issue_category_id: cat?.id || null,
            issue_category_label: cat?.name || null,
            remarks: picked[a.id].remarks.trim(),
          };
        }),
      });
      toast.success(`Ticket #${data.ticket.id} raised — assign a technician next`);
      navigate(`/carret/serve/tickets/${data.ticket.id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not raise the ticket'));
      setBusy(false);
    }
  };

  const cols = [
    { key: 'x', header: '', width: '2.5rem', render: (a) => <input type="checkbox" aria-label={`Pick ${a.unique_serial_number}`} checked={Boolean(picked[a.id])} onChange={() => toggle(a)} onClick={(e) => e.stopPropagation()} /> },
    { key: 't', header: 'Laptop', render: (a) => <DocNumber value={a.unique_serial_number || a.serial_number} />, sub: (a) => a.model_name },
    { key: 's', header: 'Specs', render: (a) => [a.processor, a.ram, a.storage].filter(Boolean).join(' · ') || '—' },
    { key: 'w', header: '', render: (a) => (a.is_wfh ? <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>Work from home</span> : null) },
  ];

  return (
    <DeskShell title="New support ticket" breadcrumb="Serve / Queue">
      <div className="c-stack">
        <Section title="1 · Customer">
          {customer ? (
            <div className="flex items-center" style={{ gap: '12px' }}>
              <strong>{customer.customer_name}</strong>
              <span className="text-ink-3">{customer.customer_number}</span>
              <Button variant="quiet" onClick={() => { setCustomer(null); setPicked({}); }}>Change</Button>
            </div>
          ) : (
            <>
              <Input autoFocus type="search" placeholder="Company, contact, phone or customer id" value={q} onChange={(e) => setQ(e.target.value)} />
              {customers.length > 0 && (
                <div className="c-stack" style={{ gap: '4px', marginTop: '8px' }}>
                  {customers.map((c) => (
                    <button key={c.customer_id} type="button" className="c-btn" style={{ justifyContent: 'space-between' }} onClick={() => setCustomer(c)}>
                      <span>{c.customer_name}</span><span className="text-ink-3">{c.customer_number || ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {customer && (
          <Section title={`2 · Which laptop(s)${chosen.length ? ` · ${chosen.length} picked` : ''}`}>
            {laptops === null ? <EmptyState title="Loading…" /> : (
              <DataTable columns={cols} rows={laptops} rowKey={(a) => a.id} onRowClick={toggle} empty={<EmptyState title="No laptops with this customer" />} />
            )}
            {wfhChosen.length > 0 && (
              <Notice tone="warn" title="Work from home">
                {wfhChosen.map((a) => a.unique_serial_number).join(', ')} {wfhChosen.length === 1 ? 'is' : 'are'} with an employee at home.
                If it needs a return pickup or a replacement delivery, that is chargeable — ₹{wfhCharge} + GST (charge it from the ticket).
              </Notice>
            )}
          </Section>
        )}

        {chosen.length > 0 && (
          <Section title="3 · The problem">
            <div className="c-stack">
              {chosen.map((a) => (
                <FormGrid key={a.id} cols={3}>
                  <Field label={`Issue — ${a.unique_serial_number || a.serial_number}`} required>
                    <Select value={picked[a.id].category} onChange={(e) => setPick(a.id, 'category', e.target.value)} placeholder="Choose…" options={cats.map((c) => ({ value: String(c.id), label: c.name }))} />
                  </Field>
                  <Field label="What the customer says" required span={2}>
                    <Input value={picked[a.id].remarks} onChange={(e) => setPick(a.id, 'remarks', e.target.value)} maxLength={500} />
                  </Field>
                </FormGrid>
              ))}
            </div>
          </Section>
        )}

        {chosen.length > 0 && (
          <Section title="4 · Priority, visit and contact">
            <FormGrid cols={3}>
              <Field label="Priority" hint="Urgent: visit in 4 business hours · High: 8 h · Normal: 1 day">
                <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} />
              </Field>
              <Field label="Visit slot agreed (optional)"><Input type="datetime-local" value={f.visit} onChange={(e) => setF({ ...f, visit: e.target.value })} /></Field>
              <Field label="Phone for the technician"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" /></Field>
              <Field label="Alternate phone"><Input value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" /></Field>
              <Field label="Email (feedback link goes here)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Visit address" span={3}><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Where the technician should go" /></Field>
              <Field label="Note for the technician" span={3}><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </FormGrid>
            <div className="flex justify-end" style={{ marginTop: '12px' }}>
              <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Raising…' : 'Raise the ticket'}</Button>
            </div>
          </Section>
        )}
      </div>
    </DeskShell>
  );
}
