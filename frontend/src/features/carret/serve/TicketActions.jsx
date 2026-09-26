import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import { fileUrl } from '../procure/procureShared';
import DispatchFields, { dispatchBody, dispatchError, emptyDispatch } from './DispatchFields';
import {
  assignPickup, cancelPickup, changePickupAssignment, changeServiceDcTechnician, createPickup, createServiceDc,
  fetchCustomerLaptops, fetchPickupContext, fetchRedeliveryContext, fetchReplacementContext, fetchResendContext,
  fetchServiceDcEligibility, fetchSwapContext, moveToReplacement, regenerateServiceDcPdf, resendLaptop, setCourierDetails,
  startRedelivery, startReplacement, startSwap,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Serve → ticket → pickup, replacement and Service DC (claude/carret-support.md).
 * The same endpoints and the same moments as the old ticket screen
 * (SupportTicketDetail / PickupItemCard / ReplacementPanel / RepairSwapPanel /
 * ServiceDcPanel), so nothing behaves differently — only where it is done.
 */
const CLOSED = ['resolved', 'closed', 'inventory_updated', 'cancelled'];
const forItem = (o, i) => [o.item_id, o.complaint_item_id, o.source_item_id].map(Number).includes(Number(i.id));
const code = (i) => i.ttspl_id || i.unique_serial_number || i.serial_number;
const addrFrom = (d = {}) => ({
  name: d.contact_name || d.name || '', phone: d.contact_phone || d.phone || '', address: d.address || '',
  city: d.city || '', state: d.state || '', pincode: d.pincode || '',
});

function pickupStarted(i) {
  return Boolean(i.visited_at || i.customer_otp_verified_at || i.warehouse_received_at || i.technician_esign_at || i.picked_up_at);
}

export default function TicketActions({ data, techs, reload }) {
  const tk = data.ticket;
  const items = data.items || [];
  const cancelledTicket = tk.status === 'cancelled';
  const closedTicket = ['closed', 'cancelled'].includes(tk.status);
  const pickups = items.filter((i) => i.item_type === 'pickup');
  const livePickups = pickups.filter((i) => !['cancelled', 'removed'].includes(i.status));
  const onRdc = livePickups.filter((i) => tk.return_dc_number && i.return_dc_number === tk.return_dc_number);
  const complaints = items.filter((i) => i.item_type === 'complaint');
  const orders = data.replacement_orders || [];
  const activeOrder = orders.find((o) => !['completed', 'cancelled'].includes(o.status));
  const warehouseReceived = livePickups.filter((i) => i.warehouse_received_at);
  const repairReceived = warehouseReceived.filter((i) => (i.pickup_type || (i.source_item_id ? 'repair' : 'return')) === 'repair');

  const [open, setOpen] = useState(null); // which drawer
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast.success(r?.data?.message || ok); setOpen(null); reload(); return r; } catch (e) {
      toast.error(errMsg(e)); return null;
    } finally { setBusy(false); }
  };

  /* ---------------- pickup: create ---------------- */
  const [pk, setPk] = useState(null);
  const openPickup = async (sourceItem = null) => {
    const base = { pickup_type: sourceItem?.item_type === 'complaint' ? 'repair' : '', selected: {}, laptops: [], dispatch: emptyDispatch({ name: tk.customer_name || '', phone: tk.display_phone || '' }) };
    // Laptops on the ticket first; otherwise the customer's laptops.
    const fromTicket = complaints.filter((i) => !CLOSED.includes(i.status) || i.status === 'resolved')
      .map((i) => ({ key: `i${i.id}`, source_item_id: i.id, ttspl_id: code(i), serial_number: i.serial_number, unique_serial_number: i.unique_serial_number, brand: i.brand, model: i.model, ram: i.ram, storage: i.storage, generation: i.generation }));
    let laptops = fromTicket;
    if (!laptops.length) {
      try {
        const { data: d } = await fetchCustomerLaptops(tk.customer_id);
        laptops = (d.assets || []).map((a) => {
          const [brand, ...rest] = String(a.model_name || '').split(' ');
          return { key: `a${a.id}`, ttspl_id: a.unique_serial_number, unique_serial_number: a.unique_serial_number, serial_number: a.serial_number, brand, model: rest.join(' '), ram: a.ram, storage: a.storage, generation: a.generation, is_wfh: a.is_wfh };
        });
      } catch (e) { toast.error(errMsg(e)); }
    }
    const selected = sourceItem ? { [`i${sourceItem.id}`]: true } : (laptops.length === 1 ? { [laptops[0].key]: true } : {});
    const first = laptops.find((l) => selected[l.key]) || laptops[0];
    let dispatch = base.dispatch;
    if (first) {
      try {
        const { data: c } = await fetchPickupContext(tk.customer_id, first.ttspl_id || first.serial_number);
        if (c.found && c.pickup_address) dispatch = { ...dispatch, address: { ...dispatch.address, ...addrFrom(c.pickup_address), name: c.pickup_address.name || dispatch.address.name, phone: c.pickup_address.phone || dispatch.address.phone } };
      } catch { /* the address can be typed */ }
    }
    setPk({ ...base, laptops, selected, dispatch });
    setOpen('pickup');
  };
  const submitPickup = () => {
    if (!pk.pickup_type) { toast.error('Repair or return?'); return; }
    const chosen = pk.laptops.filter((l) => pk.selected[l.key]);
    if (!chosen.length) { toast.error('Pick the laptop(s) to collect'); return; }
    const err = dispatchError(pk.dispatch);
    if (err) { toast.error(err); return; }
    run(() => createPickup(tk.id, {
      pickup_type: pk.pickup_type,
      ...dispatchBody(pk.dispatch),
      pickup_address: pk.dispatch.address,
      machines: chosen.map(({ key, is_wfh, ...m }) => m),
      source_item_id: chosen.length === 1 && chosen[0].source_item_id ? chosen[0].source_item_id : undefined,
    }), 'Pickup created with its Return DC');
  };

  /* ---------------- pickup: assign / change / courier / cancel ---------------- */
  const pendingDispatch = onRdc.find((i) => i.effective_current_step === 'pending_dispatch' && !i.assigned_to && !i.pickup_assigned_to);
  const editable = onRdc.find((i) => !CLOSED.includes(i.status) && !pickupStarted(i) && i.effective_current_step !== 'pending_dispatch' && (i.pickup_method || i.pickup_assigned_to || i.assigned_to));
  const courierItem = onRdc.find((i) => i.pickup_method === 'courier' && !CLOSED.includes(i.status) && !i.warehouse_received_at && !i.gate_inward_at);
  const cancellable = tk.return_dc_number && onRdc.length > 0 && onRdc.every((i) => !i.picked_up_at && !i.warehouse_received_at && !CLOSED.includes(i.status));
  const [asg, setAsg] = useState(null);
  const openAssign = (change) => {
    const it = change ? editable : pendingDispatch;
    setAsg({
      change,
      reason: '',
      dispatch: {
        ...emptyDispatch(),
        dispatch_mode: change ? (it?.pickup_method === 'inhouse' ? 'technician' : (it?.pickup_method || '')) : '',
        technician_user_id: change ? String(it?.pickup_assigned_to || it?.assigned_to || '') : '',
        courier_name: it?.pickup_courier_name || '', awb_number: it?.pickup_awb || '',
        porter_tracking_id: it?.porter_tracking_id || '', porter_order_id: it?.porter_order_id || '',
      },
    });
    setOpen('assign');
  };
  const submitAssign = () => {
    const err = dispatchError(asg.dispatch, { strict: true, needAddress: false });
    if (err) { toast.error(err); return; }
    if (asg.change && asg.reason.trim().length < 3) { toast.error('Why are you changing it?'); return; }
    run(() => (asg.change
      ? changePickupAssignment(tk.id, { ...dispatchBody(asg.dispatch), reason: asg.reason.trim() })
      : assignPickup(tk.id, dispatchBody(asg.dispatch))), asg.change ? 'Pickup reassigned' : 'Pickup assigned');
  };
  const [courier, setCourier] = useState({ courier_name: '', awb_number: '' });
  const [cancelReason, setCancelReason] = useState('');

  /* ---------------- replacement ---------------- */
  const [rep, setRep] = useState(null);
  const openReplacement = async () => {
    try {
      const { data: c } = await fetchReplacementContext(tk.id);
      const ids = Object.fromEntries((c.eligible_items || []).map((i) => [i.id, true]));
      setRep({ ctx: c, ids, reason: '', rdc_action: c.open_return_dc ? 'reuse' : '', dispatch: { ...emptyDispatch(addrFrom(c.delivery_defaults)) } });
      setOpen('replacement');
    } catch (e) { toast.error(errMsg(e)); }
  };
  const submitReplacement = async () => {
    const chosen = Object.keys(rep.ids).filter((k) => rep.ids[k]).map(Number);
    if (!chosen.length) { toast.error('Pick the laptop(s) to replace'); return; }
    const err = dispatchError(rep.dispatch, { optional: true });
    if (err) { toast.error(err); return; }
    if (rep.ctx.open_return_dc && !rep.rdc_action) { toast.error('Use the existing pickup, or cancel it and make a new one?'); return; }
    await run(() => startReplacement(tk.id, {
      source_item_ids: chosen,
      reason: rep.reason.trim() || undefined,
      existing_rdc_action: rep.ctx.open_return_dc ? rep.rdc_action : undefined,
      contact_name: rep.dispatch.address.name, contact_phone: rep.dispatch.address.phone,
      pickup_address: rep.dispatch.address,
      ...dispatchBody(rep.dispatch),
    }), 'Replacement ordered — the faulty laptop comes back on a return pickup');
  };
  const eligibleForMove = complaints.find((i) => !['resolved', 'closed', 'cancelled'].includes(i.status) && i.outcome !== 'replacement_required' && !i.replacement_flag_reason);

  /* ---------------- swap from repair / another laptop / resend ---------------- */
  const [swap, setSwap] = useState(null); // {kind, ctx, ids, reason, address}
  const openSwap = async (kind) => {
    try {
      const { data: c } = kind === 'swap' ? await fetchSwapContext(tk.id) : await fetchRedeliveryContext(tk.id);
      if ((kind === 'swap' && !c.can_swap) || (kind === 'redelivery' && !c.can_create)) { toast.error(c.block_reason || 'Not possible now'); return; }
      setSwap({ kind, ctx: c, ids: Object.fromEntries((c.eligible_items || []).map((i) => [i.pickup_item_id, true])), reason: '', dispatch: emptyDispatch(addrFrom(c.delivery_defaults)) });
      setOpen('swap');
    } catch (e) { toast.error(errMsg(e)); }
  };
  const submitSwap = () => {
    const chosen = Object.keys(swap.ids).filter((k) => swap.ids[k]).map(Number);
    if (!chosen.length) { toast.error('Pick the laptop(s)'); return; }
    if (!swap.dispatch.address.address.trim()) { toast.error('Enter the delivery address'); return; }
    const body = {
      pickup_item_ids: chosen, reason: swap.reason.trim() || undefined,
      contact_name: swap.dispatch.address.name, contact_phone: swap.dispatch.address.phone, pickup_address: swap.dispatch.address,
    };
    run(() => (swap.kind === 'swap' ? startSwap(tk.id, body) : startRedelivery(tk.id, body)), 'Replacement order raised');
  };
  const [resend, setResend] = useState(null);
  const openResend = async () => {
    try {
      const { data: c } = await fetchResendContext(tk.id);
      if (!c.can_resend) { toast.error(c.block_reason || 'Nothing to resend'); return; }
      setResend({ ctx: c, reason: '' });
      setOpen('resend');
    } catch (e) { toast.error(errMsg(e)); }
  };

  /* ---------------- Service DC ---------------- */
  const showSdc = !activeOrder && repairReceived.length > 0;
  const [sdc, setSdc] = useState(null);
  useEffect(() => {
    if (!showSdc) { setSdc(null); return; }
    fetchServiceDcEligibility(tk.id).then(({ data: d }) => setSdc(d)).catch(() => setSdc(null));
  }, [showSdc, tk.id, data]);
  const [sdcForm, setSdcForm] = useState(null);
  const openSdc = () => {
    const ids = Object.fromEntries((sdc.eligible_items || []).filter((i) => i.eligible).map((i) => [i.id, true]));
    setSdcForm({ ids, remarks: '', dispatch: emptyDispatch(addrFrom(sdc.delivery_defaults)) });
    setOpen('sdc');
  };
  const submitSdc = () => {
    const chosen = Object.keys(sdcForm.ids).filter((k) => sdcForm.ids[k]).map(Number);
    if (!chosen.length) { toast.error('Pick the laptop(s) going back'); return; }
    const err = dispatchError(sdcForm.dispatch);
    if (err) { toast.error(err); return; }
    run(() => createServiceDc(tk.id, {
      item_ids: chosen, ...dispatchBody(sdcForm.dispatch), shipping_address: sdcForm.dispatch.address, remarks: sdcForm.remarks.trim() || undefined,
    }), 'Service DC raised — it goes out like any delivery');
  };
  const [sdcTech, setSdcTech] = useState(null);

  if (cancelledTicket) return null;
  const canSchedulePickup = !closedTicket && !tk.return_dc_number && !livePickups.some((i) => !CLOSED.includes(i.status));

  return (
    <>
      {/* Pickup */}
      <Section
        title="Pickup"
        actions={(
          <>
            {canSchedulePickup && <Button variant="primary" onClick={() => openPickup()}>Schedule pickup</Button>}
            {pendingDispatch && <Button variant="primary" onClick={() => openAssign(false)}>Assign pickup</Button>}
            {editable && <Button onClick={() => openAssign(true)}>Change who collects</Button>}
            {courierItem && <Button variant="quiet" onClick={() => { setCourier({ courier_name: courierItem.pickup_courier_name || '', awb_number: courierItem.pickup_awb || '' }); setOpen('courier'); }}>Courier details</Button>}
            {cancellable && <Button variant="quiet" onClick={() => { setCancelReason(''); setOpen('cancelPickup'); }}>Cancel pickup</Button>}
          </>
        )}
      >
        {tk.return_dc_number ? (
          <p>Return DC <DocNumber value={tk.return_dc_number} /> · {onRdc.length} laptop(s) · {onRdc.map((i) => i.pickup_method || 'not dispatched').filter((v, x, a) => a.indexOf(v) === x).join(', ')}</p>
        ) : <p className="text-ink-3">No pickup on this ticket.</p>}
      </Section>

      {/* Replacement */}
      {(complaints.length > 0 || orders.length > 0 || warehouseReceived.length > 0) && !closedTicket && (
        <Section
          title="Replacement"
          actions={(
            <>
              {complaints.some((i) => i.outcome === 'replacement_required' && !orders.some((o) => forItem(o, i) && o.status !== 'cancelled')) && (
                <Button variant="primary" onClick={openReplacement}>{activeOrder && tk.return_dc_number ? 'Add to replacement' : 'Start replacement'}</Button>
              )}
              {eligibleForMove && <Button variant="quiet" onClick={() => { const why = window.prompt('Why replace this laptop instead of repairing it?') ?? null; if (why !== null) run(() => moveToReplacement(eligibleForMove.id, why), 'Marked for replacement'); }}>Move {code(eligibleForMove)} to replacement</Button>}
              {repairReceived.length > 0 && !activeOrder && <Button onClick={() => openSwap('swap')}>Swap from repair</Button>}
              {warehouseReceived.length > 0 && <Button onClick={() => openSwap('redelivery')}>Send another laptop</Button>}
              {warehouseReceived.length > 0 && orders.some((o) => o.status !== 'cancelled') && tk.sales_order_number && <Button variant="quiet" onClick={openResend}>Resend on the same order</Button>}
            </>
          )}
        >
          {orders.length === 0 ? <p className="text-ink-3">No replacement on this ticket.</p> : (
            <DataTable
              columns={[
                { key: 'o', header: 'Order', render: (o) => <DocNumber value={o.sales_order_number || `#${o.id}`} />, sub: (o) => o.dc_number || null },
                { key: 'f', header: 'Replaces', render: (o) => <span className="font-mono">{o.old_machine_serial || '—'}</span>, sub: (o) => o.old_model || null },
                { key: 's', header: 'Status', render: (o) => String(o.status).replace(/_/g, ' ') },
                { key: 'd', header: 'Delivered', render: (o) => (o.delivered_at ? <DateTime value={o.delivered_at} /> : '—') },
              ]}
              rows={orders}
              rowKey={(o) => o.id}
            />
          )}
        </Section>
      )}

      {/* Service DC */}
      {showSdc && (
        <Section title="Service DC — send the repaired laptop back" actions={sdc?.can_create && <Button variant="primary" onClick={openSdc}>Raise Service DC</Button>}>
          {!sdc ? <EmptyState title="Loading…" /> : (
            <>
              {(sdc.eligible_items || []).filter((i) => !i.eligible).map((i) => (
                <p key={i.id} className="text-ink-3"><span className="font-mono">{i.ttspl_id}</span>: {(i.reasons || []).join('; ')}{i.open_floor_ticket_id ? ` (floor ticket #${i.open_floor_ticket_id} at ${i.open_floor_ticket_stage})` : ''}</p>
              ))}
              {(sdc.service_dcs || []).length > 0 && (
                <DataTable
                  columns={[
                    { key: 'n', header: 'Service DC', render: (d) => <DocNumber value={d.dc_number} />, sub: (d) => d.current_step || d.status },
                    { key: 'm', header: 'Travels by', render: (d) => d.dispatch_mode || '—', sub: (d) => d.delivery_person_name || d.courier_name || null },
                    {
                      key: 'a',
                      header: '',
                      render: (d) => (
                        <div className="flex" style={{ gap: '6px' }}>
                          {d.pdf_path ? <a className="c-btn" href={fileUrl(d.pdf_path)} target="_blank" rel="noopener noreferrer">PDF</a>
                            : <Button variant="quiet" onClick={() => run(() => regenerateServiceDcPdf(d.dc_number), 'PDF made')}>Make PDF</Button>}
                          {d.assignment_editable && <Button variant="quiet" onClick={() => { setSdcTech({ dc: d.dc_number, tech: '', reason: '' }); setOpen('sdcTech'); }}>Change technician</Button>}
                        </div>
                      ),
                    },
                  ]}
                  rows={sdc.service_dcs}
                  rowKey={(d) => d.dc_number}
                />
              )}
            </>
          )}
        </Section>
      )}

      {/* ---------------- drawers ---------------- */}
      <Drawer open={open === 'pickup'} onClose={() => setOpen(null)} title="Schedule pickup" width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitPickup}>Create pickup + Return DC</Button>}>
        {pk && (
          <div className="c-stack">
            <Field label="Why we collect it" required>
              <Select value={pk.pickup_type} onChange={(e) => setPk({ ...pk, pickup_type: e.target.value })} placeholder="Choose…" options={[{ value: 'repair', label: 'Repair — comes back to the customer' }, { value: 'return', label: 'Return — the customer gives it back' }]} />
            </Field>
            <div>
              <div className="c-label">Laptops</div>
              {pk.laptops.length === 0 ? <p className="text-ink-3">No laptops found for this customer.</p> : pk.laptops.map((l) => (
                <Checkbox key={l.key} label={`${l.ttspl_id || l.serial_number} — ${[l.brand, l.model].filter(Boolean).join(' ')}${l.is_wfh ? ' · work from home' : ''}`} checked={Boolean(pk.selected[l.key])} onChange={(e) => setPk({ ...pk, selected: { ...pk.selected, [l.key]: e.target.checked } })} />
              ))}
            </div>
            <DispatchFields value={pk.dispatch} onChange={(d) => setPk({ ...pk, dispatch: d })} technicians={techs} addressLabel="Pickup address" />
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'assign'} onClose={() => setOpen(null)} title={asg?.change ? 'Change who collects' : 'Assign the pickup'} footer={<Button variant="primary" disabled={busy} onClick={submitAssign}>Save</Button>}>
        {asg && (
          <div className="c-stack">
            <p className="text-ink-3">Applies to every laptop on Return DC {tk.return_dc_number}.</p>
            <DispatchFields value={asg.dispatch} onChange={(d) => setAsg({ ...asg, dispatch: d })} technicians={techs} showAddress={false} />
            {asg.change && <Field label="Why the change" required><Textarea rows={2} value={asg.reason} onChange={(e) => setAsg({ ...asg, reason: e.target.value })} /></Field>}
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'courier'} onClose={() => setOpen(null)} title="Courier details" footer={<Button variant="primary" disabled={busy || !courier.courier_name.trim() || !courier.awb_number.trim()} onClick={() => run(() => setCourierDetails(courierItem.id, { courier_name: courier.courier_name.trim(), awb_number: courier.awb_number.trim() }), 'Courier details saved')}>Save</Button>}>
        <div className="c-stack">
          <Field label="Courier" required><Textarea rows={1} value={courier.courier_name} onChange={(e) => setCourier({ ...courier, courier_name: e.target.value })} /></Field>
          <Field label="AWB" required><Textarea rows={1} value={courier.awb_number} onChange={(e) => setCourier({ ...courier, awb_number: e.target.value })} /></Field>
        </div>
      </Drawer>

      <Drawer open={open === 'cancelPickup'} onClose={() => setOpen(null)} title={`Cancel pickup ${tk.return_dc_number || ''}`} footer={<Button variant="primary" disabled={busy || cancelReason.trim().length < 3} onClick={() => run(() => cancelPickup(tk.id, { reason: cancelReason.trim(), return_dc_number: tk.return_dc_number, cancel_replacement_order: false }), 'Pickup cancelled')}>Cancel the pickup</Button>}>
        <p style={{ marginBottom: '8px' }}>Nothing has been collected yet. The Return DC is cancelled; a replacement order (if any) stays.</p>
        <Field label="Reason" required><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </Drawer>

      <Drawer open={open === 'replacement'} onClose={() => setOpen(null)} title="Replacement" width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitReplacement}>Order the replacement</Button>}>
        {rep && (
          <div className="c-stack">
            <div>
              <div className="c-label">Laptops to replace</div>
              {(rep.ctx.eligible_items || []).map((i) => (
                <Checkbox key={i.id} label={`${i.ttspl_id} — ${[i.brand, i.model].filter(Boolean).join(' ')}${i.replacement_flag_reason ? ` · ${i.replacement_flag_reason}` : ''}`} checked={Boolean(rep.ids[i.id])} onChange={(e) => setRep({ ...rep, ids: { ...rep.ids, [i.id]: e.target.checked } })} />
              ))}
              {!(rep.ctx.eligible_items || []).length && <p className="text-ink-3">No laptop marked for replacement.</p>}
            </div>
            {rep.ctx.open_return_dc && (
              <Field label={`A pickup (${rep.ctx.open_return_dc.return_dc_number}) is already open`} required>
                <Select value={rep.rdc_action} onChange={(e) => setRep({ ...rep, rdc_action: e.target.value })} options={[{ value: 'reuse', label: 'Use it to collect the faulty laptop' }, ...(rep.ctx.open_return_dc.pickup_started ? [] : [{ value: 'cancel', label: 'Cancel it and make a new pickup' }])]} />
              </Field>
            )}
            <Field label="Reason (optional)"><Textarea rows={2} value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })} /></Field>
            <Notice tone="info">The replacement goes to this address, and the faulty laptop is collected from it on a return pickup.</Notice>
            <DispatchFields value={rep.dispatch} onChange={(d) => setRep({ ...rep, dispatch: d })} technicians={techs} optional addressLabel="Delivery / pickup address" />
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'swap'} onClose={() => setOpen(null)} title={swap?.kind === 'swap' ? 'Swap from repair' : 'Send another laptop'} width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitSwap}>Raise the order</Button>}>
        {swap && (
          <div className="c-stack">
            <p className="text-ink-3">{swap.kind === 'swap' ? 'The laptop in repair is replaced; a replacement sales order is raised.' : 'A new replacement order for a laptop already back in the warehouse.'}</p>
            {(swap.ctx.eligible_items || []).map((i) => (
              <Checkbox key={i.pickup_item_id} label={`${i.ttspl_id} — ${[i.brand, i.model].filter(Boolean).join(' ')}`} checked={Boolean(swap.ids[i.pickup_item_id])} onChange={(e) => setSwap({ ...swap, ids: { ...swap.ids, [i.pickup_item_id]: e.target.checked } })} />
            ))}
            <Field label="Reason (optional)"><Textarea rows={2} value={swap.reason} onChange={(e) => setSwap({ ...swap, reason: e.target.value })} /></Field>
            <DispatchFields value={swap.dispatch} onChange={(d) => setSwap({ ...swap, dispatch: d })} technicians={[]} optional addressLabel="Delivery address" />
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'resend'} onClose={() => setOpen(null)} title="Resend on the same order" footer={<Button variant="primary" disabled={busy} onClick={() => run(() => resendLaptop(tk.id, resend.reason.trim() || undefined), 'Order reopened — attach a laptop and send it')}>Resend</Button>}>
        {resend && (
          <div className="c-stack">
            {(resend.ctx.next_steps || []).map((s) => <p key={s} className="text-ink-3">• {s}</p>)}
            <Field label="Reason (optional)"><Textarea rows={2} value={resend.reason} onChange={(e) => setResend({ ...resend, reason: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'sdc'} onClose={() => setOpen(null)} title="Raise Service DC" width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitSdc}>Raise Service DC</Button>}>
        {sdcForm && (
          <div className="c-stack">
            {(sdc.eligible_items || []).filter((i) => i.eligible).map((i) => (
              <Checkbox key={i.id} label={`${i.ttspl_id} — ${[i.brand, i.model].filter(Boolean).join(' ')}`} checked={Boolean(sdcForm.ids[i.id])} onChange={(e) => setSdcForm({ ...sdcForm, ids: { ...sdcForm.ids, [i.id]: e.target.checked } })} />
            ))}
            <DispatchFields value={sdcForm.dispatch} onChange={(d) => setSdcForm({ ...sdcForm, dispatch: d })} technicians={techs} addressLabel="Deliver to" />
            <Field label="Remarks (optional)"><Textarea rows={2} value={sdcForm.remarks} onChange={(e) => setSdcForm({ ...sdcForm, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'sdcTech'} onClose={() => setOpen(null)} title={`Change technician — ${sdcTech?.dc || ''}`} footer={<Button variant="primary" disabled={busy || !sdcTech?.tech} onClick={() => run(() => changeServiceDcTechnician(sdcTech.dc, { technician_user_id: Number(sdcTech.tech), reason: sdcTech.reason || undefined }), 'Technician changed')}>Save</Button>}>
        {sdcTech && (
          <div className="c-stack">
            <Field label="Technician" required>
              <Select value={sdcTech.tech} onChange={(e) => setSdcTech({ ...sdcTech, tech: e.target.value })} placeholder="Choose…" options={techs.filter((x) => x.assignee_kind === 'technician').map((x) => ({ value: String(x.user_id), label: `${x.name} — ${x.open_item_count} open` }))} />
            </Field>
            <Field label="Reason"><Textarea rows={2} value={sdcTech.reason} onChange={(e) => setSdcTech({ ...sdcTech, reason: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </>
  );
}
