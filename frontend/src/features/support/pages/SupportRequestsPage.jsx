import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, QrCode, RefreshCw, Ticket, Eye, X, Search, Download, Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import api from '../../../utils/api';
import { isSupportLead } from '../../../utils/supportAccess';
import { assigneeOptionLabel } from '../../../components/support/utils';
import { useAuth } from '../../../context/AuthContext';
import { pickupReasonDetail, pickupReasonLabel, pickupReasonRemarks, pickupReasonTypeLabel, parseRequestExtra } from '../pickupReasonTypes';

function normalizeRequestRow(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, extra: parseRequestExtra(row.extra) };
}

function pickupTableRemarks(row) {
  if (row.request_type !== 'pickup') return row.issue_description || '—';
  const remarks = pickupReasonRemarks(row.extra, row.issue_description);
  if (remarks) return remarks;
  const reason = pickupReasonDetail(row.extra, row.issue_description, row.request_type);
  const desc = String(row.issue_description || '').trim();
  if (reason && desc === reason) return '—';
  return '—';
}

function formatVisitAddress(extra) {
  if (!extra || typeof extra !== 'object') return null;
  const addr = extra.service_address || extra.pickup_address;
  if (!addr || typeof addr !== 'object') return null;
  const line = [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  if (!line) return null;
  return { line, phone: addr.phone || null, isPickup: Boolean(extra.pickup_address && !extra.service_address) };
}

function formatVisitSchedule(extra) {
  if (!extra || typeof extra !== 'object' || !extra.preferred_visit_date) return null;
  const date = extra.preferred_visit_date;
  const time = extra.preferred_visit_time;
  try {
    const formattedDate = new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    return time ? `${formattedDate} at ${time}` : formattedDate;
  } catch {
    return time ? `${date} at ${time}` : date;
  }
}

function statusTone(status) {
  if (status === 'pending') return 'bg-amber-100 text-amber-800';
  if (status === 'reviewed') return 'bg-blue-100 text-blue-800';
  if (status === 'converted') return 'bg-emerald-100 text-emerald-800';
  if (status === 'dismissed') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-slate-700';
}

function statusLabel(status) {
  if (status === 'dismissed') return 'rejected';
  return status || '—';
}

function canActOnRequest(status) {
  return status === 'pending' || status === 'reviewed';
}

function formatWhen(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}

function RejectModal({ request, onClose, onRejected }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const notes = reason.trim();
    if (!notes) {
      toast.error('Please enter a reject reason');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/support/requests/${request.id}`, {
        status: 'dismissed',
        notes,
      });
      toast.success(`Request #${request.id} rejected`);
      onRejected?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-rose-800">Reject request</h2>
            <p className="text-xs text-slate-500">Request #{request.id} · {request.device_serial || 'No TTSPL'}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          This will mark the request as rejected. No support ticket will be created.
        </p>
        <label className="block text-sm mb-4">
          <span className="text-xs font-semibold text-slate-600">Reason *</span>
          <textarea
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[90px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this request being rejected?"
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function ConvertModal({ request, onClose, onConverted }) {
  const isPickup = request.request_type === 'pickup';
  // Every laptop on a pickup must belong to one customer, and that customer is
  // already resolved from the TTSPL bucket, so there is nothing to choose.
  const customerLocked = isPickup && Boolean(request.matched_customer_id);
  const [customerId, setCustomerId] = useState(
    request.matched_customer_id ? String(request.matched_customer_id) : ''
  );
  const [matches, setMatches] = useState([]);
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [assignees, setAssignees] = useState([]);
  const [assignedTo, setAssignedTo] = useState(request.prefill_assigned_to ? String(request.prefill_assigned_to) : '');

  const pickupDevices = Array.isArray(request.extra?.devices) && request.extra.devices.length
    ? request.extra.devices
    : [request.device_serial].filter(Boolean);
  const visitAddress = formatVisitAddress(request.extra);
  const visitSchedule = formatVisitSchedule(request.extra);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/support/requests/${request.id}`);
        if (!cancelled) setMatches(data.customer_matches || []);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [request.id]);

  useEffect(() => {
    api.get('/support/technicians')
      .then((r) => setAssignees(r.data.technicians || []))
      .catch(() => setAssignees([]));
  }, []);

  const runSearch = async () => {
    const q = search.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const { data } = await api.get('/support/customers', { params: { search: q } });
      const items = (data.items || []).map((c) => ({
        customer_id: c.customer_id,
        name: c.contact_person_name || c.customer_name,
        company_name: c.customer_name,
        phone: c.contact_person_number || c.customer_number || c.phone,
        email: c.email,
      }));
      setMatches(items);
    } catch {
      toast.error('Customer search failed');
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!customerId) {
      toast.error('Select a customer');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/support/requests/${request.id}/convert`, {
        customer_id: Number(customerId),
        priority,
        ticket_category: isPickup ? 'pickup' : 'complaint',
        assigned_to: assignedTo ? Number(assignedTo) : undefined,
      });
      toast.success(data.message || `Ticket T-${data.ticket_id} created`);
      onConverted?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Convert failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold">{isPickup ? 'Create pickup ticket' : 'Create ticket'}</h2>
            <p className="text-xs text-slate-500">
              From {isPickup ? 'pickup ' : ''}request #{request.id}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1 mb-4">
          <p><span className="text-slate-500">Name:</span> {request.customer_name}</p>
          <p><span className="text-slate-500">Mobile:</span> {request.mobile_number}</p>
          {request.company_name ? <p><span className="text-slate-500">Company:</span> {request.company_name}</p> : null}
          {isPickup ? (
            <p>
              <span className="text-slate-500">Laptops ({pickupDevices.length}):</span>{' '}
              <span className="font-mono">{pickupDevices.join(', ') || '—'}</span>
            </p>
          ) : request.device_serial ? (
            <p><span className="text-slate-500">Device:</span> <span className="font-mono">{request.device_serial}</span></p>
          ) : null}
          {visitSchedule ? (
            <p>
              <span className="text-slate-500">Preferred visit:</span> {visitSchedule}
            </p>
          ) : null}
          {visitAddress ? (
            <p>
              <span className="text-slate-500">{visitAddress.isPickup ? 'Pickup address:' : 'Service address:'}</span>{' '}
              {visitAddress.line}
              {visitAddress.phone ? ` · POC ${visitAddress.phone}` : ''}
            </p>
          ) : null}
          {(() => {
            const reason = pickupReasonLabel(request.extra);
            if (!reason) return null;
            return (
              <p>
                <span className="text-slate-500">Pickup reason:</span>{' '}
                <strong>{reason}</strong>
              </p>
            );
          })()}
          <p className="text-slate-700 whitespace-pre-wrap pt-1">{request.issue_description}</p>
        </div>

        {isPickup ? (
          <p className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900 mb-4">
            Creating this ticket also generates the Return DC for {pickupDevices.length} laptop(s) and starts the
            normal pickup workflow.
          </p>
        ) : null}

        <label className="block text-sm mb-3">
          <span className="text-xs font-semibold text-slate-600">Assign to</span>
          <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Unassigned</option>
            {assignees.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {assigneeOptionLabel(person)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm mb-3">
          <span className="text-xs font-semibold text-slate-600">Priority</span>
          <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <div className="mb-3">
          <p className="text-xs font-semibold text-slate-600 mb-1.5">Link to customer *</p>
          {customerLocked ? (
            <div className="rounded-lg border bg-slate-50 px-3 py-2 text-sm">
              <strong>
                {request.crm_customer_display || request.matched_company_name || request.matched_customer_name}
              </strong>
              <span className="block text-xs text-slate-500">
                ID {request.matched_customer_id} · owner of the laptops on this pickup
              </span>
            </div>
          ) : matches.length ? (
            <div className="space-y-1.5 mb-2 max-h-40 overflow-y-auto">
              {matches.map((c) => (
                <label key={c.customer_id} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="customer"
                    checked={String(customerId) === String(c.customer_id)}
                    onChange={() => setCustomerId(String(c.customer_id))}
                    className="mt-1"
                  />
                  <span>
                    <strong>{c.company_name || c.name}</strong>
                    <span className="block text-xs text-slate-500">{c.phone || '—'} · ID {c.customer_id}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-700 mb-2">No auto-match by mobile. Search and select a customer.</p>
          )}
          {customerLocked ? null : (
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Search customer name / phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
              />
              <button type="button" onClick={runSearch} disabled={searching} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" disabled={busy || !customerId} onClick={submit} className="px-4 py-2 text-sm bg-[#534AB7] text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            {isPickup ? 'Create pickup ticket' : 'Create ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({ request, onClose, onConvert, onReject, canAct }) {
  if (!request) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-md bg-white shadow-xl flex flex-col max-h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Request #{request.id}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusTone(request.status)}`}>
              {statusLabel(request.status)}
            </span>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
              request.request_type === 'pickup' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'
            }`}>
              {request.request_type === 'pickup' ? 'Pickup' : 'Complaint'}
            </span>
          </div>
          <p><span className="text-slate-500">CRM customer:</span>{' '}
            <strong>{request.crm_customer_display || request.matched_company_name || request.matched_customer_name || '—'}</strong>
            {request.matched_customer_id ? ` (ID ${request.matched_customer_id})` : ''}
          </p>
          <p><span className="text-slate-500">Submitted by:</span> {request.customer_name}</p>
          <p><span className="text-slate-500">Mobile:</span> {request.mobile_number}</p>
          <p><span className="text-slate-500">Company (form):</span> {request.company_name || '—'}</p>
          <p><span className="text-slate-500">Device:</span> {request.device_serial || '—'}</p>
          {Array.isArray(request.extra?.devices) && request.extra.devices.length > 1 ? (
            <p><span className="text-slate-500">Laptops:</span> {request.extra.devices.join(', ')}</p>
          ) : null}
          {(() => {
            const schedule = formatVisitSchedule(request.extra);
            if (!schedule) return null;
            return (
              <p>
                <span className="text-slate-500">Preferred visit:</span> {schedule}
              </p>
            );
          })()}
          {(() => {
            const addr = formatVisitAddress(request.extra);
            if (!addr) return null;
            return (
              <p>
                <span className="text-slate-500">{addr.isPickup ? 'Pickup:' : 'Service address:'}</span>{' '}
                {addr.line}
                {addr.phone ? ` · POC ${addr.phone}` : ''}
              </p>
            );
          })()}
          {(() => {
            const reason = pickupReasonLabel(request.extra);
            if (!reason) return null;
            return (
              <p>
                <span className="text-slate-500">Pickup reason:</span>{' '}
                <strong>{reason}</strong>
                {request.extra?.pickup_reason_type === 'other' && request.extra?.pickup_reason_label ? (
                  <span className="text-slate-500"> ({request.extra.pickup_reason_label})</span>
                ) : null}
              </p>
            );
          })()}
          <p><span className="text-slate-500">Submitted:</span> {formatWhen(request.created_at)}</p>
          <div>
            <p className="text-slate-500 mb-1">{request.request_type === 'pickup' ? 'Details' : 'Issue'}</p>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 border p-3">{request.issue_description}</p>
          </div>
          {request.notes ? (
            <div>
              <p className="text-slate-500 mb-1">Notes / reject reason</p>
              <p className="whitespace-pre-wrap rounded-lg bg-rose-50 border border-rose-100 p-3 text-rose-900">{request.notes}</p>
            </div>
          ) : null}
          {request.ticket_id ? (
            <p>
              Ticket:{' '}
              <Link className="text-indigo-700 underline" to={`/support/tickets/${request.ticket_id}`}>
                T-{request.ticket_id}
              </Link>
            </p>
          ) : null}
        </div>
        {canAct && canActOnRequest(request.status) ? (
          <div className="border-t p-4 flex gap-2">
            <button
              type="button"
              onClick={() => onReject(request)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 px-4 py-2.5 text-sm font-semibold hover:bg-rose-100"
            >
              <Ban className="w-4 h-4" /> Reject
            </button>
            <button
              type="button"
              onClick={() => onConvert(request)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#534AB7] text-white px-4 py-2.5 text-sm font-semibold"
            >
              <Ticket className="w-4 h-4" /> Create ticket
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function SupportRequestsPage() {
  const { user } = useAuth();
  const canAct = isSupportLead(user);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState(null);
  const [convertReq, setConvertReq] = useState(null);
  const [rejectReq, setRejectReq] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  const publicUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/support/request';
    return `${window.location.origin}/support/request`;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/support/requests', {
        params: {
          status: status || 'all',
          q: q || undefined,
          from: from || undefined,
          to: to || undefined,
          limit: 100,
        },
      });
      setRows((data.requests || []).map(normalizeRequestRow));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, q, from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canAct) return;
    api.get('/support/technicians')
      .then((r) => setAssignees(r.data.technicians || []))
      .catch(() => setAssignees([]));
  }, [canAct]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(publicUrl, { width: 280, margin: 2 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [publicUrl]);

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = 'rentfoxxy-support-qr.png';
    a.click();
  };

  return (
    <div className="p-4 max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Support Requests</h1>
          <p className="text-sm text-slate-500">QR / public form submissions awaiting review</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowQr(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50"
          >
            <QrCode className="w-4 h-4" /> QR code
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end bg-white border rounded-xl p-3">
        <label className="text-sm">
          <span className="text-xs text-slate-500 block">Status</span>
          <select className="border rounded-lg px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="converted">Converted</option>
            <option value="dismissed">Rejected</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm flex-1 min-w-[160px]">
          <span className="text-xs text-slate-500 block">Search</span>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile, issue…" />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-500 block">From</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-slate-500 block">To</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" onClick={load} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg">Apply</button>
      </div>

      <div className="bg-white border rounded-xl">
        {loading ? (
          <div className="p-10 text-center text-slate-500 inline-flex items-center gap-2 justify-center w-full">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">No requests found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">CRM customer</th>
                  <th className="px-3 py-2">Submitted by</th>
                  <th className="px-3 py-2">Mobile</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Reason type</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">TTSPL</th>
                  <th className="px-3 py-2">Issue / remarks</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-2 text-slate-500">{r.id}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {r.crm_customer_display || r.matched_company_name || r.matched_customer_name || '—'}
                      </div>
                      {r.matched_customer_id ? (
                        <div className="text-xs text-slate-400">ID {r.matched_customer_id}</div>
                      ) : (
                        <div className="text-xs text-amber-600">No customer linked</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.customer_name}</div>
                      {r.company_name && r.company_name !== r.crm_customer_display ? (
                        <div className="text-xs text-slate-500">{r.company_name}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.mobile_number}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        r.request_type === 'pickup' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {r.request_type === 'pickup' ? 'Pickup' : 'Complaint'}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[140px] whitespace-nowrap">
                      {pickupReasonTypeLabel(r.extra) || '—'}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <p className="line-clamp-3 text-slate-700">
                        {pickupReasonDetail(r.extra, r.issue_description, r.request_type) || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {r.device_serial || '—'}
                      {Array.isArray(r.extra?.devices) && r.extra.devices.length > 1
                        ? ` +${r.extra.devices.length - 1}`
                        : ''}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <p className="line-clamp-2 text-slate-700">
                        {pickupTableRemarks(r)}
                      </p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{formatWhen(r.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusTone(r.status)}`}>
                        {statusLabel(r.status)}
                      </span>
                      {r.ticket_id ? (
                        <Link to={`/support/tickets/${r.ticket_id}`} className="block text-xs text-indigo-700 mt-1 hover:underline">
                          T-{r.ticket_id}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button type="button" onClick={() => setDetail(r)} className="text-xs text-slate-700 hover:underline inline-flex items-center gap-1 mr-2">
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      {canAct && canActOnRequest(r.status) ? (
                        <>
                          <button type="button" onClick={() => setConvertReq(r)} className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1 mr-2">
                            <Ticket className="w-3.5 h-3.5" /> Create ticket
                          </button>
                          <select
                            className="text-xs border rounded px-1 py-0.5 max-w-[140px] mr-2"
                            defaultValue=""
                            onChange={(e) => {
                              const value = e.target.value;
                              e.target.value = '';
                              if (!value) return;
                              setConvertReq({ ...r, prefill_assigned_to: value });
                            }}
                          >
                            <option value="">Assign…</option>
                            {assignees.map((person) => (
                              <option key={person.user_id} value={person.user_id}>
                                {assigneeOptionLabel(person)}
                              </option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setRejectReq(r)} className="text-xs text-rose-700 hover:underline inline-flex items-center gap-1">
                            <Ban className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailDrawer
        request={detail}
        onClose={() => setDetail(null)}
        canAct={canAct}
        onConvert={(r) => { setDetail(null); setConvertReq(r); }}
        onReject={(r) => { setDetail(null); setRejectReq(r); }}
      />

      {convertReq ? (
        <ConvertModal
          request={convertReq}
          onClose={() => setConvertReq(null)}
          onConverted={() => load()}
        />
      ) : null}

      {rejectReq ? (
        <RejectModal
          request={rejectReq}
          onClose={() => setRejectReq(null)}
          onRejected={() => load()}
        />
      ) : null}

      {showQr ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setShowQr(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <h2 className="font-semibold mb-1">Support QR code</h2>
            <p className="text-xs text-slate-500 mb-4 break-all">{publicUrl}</p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Support QR" className="mx-auto w-56 h-56" />
            ) : (
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
            )}
            <div className="flex gap-2 justify-center mt-4">
              <button type="button" onClick={downloadQr} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg">
                <Download className="w-4 h-4" /> Download PNG
              </button>
              <button type="button" onClick={() => setShowQr(false)} className="px-4 py-2 text-sm border rounded-lg">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
