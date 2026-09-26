import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Mail, FileText } from 'lucide-react';
import {
  downloadRepairRequestPdf, fetchRepairMailPreview, sendRepairMail, updateRepairRequestDetails,
} from '../vendorRepairApi';
import { addDaysYmd, todayIst } from '../repairIssueTypes';

const pretty = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const ymdOf = (v) => (v ? new Intl.DateTimeFormat('en-CA').format(new Date(v)) : '');
const msg = (e, f) => e?.response?.data?.message || e?.message || f;

/**
 * Repair challan → mail the vendor (claude/carret-vendor-repair.md).
 * Sending mails the vendor with the repair-request PDF and stops rent from the
 * stop date on the laptops rented from this vendor. Required before the
 * challan can be signed for dispatch.
 */
export default function RepairRentPanel({ dc, canAct, onReload }) {
  const [preview, setPreview] = useState(null);
  const [showMail, setShowMail] = useState(false);
  const [busy, setBusy] = useState('');
  const [stop, setStop] = useState('');
  const mailed = Boolean(dc.vendor_notified_at);
  const open = ['draft', 'dispatch_ready'].includes(dc.status);
  const stopYmd = ymdOf(dc.rent_stop_date);

  useEffect(() => { setStop(stopYmd); }, [stopYmd]);
  useEffect(() => {
    if (!dc.rent_stop_date || mailed) { setPreview(null); return; }
    fetchRepairMailPreview(dc.dc_number).then(({ data }) => setPreview(data.preview)).catch(() => setPreview(null));
  }, [dc.dc_number, dc.rent_stop_date, dc.updated_at, mailed]);

  if (!dc.rent_stop_date && !mailed) return null;
  const today = todayIst();
  const passed = stopYmd && stopYmd < today && !mailed;

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); onReload?.(); } catch (e) { toast.error(msg(e, 'That did not work')); } finally { setBusy(''); }
  };

  return (
    <div className={`rounded-xl border p-4 text-sm space-y-3 print:hidden ${mailed ? 'border-emerald-200 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Vendor mail & rent</h3>
        <button type="button" disabled={busy === 'pdf'} onClick={() => run('pdf', () => downloadRepairRequestPdf(dc.dc_number))} className="inline-flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs bg-white">
          <FileText className="w-3.5 h-3.5" /> Repair request PDF
        </button>
      </div>

      {mailed ? (
        <p className="text-emerald-900">
          Mailed to <strong>{dc.notify_to}</strong> on {pretty(ymdOf(dc.vendor_notified_at))}. Rent on the laptops rented from this vendor
          stopped from <strong>{pretty(stopYmd)}</strong>; each one's rent starts again the day it (or its replacement) is back at our gate.
          {dc.cancel_mail_sent_at ? ' The challan was cancelled and the vendor told — rent continued as before.' : ''}
        </p>
      ) : (
        <>
          <p className="text-orange-900">
            Not mailed yet. Mailing the vendor stops rent from the date below on {preview?.paused_laptops ?? '…'} laptop(s) rented from them,
            and must be done before the challan can be signed for dispatch.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block font-semibold text-slate-700 mb-1">Rent stops from</span>
              <input type="date" min={today} max={addDaysYmd(today, 30)} className="border rounded-lg px-2 py-1.5 bg-white" value={stop} disabled={!canAct || !open} onChange={(e) => setStop(e.target.value)} />
            </label>
            {canAct && open && stop && stop !== stopYmd ? (
              <button type="button" disabled={busy === 'date'} onClick={() => run('date', () => updateRepairRequestDetails(dc.dc_number, { rent_stop_date: stop }), 'Rent stop date changed')} className="px-3 py-1.5 border rounded-lg text-xs bg-white">
                Save date
              </button>
            ) : null}
            <span className="text-[11px] text-slate-600">Billed up to {pretty(stop ? addDaysYmd(stop, -1) : '')}.</span>
          </div>
          {passed ? <p className="text-rose-700 text-xs font-semibold">This date has passed — change it to today or later before mailing.</p> : null}
          {preview && !preview.to ? <p className="text-rose-700 text-xs font-semibold">The vendor has no email address — add it on the vendor record.</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowMail((v) => !v)} className="px-3 py-1.5 border rounded-lg text-xs bg-white">
              {showMail ? 'Hide the mail' : 'Preview the mail'}
            </button>
            {canAct && open ? (
              <button
                type="button"
                disabled={busy === 'send' || passed || !preview?.to || stop !== stopYmd}
                onClick={() => {
                  if (!window.confirm(`Mail ${preview?.to} now? Rent stops from ${pretty(stopYmd)} on ${preview?.paused_laptops || 0} laptop(s).`)) return;
                  run('send', () => sendRepairMail(dc.dc_number), 'Mailed — rent stopped from the date shown');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Mail the vendor
              </button>
            ) : null}
          </div>
          {dc.notify_error ? <p className="text-rose-700 text-xs">Last attempt failed: {dc.notify_error}</p> : null}
          {showMail && preview ? (
            <div className="bg-white border rounded-lg p-3 space-y-1 text-xs">
              <p><span className="text-slate-500">To:</span> {preview.to || '—'}</p>
              <p><span className="text-slate-500">CC:</span> {preview.cc}</p>
              <p><span className="text-slate-500">Subject:</span> {preview.subject}</p>
              <p><span className="text-slate-500">Attached:</span> Repair request PDF</p>
              <iframe title="Repair mail preview" sandbox="" srcDoc={preview.html} className="w-full border rounded mt-2" style={{ height: 460 }} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
