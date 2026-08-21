import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, TypeTag, WizardRail, BlockedReason } from '../../../../../components/ui/supportPrimitives';
import { usePermission } from '../../../../../hooks/usePermission';
import {
  createWorkOrder, createPartRequest, fetchCompatibleParts, fetchQueueMeta, fetchSlotAvailability,
} from '../../../supportV2Api';
import { LABELS, WO_TYPES, WO_TYPE_SECTION, woTypeLabel } from '../../../supportV2Utils';
import { addMinutes, istToday, nextDays, slotTimes } from '../../../istTime';
import EvidenceUploader from '../../EvidenceUploader';

const METHOD_FOR = {
  TECHNICIAN: ['FIELD_VISIT', 'REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN', 'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN'],
  COURIER: ['REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN', 'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN'],
  REMOTE: ['REMOTE_FIX', 'FIELD_VISIT'],
};
const STEPS = ['What', 'How', 'Parts', 'Review'];
const COURIERS = ['BLUEDART', 'DELHIVERY', 'DTDC', 'PORTER', 'OTHER'];

function directionFor(type) {
  if (/PICKUP|PART_RETURN/.test(type)) return 'PICKUP_FROM_CUSTOMER';
  return 'DELIVER_TO_CUSTOMER';
}

export default function CreateWorkOrderWizard({ ticket, lines, initialLineIds, onClose, onCreated }) {
  const { canCreate } = usePermission();
  const types = WO_TYPES.filter((t) => canCreate('support_work_orders') && canCreate(WO_TYPE_SECTION[t]));
  const suggested = [...new Set((lines || []).map((l) => l.default_wo_type).filter(Boolean))][0];
  const [step, setStep] = useState(0);
  const [woType, setWoType] = useState(suggested || types[0] || '');
  const [lineIds, setLineIds] = useState(initialLineIds || lines.map((l) => l.line_id));
  const [method, setMethod] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [owners, setOwners] = useState([]);
  const [groups, setGroups] = useState([]);
  const [avail, setAvail] = useState(null);
  const [slots, setSlots] = useState([]);
  const [courier, setCourier] = useState('BLUEDART');
  const [courierOther, setCourierOther] = useState('');
  const [pickupDate, setPickupDate] = useState(istToday());
  const [declared, setDeclared] = useState('');
  const [packNote, setPackNote] = useState('');
  const [awb, setAwb] = useState('');
  const [window, setWindow] = useState('Now');
  const [partDraft, setPartDraft] = useState(null);
  const [parts, setParts] = useState([]);
  const [saving, setSaving] = useState(false);

  const methods = Object.entries(METHOD_FOR).filter(([, list]) => list.includes(woType)).map(([m]) => m);

  useEffect(() => {
    fetchQueueMeta().then((r) => {
      setOwners(r.data?.owners || []);
      setGroups(r.data?.groups || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (method !== 'TECHNICIAN') return undefined;
    fetchSlotAvailability({
      group_id: ticket.assignment_group_id || undefined,
      date_from: istToday(),
      days: 7,
      site_key: ticket.site_key || undefined,
    }).then((r) => setAvail(r.data)).catch(() => setAvail(null));
    return undefined;
  }, [method, ticket.assignment_group_id, ticket.site_key]);

  useEffect(() => {
    const serial = (lines || []).find((l) => lineIds.includes(l.line_id) && l.serial_id);
    if (!serial) return undefined;
    fetchCompatibleParts(serial.serial_id).then((r) => setParts(r.data?.rows || r.data?.parts || [])).catch(() => setParts([]));
    return undefined;
  }, [lineIds, lines]);

  const blocked = () => {
    if (step === 0 && (!woType || !lineIds.length)) return 'Pick a work-order type and at least one machine.';
    if (step === 1 && !method) return 'Choose how this job will be done.';
    if (step === 1 && method === 'COURIER' && !courier) return 'Courier partner is required.';
    if (step === 1 && method === 'TECHNICIAN' && !slots.length) return 'Select at least one 30-minute slot.';
    return '';
  };

  const toggleSlot = (date, start) => {
    const key = `${date}|${start}`;
    setSlots((cur) => {
      if (cur.some((s) => `${s.date}|${s.start}` === key)) return cur.filter((s) => `${s.date}|${s.start}` !== key);
      return [...cur, { date, start, end: addMinutes(start, 30) }];
    });
  };

  const submit = async () => {
    setSaving(true);
    try {
      const r = await createWorkOrder(ticket.ticket_id, {
        wo_type: woType,
        line_ids: lineIds,
        method,
        assigned_to: assignedTo ? Number(assignedTo) : null,
        slots: method === 'TECHNICIAN' ? slots : undefined,
        courier_partner: method === 'COURIER' ? courier : undefined,
        courier_other_name: courier === 'OTHER' ? courierOther : undefined,
        courier_direction: method === 'COURIER' ? directionFor(woType) : undefined,
        courier_pickup_date: method === 'COURIER' ? pickupDate : undefined,
        courier_declared_value: declared ? Number(declared) : undefined,
        courier_packaging_note: packNote || undefined,
        courier_awb: awb || undefined,
        remote_contact_window: method === 'REMOTE' ? window : undefined,
      });
      if (partDraft?.part_id) {
        await createPartRequest({
          part_id: partDraft.part_id,
          support_ticket_id: ticket.ticket_id,
          support_line_id: lineIds[0],
          work_order_id: r.data.wo_id,
          quantity: partDraft.qty || 1,
          reason: partDraft.reason,
          fault_attribution: partDraft.fault,
          photo_attachment_ids: partDraft.photos || [],
          collect_old_part: Boolean(partDraft.collect_old),
          requested_before_visit: true,
        });
      }
      toast.success(`Created ${r.data.wo.wo_number}`);
      onCreated(r.data.wo);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not create work order');
    } finally {
      setSaving(false);
    }
  };

  const days = nextDays(7);
  const times = slotTimes();
  const tech = (avail?.users || []).find((u) => String(u.user_id) === String(assignedTo)) || (avail?.users || [])[0];

  return (
    <Modal title="Create work order" subtitle={ticket.ticket_number} size="xl" onClose={onClose} footer={(
      <>
        <Button variant="secondary" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>{step === 0 ? 'Cancel' : 'Back'}</Button>
        <BlockedReason>{blocked()}</BlockedReason>
        {step < 3
          ? <Button disabled={Boolean(blocked())} onClick={() => setStep((s) => s + 1)}>Continue</Button>
          : <Button loading={saving} onClick={submit}>Create work order</Button>}
      </>
    )}>
      <div className="space-y-3">
        <WizardRail steps={STEPS} current={step} onGo={setStep} />

        {step === 0 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              {types.map((t) => (
                <button key={t} type="button" onClick={() => { setWoType(t); setMethod(''); }} className={`text-left rounded-[10px] border p-3 ${woType === t ? 'border-sup-accent bg-sup-accentSoft' : 'border-sup-lineSoft'}`}>
                  <div className="flex items-center gap-2"><TypeTag type={t} />{t === suggested && <span className="text-[10px] uppercase text-sup-faint">Suggested</span>}</div>
                  <div className="text-[12px] font-semibold mt-1">{woTypeLabel(t)}</div>
                  <div className="text-[11px] text-sup-muted">{LABELS.WO_TYPES[t]?.hint}</div>
                </button>
              ))}
            </div>
            <div className="text-[12px] font-semibold">Machines</div>
            {lines.map((l) => (
              <label key={l.line_id} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={lineIds.includes(l.line_id)} onChange={() => setLineIds((cur) => cur.includes(l.line_id) ? cur.filter((x) => x !== l.line_id) : [...cur, l.line_id])} />
                {l.line_code} {l.ttspl_id || 'Unknown'} · {l.line_status}
              </label>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-[12px]">
            <div className="flex flex-wrap gap-2">
              {methods.map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)} className={`px-3 py-2 rounded-[10px] border ${method === m ? 'border-sup-accent bg-sup-accentSoft' : 'border-sup-line'}`}>
                  <div className="font-semibold">{LABELS.METHODS[m].label}</div>
                  <div className="text-[11px] text-sup-muted">{LABELS.METHODS[m].hint}</div>
                </button>
              ))}
            </div>

            {method === 'COURIER' && (
              <div className="space-y-2">
                <label>Courier partner *
                  <select value={courier} onChange={(e) => setCourier(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
                    {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {courier === 'OTHER' && <input value={courierOther} onChange={(e) => setCourierOther(e.target.value)} placeholder="Partner name" className="w-full border rounded px-2 py-1.5" />}
                <div>Direction <b>{directionFor(woType) === 'PICKUP_FROM_CUSTOMER' ? 'Pickup from customer' : 'Deliver to customer'}</b></div>
                <label>Pickup / dispatch date <input type="date" min={istToday()} value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className="mt-1 border rounded px-2 py-1.5" /></label>
                <label>Declared value <input value={declared} onChange={(e) => setDeclared(e.target.value)} className="mt-1 border rounded px-2 py-1.5" /></label>
                <label>Packaging note <input value={packNote} onChange={(e) => setPackNote(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" /></label>
                <label>AWB (optional) <input value={awb} onChange={(e) => setAwb(e.target.value)} className="mt-1 border rounded px-2 py-1.5" /></label>
                <label>Logistics coordinator
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
                    <option value="">Unassigned</option>
                    {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
                  </select>
                </label>
                <p className="text-sup-muted">{courier} to {ticket.site_pincode || 'site'} — typically 2–3 working days.</p>
              </div>
            )}

            {method === 'TECHNICIAN' && (
              <div className="space-y-2">
                <label>Technician
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
                    <option value="">Pick a technician</option>
                    {(avail?.users || owners).map((u) => (
                      <option key={u.user_id} value={u.user_id}>{u.name}{u.jobs_today != null ? ` · ${u.jobs_today} jobs today` : ''}{u.jobs_at_site ? ` · ${u.jobs_at_site} at this site` : ''}</option>
                    ))}
                  </select>
                </label>
                <div className="overflow-auto border rounded-[10px]">
                  <table className="text-[10px] min-w-[640px]">
                    <thead><tr><th className="p-1" />{days.map((d) => <th key={d} className="p-1">{d.slice(5)}</th>)}</tr></thead>
                    <tbody>
                      {times.map((t) => (
                        <tr key={t}>
                          <td className="p-1 font-mono">{t}</td>
                          {days.map((d) => {
                            const busy = tech?.busy?.[`${d}|${t}`];
                            const leave = tech?.leave_dates?.includes(d);
                            const on = slots.some((s) => s.date === d && s.start === t);
                            return (
                              <td key={d} className="p-0.5">
                                <button
                                  type="button"
                                  disabled={Boolean(busy || leave)}
                                  onClick={() => toggleSlot(d, t)}
                                  className={`w-full h-6 rounded ${leave ? 'bg-sup-canvas2 text-sup-faint' : busy ? 'bg-pri2-bg text-pri2' : on ? 'bg-sup-accent text-white' : 'bg-white border border-sup-lineSoft'}`}
                                  title={busy ? `Busy WO-${busy}` : leave ? 'On leave' : ''}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-1">
                  {slots.map((s) => (
                    <button key={`${s.date}|${s.start}`} type="button" className="px-2 py-0.5 rounded-full bg-sup-canvas2 text-[11px]" onClick={() => toggleSlot(s.date, s.start)}>
                      {s.date.slice(5)} {s.start}–{s.end} ✕
                    </button>
                  ))}
                </div>
                <p className="text-sup-muted">{slots.length} slot{slots.length === 1 ? '' : 's'} · {slots.length * 30} min</p>
              </div>
            )}

            {method === 'REMOTE' && (
              <div className="space-y-2">
                <label>Remote engineer
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
                    <option value="">Unassigned</option>
                    {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
                  </select>
                </label>
                <label>Contact window
                  <select value={window} onChange={(e) => setWindow(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
                    {['Now', 'Within 2 hours', 'Today 2–5 PM', 'Tomorrow morning'].map((w) => <option key={w}>{w}</option>)}
                  </select>
                </label>
                <p>Call {ticket.contact_name} on <a className="text-sup-accent underline" href={`tel:${ticket.contact_phone}`}>{ticket.contact_phone}</a></p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2 text-[12px]">
            <p className="text-sup-muted">Optional — pre-book a part so the visit does not fail mid-way.</p>
            <select value={partDraft?.part_id || ''} onChange={(e) => setPartDraft((p) => ({ ...(p || {}), part_id: e.target.value ? Number(e.target.value) : null }))} className="w-full border rounded px-2 py-1.5">
              <option value="">No part needed</option>
              {parts.map((p) => <option key={p.part_id} value={p.part_id}>{p.part_name} · ₹{p.selling_price ?? '—'}</option>)}
            </select>
            {partDraft?.part_id && (
              <>
                <input value={partDraft.reason || ''} onChange={(e) => setPartDraft((p) => ({ ...p, reason: e.target.value }))} placeholder="Why is it needed (min 15 chars)" className="w-full border rounded px-2 py-1.5" />
                <div className="grid sm:grid-cols-2 gap-1">
                  {Object.entries(LABELS.FAULT).map(([k, v]) => (
                    <label key={k} className="flex items-start gap-1.5">
                      <input type="radio" checked={partDraft.fault === k} onChange={() => setPartDraft((p) => ({ ...p, fault: k }))} />
                      <span>{v.label}<br /><span className="text-sup-muted">{v.hint}</span></span>
                    </label>
                  ))}
                </div>
                {LABELS.FAULT[partDraft.fault]?.chargeable && (
                  <EvidenceUploader attachmentIds={partDraft.photos || []} onChange={(ids) => setPartDraft((p) => ({ ...p, photos: ids }))} required />
                )}
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="text-[13px] space-y-2">
            <p>
              {method === 'TECHNICIAN' && `${(avail?.users || owners).find((u) => String(u.user_id) === String(assignedTo))?.name || 'A technician'} will visit ${ticket.site_label || 'the site'}${slots[0] ? ` on ${slots[0].date}, ${slots[0].start}–${slots[slots.length - 1].end}` : ''}, for ${lineIds.length} machine(s).`}
              {method === 'COURIER' && `${courier} will ${directionFor(woType) === 'PICKUP_FROM_CUSTOMER' ? 'collect from' : 'deliver to'} ${ticket.site_label || 'the customer'} on ${pickupDate}.`}
              {method === 'REMOTE' && `Remote session (${window}) with ${ticket.contact_name || 'the contact'}.`}
            </p>
            <p>{woTypeLabel(woType)} · {lineIds.length} machine(s){partDraft?.part_id ? ' · 1 part pre-booked' : ''}.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
