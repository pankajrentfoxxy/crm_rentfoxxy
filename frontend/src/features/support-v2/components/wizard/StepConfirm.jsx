import React, { useEffect, useMemo, useState } from 'react';
import { TypeTag } from '../../../../components/ui/supportPrimitives';
import { previewSla } from '../../supportV2Api';
import { previewTicketPriority, woTypeLabel } from '../../supportV2Utils';
import { formatIstDateTime } from '../../istTime';

export default function StepConfirm({ state, setState, groups, owners, supportTier, fleetSize, currentUserId }) {
  const [preview, setPreview] = useState(null);
  const pri = previewTicketPriority(state, supportTier, fleetSize);
  const suggested = [...new Set((state.lines || []).map((l) => l.default_wo_type).filter(Boolean))];
  const active = (groups || []).filter((g) => g.is_active !== false);
  const remote = active.find((g) => g.group_type === 'REMOTE');
  const inhouse = active.find((g) => g.group_type === 'WAREHOUSE' && /inhouse/i.test(g.name));
  const cities = active.filter((g) => g.group_type === 'FIELD').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const suggestedCity = useMemo(() => {
    const pin = String(state.site_pincode || '').replace(/\D/g, '').slice(0, 6);
    if (!pin) return null;
    return cities.find((g) => String(g.display_name || g.name).toLowerCase().includes(
      pin.startsWith('56') ? 'bengaluru' : pin.startsWith('40') ? 'mumbai' : pin.startsWith('12') || pin.startsWith('11') ? 'ncr' : ''
    )) || null;
  }, [cities, state.site_pincode]);

  useEffect(() => {
    const first = (state.lines || [])[0];
    if (!state.customer_id || !first) return undefined;
    previewSla({
      customer_id: state.customer_id,
      ticket_class: state.ticket_class,
      impact: first.impact || 2,
      urgency: first.urgency || 2,
      is_safety: (state.lines || []).some((l) => l.is_safety),
      is_repeat: (state.lines || []).some((l) => l.repeat),
      contact_is_vip: state.contact_is_vip,
      support_tier: supportTier,
      fleet_size: fleetSize,
      affected_units: (state.lines || []).length,
    }).then((r) => setPreview(r.data)).catch(() => setPreview(null));
    return undefined;
  }, [state.customer_id, state.ticket_class, state.contact_is_vip, state.lines, supportTier, fleetSize]);

  const pickGroup = (g) => {
    setState((s) => ({
      ...s,
      assignment_group_id: g ? g.group_id : null,
      assigned_to: currentUserId || s.assigned_to,
    }));
  };

  const selected = active.find((g) => g.group_id === state.assignment_group_id);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-3 text-[12px]">
        <div className="font-semibold">Route to *</div>
        <div className="flex flex-wrap gap-1.5">
          {remote && (
            <button type="button" onClick={() => pickGroup(remote)} className={`px-3 py-1.5 rounded-md border ${selected?.group_id === remote.group_id ? 'bg-sup-accentSoft border-sup-accent' : 'border-sup-line'}`}>
              Remote
            </button>
          )}
          {inhouse && (
            <button type="button" onClick={() => pickGroup(inhouse)} className={`px-3 py-1.5 rounded-md border ${selected?.group_id === inhouse.group_id ? 'bg-sup-accentSoft border-sup-accent' : 'border-sup-line'}`}>
              Inhouse
            </button>
          )}
          {cities.map((g) => (
            <button
              key={g.group_id}
              type="button"
              onClick={() => pickGroup(g)}
              className={`px-3 py-1.5 rounded-md border ${selected?.group_id === g.group_id ? 'bg-sup-accentSoft border-sup-accent' : 'border-sup-line'}`}
            >
              {g.display_name || g.name}
              {suggestedCity && suggestedCity.group_id === g.group_id ? ' · Suggested' : ''}
            </button>
          ))}
        </div>
        {selected?.group_type === 'REMOTE' && <p className="text-sup-muted">No visit needed unless remote fails.</p>}
        {selected?.group_type === 'WAREHOUSE' && <p className="text-sup-muted">A pickup work order will be needed.</p>}
        {suggestedCity && !state.assignment_group_id && (
          <p className="text-sup-muted">{state.site_pincode} is in {suggestedCity.display_name}.</p>
        )}
        {!suggestedCity && state.site_pincode && (
          <p className="text-sup-muted">{state.site_pincode} is not in any city zone — pick a team.</p>
        )}

        <label className="block font-semibold">
          Desk owner
          <select
            value={state.assigned_to || ''}
            onChange={(e) => setState((s) => ({ ...s, assigned_to: e.target.value ? Number(e.target.value) : null }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
          >
            <option value="">Unassigned</option>
            {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-sup-muted">Who follows this ticket up. The technician or courier is chosen when you create the work order.</p>
        <label className="block font-semibold">
          Internal note
          <textarea value={state.internal_note} onChange={(e) => setState((s) => ({ ...s, internal_note: e.target.value }))} rows={3} className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5" />
        </label>
      </div>
      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-2 text-[12px]">
        <div className="font-semibold">Review</div>
        <p>
          P{preview?.priority || pri.priority} · Response by <b>{formatIstDateTime(preview?.response_due_at)}</b>
          {' '}· Resolution by <b>{formatIstDateTime(preview?.resolution_due_at)}</b>
        </p>
        <p>
          {(state.lines || []).length} machine{(state.lines || []).length === 1 ? '' : 's'} at {state.site_label || '—'}
          {' '}· Routed to <b>{selected?.display_name || selected?.name || '—'}</b>
        </p>
        <div className="pt-2 font-semibold">Next step after creating</div>
        {suggested.length ? suggested.map((w) => (
          <div key={w} className="flex items-center gap-2">
            <TypeTag type={w} />
            <span>{woTypeLabel(w)}</span>
          </div>
        )) : <p className="text-sup-muted">No work order implied yet — you can still create one.</p>}
      </div>
    </div>
  );
}
