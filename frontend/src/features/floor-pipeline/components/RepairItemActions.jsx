import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { decideReplacement, markVendorKept, previewVendorKept, startReplacementCheck } from '../vendorRepairApi';
import { issueTypeLabel } from '../repairIssueTypes';

const msg = (e, f) => e?.response?.data?.message || e?.message || f;
const pretty = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const ymdOf = (v) => (v ? new Intl.DateTimeFormat('en-CA').format(new Date(v)) : '');

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto text-sm">
        <h3 className="font-semibold">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 pt-1">{footer}</div>
      </div>
    </div>
  );
}

/** What this laptop's rent / replacement state is, in a line or two. */
export function RepairItemRentLines({ item }) {
  const lines = [];
  if (item.issue_type) lines.push(<p key="i" className="text-slate-700">Issue: {issueTypeLabel(item.issue_type)}</p>);
  if (item.rent_paused_from && !item.rent_resumed_on && !['vendor_kept', 'replacement_received'].includes(item.item_status)) {
    lines.push(<p key="p" className="text-orange-700">Rent stopped from {pretty(ymdOf(item.rent_paused_from))}</p>);
  }
  if (item.rent_resumed_on) lines.push(<p key="r" className="text-emerald-700">Rent resumed {pretty(ymdOf(item.rent_resumed_on))}</p>);
  if (item.item_status === 'replacement_pending') {
    const p = item.replacement_proposed || {};
    lines.push(<p key="a" className="text-amber-700 font-semibold">Replacement waiting for Accounts approval — {[p.brand, p.model].filter(Boolean).join(' ') || '—'} · {p.serial_number || '—'}</p>);
  }
  if (item.replacement_approval_status === 'approved' && item.item_status === 'gate_received') {
    lines.push(<p key="ok" className="text-emerald-700 font-semibold">Replacement approved — receive it now</p>);
  }
  if (item.replacement_config_result && item.item_status === 'gate_received' && item.replacement_approval_status !== 'approved') {
    lines.push(
      <p key="c" className={item.replacement_config_result.configurationMatched ? 'text-emerald-700' : 'text-amber-700'}>
        Replacement check: {item.replacement_config_result.configurationMatched ? 'same model & config' : 'different — will need approval'}
        {item.replacement_captured_serial ? ` · serial ${item.replacement_captured_serial}` : ' · serial not read yet'}
      </p>
    );
  }
  if ((item.replacement_rejections || []).length) {
    lines.push(<p key="rj" className="text-rose-700">{item.replacement_rejections.length} replacement(s) not accepted and handed back</p>);
  }
  if (item.item_status === 'vendor_kept') {
    lines.push(<p key="k" className="text-slate-700">Vendor kept it (not repairable){item.vendor_kept_reason ? ` — ${item.vendor_kept_reason}` : ''}</p>);
  }
  return lines.length ? <div className="mt-1 space-y-0.5">{lines}</div> : null;
}

/**
 * Buttons on one laptop of a repair challan:
 *  - It's a replacement   → access number for the replacement check script
 *  - Vendor keeps it      → confirmation mail + returned to vendor
 *  - Approve / reject     → Accounts / the named approver, when waiting
 */
export default function RepairItemActions({ dc, item, canWarehouse, canDecide, onReload }) {
  const [busy, setBusy] = useState('');
  const [kept, setKept] = useState(null); // { reason, preview }
  const [decide, setDecide] = useState(null); // { approve, note }

  const withVendor = item.item_status === 'dispatched';
  const canCheck = canWarehouse && ['dispatched', 'gate_received'].includes(item.item_status)
    && item.replacement_approval_status !== 'approved' && !dc.gate_legacy;

  const replacementCheck = async () => {
    const arrived = item.item_status === 'dispatched'
      ? window.confirm(`Has the vendor's replacement for ${item.ttspl_id} arrived at our warehouse? This records its arrival today (rent on it starts from today).`)
      : true;
    if (!arrived) return;
    setBusy('check');
    try {
      const { data } = await startReplacementCheck(dc.dc_number, item.id);
      toast.success(`Replacement check: boot the replacement and run the vendor-return script with access number ${data.access_number}`, { duration: 12000 });
      onReload?.();
    } catch (e) { toast.error(msg(e, 'Could not start the check')); } finally { setBusy(''); }
  };

  const loadKeptPreview = async () => {
    if (String(kept?.reason || '').trim().length < 3) { toast.error('Say what the vendor told us'); return; }
    setBusy('kp');
    try {
      const { data } = await previewVendorKept(dc.dc_number, { item_id: item.id, reason: kept.reason });
      setKept((k) => ({ ...k, preview: data.preview }));
    } catch (e) { toast.error(msg(e, 'Could not build the mail')); } finally { setBusy(''); }
  };

  const confirmKept = async () => {
    setBusy('k');
    try {
      await markVendorKept(dc.dc_number, { item_id: item.id, reason: kept.reason });
      toast.success('Mailed the vendor — laptop recorded as returned to them');
      setKept(null);
      onReload?.();
    } catch (e) { toast.error(msg(e, 'Could not mark it')); } finally { setBusy(''); }
  };

  const submitDecision = async () => {
    if (!decide.approve && String(decide.note || '').trim().length < 3) { toast.error('Give the reason — it goes to the vendor'); return; }
    setBusy('d');
    try {
      const { data } = await decideReplacement(dc.dc_number, { item_id: item.id, approve: decide.approve, note: decide.note });
      toast.success(data.message);
      setDecide(null);
      onReload?.();
    } catch (e) { toast.error(msg(e, 'Could not save the decision')); } finally { setBusy(''); }
  };

  const p = item.replacement_proposed || {};
  const checks = item.replacement_config_result?.checks || [];

  return (
    <div className="flex flex-col gap-1 print:hidden">
      {canCheck ? (
        <button type="button" disabled={busy === 'check'} onClick={replacementCheck} className="px-2 py-1 border border-purple-300 text-purple-800 rounded text-[11px] bg-white">
          It's a replacement
        </button>
      ) : null}
      {canWarehouse && withVendor ? (
        <button type="button" onClick={() => setKept({ reason: '' })} className="px-2 py-1 border border-slate-300 rounded text-[11px] bg-white">
          Vendor keeps it
        </button>
      ) : null}
      {canDecide && item.item_status === 'replacement_pending' ? (
        <>
          <button type="button" onClick={() => setDecide({ approve: true, note: '' })} className="px-2 py-1 bg-emerald-700 text-white rounded text-[11px]">Approve replacement</button>
          <button type="button" onClick={() => setDecide({ approve: false, note: '' })} className="px-2 py-1 bg-rose-700 text-white rounded text-[11px]">Reject</button>
        </>
      ) : null}

      {kept ? (
        <Modal
          title={`Vendor keeps ${item.ttspl_id}`}
          onClose={() => setKept(null)}
          footer={(
            <>
              <button type="button" onClick={() => setKept(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
              {kept.preview ? (
                <button type="button" disabled={busy === 'k'} onClick={confirmKept} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50">
                  {busy === 'k' ? 'Sending…' : 'Send mail and mark returned'}
                </button>
              ) : (
                <button type="button" disabled={busy === 'kp'} onClick={loadKeptPreview} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50">Preview the mail</button>
              )}
            </>
          )}
        >
          <p className="text-slate-600">
            The vendor says they can't repair it and will keep it. The vendor gets a confirmation mail, the laptop is recorded as
            returned to them, its floor ticket closes and a draft debit note is made for Accounts.
          </p>
          <label className="block text-xs font-semibold">What the vendor told us *
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" rows={3} value={kept.reason} onChange={(e) => setKept({ reason: e.target.value, preview: null })} />
          </label>
          {kept.preview ? (
            <div className="border rounded-lg p-2 text-xs space-y-1">
              <p><span className="text-slate-500">To:</span> {kept.preview.to || '—'} · <span className="text-slate-500">CC:</span> {kept.preview.cc}</p>
              <p><span className="text-slate-500">Rent ends:</span> {pretty(kept.preview.rent_end_date)}</p>
              <iframe title="Vendor keeps mail" sandbox="" srcDoc={kept.preview.html} className="w-full border rounded" style={{ height: 300 }} />
            </div>
          ) : null}
        </Modal>
      ) : null}

      {decide ? (
        <Modal
          title={decide.approve ? 'Approve this replacement?' : 'Reject this replacement?'}
          onClose={() => setDecide(null)}
          footer={(
            <>
              <button type="button" onClick={() => setDecide(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" disabled={busy === 'd'} onClick={submitDecision} className={`px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${decide.approve ? 'bg-emerald-700' : 'bg-rose-700'}`}>
                {decide.approve ? 'Approve' : 'Reject and mail the vendor'}
              </button>
            </>
          )}
        >
          <div className="text-xs space-y-1">
            <p><span className="text-slate-500">We sent:</span> {item.configuration} · {item.serial_number}</p>
            <p><span className="text-slate-500">They sent:</span> {[p.brand, p.model, p.processor, p.generation, p.ram, p.ssd].filter(Boolean).join(' · ') || '—'} · {p.serial_number || '—'}</p>
            {p.condition === 'not_on' ? <p className="text-rose-700">It does not power on — its configuration could not be read.</p> : null}
            {checks.filter((c) => c.matched === false).map((c) => (
              <p key={c.field} className="text-amber-800">{c.label || c.field}: expected {c.expected || '—'}, found {c.actual || '—'}</p>
            ))}
          </div>
          <p className="text-slate-600 text-xs">
            {decide.approve
              ? 'It becomes the replacement at the original laptop’s monthly rent, billed from the day it reached our gate. The warehouse then receives it.'
              : 'The vendor is mailed that it is not accepted; it is handed back and the original stays with the vendor with rent stopped.'}
          </p>
          <label className="block text-xs font-semibold">{decide.approve ? 'Note (optional)' : 'Reason (goes to the vendor) *'}
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" rows={2} value={decide.note} onChange={(e) => setDecide((d) => ({ ...d, note: e.target.value }))} />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
