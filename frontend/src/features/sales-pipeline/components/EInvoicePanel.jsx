import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { formatDateTime } from '../salesPipelineUtils';
import {
  generateEInvoice, generateEWayBill, sendEInvoiceEmail, getDcEInvoiceStatus,
} from '../../customer-billing/customerBillingApi';

export default function EInvoicePanel({ dcNumber, dcLine, customerEmail, onReload }) {
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showEwb, setShowEwb] = useState(false);
  const [ewbForm, setEwbForm] = useState({ transporter_name: '', vehicle_number: '', distance_km: '', mode_of_transport: 'road' });
  const [emailTo, setEmailTo] = useState(customerEmail || '');

  const line = dcLine || {};

  const reload = useCallback(async () => {
    if (!dcNumber) return;
    try {
      const res = await getDcEInvoiceStatus(dcNumber);
      setStatus(res.data);
    } catch {
      setStatus(null);
    }
    onReload?.();
  }, [dcNumber, onReload]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (customerEmail) setEmailTo(customerEmail);
  }, [customerEmail]);

  const irn = status?.irn || line.irn;
  const qrUrl = status?.qr_code_url || line.qr_code_url;
  const ewb = status?.eway_bill_number || line.eway_bill_number;
  const ewbValid = status?.eway_bill_valid_till || line.eway_bill_valid_till;
  const isSandbox = status?.isSandbox;

  const handleGenerateEInvoice = async () => {
    setGenerating(true);
    try {
      const res = await generateEInvoice(dcNumber);
      toast.success(res.data.isSandbox
        ? `Sandbox IRN generated: ${res.data.irn}`
        : `E-Invoice generated. IRN: ${res.data.irn}`);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'E-Invoice generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateEwb = async () => {
    try {
      const res = await generateEWayBill(dcNumber, ewbForm);
      toast.success(`E-Way Bill: ${res.data.ewbNumber}`);
      setShowEwb(false);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'E-Way Bill failed');
    }
  };

  const handleSendEmail = async () => {
    try {
      await sendEInvoiceEmail(dcNumber, { to_email: emailTo });
      toast.success('E-Invoice email sent');
      setShowEmail(false);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Send failed');
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold text-gray-900">E-Invoice</h3>
          {isSandbox && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">SANDBOX MODE</span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">IRN</dt><dd className="font-medium break-all">{irn || 'Not generated'}</dd></div>
          <div><dt className="text-gray-500">Generated At</dt><dd>{formatDateTime(status?.irn_generated_at || line.irn_generated_at)}</dd></div>
        </dl>
        {qrUrl && (
          <img src={qrUrl} alt="E-Invoice QR" className="mt-3 h-24 w-24 border rounded" />
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!irn && (
            <button type="button" disabled={generating} onClick={handleGenerateEInvoice} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {generating ? 'Generating…' : 'Generate E-Invoice'}
            </button>
          )}
          {irn && (
            <button type="button" onClick={() => setShowEmail(true)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              Send E-Invoice to Customer
            </button>
          )}
        </div>
      </section>

      <section className="bg-white border rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-3">E-Way Bill</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">EWB Number</dt><dd className="font-medium">{ewb || 'Not generated'}</dd></div>
          <div><dt className="text-gray-500">Valid Till</dt><dd>{formatDateTime(ewbValid)}</dd></div>
        </dl>
        {!ewb && (
          <button type="button" onClick={() => setShowEwb(true)} className="mt-4 px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
            Generate E-Way Bill
          </button>
        )}
      </section>

      {showEwb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setShowEwb(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-sm">
            <h3 className="font-semibold">Generate E-Way Bill</h3>
            <input placeholder="Transporter Name" value={ewbForm.transporter_name} onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Vehicle Number" value={ewbForm.vehicle_number} onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_number: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Distance (km)" type="number" value={ewbForm.distance_km} onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <select value={ewbForm.mode_of_transport} onChange={(e) => setEwbForm((f) => ({ ...f, mode_of_transport: e.target.value }))} className="w-full border rounded-lg px-3 py-2">
              <option value="road">Road</option>
              <option value="air">Air</option>
              <option value="rail">Rail</option>
              <option value="ship">Ship</option>
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowEwb(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleGenerateEwb} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Generate</button>
            </div>
          </div>
        </div>
      )}

      {showEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setShowEmail(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold mb-3">Send E-Invoice</h3>
            <label className="block text-sm text-gray-600 mb-1">To</label>
            <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-4" />
            <button type="button" onClick={handleSendEmail} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
