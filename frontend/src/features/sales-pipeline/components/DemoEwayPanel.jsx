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
    if (c.request_sent) {
      toast.success('E-Way Bill Request Sent');
      return;
    }
    if (!window.confirm(`Request E-Way Bill from ${c.accounts_email || 'Accounts'}?`)) return;
    setRequesting(true);
    try {
      const res = await requestDemoEway(dcNumber);
      toast.success(res.data?.message || 'E-Way Bill Request Sent');
      onReload?.();
    } catch (err) {
      if (err.response?.status === 409) {
        toast.success(err.response?.data?.message || 'E-Way Bill Request Sent');
        onReload?.();
      } else {
        toast.error(err.response?.data?.message || 'Could not send request');
      }
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
          New-customer demo DC · value <strong>{formatCurrency(c.product_value)}</strong>
          {' '}(exclusive of GST) is above ₹{Number(threshold).toLocaleString('en-IN')}.
        </p>
        <p className="mt-1">
          DC Download: <strong>{uploaded || isSuperAdmin ? 'Enabled' : 'Locked'}</strong>
        </p>
      </div>

      {canRequest && !uploaded && (
        <section className="bg-white border rounded-xl p-5 space-y-3">
          {c.request_sent ? (
            <p className="text-sm font-semibold text-emerald-800">E-Way Bill Request Sent</p>
          ) : (
            <button
              type="button"
              disabled={requesting || c.dispatch_mail_configured === false}
              onClick={handleRequest}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
            >
              {requesting ? 'Sending…' : 'Request E-Way Bill from Accounts'}
            </button>
          )}
          {c.accounts_notified_at && (
            <p className="text-xs text-emerald-700">Requested {formatDateTime(c.accounts_notified_at)}</p>
          )}
          {c.dispatch_mail_configured === false && (
            <p className="text-xs text-amber-700">Dispatch SMTP is not configured — ask admin to set DISPATCH_SMTP_*.</p>
          )}
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
