import React, { useEffect, useState } from 'react';
import { TypeTag } from '../../../../components/ui/supportPrimitives';
import { previewSla } from '../../supportV2Api';
import { previewTicketPriority, woTypeLabel } from '../../supportV2Utils';

export default function StepConfirm({ state, setState, groups, owners, supportTier, fleetSize }) {
  const [preview, setPreview] = useState(null);
  const pri = previewTicketPriority(state, supportTier, fleetSize);
  const suggested = [...new Set((state.lines || []).map((l) => l.default_wo_type).filter(Boolean))];
  const skill = [...new Set((state.lines || []).map((l) => l.skill_required).filter(Boolean))].join(', ') || '—';

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

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-3 text-[12px]">
        <label className="block font-semibold">
          Assignment group
          <select
            value={state.assignment_group_id || ''}
            onChange={(e) => setState((s) => ({ ...s, assignment_group_id: e.target.value ? Number(e.target.value) : null }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
          >
            <option value="">Unassigned group</option>
            {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
          </select>
        </label>
        <label className="block font-semibold">
          Assign to
          <select
            value={state.assigned_to || ''}
            onChange={(e) => setState((s) => ({ ...s, assigned_to: e.target.value ? Number(e.target.value) : null }))}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
          >
            <option value="">Unassigned</option>
            {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block font-semibold">
            Slot start
            <input
              type="datetime-local"
              value={state.preferred_slot_start || ''}
              onChange={(e) => setState((s) => ({ ...s, preferred_slot_start: e.target.value }))}
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
            />
          </label>
          <label className="block font-semibold">
            Slot end
            <input
              type="datetime-local"
              value={state.preferred_slot_end || ''}
              onChange={(e) => setState((s) => ({ ...s, preferred_slot_end: e.target.value }))}
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
            />
          </label>
        </div>
        <div>Skill required <b>{skill}</b></div>
        <label className="block font-semibold">
          Internal note
          <textarea
            value={state.internal_note}
            onChange={(e) => setState((s) => ({ ...s, internal_note: e.target.value }))}
            rows={3}
            className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
          />
        </label>
      </div>
      <div className="bg-white rounded-[10px] border border-sup-lineSoft p-4 space-y-2 text-[12px]">
        <div className="font-semibold text-sup-ink">What will happen</div>
        <div>Ticket priority <b>P{preview?.priority || pri.priority}</b></div>
        <ul className="text-sup-muted list-disc pl-4">
          {(preview?.reasons || pri.reasons).slice(0, 6).map((r) => <li key={r}>{r}</li>)}
        </ul>
        <div>Response due <b>{preview?.response_due_at ? new Date(preview.response_due_at).toLocaleString() : '—'}</b></div>
        <div>Resolution due <b>{preview?.resolution_due_at ? new Date(preview.resolution_due_at).toLocaleString() : '—'}</b></div>
        <div>Calendar <b>{preview?.calendar?.name || preview?.policy?.name || '—'}</b></div>
        <div className="pt-2 font-semibold">Suggested work orders</div>
        {suggested.length ? suggested.map((w) => (
          <div key={w} className="flex items-center gap-2">
            <TypeTag type={w} />
            <span className="text-[10.5px] uppercase tracking-wide text-sup-faint">Suggested</span>
            <span>{woTypeLabel(w)}</span>
          </div>
        )) : <p className="text-sup-muted">None — no field job implied. Confirm classification only.</p>}
      </div>
    </div>
  );
}
