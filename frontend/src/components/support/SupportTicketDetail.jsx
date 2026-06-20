import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Phone, MapPin, CheckCircle2, Clock, RefreshCw, Camera, Laptop } from 'lucide-react';
import TtsplHistoryDrawer from '../../features/floor-pipeline/components/TtsplHistoryDrawer';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
import OtpInput from './components/OtpInput';
import ItemStepper from './components/ItemStepper';
import CommentThread from './components/CommentThread';
import TicketEditPanel from './components/TicketEditPanel';
import DetailSidebar from './components/DetailSidebar';
import ReplacementPanel from './components/ReplacementPanel';
import AddWorkflowPhasePanel from './components/AddWorkflowPhasePanel';
import {
  formatItemId,
  formatRelative,
  formatTicketId,
  formatAddress,
  initials,
  pickupMinScheduleDate,
  podUrl as podUrlFor
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
  workflowActions
}) {
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [otp, setOtp] = useState('');
  const [verifyInput, setVerifyInput] = useState('');
  const [loanSerial, setLoanSerial] = useState('');
  const [loanAt, setLoanAt] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [busy, setBusy] = useState(false);

  const lead = isSupportLead(user);
  const tech = isSupportTechnician(user);
  const st = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const canAct = lead || (tech && item.assigned_to === user.user_id);
  const podUrl = podUrlFor(item.proof_of_completion_path || item.pod_image_path);
  const ttsplLabel = item.ttspl_id || item.unique_serial_number || item.serial_number;
  const minPickup = pickupMinScheduleDate(item.loan_delivered_at);
  const pickupBlocked = minPickup && Date.now() < minPickup.getTime();
  const terminal = ['resolved', 'closed', 'inventory_updated'].includes(item.status);

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

  const dispatchReplacement = () => {
    if (!replacementOrder?.id) return;
    run(() => api.patch(`/support/replacement-orders/${replacementOrder.id}`, { status: 'dispatched' }));
  };

  const deliverReplacement = () => {
    if (!replacementOrder?.id) return;
    if (!window.confirm('Activate the new machine in customer inventory and passivate the old one?')) return;
    run(() => api.post(`/support/replacement-orders/${replacementOrder.id}/deliver`));
  };

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

        <SpecGrid item={item} />

        {showServiceAddress && (
          <div className="support-v3-address-bar">
            <p className="support-v3-section-label !mb-1 !mt-0">Service address</p>
            <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{formatAddress(ticket.ticket_address)}</p>
          </div>
        )}

        {item.item_type === 'complaint' && st === 'replacement_required' && (
          <div className="rounded-lg p-3 space-y-2" style={{ border: '1.5px solid #dc2626', background: '#FCEBEB', color: '#991b1b' }}>
            <p className="font-semibold text-sm">Replacement required</p>
            <p className="text-sm">Flagged{item.assigned_to_name ? ` by ${item.assigned_to_name}` : ''}. {item.replacement_flag_reason || '—'}</p>
            {lead && (
              <p className="text-xs opacity-90">Use &quot;Initiate replacement&quot; on the ticket to assign a machine from inventory.</p>
            )}
            {!lead && <p className="text-xs">Awaiting team lead to assign replacement hardware.</p>}
          </div>
        )}

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

        {item.item_type === 'pickup' && item.loan_delivered_at && (
          <div className="support-pickup-notice !mx-0">
            Loan laptop {item.loan_machine_serial || '—'} delivered {new Date(item.loan_delivered_at).toLocaleString()}
            {pickupBlocked && minPickup && (
              <span> · Pickup available after {minPickup.toLocaleString()}</span>
            )}
          </div>
        )}

        {item.item_type === 'complaint' && canAct && !terminal && st === 'verify_ttspl' && item.assigned_to && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Step 1 · Verify laptop TTSPL ID</p>
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
                className="support-btn-primary min-h-[44px]"
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
            <p className="support-v3-section-label">Step 2 · Mark as reached</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Tap when you arrive at the customer location. Your GPS location will be recorded.
            </p>
            <button type="button" className="support-btn-primary w-full min-h-[44px] inline-flex items-center justify-center gap-2" disabled={busy} onClick={markReached}>
              <MapPin className="w-5 h-5" />
              {busy ? 'Getting location…' : 'I have reached the location'}
            </button>
          </div>
        )}

        {lead && item.visited_lat && item.visited_lng && (
          <a
            href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <MapPin className="w-3 h-3" /> View reached location
          </a>
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

        {item.item_type === 'complaint' && canAct && !terminal && st === 'replacement_required' && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Cannot fix at site — choose how to proceed</p>
            <button
              type="button"
              className="support-btn-outline w-full min-h-[44px] inline-flex items-center justify-center gap-2"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Pick up this laptop and carry it to the warehouse for repair?')) return;
                run(() => api.post(`/support/items/${item.id}/submit-pickup`, { pickup_reason: comment.trim() || undefined }));
              }}
            >
              Pick up laptop (carry to warehouse)
            </button>
            <div className="rounded-lg p-3 text-xs" style={{ border: '1px solid #e9d5ff', background: '#FAF5FF', color: '#6b21a8' }}>
              <p className="font-semibold">Or leave it with the customer for replacement</p>
              <p className="mt-1">The support lead has been notified and can initiate a replacement order from this ticket.</p>
            </div>
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
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && run(() => { const fd = new FormData(); fd.append('pod', e.target.files[0]); return api.post(`/support/items/${item.id}/pod`, fd); })} />
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

        {item.item_type === 'pickup' && canAct && !terminal && (st === 'assigned' || st === 'wait_72h' || st === 'pickup_action') && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Loan (optional)</p>
            <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" placeholder="Loan machine serial" value={loanSerial} onChange={(e) => setLoanSerial(e.target.value)} />
            <input type="datetime-local" className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={loanAt} onChange={(e) => setLoanAt(e.target.value)} />
            <button type="button" className="support-btn-outline w-full min-h-[44px]" disabled={busy || !loanSerial} onClick={() => run(() => api.post(`/support/items/${item.id}/loan-machine`, { loan_machine_serial: loanSerial, loan_delivered_at: loanAt || undefined }))}>
              Log loan machine delivery
            </button>
            <button type="button" className="text-sm text-[#534AB7] min-h-[44px]" disabled={busy} onClick={() => run(() => api.post(`/support/items/${item.id}/picked-up`))}>
              Proceed to mark pickup without loan
            </button>
            <input type="datetime-local" className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} disabled={pickupBlocked} />
            <button type="button" className="support-btn-outline w-full min-h-[44px]" disabled={busy || pickupBlocked || !pickupAt} onClick={() => run(() => api.post(`/support/items/${item.id}/schedule-pickup`, { pickup_scheduled_at: pickupAt }))}>
              Schedule pickup
            </button>
            <button type="button" className="support-btn-primary w-full min-h-[44px]" disabled={busy || pickupBlocked} onClick={() => run(() => api.post(`/support/items/${item.id}/picked-up`))}>
              Mark pickup completed
            </button>
          </div>
        )}

        {item.item_type === 'pickup' && canAct && !terminal && st === 'fixed_pending_pod' && (
          <div className="support-v3-pod-zone">
            <p className="font-medium text-sm mb-2">Upload proof of completion after pickup</p>
            <label className="support-btn-outline inline-flex items-center justify-center cursor-pointer min-h-[44px]">
              Take photo / Upload file
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && run(() => { const fd = new FormData(); fd.append('pod', e.target.files[0]); return api.post(`/support/items/${item.id}/pod`, fd); })} />
            </label>
          </div>
        )}

        {item.item_type === 'pickup' && canAct && !terminal && st === 'warehouse_otp' && (
          <div className="space-y-2">
            <p className="support-v3-section-label">Warehouse OTP</p>
            <OtpInput value={otp} onChange={setOtp} disabled={busy} />
            <button type="button" className="support-btn-primary w-full min-h-[44px]" disabled={busy || otp.replace(/\D/g, '').length !== 6} onClick={() => run(() => api.post(`/support/items/${item.id}/verify-warehouse-otp`, { otp }))}>
              Confirm warehouse receipt
            </button>
          </div>
        )}

        {item.item_type === 'replacement' && lead && replacementOrder && !terminal && (
          <div className="support-replacement-banner !mx-0">
            <p className="font-medium text-pink-900">Replacement order</p>
            <p className="text-sm text-pink-900/90">{replacementOrder.notes || item.remarks}</p>
            <p className="text-sm">New serial: {replacementOrder.new_machine_serial || '—'}</p>
            <p className="text-sm">Status: {replacementOrder.status || item.status}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {replacementOrder.status === 'placed' && (
                <button type="button" className="support-btn-outline min-h-[44px]" disabled={busy} onClick={dispatchReplacement}>Mark dispatched</button>
              )}
              {['placed', 'dispatched', 'delivered'].includes(replacementOrder.status) && replacementOrder.status !== 'inventory_updated' && (
                <button type="button" className="support-btn-primary min-h-[44px]" disabled={busy} onClick={deliverReplacement}>Mark delivered & update inventory</button>
              )}
            </div>
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
                    + Add pickup phase (this machine)
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

// Lead generates a Return DC for a pickup ticket and assigns a pickup mode
// (technician / courier / porter). The unit then rides the delivery flow.
function ReturnDcPanel({ ticket, technicians, isLead }) {
  const [rdc, setRdc] = useState(ticket.return_dc_number || null);
  const [mode, setMode] = useState('technician');
  const [techId, setTechId] = useState('');
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const body = { pickup_mode: mode };
      if (mode === 'technician') body.technician_user_id = techId || undefined;
      if (mode === 'courier') { body.courier_name = courier || undefined; body.awb_number = awb || undefined; }
      const { data } = await api.post(`/sales-management/return-dc/tickets/${ticket.id}/generate`, body);
      setRdc(data.return_dc_number);
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to generate Return DC';
      const m = /already generated \(([^)]+)\)/.exec(msg);
      if (m) setRdc(m[1]); else alert(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="support-v3-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Return DC (Pickup)</h3>
        {rdc && <span className="support-pill progress font-mono">{rdc}</span>}
      </div>
      {rdc ? (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Return DC <b>{rdc}</b> generated. Track it under <b>Pickup Bucket</b> / <b>My Pickups</b> and the Delivery Register;
          on POD completion the unit re-enters QC and a credit note is raised.
        </p>
      ) : !isLead ? (
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No Return DC generated yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Generate a Return DC and assign the pickup mode.</p>
          <div className="flex gap-2">
            {['technician', 'courier', 'porter'].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg border text-sm capitalize ${mode === m ? 'border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7] font-medium' : 'border-slate-200 text-slate-600'}`}>
                {m}
              </button>
            ))}
          </div>
          {mode === 'technician' && (
            <select value={techId} onChange={(e) => setTechId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select technician…</option>
              {technicians.map((t) => (
                <option key={t.user_id || t.id} value={t.user_id || t.id}>{t.name || t.full_name || t.email}</option>
              ))}
            </select>
          )}
          {mode === 'courier' && (
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Courier name" value={courier} onChange={(e) => setCourier(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="AWB number" value={awb} onChange={(e) => setAwb(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <button type="button" disabled={busy || (mode === 'technician' && !techId)} onClick={generate}
            className="support-btn-primary w-full min-h-[44px] disabled:opacity-50">
            {busy ? 'Generating…' : 'Generate Return DC'}
          </button>
        </div>
      )}
    </section>
  );
}

export default function SupportTicketDetail() {
  const { ticketId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(false);
  const [showReplacement, setShowReplacement] = useState(false);
  const [phasePanel, setPhasePanel] = useState(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('complaint');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [customerLaptops, setCustomerLaptops] = useState([]);

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
    replacement_orders: replacementOrders = [],
    customer_addresses: customerAddresses = [],
    otp_phase_note: otpNote
  } = data;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const audit = Array.isArray(rawAudit) ? rawAudit : [];
  const resolvedCount = items.filter((i) => ['resolved', 'closed', 'inventory_updated'].includes(i.status)).length;
  const allResolved = items.length > 0 && resolvedCount === items.length;
  const flaggedItem = items.find((i) => i.replacement_flag_reason && i.item_type === 'complaint');
  const canInitiateReplacement = isSupportLead(user) && flaggedItem && !items.some((i) => i.item_type === 'replacement' && i.source_item_id === flaggedItem.id);

  const complaints = items.filter((i) => i.item_type === 'complaint');
  const pickups = items.filter((i) => i.item_type === 'pickup');
  const replacements = items.filter((i) => i.item_type === 'replacement');

  const tabItems = tab === 'complaint' ? complaints : tab === 'pickup' ? pickups : replacements;

  const hasLinkedPickup = (sourceId) => pickups.some((p) => p.source_item_id === sourceId);
  const hasLinkedReplacement = (sourceId) => replacements.some((r) => r.source_item_id === sourceId);

  const workflowForItem = (item) => {
    if (!isSupportLead(user) || ticket.status === 'closed') return null;
    const resolved = ['resolved', 'closed'].includes(item.status);
    const actions = { onAddPhase: (type) => setPhasePanel({ sourceItem: item, phaseType: type }) };
    if (item.item_type === 'complaint' && (resolved || item.outcome === 'replacement_required')) {
      if (!hasLinkedPickup(item.id)) actions.showPickup = true;
      if (item.outcome === 'replacement_required' && !hasLinkedReplacement(item.id)) actions.showReplacement = true;
    }
    if (item.item_type === 'replacement' && item.status === 'inventory_updated' && !hasLinkedPickup(item.id)) {
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
        <Link to="/support/tickets" className="text-sm min-h-[44px] inline-flex items-center" style={{ color: 'var(--support-primary)' }}>← All tickets</Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="support-btn-outline lg:hidden min-h-[44px]" onClick={() => setMobileDetails(true)}>Details</button>
          {isSupportLead(user) && (
            <>
              {canInitiateReplacement && (
                <button type="button" className="support-btn-primary min-h-[44px]" onClick={() => setShowReplacement(true)}>Initiate replacement</button>
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

      {showReplacement && flaggedItem && (
        <ReplacementPanel
          ticketId={ticket.id}
          sourceItem={flaggedItem}
          customerId={ticket.customer_id}
          onDone={() => { setShowReplacement(false); load(); }}
          onCancel={() => setShowReplacement(false)}
        />
      )}

      {editing && isSupportLead(user) && (
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
              <span className={`support-pill ${ticket.status === 'closed' ? 'closed' : 'progress'}`}>{ticket.status.replace(/_/g, ' ')}</span>
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

          {(pickups.length > 0 || ticket.ticket_category === 'pickup') && (
            <ReturnDcPanel ticket={ticket} technicians={technicians} isLead={isSupportLead(user)} />
          )}

          <section className="support-v3-card">
            <div className="support-v3-tabs mb-3">
              {[
                { id: 'complaint', label: 'Complaint', n: complaints.length },
                { id: 'pickup', label: 'Pickup', n: pickups.length },
                { id: 'replacement', label: 'Replacement', n: replacements.length }
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`support-v3-tab ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label} ({t.n})
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {tabItems.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No items in this category.</p>}
              {tabItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  ticket={ticket}
                  replacementOrder={(replacementOrders || []).find((o) => o.item_id === item.id)}
                  onRefresh={load}
                  technicians={technicians}
                  canAssign={isSupportLead(user)}
                  otpNote={otpNote}
                  workflowActions={workflowForItem(item)}
                />
              ))}
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
                      {entry.action.replace(/_/g, ' ')}
                      {entry.detail?.text ? `: ${entry.detail.text}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isSupportLead(user) && (
            <div className="flex justify-end pt-2">
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
            onPriorityChange={isSupportLead(user) ? onPriorityChange : null}
          />
        </div>
      </div>

      <TtsplHistoryDrawer
        ttsplId={ticket.ttspl_id || customerLaptops[0]?.ttspl_id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
