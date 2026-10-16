import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DataTable, DocNumber, Drawer, Field, Input, Money, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import { fileUrl } from '../procure/procureShared';
import DispatchFields, { dispatchBody, dispatchError, emptyDispatch } from './DispatchFields';
import {
  assignPickup, cancelPickup, changePickupAssignment, changeServiceDcTechnician, createPickup, createServiceDc,
  fetchCustomerLaptops, fetchPickupContext, fetchRedeliveryContext, fetchReplacementContext, fetchResendContext,
  fetchServiceDcEligibility, fetchSwapContext, moveToReplacement, regenerateServiceDcPdf, resendLaptop, setCourierDetails,
  startRedelivery, startReplacement, startSwap, createEarlyReturn, fetchEarlyReturns, cancelEarlyReturn,
  convertToPickup, decideRepairPickup, fetchUpgradeContext, createPartsUpgrade,
} from './serveApi';
import RaisePartRequestForm from '../../support/components/RaisePartRequestForm';
import { errMsg } from './serveShared';
import TermsBadge, { fmtDay, termsText } from './TermsBadge';

/**
 * Serve → ticket → pickup, replacement and Service DC (claude/carret-support.md).
 * The same endpoints and the same moments as the old ticket screen
 * (SupportTicketDetail / PickupItemCard / ReplacementPanel / RepairSwapPanel /
 * ServiceDcPanel), so nothing behaves differently — only where it is done.
 */
const CLOSED = ['resolved', 'closed', 'inventory_updated', 'cancelled'];
const EARLY_RETURN_LABEL = {
  pending_sales: 'Waiting for Sales', pending_accounts: 'Waiting for Accounts', approved: 'Approved — schedule the pickup',
  rejected: 'Rejected', cancelled: 'Withdrawn', used: 'Pickup made',
};
const forItem = (o, i) => [o.item_id, o.complaint_item_id, o.source_item_id].map(Number).includes(Number(i.id));
const code = (i) => i.ttspl_id || i.unique_serial_number || i.serial_number;
const addrFrom = (d = {}) => ({
  name: d.contact_name || d.name || '', phone: d.contact_phone || d.phone || '', address: d.address || '',
  city: d.city || '', state: d.state || '', pincode: d.pincode || '',
});

function pickupStarted(i) {
  return Boolean(i.visited_at || i.customer_otp_verified_at || i.warehouse_received_at || i.technician_esign_at || i.picked_up_at);
}

export default function TicketActions({ data, techs, reload, enabled = true, renderLaptops }) {
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
    // The customer's laptops carry lock-in / warranty (claude/carret-lockin-warranty.md).
    let assets = [];
    try {
      const { data: d } = await fetchCustomerLaptops(tk.customer_id);
      assets = d.assets || [];
    } catch (e) { toast.error(errMsg(e)); }
    const byCode = new Map(assets.flatMap((a) => [a.unique_serial_number, a.serial_number].filter(Boolean).map((c) => [String(c).toUpperCase(), a])));
    const termsOf = (l) => byCode.get(String(l.ttspl_id || '').toUpperCase()) || byCode.get(String(l.serial_number || '').toUpperCase()) || null;
    laptops = laptops.map((l) => ({ ...l, terms: termsOf(l), is_wfh: Boolean(l.is_wfh ?? termsOf(l)?.is_wfh) }));
    if (!laptops.length) {
      laptops = assets.map((a) => {
        const [brand, ...rest] = String(a.model_name || '').split(' ');
        return { key: `a${a.id}`, ttspl_id: a.unique_serial_number, unique_serial_number: a.unique_serial_number, serial_number: a.serial_number, brand, model: rest.join(' '), ram: a.ram, storage: a.storage, generation: a.generation, is_wfh: a.is_wfh, terms: a };
      });
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
    if (pk.pickup_type === 'return') {
      const locked = chosen.filter((l) => l.terms?.lock_in_active && l.terms?.early_return?.status !== 'approved');
      if (locked.length) { toast.error(`In lock-in: ${locked.map((l) => l.ttspl_id).join(', ')} — ask for an early return first`); return; }
    }
    run(() => createPickup(tk.id, {
      pickup_type: pk.pickup_type,
      ...dispatchBody(pk.dispatch),
      pickup_address: pk.dispatch.address,
      machines: chosen.map(({ key, is_wfh, terms, ...m }) => m),
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

  /* ---------------- early return (lock-in) ---------------- */
  const [earlyReturns, setEarlyReturns] = useState([]);
  const loadEarlyReturns = React.useCallback(() => {
    if (!enabled) return;
    fetchEarlyReturns({ customer_id: tk.customer_id })
      .then(({ data: d }) => setEarlyReturns((d.data || []).filter((r) => Number(r.support_ticket_id) === Number(tk.id))))
      .catch(() => setEarlyReturns([]));
  }, [tk.customer_id, tk.id, enabled]);
  useEffect(() => { loadEarlyReturns(); }, [loadEarlyReturns]);
  const [er, setEr] = useState(null);
  const openEarlyReturn = (laptops) => {
    setEr({ laptops, planned: new Date().toISOString().slice(0, 10), reason: '' });
    setOpen('earlyReturn');
  };
  const submitEarlyReturn = async () => {
    if (er.reason.trim().length < 3) { toast.error('Why does the customer want to return early?'); return; }
    setBusy(true);
    try {
      for (const l of er.laptops) {
        await createEarlyReturn({ serial_id: l.terms.id, ticket_id: tk.id, planned_return_date: er.planned, reason: er.reason.trim() });
      }
      toast.success('Early return sent to Sales — the pickup can be made once Accounts approve');
      setOpen(null);
      loadEarlyReturns();
      if (pk) setPk(null);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const [withdrawFor, setWithdrawFor] = useState(null);
  const withdrawEarlyReturn = async (r) => {
    try { await cancelEarlyReturn(r.id, 'Withdrawn by Support'); toast.success('Withdrawn'); loadEarlyReturns(); } catch (e) { toast.error(errMsg(e)); }
  };
  // Laptops delivered work-from-home: collecting them is chargeable (Rs 799 + GST).
  const wfhPickup = pk ? pk.laptops.filter((l) => pk.selected[l.key] && l.is_wfh) : [];
  const lockedInPickup = pk && pk.pickup_type === 'return'
    ? pk.laptops.filter((l) => pk.selected[l.key] && l.terms?.lock_in_active && l.terms?.early_return?.status !== 'approved')
    : [];

  /* ---------------- replacement ---------------- */
  const [rep, setRep] = useState(null);
  const openReplacement = async (onlyId = null, asUpgrade = false) => {
    try {
      const { data: c } = await fetchReplacementContext(tk.id);
      // Laptop upgrade: the laptop today, to change into the better one at a new rent.
      let upgrade = null;
      if (asUpgrade && onlyId) {
        const { data: u } = await fetchUpgradeContext(onlyId);
        if (u.is_sale) { toast.error('This laptop was sold — there is no rent to upgrade'); return; }
        upgrade = { item_id: onlyId, current: u.config, current_rate: u.monthly_rate, ...u.config, monthly_rate: '' };
        if (!(c.eligible_items || []).some((i) => Number(i.id) === Number(onlyId))) {
          const it = items.find((x) => Number(x.id) === Number(onlyId));
          c.eligible_items = [...(c.eligible_items || []), { id: onlyId, ttspl_id: code(it), brand: it?.brand, model: it?.model }];
        }
      }
      const elig = c.eligible_items || [];
      const pick = onlyId && elig.some((i) => Number(i.id) === Number(onlyId)) ? elig.filter((i) => Number(i.id) === Number(onlyId)) : elig;
      const ids = Object.fromEntries(pick.map((i) => [i.id, true]));
      setRep({ ctx: c, ids, upgrade, reason: upgrade ? 'Customer upgrade' : '', rdc_action: c.open_return_dc ? 'reuse' : '', dispatch: { ...emptyDispatch(addrFrom(c.delivery_defaults)) } });
      setOpen('replacement');
    } catch (e) { toast.error(errMsg(e)); }
  };
  const submitReplacement = async () => {
    const chosen = Object.keys(rep.ids).filter((k) => rep.ids[k]).map(Number);
    if (!chosen.length) { toast.error('Pick the laptop(s) to replace'); return; }
    const err = dispatchError(rep.dispatch, { optional: true });
    if (err) { toast.error(err); return; }
    if (rep.ctx.open_return_dc && !rep.rdc_action) { toast.error('Use the existing pickup, or cancel it and make a new one?'); return; }
    if (rep.upgrade && !(Number(rep.upgrade.monthly_rate) > 0)) { toast.error('Enter the new monthly rent'); return; }
    await run(() => startReplacement(tk.id, {
      source_item_ids: chosen,
      upgrades: rep.upgrade ? { [rep.upgrade.item_id]: { ...Object.fromEntries(['brand', 'model', 'processor', 'generation', 'ram', 'storage'].map((k) => [k, rep.upgrade[k]])), monthly_rate: Number(rep.upgrade.monthly_rate) } } : undefined,
      reason: rep.reason.trim() || undefined,
      existing_rdc_action: rep.ctx.open_return_dc ? rep.rdc_action : undefined,
      contact_name: rep.dispatch.address.name, contact_phone: rep.dispatch.address.phone,
      pickup_address: rep.dispatch.address,
      ...dispatchBody(rep.dispatch),
    }), 'Replacement ordered — the faulty laptop comes back on a return pickup');
  };
  // Complaint being moved to replacement, with the optional reason: { item, reason }.
  const [moveRep, setMoveRep] = useState(null);

  /* ---------------- visit → repair / return pickup (16 Oct 2026) ---------------- */
  const [cv, setCv] = useState(null); // { item, type, reason, dispatch }
  const openConvert = async (i, type = 'repair') => {
    let dispatch = emptyDispatch({ name: tk.ticket_contact_name || tk.customer_name || '', phone: tk.display_phone || '', address: tk.ticket_address || '' });
    try {
      const { data: c } = await fetchPickupContext(tk.customer_id, code(i));
      if (c.found && c.pickup_address) dispatch = { ...dispatch, address: { ...dispatch.address, ...addrFrom(c.pickup_address) } };
    } catch { /* the address can be typed */ }
    if (i.assigned_to) dispatch = { ...dispatch, dispatch_mode: 'technician', technician_user_id: String(i.assigned_to) };
    setCv({ item: i, type, reason: '', dispatch });
    setOpen('convert');
  };
  const submitConvert = () => {
    const err = dispatchError(cv.dispatch);
    if (err) { toast.error(err); return; }
    run(() => convertToPickup(cv.item.id, { pickup_type: cv.type, ...dispatchBody(cv.dispatch), pickup_address: cv.dispatch.address, reason: cv.reason.trim() || undefined }), 'Converted to a pickup');
  };
  const [rejectFor, setRejectFor] = useState(null); // { item, reason }

  /* ---------------- RAM / SSD upgrade (migration 434) ---------------- */
  const [pu, setPu] = useState(null); // { item, ctx, ram, storage, new_rate, notes, saved }
  const openPartsUpgrade = async (i) => {
    try {
      const { data: c } = await fetchUpgradeContext(i.id);
      if (c.is_sale) { toast.error('This laptop was sold — there is no rent to upgrade'); return; }
      setPu({ item: i, ctx: c, ram: '', storage: '', new_rate: '', notes: '', saved: false });
      setOpen('partsUpgrade');
    } catch (e) { toast.error(errMsg(e)); }
  };
  const submitPartsUpgrade = async () => {
    if (!pu.ram.trim() && !pu.storage.trim()) { toast.error('Enter the new RAM and/or SSD'); return; }
    if (!(Number(pu.new_rate) > 0)) { toast.error('Enter the new monthly rent'); return; }
    setBusy(true);
    try {
      await createPartsUpgrade(pu.item.id, { ram: pu.ram.trim() || undefined, storage: pu.storage.trim() || undefined, new_rate: Number(pu.new_rate), notes: pu.notes.trim() || undefined });
      toast.success('Upgrade recorded — now request the part');
      setPu({ ...pu, saved: true });
      reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  /* ---------------- swap from repair / another laptop / resend ---------------- */
  const [swap, setSwap] = useState(null); // {kind, ctx, ids, reason, address}
  const openSwap = async (kind, onlyPickupId = null) => {
    try {
      const { data: c } = kind === 'swap' ? await fetchSwapContext(tk.id) : await fetchRedeliveryContext(tk.id);
      if ((kind === 'swap' && !c.can_swap) || (kind === 'redelivery' && !c.can_create)) { toast.error(c.block_reason || 'Not possible now'); return; }
      const elig = c.eligible_items || [];
      const pick = onlyPickupId && elig.some((i) => Number(i.pickup_item_id) === Number(onlyPickupId)) ? elig.filter((i) => Number(i.pickup_item_id) === Number(onlyPickupId)) : elig;
      setSwap({ kind, ctx: c, ids: Object.fromEntries(pick.map((i) => [i.pickup_item_id, true])), reason: '', dispatch: emptyDispatch(addrFrom(c.delivery_defaults)) });
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
    if (!showSdc || !enabled) { setSdc(null); return; }
    fetchServiceDcEligibility(tk.id).then(({ data: d }) => setSdc(d)).catch(() => setSdc(null));
  }, [showSdc, tk.id, data, enabled]);
  const [sdcForm, setSdcForm] = useState(null);
  const openSdc = (onlyId = null) => {
    const elig = (sdc.eligible_items || []).filter((i) => i.eligible);
    const pick = onlyId && elig.some((i) => Number(i.id) === Number(onlyId)) ? elig.filter((i) => Number(i.id) === Number(onlyId)) : elig;
    const ids = Object.fromEntries(pick.map((i) => [i.id, true]));
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

  const canSchedulePickup = !closedTicket && !tk.return_dc_number && !livePickups.some((i) => !CLOSED.includes(i.status));
  const act = enabled && !cancelledTicket;

  /*
   * The buttons for one task on a laptop's card (16 Oct 2026: pickup,
   * replacement and Service DC live on the laptop they are for).
   *   buttons — what to show; replaceDefault — the card's own Assign / slot
   *   buttons do not apply (a pickup is dispatched as a whole Return DC);
   *   note — one extra line under the task.
   */
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const taskActions = (i) => {
    if (!act) return null;
    const out = [];
    let replaceDefault = false;
    let note = null;
    if (i.item_type === 'complaint') {
      const ordered = orders.some((o) => forItem(o, i) && o.status !== 'cancelled');
      if (i.outcome === 'repair_pickup_requested') {
        // The technician asked to take it to the workshop: approve → they collect it now.
        replaceDefault = true;
        out.push(<Button key="ap" variant="primary" disabled={busy} onClick={() => run(() => decideRepairPickup(i.id, { approve: true }), 'Approved — the technician collects it now')}>Approve repair pickup</Button>);
        out.push(<Button key="rj" variant="quiet" onClick={() => setRejectFor({ item: i, reason: '' })}>Reject</Button>);
        note = `Technician: ${i.replacement_flag_reason || 'needs workshop repair'}`;
      } else if (i.outcome === 'replacement_required' && !ordered) {
        replaceDefault = true;
        out.push(<Button key="rep" variant="primary" onClick={() => openReplacement(i.id)}>{activeOrder && tk.return_dc_number ? 'Add to replacement' : 'Start replacement'}</Button>);
        out.push(<Button key="cv" onClick={() => openConvert(i, 'repair')}>Convert to pickup</Button>);
        note = i.replacement_flag_reason ? `Technician: ${i.replacement_flag_reason}` : 'The technician could not fix it on site — choose replacement or a pickup.';
      } else if (!CLOSED.includes(i.status)) {
        out.push(<Button key="cv" variant="quiet" onClick={() => openConvert(i, 'repair')}>Convert to pickup</Button>);
        // Customer upgrade: a better laptop (replacement at a new rent) or more RAM / SSD.
        if (!(data.upgrades || []).some((u) => Number(u.item_id) === Number(i.id) && ['pending', 'ordered'].includes(u.status))) {
          out.push(<Button key="ul" variant="quiet" onClick={() => openReplacement(i.id, true)}>Upgrade laptop</Button>);
          out.push(<Button key="up" variant="quiet" onClick={() => openPartsUpgrade(i)}>Upgrade RAM / SSD</Button>);
        }
        if (!i.replacement_flag_reason && i.outcome !== 'replacement_required') {
          out.push(<Button key="mv" variant="quiet" onClick={() => { setMoveRep({ item: i, reason: '' }); setOpen('moveReplacement'); }}>Replace instead</Button>);
        }
      }
    } else if (i.item_type === 'pickup') {
      const onThisRdc = tk.return_dc_number && i.return_dc_number === tk.return_dc_number;
      if (onThisRdc) {
        replaceDefault = true;
        if (pendingDispatch && Number(pendingDispatch.id) === Number(i.id)) out.push(<Button key="as" variant="primary" onClick={() => openAssign(false)}>Assign pickup</Button>);
        else if (editable && Number(editable.id) === Number(i.id)) out.push(<Button key="ch" onClick={() => openAssign(true)}>Change who collects</Button>);
        if (courierItem && Number(courierItem.id) === Number(i.id)) out.push(<Button key="cr" variant="quiet" onClick={() => { setCourier({ courier_name: courierItem.pickup_courier_name || '', awb_number: courierItem.pickup_awb || '' }); setOpen('courier'); }}>Courier details</Button>);
        if (cancellable) out.push(<Button key="cx" variant="quiet" onClick={() => { setCancelReason(''); setOpen('cancelPickup'); }}>Cancel pickup</Button>);
        if (onRdc.length > 1) note = `Return DC ${tk.return_dc_number} carries ${onRdc.length} laptops — who collects applies to all.`;
      }
      if (i.warehouse_received_at) {
        const isRep = (i.pickup_type || (i.source_item_id ? 'repair' : 'return')) === 'repair';
        const sdcItem = (sdc?.eligible_items || []).find((x) => Number(x.id) === Number(i.id));
        if (isRep && sdcItem?.eligible && sdc?.can_create) out.push(<Button key="sdc" variant="primary" onClick={() => openSdc(i.id)}>Raise Service DC</Button>);
        if (isRep && sdcItem && !sdcItem.eligible) note = (sdcItem.reasons || []).join('; ') + (sdcItem.open_floor_ticket_id ? ` (floor ticket #${sdcItem.open_floor_ticket_id} at ${sdcItem.open_floor_ticket_stage})` : '');
        if (isRep && !activeOrder && !i.service_dc_number) out.push(<Button key="sw" variant="quiet" onClick={() => openSwap('swap', i.id)}>Swap from repair</Button>);
        out.push(<Button key="rd" variant="quiet" onClick={() => openSwap('redelivery', i.id)}>Send another laptop</Button>);
      }
    } else if (i.item_type === 'replacement') {
      const o = orders.find((x) => forItem(x, i) && x.status !== 'cancelled') || activeOrder;
      if (o) note = [o.sales_order_number && `Order ${o.sales_order_number}`, o.dc_number && `DC ${o.dc_number}`, o.new_machine_serial && `new ${o.new_machine_serial}`].filter(Boolean).join(' · ') || null;
      if (warehouseReceived.length > 0 && tk.sales_order_number) out.push(<Button key="rs" variant="quiet" onClick={openResend}>Resend on the same order</Button>);
    }
    return { buttons: out.length ? out : null, replaceDefault, note };
  };

  const headerActions = act && canSchedulePickup ? <Button onClick={() => openPickup()}>Schedule pickup</Button> : null;
  const sdcs = sdc?.service_dcs || [];

  return (
    <>
      {renderLaptops?.({ taskActions, headerActions, scrollTop })}

      {act && earlyReturns.length > 0 && (
        <Section title="Early returns (lock-in)">
          <DataTable
            columns={[
              { key: 'l', header: 'Laptop', render: (r) => <DocNumber value={r.asset_code} />, sub: (r) => `Lock-in till ${fmtDay(r.lock_in_end_date)} · ${r.remaining_days} days` },
              { key: 's', header: 'Status', render: (r) => EARLY_RETURN_LABEL[r.status] || r.status, sub: (r) => r.sales_note || r.accounts_note || r.reason },
              { key: 'a', header: 'Charge', numeric: true, render: (r) => (r.approved_amount != null ? <Money value={r.approved_amount} /> : (r.proposed_amount != null ? <Money value={r.proposed_amount} /> : <Money value={r.full_amount} />)), sub: (r) => (r.approved_amount != null ? 'approved' : r.proposed_amount != null ? 'proposed' : 'full') },
              { key: 'x', header: '', render: (r) => (['pending_sales', 'pending_accounts', 'approved'].includes(r.status) ? <Button variant="quiet" onClick={() => setWithdrawFor(r)}>Withdraw</Button> : null) },
            ]}
            rows={earlyReturns}
            rowKey={(r) => r.id}
          />
        </Section>
      )}

      {act && sdcs.length > 0 && (
        <Section title="Service DCs">
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
            rows={sdcs}
            rowKey={(d) => d.dc_number}
          />
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
                <div key={l.key}>
                  <Checkbox label={`${l.ttspl_id || l.serial_number} — ${[l.brand, l.model].filter(Boolean).join(' ')}${l.is_wfh ? ' · work from home' : ''}`} checked={Boolean(pk.selected[l.key])} onChange={(e) => setPk({ ...pk, selected: { ...pk.selected, [l.key]: e.target.checked } })} />
                  {termsText(l.terms) && <div style={{ marginLeft: '1.6rem', fontSize: '12px' }}><TermsBadge laptop={l.terms} /></div>}
                </div>
              ))}
            </div>
            {lockedInPickup.length > 0 && (
              <Notice
                tone="warn"
                title="Lock-in not complete"
                action={lockedInPickup.every((l) => !l.terms.early_return) && <Button onClick={() => openEarlyReturn(lockedInPickup)}>Ask for early return</Button>}
              >
                {lockedInPickup.map((l) => `${l.ttspl_id} (till ${fmtDay(l.terms.lock_in_end_date)})`).join(', ')} cannot be returned yet.
                {lockedInPickup.some((l) => l.terms.early_return)
                  ? ' An early-return request is already with Sales / Accounts — the pickup can be made once it is approved.'
                  : ' Raise an early return: Sales agrees the charge with the customer, Accounts approve it, then schedule the pickup.'}
              </Notice>
            )}
            {wfhPickup.length > 0 && (
              <Notice tone="warn" title="Work-from-home pickup — chargeable ₹799 + GST">
                {wfhPickup.map((l) => l.ttspl_id || l.serial_number).join(', ')} {wfhPickup.length === 1 ? 'was' : 'were'} delivered to an employee’s home.
                {' '}Once the pickup is created, use “Charge WFH ₹799” on its row so it goes on Delivery Charges.
              </Notice>
            )}
            <DispatchFields value={pk.dispatch} onChange={(d) => setPk({ ...pk, dispatch: d })} technicians={techs} addressLabel="Pickup address" />
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'earlyReturn'} onClose={() => setOpen(null)} title="Ask for early return" footer={<Button variant="primary" disabled={busy} onClick={submitEarlyReturn}>Send to Sales</Button>}>
        {er && (
          <div className="c-stack">
            <p>
              {er.laptops.map((l) => `${l.ttspl_id} (lock-in till ${fmtDay(l.terms.lock_in_end_date)}, ₹${Number(l.terms.monthly_rate || 0).toLocaleString('en-IN')}/month)`).join(', ')}.
              Sales will agree the charge with the customer — full remaining rent, a negotiated amount, or waive — and Accounts approve it.
              The approved amount goes on the customer&apos;s next invoice.
            </p>
            <Field label="Planned return date" required><Input type="date" value={er.planned} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setEr({ ...er, planned: e.target.value })} /></Field>
            <Field label="Why the customer wants to return early" required><Textarea rows={3} value={er.reason} onChange={(e) => setEr({ ...er, reason: e.target.value })} /></Field>
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

      <Drawer open={open === 'replacement'} onClose={() => setOpen(null)} title={rep?.upgrade ? 'Upgrade to a better laptop' : 'Replacement'} width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitReplacement}>{rep?.upgrade ? 'Order the upgrade' : 'Order the replacement'}</Button>}>
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
            {rep.upgrade && (
              <div className="c-upg">
                <div className="c-upg-h"><b>Upgrade to</b><span>Now: {[rep.upgrade.current.processor, rep.upgrade.current.generation, rep.upgrade.current.ram, rep.upgrade.current.storage].filter(Boolean).join(' · ')} · ₹{Number(rep.upgrade.current_rate || 0).toLocaleString('en-IN')}/month</span></div>
                <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                  {[['brand', 'Brand'], ['model', 'Model'], ['processor', 'Processor'], ['generation', 'Generation'], ['ram', 'RAM'], ['storage', 'SSD']].map(([k, l]) => (
                    <Field key={k} label={l}><Input value={rep.upgrade[k] || ''} onChange={(e) => setRep({ ...rep, upgrade: { ...rep.upgrade, [k]: e.target.value } })} /></Field>
                  ))}
                  <Field label="New monthly rent (₹)" required><Input type="number" min={1} value={rep.upgrade.monthly_rate} onChange={(e) => setRep({ ...rep, upgrade: { ...rep.upgrade, monthly_rate: e.target.value } })} /></Field>
                </div>
              </div>
            )}
            <Field label="Reason (optional)"><Textarea rows={2} value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })} /></Field>
            <Notice tone="info">{rep.upgrade ? 'The better laptop goes to this address at the new rent; the old one is collected from it on a return pickup.' : 'The replacement goes to this address, and the faulty laptop is collected from it on a return pickup.'}</Notice>
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

      <Drawer open={open === 'convert'} onClose={() => setOpen(null)} title={`Convert ${cv ? code(cv.item) : ''} to a pickup`} width="40rem" footer={<Button variant="primary" disabled={busy} onClick={submitConvert}>Convert</Button>}>
        {cv && (
          <div className="c-stack">
            <Field label="Pickup for" required>
              <Select value={cv.type} onChange={(e) => setCv({ ...cv, type: e.target.value })} options={[{ value: 'repair', label: 'Repair — fixed in the workshop, then sent back' }, { value: 'return', label: 'Return — the customer gives it back' }]} />
            </Field>
            <p className="text-ink-3" style={{ margin: 0 }}>The visit closes; the pickup carries on{tk.return_dc_number ? ` on Return DC ${tk.return_dc_number}` : ' on a new Return DC'}.</p>
            <DispatchFields value={cv.dispatch} onChange={(d) => setCv({ ...cv, dispatch: d })} technicians={techs} addressLabel="Pickup address" />
            <Field label="Reason (optional)"><Textarea rows={2} value={cv.reason} onChange={(e) => setCv({ ...cv, reason: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(rejectFor)} onClose={() => setRejectFor(null)} title="Reject the repair pickup" footer={<Button variant="primary" disabled={busy || String(rejectFor?.reason || '').trim().length < 3} onClick={async () => { const r = await run(() => decideRepairPickup(rejectFor.item.id, { approve: false, reason: rejectFor.reason.trim() }), 'Rejected'); if (r) setRejectFor(null); }}>Reject</Button>}>
        {rejectFor && (
          <div className="c-stack">
            <p style={{ margin: 0 }}>The visit goes back to the technician to record the result. They see your reason as a comment.</p>
            <Field label="Why" required><Textarea rows={3} value={rejectFor.reason} onChange={(e) => setRejectFor({ ...rejectFor, reason: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={open === 'partsUpgrade'}
        onClose={() => setOpen(null)}
        title={`Upgrade RAM / SSD · ${pu ? code(pu.item) : ''}`}
        width="40rem"
        footer={pu && !pu.saved ? <Button variant="primary" disabled={busy} onClick={submitPartsUpgrade}>Save the upgrade</Button> : <Button onClick={() => setOpen(null)}>Done</Button>}
      >
        {pu && (
          <div className="c-stack">
            <div className="c-upg">
              <div className="c-upg-h"><b>Today</b><span>₹{Number(pu.ctx.monthly_rate || 0).toLocaleString('en-IN')}/month</span></div>
              <div className="text-ink-2" style={{ fontSize: '13.5px' }}>{[pu.ctx.config.brand, pu.ctx.config.model, pu.ctx.config.processor, pu.ctx.config.generation].filter(Boolean).join(' · ')}</div>
              <div className="c-upg-now"><span>RAM <b>{pu.ctx.config.ram || '—'}</b></span><span>SSD <b>{pu.ctx.config.storage || '—'}</b></span></div>
            </div>
            {!pu.saved ? (
              <>
                <div className="c-form-grid" style={{ '--c-cols': 3 }}>
                  <Field label="New RAM" hint="Total after fitting, e.g. 16GB"><Input value={pu.ram} onChange={(e) => setPu({ ...pu, ram: e.target.value })} placeholder={pu.ctx.config.ram} /></Field>
                  <Field label="New SSD" hint="e.g. 1TB SSD"><Input value={pu.storage} onChange={(e) => setPu({ ...pu, storage: e.target.value })} placeholder={pu.ctx.config.storage} /></Field>
                  <Field label="New rent (₹/month)" required><Input type="number" min={1} value={pu.new_rate} onChange={(e) => setPu({ ...pu, new_rate: e.target.value })} /></Field>
                </div>
                <Field label="Note (optional)"><Textarea rows={2} value={pu.notes} onChange={(e) => setPu({ ...pu, notes: e.target.value })} /></Field>
                <Notice tone="info">Nothing comes back — the part is added to the laptop. Once it is fitted, “Apply” on the laptop’s card updates its configuration, and the new rent starts from the next billing period ({pu.ctx.effective_from || 'next invoice'}).</Notice>
              </>
            ) : (
              <>
                <Notice tone="good" title="Upgrade saved">Now request the part (set “collect old part” to No — nothing comes back).</Notice>
                <RaisePartRequestForm ticket={tk} item={pu.item} />
              </>
            )}
          </div>
        )}
      </Drawer>

      <Drawer open={open === 'moveReplacement'} onClose={() => setOpen(null)} title={`Move ${moveRep ? code(moveRep.item) : ''} to replacement`} footer={<Button variant="primary" disabled={busy || !moveRep} onClick={() => run(() => moveToReplacement(moveRep.item.id, moveRep.reason), 'Marked for replacement')}>Move to replacement</Button>}>
        {moveRep && (
          <div className="c-stack">
            <Field label="Why replace this laptop instead of repairing it?" hint="Optional">
              <Textarea rows={3} value={moveRep.reason} onChange={(e) => setMoveRep({ ...moveRep, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!withdrawFor}
        onClose={() => setWithdrawFor(null)}
        onConfirm={() => { if (withdrawFor) withdrawEarlyReturn(withdrawFor); }}
        title={`Withdraw the early-return request for ${withdrawFor?.asset_code || ''}?`}
        body="The customer keeps the laptop."
        confirmLabel="Withdraw"
        tone="warn"
      />
    </>
  );
}
