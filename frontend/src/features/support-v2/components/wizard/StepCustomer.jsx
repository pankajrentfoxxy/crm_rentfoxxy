import React, { useEffect, useState } from 'react';
import { searchCustomers } from '../../supportV2Api';
import { indianMobile } from '../../supportV2Utils';
import TicketLinkPicker from '../TicketLinkPicker';

const CHANNELS = ['PHONE', 'EMAIL', 'WHATSAPP', 'PORTAL', 'INTERNAL', 'CHAT'];

export default function StepCustomer({ state, setState, context }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      searchCustomers(q.trim())
        .then((r) => setHits(r.data?.rows || []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (c) => {
    setState((s) => ({
      ...s,
      customer_id: c.customer_id,
      customer: c,
      contact_name: s.contact_name || c.name || '',
      contact_phone: s.contact_phone || c.phone || '',
      contact_email: s.contact_email || c.email || '',
      site_id: null,
      site_key: '',
      site_pincode: '',
      site_label: '',
      selectedSerials: [],
      link: null,
    }));
    setQ('');
    setHits([]);
  };

  const phoneOk = Boolean(indianMobile(state.contact_phone));
  const sites = context?.sites || [];
  const open = context?.open_tickets || [];

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
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
        <label className="block text-[12px] font-semibold">
          Delivery site *
          <select
            value={state.site_key || ''}
            onChange={(e) => {
              const site = sites.find((s) => s.site_key === e.target.value);
              setState((s) => ({
                ...s,
                site_key: site ? site.site_key : '',
                site_id: site ? site.customer_address_id : null,
                site_pincode: site ? (site.pincode || '') : '',
                site_label: site ? (site.address || site.city || site.pincode || '').slice(0, 120) : '',
                assignment_group_id: site?.suggested_group_id || s.assignment_group_id,
                selectedSerials: [],
              }));
            }}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
          >
            <option value="">Select the location where the laptop was delivered</option>
            {sites.map((s) => (
              <option key={s.site_key || s.customer_address_id} value={s.site_key}>
                {(s.address || s.city || 'Address')} · {s.pincode || '—'}
                {s.source === 'delivery' ? ` · ${s.machine_count || 0} laptop(s)` : ' · CRM address'}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-sup-muted -mt-1">
          Site is taken from the delivery challan. Only laptops delivered here can be selected next.
        </p>
        <label className="block text-[12px] font-semibold">
          Channel *
          <select
            value={state.channel}
            onChange={(e) => setState((s) => ({ ...s, channel: e.target.value }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
          >
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-semibold">
            Contact name *
            <input
              value={state.contact_name}
              onChange={(e) => setState((s) => ({ ...s, contact_name: e.target.value }))}
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
            />
          </label>
          <label className="block text-[12px] font-semibold">
            Mobile *
            <input
              value={state.contact_phone}
              onChange={(e) => setState((s) => ({ ...s, contact_phone: e.target.value }))}
              className={`mt-1 w-full rounded-md border px-2 py-1.5 text-[13px] ${state.contact_phone && !phoneOk ? 'border-pri1' : 'border-sup-line'}`}
            />
          </label>
        </div>
        <label className="block text-[12px] font-semibold">
          Email
          <input
            value={state.contact_email}
            onChange={(e) => setState((s) => ({ ...s, contact_email: e.target.value }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5 text-[13px]"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={state.contact_is_vip}
            onChange={(e) => setState((s) => ({ ...s, contact_is_vip: e.target.checked }))}
          />
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
              <div>Buffer <b>{context?.buffer_units ?? 0}</b></div>
              <div>Overdue invoices <b className={context?.overdue_invoices ? 'text-pri1' : ''}>{context?.overdue_invoices ?? 0}</b></div>
            </div>
            <div className="mt-2 rounded-md bg-pri2-bg p-2">
              <TicketLinkPicker
                value={state.link}
                onChange={(link) => setState((s) => ({ ...s, link }))}
                suggestions={open}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function customerStepValid(state) {
  return Boolean(
    state.customer_id && (state.site_key || state.site_id) && state.channel && state.contact_name && indianMobile(state.contact_phone)
  );
}
