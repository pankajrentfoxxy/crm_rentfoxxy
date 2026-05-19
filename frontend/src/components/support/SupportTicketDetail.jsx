import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Phone, MapPin, CheckCircle2, Clock, RefreshCw, Camera } from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
import OtpInput from './components/OtpInput';
import ItemStepper from './components/ItemStepper';
import CommentThread from './components/CommentThread';
import TicketEditPanel from './components/TicketEditPanel';
import DetailSidebar from './components/DetailSidebar';
import ReplacementPanel from './components/ReplacementPanel';
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
  otpNote
}) {
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [otp, setOtp] = useState('');
  const [loanSerial, setLoanSerial] = useState('');
  const [loanAt, setLoanAt] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [busy, setBusy] = useState(false);

  const lead = isSupportLead(user);
  const tech = isSupportTechnician(user);
  const st = item.effective_current_step || (item.assigned_to ? 'assigned' : 'unassigned');
  const canAct = lead || (tech && item.assigned_to === user.user_id);
  const podUrl = podUrlFor(item.pod_image_path);
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

        {item.item_type === 'complaint' && canAct && !terminal && st === 'assigned' && item.assigned_to && (
          <button type="button" className="support-btn-primary w-full min-h-[44px]" disabled={busy} onClick={() => run(() => api.post(`/support/items/${item.id}/mark-visited`))}>
            Mark as visited
          </button>
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
            <p className="font-medium text-sm mb-2">Upload proof of delivery</p>
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
            <p className="font-medium text-sm mb-2">Upload POD after pickup</p>
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
      </div>
    </article>
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
  const [mobileDetails, setMobileDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('complaint');

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
                />
              ))}
            </div>
          </section>

          {isSupportLead(user) && audit?.length > 0 && (
            <section className="support-v3-card">
              <h2 className="font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Activity</h2>
              <ul className="space-y-3">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">{initials(entry.user_name)}</span>
                    <div>
                      <p style={{ color: 'var(--color-text-primary)' }}><span className="font-medium">{entry.user_name || 'System'}</span> {entry.action.replace(/_/g, ' ')}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{formatRelative(entry.created_at)}</p>
                    </div>
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
  );
}
