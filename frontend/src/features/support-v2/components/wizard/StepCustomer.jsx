import React, { useEffect, useState } from 'react';
import { searchCustomers, getCustomerContacts } from '../../supportV2Api';
import { indianMobile } from '../../supportV2Utils';
import TicketLinkPicker from '../TicketLinkPicker';
import { applyCustomer, customerHasDraftWork } from '../../ticketDraft';
import { Modal, Button } from '../../../../components/ui/supportPrimitives';

const CHANNELS = ['PHONE', 'EMAIL', 'WHATSAPP', 'PORTAL', 'INTERNAL', 'CHAT'];

export default function StepCustomer({ state, setState, context }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [pending, setPending] = useState(null);
  const [manual, setManual] = useState(state.contact_source === 'MANUAL');

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      searchCustomers(q.trim()).then((r) => setHits(r.data?.rows || [])).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!state.customer_id) { setContacts([]); return undefined; }
    getCustomerContacts(state.customer_id).then((r) => setContacts(r.data?.rows || [])).catch(() => setContacts([]));
    return undefined;
  }, [state.customer_id]);

  const pick = (c) => {
    if (Number(state.customer_id) === Number(c.customer_id)) {
      setQ(''); setHits([]);
      return;
    }
    if (customerHasDraftWork(state)) {
      setPending(c);
      return;
    }
    setState((s) => applyCustomer(s, c));
    setManual(false);
    setQ(''); setHits([]);
  };

  const confirmChange = () => {
    if (!pending) return;
    setState((s) => applyCustomer(s, pending));
    setManual(false);
    setPending(null);
    setQ(''); setHits([]);
  };

  const applyContact = (row) => {
    if (row === 'MANUAL') {
      setManual(true);
      setState((s) => ({ ...s, contact_source: 'MANUAL', contact_name: '', contact_phone: '', contact_email: '' }));
      return;
    }
    setManual(false);
    setState((s) => ({
      ...s,
      contact_source: row.source,
      contact_name: row.name || '',
      contact_phone: row.phone || '',
      contact_email: row.email || '',
    }));
  };

  const phoneOk = Boolean(indianMobile(state.contact_phone));
  const open = context?.open_tickets || [];

  return (
    <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-3">
        <label className="block text-[12px] font-semibold text-sup-ink">
          Customer *
          <input
            value={state.customer ? (state.customer.display_name || state.customer.company_name || state.customer.name) : q}
            onChange={(e) => { setState((s) => ({ ...s, customer_id: null, customer: null })); setQ(e.target.value); }}
            placeholder="Search name, id, phone"
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
          />
        </label>
        {hits.length > 0 && (
          <ul className="border border-sup-lineSoft rounded-md max-h-40 overflow-auto text-[12px]">
            {hits.map((c) => (
              <li key={c.customer_id}>
                <button type="button" className="w-full text-left px-2 py-1.5 hover:bg-sup-canvas2" onClick={() => pick(c)}>
                  {c.display_name} <span className="text-sup-faint">#{c.customer_id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {state.customer_id && (
          <label className="block text-[12px] font-semibold">
            Reporting contact *
            <select
              value={state.contact_source === 'MANUAL' ? 'MANUAL' : `${state.contact_name}|${state.contact_phone}`}
              onChange={(e) => {
                if (e.target.value === 'MANUAL') applyContact('MANUAL');
                else {
                  const row = contacts.find((c) => `${c.name}|${c.phone}` === e.target.value);
                  if (row) applyContact(row);
                }
              }}
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
            >
              <option value="">Select who is calling</option>
              {contacts.map((c) => (
                <option key={c.contact_id} value={`${c.name}|${c.phone}`}>
                  {c.name || 'Unnamed'} · {c.phone || '—'}{c.is_primary ? ' · Primary' : ''}{c.site_label ? ` · ${c.site_label}` : ''}
                </option>
              ))}
              <option value="MANUAL">＋ Someone else</option>
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-semibold">
            Contact name *
            <input
              value={state.contact_name}
              readOnly={!manual}
              onChange={(e) => setState((s) => ({ ...s, contact_name: e.target.value, contact_source: 'MANUAL' }))}
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
            />
          </label>
          <label className="block text-[12px] font-semibold">
            Mobile *
            <input
              value={state.contact_phone}
              readOnly={!manual}
              onChange={(e) => setState((s) => ({ ...s, contact_phone: e.target.value, contact_source: 'MANUAL' }))}
              className={`mt-1 w-full rounded-md border px-2 py-1.5 text-[13px] ${state.contact_phone && !phoneOk ? 'border-pri1' : 'border-sup-line'}`}
            />
            {state.contact_phone && !phoneOk && (
              <span className="text-[11px] text-pri1 font-normal">Enter a 10-digit Indian mobile number.</span>
            )}
          </label>
        </div>
        {state.customer_id && !manual && (
          <button type="button" className="text-[11px] text-sup-accent underline" onClick={() => setManual(true)}>Edit</button>
        )}
        <label className="block text-[12px] font-semibold">
          Email
          <input
            value={state.contact_email}
            readOnly={!manual}
            onChange={(e) => setState((s) => ({ ...s, contact_email: e.target.value, contact_source: 'MANUAL' }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Channel *
          <select value={state.channel} onChange={(e) => setState((s) => ({ ...s, channel: e.target.value }))} className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]">
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={state.contact_is_vip} onChange={(e) => setState((s) => ({ ...s, contact_is_vip: e.target.checked }))} />
          VIP contact
        </label>
      </div>

      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-2 text-[12px]">
        <div className="font-semibold text-sup-ink">Customer context</div>
        {!state.customer_id ? (
          <p className="text-sup-muted">Pick a customer to see tier, fleet and open tickets.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>Tier <b>{context?.support_tier || '—'}</b></div>
              <div>Fleet <b>{context?.fleet_size ?? '—'}</b></div>
              <div>Contract end <b>{context?.contract_end ? String(context.contract_end).slice(0, 10) : '—'}</b></div>
              <div>SLA <b>{context?.sla_policy_name || '—'}</b></div>
            </div>
            <div className="mt-2 rounded-md bg-pri2-bg p-2">
              <TicketLinkPicker value={state.link} onChange={(link) => setState((s) => ({ ...s, link }))} suggestions={open} />
            </div>
          </>
        )}
      </div>

      {pending && (
        <Modal title="Change customer?" onClose={() => setPending(null)} footer={(
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>Keep {state.customer?.display_name || state.customer?.name}</Button>
            <Button onClick={confirmChange}>Change customer</Button>
          </>
        )}>
          <p className="text-[13px]">
            You have {(state.lines || []).length || (state.selectedSerials || []).length} machine(s) entered for {state.customer?.display_name || state.customer?.name}. Changing the customer will clear them.
          </p>
        </Modal>
      )}
    </div>
  );
}

export function customerStepValid(state) {
  return Boolean(state.customer_id && state.channel && state.contact_name && indianMobile(state.contact_phone));
}
