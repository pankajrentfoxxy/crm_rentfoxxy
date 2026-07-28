import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDateTime } from '../salesPipelineUtils';
import { uploadSaleDcCompliance, sendAccountsDcMail } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';

function docUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export default function SaleDcCompliancePanel({
  dcNumber,
  saleCompliance,
  totals,
  onReload,
  isSuperAdmin,
}) {
  const compliance = saleCompliance || {};
  const needsEway = compliance.requires_eway_bill;
  const grandTotal = compliance.grand_total ?? totals?.grand_total;
  const canUpload = compliance.can_upload_compliance ?? isSuperAdmin;
  const canSendMail = compliance.can_send_accounts_mail ?? isSuperAdmin;
  const dispatchMailConfigured = compliance.dispatch_mail_configured === true;
  const accountsEmail = compliance.accounts_email || 'accounts@truetechservices.in';
  const dispatchFrom = compliance.dispatch_mail_from;

  const [einvoiceNumber, setEinvoiceNumber] = useState(compliance.einvoice_number || '');
  const [ewayNumber, setEwayNumber] = useState(compliance.eway_bill_number || '');
  const [einvoiceFile, setEinvoiceFile] = useState(null);
  const [ewayFile, setEwayFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sendingMail, setSendingMail] = useState(false);

  const handleSendAccountsMail = async () => {
    if (!dispatchMailConfigured) {
      toast.error('Dispatch mail is not configured on the server (DISPATCH_SMTP_*)');
      return;
    }
    if (!window.confirm(`Send E-Invoice request to ${accountsEmail}${dispatchFrom ? ` from ${dispatchFrom}` : ''}?`)) return;
    setSendingMail(true);
    try {
      const res = await sendAccountsDcMail(dcNumber);
      toast.success(res.data?.message || 'Mail sent to accounts');
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send mail');
    } finally {
      setSendingMail(false);
    }
  };

  const submit = async () => {
    if (!einvoiceNumber.trim() && !compliance.einvoice_complete) {
      toast.error('E-Invoice number is required');
      return;
    }
    if (!einvoiceFile && !compliance.einvoice_pdf_path) {
      toast.error('E-Invoice PDF or image is required');
      return;
    }
    if (needsEway) {
      if (!ewayNumber.trim() && !compliance.eway_bill_number) {
        toast.error('E-Way Bill number is required — DC value exceeds ₹50,000');
        return;
      }
      if (!ewayFile && !compliance.eway_bill_pdf_path) {
        toast.error('E-Way Bill PDF or image is required');
        return;
      }
    }

    const fd = new FormData();
    if (einvoiceNumber.trim()) fd.append('einvoice_number', einvoiceNumber.trim());
    if (needsEway && ewayNumber.trim()) fd.append('eway_bill_number', ewayNumber.trim());
    if (einvoiceFile) fd.append('einvoice_pdf', einvoiceFile);
    if (needsEway && ewayFile) fd.append('eway_bill_pdf', ewayFile);

    setSaving(true);
    try {
      const res = await uploadSaleDcCompliance(dcNumber, fd);
      toast.success(res.data?.message || 'Documents saved');
      setEinvoiceFile(null);
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
      <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-950">
        <p className="font-semibold">Sale DC — E-Invoice required</p>
        <p className="mt-1">
          DC value: <strong>{formatCurrency(grandTotal)}</strong>
          {needsEway
            ? ' — E-Way Bill is mandatory (above ₹50,000).'
            : ' — E-Way Bill is not required for this DC.'}
        </p>
        {!compliance.einvoice_complete && (
          <p className="mt-2 text-indigo-800">
            The DC PDF is hidden from the team until E-Invoice is uploaded
            {isSuperAdmin ? ' (super admin can still download).' : '.'}
            {canUpload && ' Dispatch and Accounts can upload documents below.'}
          </p>
        )}
        {compliance.einvoice_complete && !compliance.compliance_complete && needsEway && (
          <p className="mt-2 text-amber-800">E-Way Bill still required — DC PDF is available after E-Invoice upload.</p>
        )}
        {compliance.einvoice_complete && compliance.can_download_pdf && (
          <p className="mt-2 text-emerald-800 font-medium">DC PDF is now available to download on the Details tab.</p>
        )}
        {compliance.compliance_complete && (
          <p className="mt-2 text-emerald-800 font-medium">All required documents are on file.</p>
        )}
      </div>

      {canSendMail && (
        <section className="bg-white border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-900">Notify Accounts</h3>
          <p className="text-sm text-gray-600">
            Send E-Invoice request to <strong>{accountsEmail}</strong>
            {dispatchFrom ? <> from <strong>{dispatchFrom}</strong> (dispatch mail)</> : ' using the dispatch mail account.'}
            {' '}DC PDF will be attached. Mail is <strong>not</strong> sent automatically when the DC is created.
          </p>
          {compliance.accounts_notified_at && (
            <p className="text-xs text-emerald-700">
              Last sent: {formatDateTime(compliance.accounts_notified_at)}
            </p>
          )}
          {!dispatchMailConfigured && (
            <p className="text-xs text-amber-700">Dispatch SMTP is not configured — ask admin to set DISPATCH_SMTP_* in server .env.</p>
          )}
          <button
            type="button"
            disabled={sendingMail || !dispatchMailConfigured}
            onClick={handleSendAccountsMail}
            className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
          >
            {sendingMail ? 'Sending…' : compliance.accounts_notified_at ? 'Resend mail to Accounts' : 'Send mail to Accounts'}
          </button>
        </section>
      )}

      {compliance.einvoice_complete && (
        <section className="bg-white border rounded-xl p-5 text-sm space-y-2">
          <h3 className="font-semibold">Uploaded documents</h3>
          <p><span className="text-gray-500">E-Invoice:</span> {compliance.einvoice_number || '—'}</p>
          {compliance.einvoice_pdf_path && (
            <a href={docUrl(compliance.einvoice_pdf_path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              View E-Invoice file
            </a>
          )}
          {needsEway && (
            <>
              <p><span className="text-gray-500">E-Way Bill:</span> {compliance.eway_bill_number || '—'}</p>
              {compliance.eway_bill_pdf_path && (
                <a href={docUrl(compliance.eway_bill_pdf_path)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline block">
                  View E-Way Bill file
                </a>
              )}
            </>
          )}
          {compliance.einvoice_uploaded_at && (
            <p className="text-xs text-gray-500">Uploaded {formatDateTime(compliance.einvoice_uploaded_at)}</p>
          )}
          {compliance.vehicle_number && (
            <p><span className="text-gray-500">Vehicle:</span> {compliance.vehicle_number}</p>
          )}
        </section>
      )}

      {canUpload ? (
      <section className="bg-white border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">
          {compliance.einvoice_complete ? 'Update documents' : 'Upload E-Invoice / E-Way Bill'}
        </h3>
        <p className="text-xs text-gray-500">
          Dispatch and Accounts teams can upload here. After E-Invoice is saved, the DC PDF unlocks for everyone.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">E-Invoice number *</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={einvoiceNumber}
            onChange={(e) => setEinvoiceNumber(e.target.value)}
            placeholder="E-Invoice / IRN number"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">E-Invoice PDF or image *</label>
          <input
            type="file"
            accept=".pdf,image/*"
            className="w-full text-sm"
            onChange={(e) => setEinvoiceFile(e.target.files?.[0] || null)}
          />
        </div>

        {needsEway && (
          <>
            <div className="pt-2 border-t">
              <h4 className="text-sm font-semibold text-gray-800 mb-2">E-Way Bill (required)</h4>
              <div className="space-y-3">
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">E-Way Bill PDF or image *</label>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="w-full text-sm"
                    onChange={(e) => setEwayFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : compliance.einvoice_complete ? 'Update documents' : 'Submit & unlock DC PDF'}
        </button>
      </section>
      ) : (
        <section className="bg-white border rounded-xl p-5 text-sm text-gray-600">
          <p>Document upload is limited to Dispatch and Accounts teams. Contact them to upload E-Invoice{needsEway ? ' and E-Way Bill' : ''}.</p>
        </section>
      )}
    </div>
  );
}
