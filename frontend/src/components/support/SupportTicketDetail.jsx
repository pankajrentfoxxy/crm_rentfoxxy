import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Loader2, Phone, MapPin, CheckCircle2, Clock, RefreshCw, Camera, Laptop } from 'lucide-react';
import toast from 'react-hot-toast';
import TtsplHistoryDrawer from '../../features/floor-pipeline/components/TtsplHistoryDrawer';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { canCancelSupportTicket, canCloseSupportTicket, isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
import CancelTicketModal from './components/CancelTicketModal';
import OtpInput from './components/OtpInput';
import ItemStepper from './components/ItemStepper';
import CommentThread from './components/CommentThread';
import TicketEditPanel from './components/TicketEditPanel';
import DetailSidebar from './components/DetailSidebar';
import ReplacementPanel from './components/ReplacementPanel';
import AddWorkflowPhasePanel from './components/AddWorkflowPhasePanel';
import RaisePartRequestForm from '../../features/support/components/RaisePartRequestForm';
import PickupItemCard from './components/PickupItemCard';
import CreatePickupModal from './components/CreatePickupModal';
import PickupSetupForm from './components/PickupSetupForm';
import ServiceDcPanel from './components/ServiceDcPanel';
import RepairSwapPanel from './components/RepairSwapPanel';
import AssignmentHistoryList, { actionLabel } from './components/AssignmentHistoryList';
import { replacementSalesOrderDetailPath } from '../../features/sales-pipeline/salesOrderScope';
import {
  formatItemId,
  formatTicketId,
  formatAddress,
  initials,
  itemAllowsTechnicianAssign,
  isPickupAssignmentEditable,
  podUrl as podUrlFor,
  compressImageFile
} from './utils';
import './support.css';

function SpecGrid({ item }) {
  const cells = [
    { label: 'Brand', value: item.brand },
    { label: 'Model', value: item.model },
    { label: 'Serial', value: item.unique_serial_number || item.serial_number, mono: true },
    { label: 'Processor', value: [item.processor, item.generation].filter(Boolean).join(' ') || '—' },
    { label: 'RAM', value: item.ram },
    { label: 'Storage', value: item.storage }
  ];
  return (
    <div className="support-v3-spec-grid">
      {cells.map((c) => (
        <div key={c.label} className="support-v3-spec-cell">
          <span>{c.label}</span>
          <span className={c.mono ? 'font-mono text-sm' : 'text-sm font-medium'} style={{ color: 'var(--color-text-primary)' }}>
            {c.value || '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function ItemCard({
  item,
  replacementOrder,
  ticket,
  onRefresh,
  technicians,
  canAssign,
  otpNote,
  workflowActions,
  assignmentHistory = [],
}) {
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [otp, setOtp] = useState('');
  const [verifyInput, setVerifyInput] = useState('');
  const [busy, setBusy] = useState(false);

  const lead = isSupportLead(user);
  const tech = isSupportTechnician(user);
  const st = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const canAct = ticket.status !== 'cancelled' && (lead || (tech && item.assigned_to === user.user_id));
  const podUrl = podUrlFor(item.proof_of_completion_path || item.pod_image_path);
  const ttsplLabel = item.ttspl_id || item.unique_serial_number || item.serial_number;
  const terminal = ['resolved', 'closed', 'inventory_updated'].includes(item.status);
  // Phase 20: pickup items render via the dedicated PickupItemCard. This is the
  // default for every pickup; only the deprecated self-carry / loan-machine flow
  // (explicitly marked) falls back to the legacy rendering.
  const isLegacyPickup = item.item_type === 'pickup' && !item.pickup_type
    && (item.pickup_method === 'self_carry' || item.loan_delivered_at);
  const isNewPickup = item.item_type === 'pickup' && !isLegacyPickup;

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      onRefresh();
    } catch (e) {
      alert(e.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const assignTech = (assignedTo) => run(() =>
    api.patch(`/support/items/${item.id}/assign`, { assigned_to: assignedTo ? Number(assignedTo) : null }));

  // Phase 18: mark "reached" while capturing GPS coordinates (falls back gracefully).
  const markReached = () => {
    setBusy(true);
    const doMark = (lat, lng) =>
      api.post(`/support/items/${item.id}/visit`, {
        latitude: lat != null ? String(lat) : null,
        longitude: lng != null ? String(lng) : null
      })
        .then(() => onRefresh())
        .catch((e) => alert(e.response?.data?.message || 'Failed to mark reached'))
        .finally(() => setBusy(false));
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => doMark(pos.coords.latitude, pos.coords.longitude),
        () => doMark(null, null),
        { timeout: 10000 }
      );
    } else {
      doMark(null, null);
    }
  };

  const showServiceAddress = item.item_type === 'complaint' || item.item_type === 'replacement';
  const showComments = !!item.assigned_to && st !== 'unassigned';

  const typePill =
    item.item_type === 'complaint' ? 'progress' : item.item_type === 'pickup' ? 'open' : 'replacement';

  return (
    <article className="support-item-card support-v3-card !p-0 overflow-hidden">
      <header className="support-item-card-header bg-slate-50 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{formatItemId(item.id)}</span>
          <span className={`support-pill ${typePill}`}>{item.item_type}</span>
          <span className="text-sm font-medium flex-1 min-w-0" style={{ color: 'var(--color-text-primary)' }}>
            {item.model} · <span className="font-mono text-xs">{item.unique_serial_number || item.serial_number}</span>
          </span>
          <span className={`support-pill ${terminal ? 'closed' : 'progress'}`}>
            {item.status.replace(/_/g, ' ')}
          </span>
        </div>
      </header>

      <div className="p-4 space-y-3">
        <ItemStepper item={item} replacementOrder={replacementOrder} />

        {isNewPickup ? (
          <PickupItemCard
            item={item}
            ticket={ticket}
            onRefresh={onRefresh}
            assignmentHistory={assignmentHistory}
          />
        ) : (
        <SpecGrid item={item} />
        )}

        {!isNewPickup && showServiceAddress && (
          <div className="support-v3-address-bar">
            <p className="support-v3-section-label !mb-1 !mt-0">Service address</p>
            <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{formatAddress(ticket.ticket_address)}</p>
          </div>
        )}

        {item.item_type === 'complaint' && item.outcome === 'replacement_required' && !ticket.sales_order_number && (
          <div className="rounded-lg p-3 space-y-2" style={{ border: '1.5px solid #dc2626', background: '#FCEBEB', color: '#991b1b' }}>
            <p className="font-semibold text-sm">Replacement required</p>
            <p className="text-sm">Flagged{item.assigned_to_name ? ` by ${item.assigned_to_name}` : ''}. {item.replacement_flag_reason || '—'}</p>
            {lead && (
              <p className="text-xs opacity-90">Click <b>Initiate replacement</b> above — creates one sales order (laptop config) and return pickup DC.</p>
            )}
            {!lead && <p className="text-xs">Awaiting support lead to create the replacement order.</p>}
          </div>
        )}

        {!isNewPickup && (
        <div className="support-item-tech-row">
          {canAssign ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                {initials(item.assigned_to_name)}
              </span>
              <select
                className="flex-1 min-w-[160px] border rounded-lg px-3 py-3 min-h-[44px] text-base"
                value={item.assigned_to || ''}
                onChange={(e) => assignTech(e.target.value)}
                disabled={busy}
              >
                <option value="">Assign technician</option>
                {technicians.map((t) => (
                  <option key={t.user_id} value={t.user_id}>{t.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Assigned: {item.assigned_to_name || '—'}
            </p>
          )}
        </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && item.assigned_to && (
          <RaisePartRequestForm ticket={ticket} item={item} />
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'verify_ttspl' && item.assigned_to && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Step 2 · Verify laptop TTSPL ID</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Enter the TTSPL ID or serial number from the laptop label to confirm you are working on the correct machine.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && verifyInput.trim()) run(() => api.post(`/support/items/${item.id}/verify-ttspl`, { ttspl_input: verifyInput })); }}
                placeholder={`Enter ${ttsplLabel || 'TTSPL ID or serial'}`}
                className="flex-1 min-w-0 border rounded-lg px-3 py-3 min-h-[44px] text-base"
                style={{ textTransform: 'uppercase' }}
              />
              <button
                type="button"
                className="support-btn-primary min-h-[44px] shrink-0 whitespace-nowrap"
                disabled={busy || !verifyInput.trim()}
                onClick={() => run(() => api.post(`/support/items/${item.id}/verify-ttspl`, { ttspl_input: verifyInput }))}
              >
                {busy ? '…' : 'Verify'}
              </button>
            </div>
          </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'assigned' && item.assigned_to && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Step 1 · Mark as reached</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Tap when you arrive at the customer location. Your GPS location will be recorded.
            </p>
            <button type="button" className="support-btn-primary w-full min-h-[44px] inline-flex items-center justify-center gap-2" disabled={busy} onClick={markReached}>
              <MapPin className="w-5 h-5" />
              {busy ? 'Getting location…' : 'I have reached the location'}
            </button>
          </div>
        )}

        {lead && !terminal && item.visited_lat && item.visited_lng && (
          <a
            href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <MapPin className="w-3 h-3" /> View reached location
          </a>
        )}

        {/* Read-only proof & location for resolved/closed items (and any item with a POD). */}
        {terminal && (podUrl || (item.visited_lat && item.visited_lng)) && (
          <div className="support-v3-proof-view">
            <p className="support-v3-section-label !mt-0">Proof of completion &amp; location</p>
            <div className="support-v3-proof-row">
              {item.visited_lat && item.visited_lng && (
                <a
                  href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline min-h-[44px]"
                >
                  <MapPin className="w-4 h-4" /> View technician location
                </a>
              )}
              {podUrl && (
                <a href={podUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={podUrl} alt="Proof of completion" className="support-v3-proof-thumb" />
                  <span className="text-xs text-blue-600 hover:underline">Open full proof</span>
                </a>
              )}
              {!podUrl && (
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No proof image was uploaded.</span>
              )}
            </div>
          </div>
        )}

        {item.item_type === 'complaint' && st === 'picked_up_for_repair' && (
          <div className="rounded-lg p-3 text-sm" style={{ border: '1.5px solid #f97316', background: '#FFF7ED', color: '#9a3412' }}>
            <p className="font-semibold">Laptop picked up for warehouse repair</p>
            <p className="text-xs mt-1">Track the return journey under the <b>Pickup</b> tab. A floor repair ticket is created once the warehouse confirms receipt.</p>
          </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && (st === 'visited' || st === 'working' || st === 'replacement_required') && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Technician outcome</p>
            <div className="support-v3-outcome-row">
              {[
                { key: 'fixed', label: 'Fixed', Icon: CheckCircle2, sel: 'sel-green' },
                { key: 'working', label: 'Working on it', Icon: Clock, sel: 'sel-blue' },
                { key: 'replacement_required', label: 'Replacement required', Icon: RefreshCw, sel: 'sel-red' }
              ].map(({ key, label, Icon, sel }) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  className={`support-v3-outcome-btn ${item.outcome === key ? sel : ''}`}
                  onClick={() => run(() => api.post(`/support/items/${item.id}/set-outcome`, { outcome: key, comment: comment.trim() || undefined }))}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && item.outcome === 'replacement_required' && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Next step</p>
            <p className="text-sm text-slate-600 rounded-lg border border-slate-200 bg-slate-50 p-3">
              Leave the laptop with the customer. Support lead will create a replacement sales order and schedule pickup of this unit.
            </p>
          </div>
        )}

        {showComments && (
          <CommentThread
            comments={item.comments}
            draft={comment}
            onDraftChange={setComment}
            posting={busy}
            onPost={() => run(() => api.post(`/support/items/${item.id}/comments`, { body: comment }).then(() => setComment('')))}
          />
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'fixed_pending_pod' && item.outcome === 'fixed' && (
          <div className="support-v3-pod-zone">
            <Camera className="w-8 h-8 mx-auto mb-2 opacity-60" />
            <p className="font-medium text-sm mb-2">Upload proof of completion</p>
            <label className="support-btn-outline inline-flex items-center justify-center cursor-pointer min-h-[44px]">
              Take photo / Upload file
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) run(async () => { const compressed = await compressImageFile(file); const fd = new FormData(); fd.append('pod', compressed); return api.post(`/support/items/${item.id}/pod`, fd); }); }} />
            </label>
          </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'fixed_pending_pod' && item.outcome === 'fixed' && item.pod_image_path && (
          <button type="button" className="support-btn-primary w-full min-h-[44px]" disabled={busy} onClick={() => run(() => api.post(`/support/items/${item.id}/work-done`))}>
            Mark work done & proceed to OTP
          </button>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'pod_uploaded' && (
          <div className="space-y-2">
            {podUrl && (
              <div className="space-y-1">
                <img src={podUrl} alt="POD" className="max-h-40 rounded-lg border" />
                <button type="button" className="text-sm text-red-700 min-h-[44px]" disabled={busy} onClick={() => run(() => api.delete(`/support/items/${item.id}/pod`))}>Remove POD</button>
              </div>
            )}
            <p className="support-v3-section-label">Customer OTP</p>
            <OtpInput value={otp} onChange={setOtp} disabled={busy} />
            <button type="button" className="support-btn-primary w-full min-h-[44px]" disabled={busy || otp.replace(/\D/g, '').length !== 6} onClick={() => run(() => api.post(`/support/items/${item.id}/verify-customer-otp`, { otp }))}>
              Verify OTP & close item
            </button>
          </div>
        )}

        {item.item_type === 'pickup' && st === 'in_transit' && (
          <div className="space-y-2">
            <div className="rounded-lg p-3 text-sm" style={{ border: '1.5px solid #f97316', background: '#FFF7ED', color: '#9a3412' }}>
              <p className="font-semibold">In transit to warehouse</p>
              <p className="text-xs mt-1">
                {lead ? 'Confirm receipt once the laptop reaches the warehouse — a floor repair ticket will be created automatically.'
                  : 'Carry the laptop to the warehouse. A support lead / warehouse will confirm receipt.'}
              </p>
            </div>
            {lead && (
              <button
                type="button"
                className="support-btn-primary w-full min-h-[44px]"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('Confirm the laptop has been received at the warehouse and create a floor repair ticket?')) return;
                  run(() => api.post(`/support/items/${item.id}/warehouse-received`));
                }}
              >
                Confirm warehouse receipt
              </button>
            )}
          </div>
        )}

        {item.item_type === 'pickup' && st === 'reached_warehouse' && (
          <div className="rounded-lg p-3 text-sm" style={{ border: '1.5px solid #16a34a', background: '#F0FDF4', color: '#166534' }}>
            <p className="font-semibold inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Received at warehouse</p>
            {item.floor_ticket_id && (
              <p className="text-xs mt-1">Floor repair ticket #{item.floor_ticket_id} created.</p>
            )}
          </div>
        )}

        {item.item_type === 'replacement' && replacementOrder && !terminal && (
          <div className="rounded-lg border border-pink-200 bg-pink-50/50 p-3 text-sm space-y-1">
            <p className="font-medium text-pink-900">Replacing {replacementOrder.old_machine_serial || '—'}</p>
            <p className="text-pink-900/80">{replacementOrder.notes || item.remarks}</p>
            {replacementOrder.new_machine_serial && (
              <p>New unit: <span className="font-mono">{replacementOrder.new_machine_serial}</span></p>
            )}
            {replacementOrder.dc_number && (
              <p>Delivery DC: <span className="font-mono">{replacementOrder.dc_number}</span></p>
            )}
          </div>
        )}

        {workflowActions && <WorkflowActionsBar workflowActions={workflowActions} item={item} />}
      </div>
    </article>
  );
}

function WorkflowActionsBar({ workflowActions, item }) {
    return (
        <div className="support-workflow-actions">
            {workflowActions.showPickup && (
                <button type="button" className="support-btn-outline w-full min-h-[44px]" onClick={() => workflowActions.onAddPhase('pickup')}>
                    Schedule pickup for this machine
                </button>
            )}
            {workflowActions.showReplacement && (
                <button type="button" className="support-btn-outline w-full min-h-[44px]" onClick={() => workflowActions.onAddPhase('replacement')}>
                    + Add replacement phase
                </button>
            )}
            {item.source_item_id && (
                <p className="text-xs text-slate-500">Linked to item #{item.source_item_id}</p>
            )}
        </div>
    );
}

function ReplacementOrderBanner({ ticket, replacementOrders, pickups, ticketId, isLead, onRefresh, assignmentHistory = [] }) {
  const [showAssign, setShowAssign] = useState(false);
  const [showChangeAssignee, setShowChangeAssignee] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  if (!ticket.sales_order_number) return null;
  const units = replacementOrders.filter((o) => o.sales_order_number === ticket.sales_order_number);
  const delivered = units.filter((o) => o.status === 'delivered' || o.new_machine_serial).length;
  const hasDeliveryDc = units.some((o) => o.dc_number);
  const soPath = replacementSalesOrderDetailPath(ticket.sales_order_number);
  const linkedPickups = pickups.filter((p) => p.return_dc_number === ticket.return_dc_number);
  const pendingPickup = linkedPickups.some(
    (p) => p.status === 'pending_dispatch' || (!p.pickup_method && !p.assigned_to && !p.pickup_assigned_to)
  );
  const editablePickup = linkedPickups.find((p) => isPickupAssignmentEditable(p));
  const canChangeAssignee = isLead && !pendingPickup && !!editablePickup;
  const migratedPickupStuck = linkedPickups.some(
    (p) => ['resolved', 'inventory_updated', 'closed'].includes(p.status)
      || p.customer_otp_verified_at
      || p.warehouse_received_at
  );
  const canCancelReturnPickup = isLead && ticket.return_dc_number
    && (linkedPickups.length === 0 || linkedPickups.every((p) => !p.picked_up_at && !p.warehouse_received_at
      && !['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(p.status)));
  const canForceVoidPickup = isLead && ticket.return_dc_number && migratedPickupStuck;

  const assignPickup = async (form) => {
    setAssignBusy(true);
    try {
      await api.post(`/support/tickets/${ticketId}/assign-return-pickup`, {
        dispatch_mode: form.dispatch_mode,
        technician_user_id: form.technician_user_id,
        courier_name: form.courier_name,
        awb_number: form.awb_number,
        porter_tracking_id: form.porter_tracking_id,
        porter_order_id: form.porter_order_id,
      });
      toast.success('Return pickup assigned');
      setShowAssign(false);
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to assign pickup');
    } finally {
      setAssignBusy(false);
    }
  };

  const changePickupAssignee = async (form) => {
    setChangeBusy(true);
    try {
      await api.patch(`/support/tickets/${ticketId}/return-pickup-assignment`, {
        dispatch_mode: form.dispatch_mode,
        technician_user_id: form.technician_user_id,
        courier_name: form.courier_name,
        awb_number: form.awb_number,
        porter_tracking_id: form.porter_tracking_id,
        porter_order_id: form.porter_order_id,
        reason: form.reason,
      });
      toast.success('Pickup assignee updated');
      setShowChangeAssignee(false);
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update assignee');
    } finally {
      setChangeBusy(false);
    }
  };

  const changeInitialValues = editablePickup ? {
    dispatch_mode: editablePickup.pickup_method || 'technician',
    technician_user_id: editablePickup.pickup_assigned_to || editablePickup.assigned_to,
    courier_name: editablePickup.pickup_courier_name,
    awb_number: editablePickup.pickup_awb,
    porter_tracking_id: editablePickup.porter_tracking_id,
    porter_order_id: editablePickup.porter_order_id,
  } : null;

  const cancelReturnPickup = async (force = false) => {
    const reason = window.prompt(
      force
        ? `Force-cancel ${ticket.return_dc_number}? Pickup shows complete in CRM but never happened.\n\nReason (required):`
        : `Cancel Return DC ${ticket.return_dc_number} and reset replacement?\n\nReason (required):`
    );
    if (reason == null) return;
    if (!String(reason).trim()) {
      toast.error('Cancellation reason is required');
      return;
    }
    if (!window.confirm(
      `Cancel ${ticket.return_dc_number} and the linked pickup? You can create a fresh replacement order after this.`
    )) return;
    setCancelBusy(true);
    try {
      const { data } = await api.post(`/support/tickets/${ticketId}/cancel-return-pickup`, {
        return_dc_number: ticket.return_dc_number,
        reason: reason.trim(),
        cancel_replacement_order: true,
        force,
      });
      toast.success(data.message || 'Return pickup cancelled');
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to cancel return pickup');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <section className="support-v3-card border-pink-200 bg-pink-50/30">
      <h3 className="font-semibold text-sm text-pink-900 mb-2">Replacement order</h3>
      <div className="text-sm space-y-2 text-pink-950">
        <p>
          Sales order{' '}
          <Link to={soPath} className="font-mono font-semibold text-pink-800 underline">
            {ticket.sales_order_number}
          </Link>
          {units.length > 1 ? ` · ${units.length} laptops` : ''}
        </p>
        {ticket.return_dc_number && (
          <p>Return pickup DC: <span className="font-mono">{ticket.return_dc_number}</span></p>
        )}
        {pendingPickup && (
          <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-2 py-1.5">
            Return DC created — assign a technician or add courier details when ready.
          </p>
        )}
        {!hasDeliveryDc ? (
          <ol className="list-decimal list-inside text-xs space-y-0.5 text-pink-900/90">
            <li>Attach QC-passed laptops on the sales order (one per line)</li>
            <li>Complete Dispatch QC → Create delivery DC → Assign delivery</li>
            <li>Pick up faulty units on the Return DC (Pickup tab / My Deliveries)</li>
          </ol>
        ) : (
          <p className="text-xs">
            Delivery in progress ({delivered}/{units.length || 1} delivered). Ticket closes when all units are delivered and old laptops are received at warehouse.
          </p>
        )}
        {isLead && pendingPickup && (
          <div className="pt-2 border-t border-pink-100 flex flex-wrap gap-2">
            {!showAssign ? (
              <button type="button" className="support-btn-outline min-h-[40px] text-sm" onClick={() => setShowAssign(true)}>
                Assign return pickup
              </button>
            ) : (
              <div className="rounded-lg border border-pink-100 bg-white p-3 w-full">
                <PickupSetupForm
                  ticket={ticket}
                  dispatchOnly
                  saving={assignBusy}
                  submitLabel="Assign pickup"
                  onSubmit={assignPickup}
                />
                <button type="button" className="support-btn-outline w-full min-h-[40px] mt-2 text-sm" onClick={() => setShowAssign(false)} disabled={assignBusy}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
        {canChangeAssignee && (
          <div className="pt-2 border-t border-pink-100">
            {!showChangeAssignee ? (
              <button
                type="button"
                className="support-btn-outline min-h-[40px] text-sm text-blue-700 border-blue-200"
                onClick={() => setShowChangeAssignee(true)}
              >
                Change pickup assignee
              </button>
            ) : (
              <div className="rounded-lg border border-blue-100 bg-white p-3">
                <PickupSetupForm
                  ticket={ticket}
                  dispatchOnly
                  changeMode
                  initialValues={changeInitialValues}
                  saving={changeBusy}
                  submitLabel="Save assignee"
                  onSubmit={changePickupAssignee}
                  onCancel={() => setShowChangeAssignee(false)}
                />
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Reassign technician, courier, or porter until pickup starts (before reached).
            </p>
          </div>
        )}
        {assignmentHistory.length > 0 && (
          <div className="pt-2 border-t border-pink-100">
            <AssignmentHistoryList rows={assignmentHistory} />
          </div>
        )}
        {canForceVoidPickup && (
          <div className="pt-2 border-t border-amber-200 bg-amber-50 rounded-lg p-3">
            <p className="text-xs text-amber-900 mb-2">
              CRM shows return pickup as done (migrated data) but it never happened. Void to restore the laptop with the customer.
            </p>
            <button
              type="button"
              className="support-btn-danger-outline min-h-[40px] text-sm"
              onClick={() => cancelReturnPickup(true)}
              disabled={cancelBusy || assignBusy}
            >
              {cancelBusy ? 'Voiding…' : `Void migrated pickup (${ticket.return_dc_number})`}
            </button>
          </div>
        )}
        {canCancelReturnPickup && (
          <div className="pt-2 border-t border-pink-100">
            <button
              type="button"
              className="support-btn-outline min-h-[40px] text-sm text-red-700 border-red-200"
              onClick={() => cancelReturnPickup(false)}
              disabled={cancelBusy || assignBusy}
            >
              {cancelBusy ? 'Cancelling…' : `Cancel Return DC ${ticket.return_dc_number}`}
            </button>
            <p className="text-xs text-slate-500 mt-1">
              Use when pickup was created in error (e.g. migrated data). Clears the Return DC so you can initiate replacement again.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PickupStatusBanner({ ticket, pickups, ticketId, isLead, onRefresh, assignmentHistory = [] }) {
  const [cancelBusy, setCancelBusy] = useState(false);
  const active = pickups.find((p) => !['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(p.status));
  const pendingAssign = pickups.some(
    (p) => p.status === 'pending_dispatch' || (p.return_dc_number && !p.pickup_method && !p.assigned_to)
  );
  const linkedPickups = ticket.return_dc_number
    ? pickups.filter((p) => p.return_dc_number === ticket.return_dc_number)
    : pickups.filter((p) => !['cancelled'].includes(p.status));
  const migratedPickupStuck = linkedPickups.some(
    (p) => ['resolved', 'inventory_updated', 'closed'].includes(p.status)
      || p.customer_otp_verified_at
      || p.warehouse_received_at
  );
  const canCancelReturnPickup = isLead && ticket.return_dc_number
    && (linkedPickups.length === 0 || linkedPickups.every((p) => !p.picked_up_at && !p.warehouse_received_at
      && !['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(p.status)));
  const canForceVoidPickup = isLead && ticket.return_dc_number && migratedPickupStuck;

  const cancelReturnPickup = async (force = false) => {
    const reason = window.prompt(
      force
        ? `Force void ${ticket.return_dc_number}? CRM shows pickup done but it never happened.\n\nReason (required):`
        : `Cancel Return DC ${ticket.return_dc_number}?\n\nReason (required):`
    );
    if (reason == null || !String(reason).trim()) {
      if (reason != null) toast.error('Cancellation reason is required');
      return;
    }
    if (!window.confirm(
      force
        ? `Void ${ticket.return_dc_number} and restore the laptop with the customer?`
        : `Cancel ${ticket.return_dc_number} and linked pickup items?`
    )) return;
    setCancelBusy(true);
    try {
      const { data } = await api.post(`/support/tickets/${ticketId}/cancel-return-pickup`, {
        return_dc_number: ticket.return_dc_number,
        reason: reason.trim(),
        cancel_replacement_order: false,
        force,
      });
      toast.success(data.message || 'Return pickup cancelled');
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to cancel return pickup');
    } finally {
      setCancelBusy(false);
    }
  };

  if (!ticket.return_dc_number && !active) return null;
  return (
    <section className="support-v3-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Pickup &amp; Return DC</h3>
        {ticket.return_dc_number && (
          <span className="support-pill progress font-mono">{ticket.return_dc_number}</span>
        )}
      </div>
      {pendingAssign ? (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Return DC <b>{ticket.return_dc_number}</b> created. Assign technician or courier from the replacement order section above when details are available.
        </p>
      ) : active ? (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Pickup scheduled
          {active.pickup_type === 'repair' ? ' (repair)' : ' (return)'}
          {active.assigned_to_name ? ` · assigned to ${active.assigned_to_name}` : ''}.
          Track progress under the <b>Pickup</b> tab — technician reaches customer, signs Return DC, verifies OTP, then warehouse confirms receipt.
        </p>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Return DC <b>{ticket.return_dc_number}</b> — pickup completed or closed.
        </p>
      )}
      {canForceVoidPickup && (
        <div className="mt-3 pt-3 border-t border-amber-200 bg-amber-50 rounded-lg p-3">
          <p className="text-sm text-amber-900 mb-2">
            CRM shows this pickup as done (migrated data) but it was not completed. Void it to restore the laptop with the customer and open a new ticket.
          </p>
          <button
            type="button"
            className="support-btn-danger-outline min-h-[40px] text-sm"
            onClick={() => cancelReturnPickup(true)}
            disabled={cancelBusy}
          >
            {cancelBusy ? 'Voiding…' : `Void migrated pickup (${ticket.return_dc_number})`}
          </button>
        </div>
      )}
      {canCancelReturnPickup && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            className="support-btn-outline min-h-[40px] text-sm text-red-700 border-red-200"
            onClick={() => cancelReturnPickup(false)}
            disabled={cancelBusy}
          >
            {cancelBusy ? 'Cancelling…' : `Cancel Return DC ${ticket.return_dc_number}`}
          </button>
        </div>
      )}
      {assignmentHistory.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <AssignmentHistoryList rows={assignmentHistory} />
        </div>
      )}
    </section>
  );
}

export default function SupportTicketDetail() {
  const { ticketId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const ticketsBackTo = location.state?.ticketsListSearch
    ? `/support/tickets?${location.state.ticketsListSearch}`
    : '/support/tickets';
  const [data, setData] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(false);
  const [showReplacement, setShowReplacement] = useState(false);
  const [phasePanel, setPhasePanel] = useState(null);
  const [pickupModal, setPickupModal] = useState(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('complaint');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [customerLaptops, setCustomerLaptops] = useState([]);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/support/tickets/${ticketId}`);
      setData(res);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.ticket) return;
    const hasPickup = (data.items || []).some((i) => i.item_type === 'pickup');
    if (data.ticket.ticket_category === 'pickup' || hasPickup) {
      setTab('pickup');
    }
  }, [data?.ticket?.id]);

  useEffect(() => {
    const cid = data?.ticket?.customer_id;
    if (!cid) {
      setCustomerLaptops([]);
      return;
    }
    api.get(`/customer-management/customers/${cid}/laptops`)
      .then((r) => setCustomerLaptops((r.data.laptops || []).slice(0, 5)))
      .catch(() => setCustomerLaptops([]));
  }, [data?.ticket?.customer_id]);

  useEffect(() => {
    if (!isSupportLead(user)) return;
    api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || [])).catch(() => setTechnicians([]));
    api.get('/support/categories').then((r) => setCategories(r.data.categories || [])).catch(() => setCategories([]));
  }, [user]);

  useEffect(() => {
    if (!editing) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editing]);

  const closeTicket = async () => {
    try {
      await api.post(`/support/tickets/${ticketId}/close`, {});
      load();
    } catch (e) {
      if (e.response?.status === 400 && window.confirm('Not all items are resolved. Force close this ticket?')) {
        await api.post(`/support/tickets/${ticketId}/close`, { force: true });
        load();
      } else {
        alert(e.response?.data?.message || 'Could not close ticket');
      }
    }
  };

  const saveEdit = async (payload) => {
    await api.patch(`/support/tickets/${ticketId}`, payload);
    setEditing(false);
    load();
  };

  const onPriorityChange = async (priority) => {
    try {
      await api.patch(`/support/tickets/${ticketId}`, { priority });
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to update priority');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }
  if (!data?.ticket) {
    return <p className="text-slate-600">Ticket not found.</p>;
  }

  const {
    ticket,
    items: rawItems,
    audit: rawAudit,
    assignment_history: assignmentHistory = [],
    replacement_orders: replacementOrders = [],
    customer_addresses: customerAddresses = [],
    otp_phase_note: otpNote
  } = data;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const audit = Array.isArray(rawAudit) ? rawAudit : [];
  const isCancelled = ticket.status === 'cancelled';
  const resolvedCount = items.filter((i) => ['resolved', 'closed', 'inventory_updated'].includes(i.status)).length;
  const allResolved = items.length > 0 && resolvedCount === items.length;
  const complaints = items.filter((i) => i.item_type === 'complaint');
  const pickups = items.filter((i) => i.item_type === 'pickup');
  const replacements = items.filter((i) => i.item_type === 'replacement');
  const complaintForReplacement = complaints.find((c) => !['resolved', 'closed'].includes(c.status));

  const eligibleForReplacement = complaints.filter((c) => {
    const activeOrder = replacementOrders.some(
      (o) => o.source_item_id === c.id && !['completed', 'cancelled'].includes(o.status)
    );
    if (activeOrder) return false;
    if (c.outcome === 'replacement_required') return true;
    return replacementOrders.some((o) => o.source_item_id === c.id && o.status === 'cancelled');
  });
  const canInitiateReplacement = isSupportLead(user) && eligibleForReplacement.length > 0;
  const replacementActionLabel = ticket.return_dc_number && ticket.sales_order_number
    ? `Add to replacement (${eligibleForReplacement.length})`
    : 'Initiate replacement';
  const canMoveToReplacement = isSupportLead(user) && complaintForReplacement
    && complaintForReplacement.outcome !== 'replacement_required'
    && !complaintForReplacement.replacement_flag_reason;

  const repairPickupsInWarehouse = pickups.filter(
    (p) => (p.pickup_type === 'repair' || p.source_item_id) && p.warehouse_received_at
  );
  const hasActiveReplacementSo = !!ticket.sales_order_number
    && replacementOrders.some((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const showSwapTab = repairPickupsInWarehouse.length > 0
    || pickups.some((p) => p.status === 'swap_initiated');
  const canOpenRepairSwap = isSupportLead(user) && showSwapTab && !hasActiveReplacementSo;

  const tabItems = tab === 'complaint'
    ? complaints
    : tab === 'pickup'
      ? pickups
      : tab === 'replacement'
        ? replacements
        : [];

  const hasActivePickup = (sourceId) => pickups.some(
    (p) => p.source_item_id === sourceId && !['resolved', 'closed', 'inventory_updated'].includes(p.status)
  );
  const hasLinkedReplacement = (sourceId) => replacements.some((r) => r.source_item_id === sourceId);
  const activePickupExists = pickups.some((p) => !['resolved', 'closed', 'inventory_updated'].includes(p.status));

  const workflowForItem = (item) => {
    if (!isSupportLead(user) || ticket.status === 'closed' || isCancelled) return null;
    const resolved = ['resolved', 'closed'].includes(item.status);
    const actions = {
      onAddPhase: (type) => (type === 'pickup'
        ? setPickupModal({ sourceItem: item })
        : setPhasePanel({ sourceItem: item, phaseType: type }))
    };
    if (item.item_type === 'complaint' && item.outcome === 'replacement_required') {
      if (!hasLinkedReplacement(item.id) && !hasActivePickup(item.id)) {
        /* Lead uses header Initiate / Add to replacement — hide duplicate workflow buttons */
      } else if (!hasActivePickup(item.id)) {
        actions.showPickup = true;
      }
    } else if (item.item_type === 'complaint' && resolved) {
      if (!hasActivePickup(item.id)) actions.showPickup = true;
    }
    if (item.item_type === 'replacement' && item.status === 'inventory_updated' && !hasActivePickup(item.id)) {
      actions.showPickup = true;
    }
    if (!actions.showPickup && !actions.showReplacement) return null;
    return actions;
  };

  const ticketCategory = ticket.ticket_category || complaints[0]?.item_type || pickups[0]?.item_type || 'complaint';

  const cityLine = formatAddress(ticket.ticket_address);
  const shortCity = cityLine.length > 80 ? `${cityLine.slice(0, 77)}…` : cityLine;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={ticketsBackTo} className="text-sm min-h-[44px] inline-flex items-center" style={{ color: 'var(--support-primary)' }}>← All tickets</Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="support-btn-outline lg:hidden min-h-[44px]" onClick={() => setMobileDetails(true)}>Details</button>
          {isSupportLead(user) && !isCancelled && (
            <>
              {canMoveToReplacement && (
                <button
                  type="button"
                  className="support-btn-outline min-h-[44px]"
                  onClick={async () => {
                    const reason = window.prompt('Reason for replacement (optional):') ?? '';
                    try {
                      await api.post(`/support/items/${complaintForReplacement.id}/move-to-replacement`, { reason });
                      toast.success('Complaint moved to replacement');
                      load();
                    } catch (e) {
                      toast.error(e.response?.data?.message || 'Failed');
                    }
                  }}
                >
                  Move to replacement
                </button>
              )}
              {canInitiateReplacement && (
                <button type="button" className="support-btn-primary min-h-[44px]" onClick={() => setShowReplacement(true)}>
                  {replacementActionLabel}
                </button>
              )}
              {canOpenRepairSwap && (
                <button type="button" className="support-btn-outline min-h-[44px]" onClick={() => setTab('swap')}>
                  Repair swap (create SO)
                </button>
              )}
              {!activePickupExists && !canInitiateReplacement && !ticket.return_dc_number && (
                <button type="button" className="support-btn-outline min-h-[44px]" onClick={() => setPickupModal({})}>Schedule pickup</button>
              )}
              <button type="button" className="support-btn-outline min-h-[44px]" onClick={() => setEditing((v) => !v)}>{editing ? 'Close edit' : 'Edit ticket'}</button>
            </>
          )}
        </div>
      </div>

      {phasePanel && (
        <AddWorkflowPhasePanel
          ticketId={ticket.id}
          customerId={ticket.customer_id}
          sourceItem={phasePanel.sourceItem}
          phaseType={phasePanel.phaseType}
          onDone={() => { setPhasePanel(null); load(); }}
          onCancel={() => setPhasePanel(null)}
        />
      )}

      {pickupModal && (
        <CreatePickupModal
          ticket={ticket}
          items={items}
          sourceItem={pickupModal.sourceItem}
          onCreated={() => { setPickupModal(null); load(); }}
          onClose={() => setPickupModal(null)}
        />
      )}

      {showReplacement && (
        <ReplacementPanel
          ticketId={ticket.id}
          ticket={ticket}
          customerId={ticket.customer_id}
          onDone={() => { setShowReplacement(false); load(); }}
          onCancel={() => setShowReplacement(false)}
        />
      )}

      {editing && isSupportLead(user) && !isCancelled && (
        <TicketEditPanel
          ticket={ticket}
          items={items}
          customerAddresses={customerAddresses}
          technicians={technicians}
          categories={categories}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="support-detail-layout">
        <div className="support-detail-main space-y-4">
          <section className="support-v3-card">
            {isCancelled && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
                <p className="font-semibold text-red-800">This ticket has been cancelled</p>
                <p className="text-red-900 mt-1"><span className="font-medium">Cancelled by:</span> {ticket.cancelled_by_name || '—'}</p>
                <p className="text-red-900"><span className="font-medium">Cancelled at:</span> {ticket.cancelled_at ? new Date(ticket.cancelled_at).toLocaleString() : '—'}</p>
                <p className="text-red-900 mt-2"><span className="font-medium">Remark:</span> {ticket.cancellation_remark || '—'}</p>
                <p className="text-xs text-red-700 mt-2">This ticket is read-only. Create a new support ticket for the same customer/laptop if needed.</p>
              </div>
            )}
            <p className="text-xs font-mono mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {formatTicketId(ticket.id)} · {new Date(ticket.created_at).toLocaleString()}
              {ticket.created_by_name ? ` · Created by ${ticket.created_by_name}` : ''}
            </p>
            <h1 className="support-ticket-title">{ticket.customer_name}</h1>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className={`support-category-label ${ticketCategory}`}>{ticketCategory} ticket</span>
              {complaints.length > 0 && <span className="support-phase-count complaint">{complaints.length} complaint</span>}
              {pickups.length > 0 && <span className="support-phase-count pickup">{pickups.length} pickup</span>}
              {replacements.length > 0 && <span className="support-phase-count replacement">{replacements.length} replacement</span>}
            </div>
            {ticket.ttspl_id && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1 text-sm text-blue-600 hover:underline mt-2"
              >
                <Laptop className="w-4 h-4" /> View TTSPL History: {ticket.ttspl_id}
              </button>
            )}
            <div className="flex flex-wrap gap-3 text-sm mt-2 items-center">
              <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                <Phone className="w-4 h-4 shrink-0" /> {ticket.display_phone || ticket.customer_phone}
              </span>
              <span className="inline-flex items-start gap-1 min-w-0 max-w-full" style={{ color: 'var(--color-text-secondary)' }}>
                <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{shortCity}</span>
              </span>
              <span className={`support-pill ${isCancelled ? 'cancelled' : ticket.status === 'closed' ? 'closed' : 'progress'}`}>
                {isCancelled ? 'Cancelled' : ticket.status.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Overall resolution</span>
                <span>{resolvedCount} of {items.length} items resolved</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-muted)' }}>
                <div className="h-full rounded-full" style={{ width: `${items.length ? (resolvedCount / items.length) * 100 : 0}%`, background: '#639922' }} />
              </div>
            </div>
          </section>

          {ticket.sales_order_number && (
            <ReplacementOrderBanner
              ticket={ticket}
              replacementOrders={replacementOrders}
              pickups={pickups}
              ticketId={ticket.id}
              isLead={isSupportLead(user)}
              onRefresh={load}
              assignmentHistory={assignmentHistory}
            />
          )}

          {(pickups.length > 0 || ticket.return_dc_number) && (
            <PickupStatusBanner
              ticket={ticket}
              pickups={pickups}
              ticketId={ticket.id}
              isLead={isSupportLead(user)}
              onRefresh={load}
              assignmentHistory={assignmentHistory}
            />
          )}

          <ServiceDcPanel
            ticket={ticket}
            pickups={pickups}
            replacementOrders={replacementOrders}
            ticketId={ticket.id}
            isLead={isSupportLead(user)}
            onRefresh={load}
          />

          <section className="support-v3-card">
            <div className="support-v3-tabs mb-3">
              {[
                { id: 'complaint', label: 'Complaint', n: complaints.length },
                { id: 'pickup', label: 'Pickup', n: pickups.length },
                { id: 'replacement', label: 'Replacement', n: replacements.length },
                ...(showSwapTab ? [{
                  id: 'swap',
                  label: 'Repair swap',
                  n: repairPickupsInWarehouse.length || 1,
                }] : []),
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`support-v3-tab ${t.id} ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label} ({t.n})
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {tab === 'swap' ? (
                <RepairSwapPanel
                  variant="tab"
                  ticket={ticket}
                  pickups={pickups}
                  replacementOrders={replacementOrders}
                  ticketId={ticket.id}
                  isLead={isSupportLead(user)}
                  onRefresh={load}
                  onSwapCreated={() => setTab('replacement')}
                />
              ) : (
                <>
              {tabItems.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No items in this category.</p>}
              {tabItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  ticket={ticket}
                  replacementOrder={(replacementOrders || []).find((o) => o.item_id === item.id)}
                  onRefresh={load}
                  technicians={technicians}
                  canAssign={!isCancelled && isSupportLead(user) && itemAllowsTechnicianAssign(item)}
                  otpNote={otpNote}
                  workflowActions={workflowForItem(item)}
                  assignmentHistory={assignmentHistory}
                />
              ))}
                </>
              )}
            </div>
          </section>

          {audit?.length > 0 && (
            <section className="support-v3-card">
              <h2 className="font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Activity Log</h2>
              <ul className="space-y-2 border-l-2 border-slate-200 ml-2 pl-4">
                {audit.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p style={{ color: 'var(--color-text-primary)' }}>
                      <span className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString()}</span>
                      {' · '}
                      <span className="font-medium">{entry.user_name || 'System'}</span>
                      {' · '}
                      {actionLabel(entry.action)}
                      {entry.detail?.previous_assignee && entry.detail?.new_assignee
                        ? `: ${entry.detail.previous_assignee} → ${entry.detail.new_assignee}`
                        : ''}
                      {!entry.detail?.previous_assignee && entry.detail?.new_assignee
                        ? `: ${entry.detail.new_assignee}`
                        : ''}
                      {entry.detail?.reason ? ` (${entry.detail.reason})` : ''}
                      {entry.detail?.remark ? `: ${entry.detail.remark}` : ''}
                      {entry.detail?.text ? `: ${entry.detail.text}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isCancelled && canCloseSupportTicket(user) && ticket.status !== 'closed' && (
            <div className="flex justify-end gap-2 pt-2">
              {canCancelSupportTicket(user) && (
                <button
                  type="button"
                  className="support-btn-danger-outline"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel ticket
                </button>
              )}
              <button
                type="button"
                className="support-btn-danger-outline"
                title={allResolved ? 'Close ticket' : 'Closes only when every item is resolved; you will be asked to confirm a force close.'}
                onClick={closeTicket}
              >
                Close ticket
              </button>
            </div>
          )}
        </div>

        <div className="support-detail-side space-y-3">
          <section className="support-v3-card">
            <h3 className="support-v3-section-label mb-2">Customer&apos;s Active Laptops</h3>
            {customerLaptops.length ? customerLaptops.map((lap) => {
              const highlight = ticket.ttspl_id && lap.ttspl_id === ticket.ttspl_id;
              return (
                <button
                  key={lap.id}
                  type="button"
                  onClick={() => { if (lap.ttspl_id) { setHistoryOpen(true); } }}
                  className={`w-full text-left text-sm py-2 border-b border-gray-50 last:border-0 ${highlight ? 'bg-blue-50 rounded px-2 -mx-2' : ''}`}
                >
                  <span className="font-mono text-blue-600">{lap.ttspl_id || lap.serial_number}</span>
                  <span className="text-gray-500 block text-xs">{[lap.processor, lap.ram, lap.storage].filter(Boolean).join(' · ') || lap.model_name}</span>
                  <span className="text-xs capitalize text-gray-400">{lap.status}</span>
                </button>
              );
            }) : <p className="text-xs text-gray-500">No active laptops on record</p>}
          </section>
          <DetailSidebar
            ticket={ticket}
            items={items}
            otpNote={otpNote}
            mobileOpen={mobileDetails}
            onCloseMobile={() => setMobileDetails(false)}
            showLeadOtp={isSupportLead(user)}
            onPriorityChange={!isCancelled && isSupportLead(user) ? onPriorityChange : null}
          />
        </div>
      </div>

      <CancelTicketModal
        ticketId={ticketId}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={load}
        hasReturnDc={!!ticket.return_dc_number}
      />

      <TtsplHistoryDrawer
        ttsplId={ticket.ttspl_id || customerLaptops[0]?.ttspl_id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
