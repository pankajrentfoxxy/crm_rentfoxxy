import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, formatDateTime } from '../../sales-pipeline/salesPipelineUtils';
import { sendAccountsVrdcEwayMail, uploadVrdcEway } from '../vendorRepairApi';
import { getBackendOrigin } from '../../../utils/api';

function docUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export default function VrdcEwayPanel({
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
  const [sendingMail, setSendingMail] = useState(false);

  if (!c.applies) return null;

  const handleSendMail = async () => {
    if (c.dispatch_mail_configured === false) {
      toast.error('Dispatch mail is not configured on the server (DISPATCH_SMTP_*)');
      return;
    }
    if (!window.confirm(`Send E-way Bill request to ${c.accounts_email || 'Accounts'}? The VRDC PDF will be attached.`)) return;
    setSendingMail(true);
    try {
      const res = await sendAccountsVrdcEwayMail(dcNumber);
      toast.success(res.data?.message || 'Mail sent to Accounts Team');
      onReload?.();
    } catch (err) {
      if (err.response?.status === 409) {
        toast.success(err.response?.data?.message || 'Mail to Accounts already sent');
        onReload?.();
      } else {
        toast.error(err.response?.data?.message || 'Could not send mail');
      }
    } finally {
      setSendingMail(false);
    }
  };

  const submit = async () => {
    if (!ewayNumber.trim()) {
      toast.error('E-way Bill number is required');
      return;
    }
    if (!ewayFile && !c.eway_bill_pdf_path) {
      toast.error('E-Way Bill document (image or PDF) is required');
      return;
    }
    const fd = new FormData();
    fd.append('eway_bill_number', ewayNumber.trim());
    if (ewayDate) fd.append('eway_bill_date', ewayDate);
    if (ewayFile) fd.append('eway_bill_pdf', ewayFile);
    setSaving(true);
    try {
      const res = await uploadVrdcEway(dcNumber, fd);
      toast.success(res.data?.message || 'E-way Bill saved — VRDC download enabled');
      setEwayFile(null);
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 print:hidden">
      <div className={`p-4 border rounded-xl text-sm ${uploaded ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-amber-50 border-amber-200 text-amber-950'}`}>
        <p className="font-semibold">{uploaded ? 'E-way Bill Added' : 'E-way Bill Required'}</p>
        <p className="mt-1">
          Out for Repair VRDC · declared value <strong>{formatCurrency(c.product_value)}</strong>
          {' '}is above ₹{Number(threshold).toLocaleString('en-IN')}.
        </p>
        <p className="mt-1">
          VRDC Download: <strong>{c.can_download_pdf ? (uploaded ? 'Enabled' : 'Enabled for Accounts') : 'Locked'}</strong>
        </p>
        {!uploaded && c.lock_message ? (
          <p className="mt-2 text-amber-900">{c.lock_message}</p>
        ) : null}
      </div>

      {canRequest && !uploaded && (
        <section className="bg-white border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-900">Notify Accounts</h3>
          <p className="text-sm text-gray-600">
            Send E-way Bill request to <strong>{c.accounts_email || 'Accounts'}</strong>
            {c.dispatch_mail_from ? <> from <strong>{c.dispatch_mail_from}</strong></> : null}.
            {' '}The generated VRDC PDF is attached automatically.
          </p>
          {c.accounts_notified_at && (
            <p className="text-xs text-emerald-700">Sent {formatDateTime(c.accounts_notified_at)}</p>
          )}
          {c.dispatch_mail_configured === false && (
            <p className="text-xs text-amber-700">Dispatch SMTP is not configured — ask admin to set DISPATCH_SMTP_*.</p>
          )}
          <button
            type="button"
            disabled={sendingMail || c.dispatch_mail_configured === false}
            onClick={handleSendMail}
            className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
          >
            {sendingMail ? 'Sending…' : c.request_sent ? 'Resend Mail to Accounts' : 'Send Mail to Accounts'}
          </button>
        </section>
      )}

      {uploaded && (
        <section className="bg-white border rounded-xl p-5 text-sm space-y-2">
          <p><span className="text-gray-500">E-way Bill:</span> {c.eway_bill_number || '—'}</p>
          {c.eway_bill_date && <p><span className="text-gray-500">Date:</span> {formatDate(c.eway_bill_date)}</p>}
          {c.eway_bill_pdf_path && (
            <a href={docUrl(c.eway_bill_pdf_path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              View E-Way Bill document
            </a>
          )}
          {c.eway_bill_uploaded_at && (
            <p className="text-xs text-gray-500">Added {formatDateTime(c.eway_bill_uploaded_at)}</p>
          )}
        </section>
      )}

      {canUpload ? (
        <section className="bg-white border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">{uploaded ? 'Update E-way Bill' : 'Enter E-way Bill (Accounts)'}</h3>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-way Bill number *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase"
              value={ewayNumber}
              onChange={(e) => setEwayNumber(e.target.value.toUpperCase())}
              placeholder="E-way Bill number"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-way Bill date</label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={ewayDate}
              onChange={(e) => setEwayDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-800 mb-1">
              Upload E-Way Bill image / PDF {c.eway_bill_pdf_path ? '(optional replace)' : '*'}
            </label>
            <label className="flex flex-col items-start gap-2 w-full border-2 border-dashed border-blue-300 bg-blue-50 rounded-lg px-4 py-3 cursor-pointer hover:bg-blue-100">
              <span className="text-sm font-semibold text-blue-800">Choose image or PDF</span>
              <span className="text-xs text-blue-700">
                {ewayFile ? ewayFile.name : (c.eway_bill_pdf_path ? 'A document is already saved. Pick a new file to replace it.' : 'JPG, PNG, or PDF — required as proof')}
              </span>
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp,image/gif"
                className="text-sm"
                onChange={(e) => setEwayFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : uploaded ? 'Update E-way Bill' : 'Save E-way Bill & unlock VRDC PDF'}
          </button>
        </section>
      ) : !uploaded ? (
        <section className="bg-white border rounded-xl p-5 text-sm text-gray-600">
          Accounts Team will enter the E-way Bill and upload the proof document. After it is saved, VRDC download unlocks.
        </section>
      ) : null}
    </div>
  );
}
