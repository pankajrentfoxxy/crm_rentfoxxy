import React from 'react';
import { Button, Notice } from '../../../components/carret';
import { STEP_LABEL } from './serveShared';

/**
 * Ticket record → "What's next" (claude/carret-support.md rework F).
 *
 * One line at the top telling the lead the single most pressing thing on the
 * ticket, with the button that does it — so the lead never has to read the
 * whole page to know what to do.
 */
const DONE = ['resolved', 'closed', 'inventory_updated', 'cancelled', 'removed'];
const code = (i) => i.ttspl_id || i.unique_serial_number || i.serial_number || `#${i.id}`;
const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function nextStepOf(data) {
  const tk = data.ticket;
  if (['closed', 'cancelled'].includes(tk.status)) return null;
  const items = (data.items || []).filter((i) => i.status !== 'removed');
  const orders = (data.replacement_orders || []).filter((o) => o.status !== 'cancelled');
  const complaints = items.filter((i) => i.item_type === 'complaint' && !DONE.includes(i.status));
  const pickups = items.filter((i) => i.item_type === 'pickup' && !DONE.includes(i.status));
  const hasPickupFor = (c) => items.some((p) => p.item_type === 'pickup' && Number(p.source_item_id) === Number(c.id) && p.status !== 'cancelled');

  const askPickup = complaints.find((i) => i.outcome === 'repair_pickup_requested');
  if (askPickup) return { tone: 'warn', text: `The technician wants to take ${code(askPickup)} to the workshop${askPickup.replacement_flag_reason ? ` — “${askPickup.replacement_flag_reason}”` : ''}. Approve and they collect it now.`, action: 'replacement', item: askPickup };

  const replace = complaints.find((i) => i.outcome === 'replacement_required' && !orders.some((o) => [o.item_id, o.complaint_item_id, o.source_item_id].map(Number).includes(Number(i.id))));
  if (replace) return { tone: 'warn', text: `The technician says ${code(replace)} needs a pickup or a replacement. Decide: schedule a repair pickup, or start the replacement.`, action: 'replacement', item: replace };

  const ready = pickups.find((p) => p.repair_ready_at && !p.service_dc_number);
  if (ready) {
    const src = items.find((c) => Number(c.id) === Number(ready.source_item_id));
    if (src && src.reported_issue_id && !src.found_issue_id) return { tone: 'good', text: `${code(ready)} is repaired. Record what was wrong and what fixed it, then raise the Service DC.`, action: 'finding' };
    return { tone: 'good', text: `${code(ready)} is repaired and ready to go back. Raise the Service DC.`, action: 'sdc', item: ready };
  }

  const unassigned = complaints.find((i) => !i.assigned_to && !hasPickupFor(i));
  if (unassigned) return { tone: 'warn', text: `${code(unassigned)} has no technician yet.`, action: 'assign', item: unassigned };

  const pickupToAssign = pickups.find((p) => p.effective_current_step === 'pending_dispatch' && !p.assigned_to && !p.pickup_assigned_to);
  if (pickupToAssign) return { tone: 'warn', text: `Pickup ${tk.return_dc_number || ''} is not assigned — choose who collects it.`, action: 'pickup', item: pickupToAssign };

  const open = items.filter((i) => !DONE.includes(i.status));
  if (!open.length) {
    const missing = items.filter((i) => i.item_type === 'complaint' && i.reported_issue_id && !i.found_issue_id);
    if (missing.length) return { tone: 'warn', text: `Record what was wrong on ${missing.map(code).join(', ')}, then close the ticket.`, action: 'finding' };
    return { tone: 'good', text: 'Every laptop is done. Close the ticket — the customer gets the feedback link.', action: 'close' };
  }

  const first = open[0];
  const step = STEP_LABEL[first.effective_current_step] || STEP_LABEL[first.status] || String(first.status).replace(/_/g, ' ');
  return { tone: 'info', text: `Nothing for you right now — ${code(first)}: ${step}.`, action: null };
}

export default function TicketNextStep({ data, onAssign, onClose, canLead }) {
  const n = nextStepOf(data);
  if (!n) return null;
  const btn = {
    // Pickup, replacement and Service DC are on the laptop's card (task-<item id>).
    replacement: <Button variant="primary" onClick={() => scrollTo(`task-${n.item?.id}`)}>Go to the laptop</Button>,
    sdc: <Button variant="primary" onClick={() => scrollTo(`task-${n.item?.id}`)}>Go to the laptop</Button>,
    finding: <Button variant="primary" onClick={() => scrollTo('ticket-issue')}>Go to the issue</Button>,
    assign: <Button variant="primary" onClick={() => onAssign(n.item)}>Assign a technician</Button>,
    pickup: <Button variant="primary" onClick={() => scrollTo(`task-${n.item?.id}`)}>Go to the pickup</Button>,
    close: <Button variant="primary" onClick={onClose}>Close the ticket</Button>,
  }[n.action];
  return (
    <Notice tone={n.tone} title="What's next" action={canLead ? btn : null}>
      {n.text}
    </Notice>
  );
}
