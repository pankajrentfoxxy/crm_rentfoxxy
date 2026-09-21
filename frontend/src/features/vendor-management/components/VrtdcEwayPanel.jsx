import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileCheck2, Send, ShieldAlert, Upload } from 'lucide-react';
import { Button } from '../../../components/ui/primitives';
import {
  downloadReturnToVendorEwayPdf,
  fetchReturnToVendorEway,
  requestReturnToVendorEway,
  saveReturnToVendorEway,
} from '../vendorManagementApi';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

/**
 * E-way Bill for a Return to Vendor consignment.
 *
 * Two audiences on one panel, because they hand off to each other and each needs
 * to see where the other has got to:
 *   - Warehouse sees the declared value, whether a bill is needed, and the
 *     button that asks Accounts for it.
 *   - Accounts sees the same figures and the form to enter the bill.
 *
 * The panel renders even when no bill is needed, stating that plainly. Saying
 * "not required, ₹30,000 is under the ₹50,000 threshold" is what stops someone
 * wondering whether the feature is broken.
 */
export default function VrtdcEwayPanel({ dcNumber, status, onChange, onState }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [num, setNum] = useState('');
  const [date, setDate] = useState('');
  const [file, setFile] = useState(null);
  const [dlBusy, setDlBusy] = useState(false);

  // The warehouse and the driver need the bill itself at the gate, not just its
  // number — without this the document Accounts uploads is write-only.
  const downloadEway = async () => {
    setDlBusy(true);
    try {
      await downloadReturnToVendorEwayPdf(dcNumber);
    } catch (err) {
      toast.error(err.message || 'Could not download the E-way Bill');
    } finally {
      setDlBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnToVendorEway(dcNumber);
      const c = res.data?.compliance || null;
      setState(c);
      onState?.(c);
      if (c?.eway_bill_number) setNum(c.eway_bill_number);
      if (c?.eway_bill_date) setDate(String(c.eway_bill_date).slice(0, 10));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not load E-way status');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [dcNumber, onState]);

  useEffect(() => { load(); }, [load]);

  const request = async () => {
    setBusy(true);
    try {
      const res = await requestReturnToVendorEway(dcNumber);
      toast.success(`Sent to ${res.data?.to || 'Accounts'}`);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!num.trim()) { toast.error('E-way Bill number is required'); return; }
    if (!file && !state?.eway_bill_pdf_path) { toast.error('Attach the E-way Bill document'); return; }
    setBusy(true);
    try {
      await saveReturnToVendorEway(dcNumber, {
        eway_bill_number: num.trim(),
        eway_bill_date: date || undefined,
        file,
      });
      toast.success('E-way Bill saved — consignment released to the gate');
      setFile(null);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not save the E-way Bill');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-slate-400">
        Loading E-way Bill status…
      </div>
    );
  }
  if (!state) return null;

  const needed = state.requires_eway_bill;
  const done = state.eway_complete;
  const missingValues = Number(state.items_missing_value) > 0;

  const tone = !needed
    ? 'border-slate-200'
    : done
      ? 'border-emerald-200 bg-emerald-50/40'
      : 'border-amber-300 bg-amber-50/50';

  return (
    <div className={`rounded-xl border ${tone} bg-white p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          {done
            ? <FileCheck2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            : <ShieldAlert className={`w-5 h-5 mt-0.5 shrink-0 ${needed ? 'text-amber-600' : 'text-slate-400'}`} />}
          <div>
            <p className="font-semibold text-slate-800">E-Way Bill</p>
            <p className="text-sm text-slate-600">
              Declared value <strong>{money(state.product_value)}</strong>
              {state.laptop_count != null ? ` across ${state.laptop_count} laptop${state.laptop_count === 1 ? '' : 's'}` : ''}
              {' · '}
              threshold {money(state.eway_threshold)}
            </p>
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap ${
          !needed ? 'bg-slate-100 text-slate-600'
            : done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
        }`}
        >
          {!needed ? 'Not required' : done ? 'Bill on file' : 'Required — not yet raised'}
        </span>
      </div>

      {missingValues && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {state.items_missing_value} laptop{state.items_missing_value === 1 ? ' has' : 's have'} no
          declared value. The total above — and so whether a bill is needed — is understated until
          every laptop is priced at dispatch.
        </p>
      )}

      {state.lock_message && (
        <p className="text-sm text-slate-700">{state.lock_message}</p>
      )}

      {done && (
        <div className="text-sm text-slate-700 rounded-lg bg-white border p-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="font-mono font-semibold">{state.eway_bill_number}</span>
            {state.eway_bill_date ? ` · dated ${String(state.eway_bill_date).slice(0, 10)}` : ''}
            {state.eway_bill_uploaded_at
              ? <span className="text-slate-500"> · recorded {String(state.eway_bill_uploaded_at).slice(0, 10)}</span>
              : null}
          </div>
          {state.eway_bill_pdf_path && (
            <Button variant="secondary" loading={dlBusy} onClick={downloadEway}>
              <Download className="w-4 h-4" /> E-Way Bill document
            </Button>
          )}
        </div>
      )}

      {/* Warehouse: ask Accounts. Only meaningful while a bill is needed and missing. */}
      {needed && !done && state.can_request_eway && (
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy} onClick={request}>
            <Send className="w-4 h-4" />
            {state.request_sent ? 'Send reminder to Accounts' : 'Send for E-way Bill'}
          </Button>
          {state.request_sent && (
            <span className="text-xs text-slate-500">
              Requested {String(state.accounts_notified_at).slice(0, 10)} · {state.accounts_email}
            </span>
          )}
          {!state.dispatch_mail_configured && (
            <span className="text-xs text-red-700">Dispatch mail is not configured — the request will fail.</span>
          )}
        </div>
      )}

      {/* Accounts: record the bill. */}
      {needed && state.can_upload_eway && status !== 'dispatched' && status !== 'completed' && (
        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Accounts — record the E-way Bill</p>
          <div className="flex flex-wrap gap-2">
            <input
              id="vrtdc-eway-number"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono flex-1 min-w-[190px]"
              placeholder="E-way Bill number"
              value={num}
              onChange={(e) => setNum(e.target.value)}
            />
            <input
              id="vrtdc-eway-date"
              type="date"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Upload className="w-4 h-4 text-slate-400" />
            <input
              id="vrtdc-eway-file"
              type="file"
              accept="application/pdf,image/*"
              className="text-sm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {state.eway_bill_pdf_path && !file && (
            <p className="text-xs text-slate-500">A document is already on file — leave blank to keep it.</p>
          )}
          <Button loading={busy} onClick={save}>Save E-way Bill</Button>
        </div>
      )}
    </div>
  );
}
