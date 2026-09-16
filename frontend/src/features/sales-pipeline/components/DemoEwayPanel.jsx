import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, formatDateTime } from '../salesPipelineUtils';
import { requestDemoEway, uploadDemoEway } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';

function docUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export default function DemoEwayPanel({
  dcNumber,
  compliance,
  onReload,
  isSuperAdmin,
}) {
  const c = compliance || {};
  const threshold = c.eway_threshold || 50000;
  const canUpload = c.can_upload_eway ?? isSuperAdmin;
  const canRequest = c.can_request_eway !== false;
  const uploaded = c.eway_complete === true;

  const [ewayNumber, setEwayNumber] = useState(c.eway_bill_number || '');
  const [ewayDate, setEwayDate] = useState(c.eway_bill_date ? String(c.eway_bill_date).slice(0, 10) : '');
  const [ewayFile, setEwayFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const handleRequest = async () => {
    if (c.dispatch_mail_configured === false) {
      toast.error('Dispatch mail is not configured on the server (DISPATCH_SMTP_*)');
      return;
    }
    const accountsEmail = c.accounts_email || 'Accounts';
    const label = c.request_sent ? 'Resend' : 'Send';
    if (!window.confirm(`${label} E-Way Bill request to ${accountsEmail}${c.dispatch_mail_from ? ` from ${c.dispatch_mail_from}` : ''}?`)) return;
    setRequesting(true);
    try {
      const res = await requestDemoEway(dcNumber);
      toast.success(res.data?.message || 'Mail sent to Accounts');
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send mail');
    } finally {
      setRequesting(false);
    }
  };

  const submit = async () => {
    if (!ewayNumber.trim() && !c.eway_bill_number) {
      toast.error('E-Way Bill number is required');
      return;
    }
    if (!ewayFile && !c.eway_bill_pdf_path) {
      toast.error('E-Way Bill document is required');
      return;
    }
    const fd = new FormData();
    if (ewayNumber.trim()) fd.append('eway_bill_number', ewayNumber.trim());
    if (ewayDate) fd.append('eway_bill_date', ewayDate);
    if (ewayFile) fd.append('eway_bill_pdf', ewayFile);
    setSaving(true);
    try {
      const res = await uploadDemoEway(dcNumber, fd);
      toast.success(res.data?.message || 'E-Way Bill Uploaded');
      setEwayFile(null);
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`p-4 border rounded-xl text-sm ${uploaded ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-amber-50 border-amber-200 text-amber-950'}`}>
        <p className="font-semibold">{uploaded ? 'E-Way Bill Uploaded' : 'E-Way Bill Required'}</p>
        <p className="mt-1">
          Asset value <strong>{formatCurrency(c.asset_value ?? c.product_value)}</strong>
          {' '}(processor + generation matrix) is above ₹{Number(threshold).toLocaleString('en-IN')}.
        </p>
        {c.billed_value != null && Number(c.billed_value) !== Number(c.asset_value ?? c.product_value) && (
          <p className="mt-1 text-xs">
            Rental / billed amount {formatCurrency(c.billed_value)} is not used for the E-Way Bill.
          </p>
        )}
        {Array.isArray(c.asset_units) && c.asset_units.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs bg-white/70 rounded-lg">
              <thead>
                <tr className="text-left text-amber-900/70">
                  <th className="px-2 py-1">TTSPL</th>
                  <th className="px-2 py-1">Serial</th>
                  <th className="px-2 py-1">Processor</th>
                  <th className="px-2 py-1">Generation</th>
                  <th className="px-2 py-1 text-right">Asset value</th>
                </tr>
              </thead>
              <tbody>
                {c.asset_units.map((u, i) => (
                  <tr key={`${u.ttspl || u.serial || i}`}>
                    <td className="px-2 py-1 font-mono">{u.ttspl || '—'}</td>
                    <td className="px-2 py-1 font-mono">{u.serial || '—'}</td>
                    <td className="px-2 py-1">{u.processor || '—'}</td>
                    <td className="px-2 py-1">{u.generation || '—'}</td>
                    <td className="px-2 py-1 text-right font-semibold">
                      {u.asset_value != null ? formatCurrency(u.asset_value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1">
          DC Download: <strong>{uploaded || canUpload ? 'Enabled' : 'Locked'}</strong>
        </p>
        {c.lock_message && !uploaded && (
          <p className="mt-1">{c.lock_message}</p>
        )}
      </div>

      {canRequest && (
        <section className="bg-white border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-900">Notify Accounts</h3>
          <p className="text-sm text-gray-600">
            Send E-Way Bill request to <strong>{c.accounts_email || 'accounts@truetechservices.in'}</strong>
            {c.dispatch_mail_from ? <> from <strong>{c.dispatch_mail_from}</strong> (dispatch mail)</> : ' using the dispatch mail account.'}
            {' '}DC PDF will be attached. Mail is <strong>not</strong> sent automatically when the DC is created.
          </p>
          {c.accounts_notified_at && (
            <p className="text-xs text-emerald-700">Last sent: {formatDateTime(c.accounts_notified_at)}</p>
          )}
          {c.dispatch_mail_configured === false && (
            <p className="text-xs text-amber-700">Dispatch SMTP is not configured — ask admin to set DISPATCH_SMTP_* in server .env.</p>
          )}
          <button
            type="button"
            disabled={requesting || c.dispatch_mail_configured === false}
            onClick={handleRequest}
            className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
          >
            {requesting ? 'Sending…' : c.request_sent ? 'Resend mail to Accounts' : 'Send mail to Accounts'}
          </button>
        </section>
      )}

      {uploaded && (
        <section className="bg-white border rounded-xl p-5 text-sm space-y-2">
          <p><span className="text-gray-500">E-Way Bill:</span> {c.eway_bill_number || '—'}</p>
          {c.eway_bill_date && <p><span className="text-gray-500">Date:</span> {formatDate(c.eway_bill_date)}</p>}
          {c.eway_bill_pdf_path && (
            <a href={docUrl(c.eway_bill_pdf_path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              View document
            </a>
          )}
          {c.eway_bill_uploaded_at && (
            <p className="text-xs text-gray-500">Uploaded {formatDateTime(c.eway_bill_uploaded_at)}</p>
          )}
        </section>
      )}

      {canUpload ? (
        <section className="bg-white border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">{uploaded ? 'Update E-Way Bill' : 'Upload E-Way Bill'}</h3>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill number *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={ewayNumber}
              onChange={(e) => setEwayNumber(e.target.value)}
              placeholder="E-Way Bill number"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill date</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={ewayDate}
              onChange={(e) => setEwayDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill document *</label>
            <input
              type="file"
              accept=".pdf,image/*"
              className="w-full text-sm"
              onChange={(e) => setEwayFile(e.target.files?.[0] || null)}
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : uploaded ? 'Update E-Way Bill' : 'Save & unlock DC PDF'}
          </button>
        </section>
      ) : (
        <section className="bg-white border rounded-xl p-5 text-sm text-gray-600">
          Accounts will upload the E-Way Bill. After it is saved, DC download unlocks.
        </section>
      )}
    </div>
  );
}
