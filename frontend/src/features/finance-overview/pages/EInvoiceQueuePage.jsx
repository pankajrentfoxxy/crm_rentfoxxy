import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { generateEInvoice, generateEWayBill, sendEInvoiceEmail } from '../../customer-billing/customerBillingApi';
import { getEinvoiceQueue } from '../financeOverviewApi';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';

export default function EInvoiceQueuePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [ewbModal, setEwbModal] = useState(null);
  const [ewbForm, setEwbForm] = useState({ transporter_name: '', vehicle_number: '', distance_km: '' });
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEinvoiceQueue();
      setRows(res.data?.queue || []);
    } catch {
      toast.error('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (dc) => {
    setSelected((s) => (s.includes(dc) ? s.filter((x) => x !== dc) : [...s, dc]));
  };

  const handleGenerate = async (dcNumber) => {
    setGenerating(true);
    try {
      const res = await generateEInvoice(dcNumber);
      toast.success(res.data.isSandbox ? `Sandbox IRN: ${res.data.irn}` : `IRN: ${res.data.irn}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleBulkGenerate = async () => {
    for (const dc of selected) {
      await handleGenerate(dc);
    }
    setSelected([]);
  };

  const handleEwb = async () => {
    if (!ewbModal) return;
    try {
      const res = await generateEWayBill(ewbModal, ewbForm);
      toast.success(`EWB: ${res.data.ewbNumber}`);
      setEwbModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'EWB failed');
    }
  };

  const handleSendEmail = async (dcNumber) => {
    try {
      await sendEInvoiceEmail(dcNumber, {});
      toast.success('Email sent');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Send failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">E-Invoice Queue</h1>
          <p className="text-sm text-gray-500">Delivered sale DCs awaiting IRN</p>
        </div>
        {selected.length > 0 && (
          <button type="button" disabled={generating} onClick={handleBulkGenerate} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
            Generate IRN for {selected.length} selected
          </button>
        )}
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 w-8" />
              <th className="px-4 py-3 text-left">DC #</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">IRN</th>
              <th className="px-4 py-3 text-left">EWB</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Queue empty</td></tr>
            ) : rows.map((r) => (
              <tr key={r.dc_number}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.includes(r.dc_number)} onChange={() => toggleSelect(r.dc_number)} />
                </td>
                <td className="px-4 py-3 font-medium">
                  <Link to={deliveryChallanDetailPath(r.dc_number)} className="text-blue-600 hover:underline">{r.dc_number}</Link>
                </td>
                <td className="px-4 py-3">{r.created_at?.slice?.(0, 10)}</td>
                <td className="px-4 py-3">{r.customer_name}</td>
                <td className="px-4 py-3 capitalize">{r.quotation_type}</td>
                <td className="px-4 py-3">₹{Number(r.amount || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3">{r.irn ? '✓' : 'Pending'}</td>
                <td className="px-4 py-3">{r.eway_bill_number ? '✓' : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {!r.irn && (
                      <button type="button" disabled={generating} onClick={() => handleGenerate(r.dc_number)} className="text-xs text-blue-600 hover:underline">Generate IRN</button>
                    )}
                    <button type="button" onClick={() => setEwbModal(r.dc_number)} className="text-xs text-gray-600 hover:underline">EWB</button>
                    {r.irn && (
                      <button type="button" onClick={() => handleSendEmail(r.dc_number)} className="text-xs text-green-600 hover:underline">Send</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ewbModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setEwbModal(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-sm">
            <h3 className="font-semibold">E-Way Bill — {ewbModal}</h3>
            <input placeholder="Transporter" value={ewbForm.transporter_name} onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Vehicle" value={ewbForm.vehicle_number} onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_number: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Distance km" type="number" value={ewbForm.distance_km} onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEwbModal(null)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleEwb} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
