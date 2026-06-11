import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import VendorBillStatusBadge from '../components/VendorBillStatusBadge';
import { approveVendorBill, generateVendorBill, listVendorBills, markVendorBillPaid } from '../vendorBillingApi';
import api from '../../../utils/api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function VendorBillListPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ vendor_id: '', month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()) });

  useEffect(() => {
    api.get('/vendor-management/vendors', { params: { limit: 200 } })
      .then((r) => setVendors(r.data?.vendors || r.data?.rows || []))
      .catch(() => setVendors([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (status) params.status = status;
      if (vendorId) params.vendor_id = vendorId;
      const res = await listVendorBills(params);
      setRows(res.data?.bills || []);
      setSummary(res.data?.summary || {});
    } catch {
      toast.error('Failed to load bills');
    } finally {
      setLoading(false);
    }
  }, [status, vendorId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    generated: { count: summary.generated_count || 0, total: summary.generated_total || 0 },
    approved: { count: summary.approved_count || 0, total: summary.approved_total || 0 },
    paid: { count: summary.paid_count || 0, total: summary.paid_total || 0 },
  }), [summary]);

  const handleGenerate = async () => {
    try {
      await generateVendorBill({
        vendor_id: Number(genForm.vendor_id),
        month: Number(genForm.month),
        year: Number(genForm.year),
      });
      toast.success('Bill generated');
      setGenOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generate failed');
    }
  };

  const handleApprove = async (id) => {
    try {
      await approveVendorBill(id);
      toast.success('Approved');
      load();
    } catch {
      toast.error('Approve failed');
    }
  };

  const handlePaid = async (id) => {
    const ref = window.prompt('Payment reference:');
    try {
      await markVendorBillPaid(id, { payment_reference: ref || '' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Vendor Bills</h1>
          <p className="text-sm text-gray-500">VB-* series</p>
        </div>
        <PermissionGate section="vendor_billing_mgmt" action="create">
          <button type="button" onClick={() => setGenOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Generate Bill
          </button>
        </PermissionGate>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          ['Generated', stats.generated.count, stats.generated.total],
          ['Approved', stats.approved.count, stats.approved.total],
          ['Paid', stats.paid.count, stats.paid.total],
          ['Total Payable', stats.approved.count, stats.approved.total],
        ].map(([label, count, total]) => (
          <div key={label} className="bg-white border rounded-lg p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-semibold">{count}</p>
            <p className="text-xs text-gray-600">{fmt(total)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['generated', 'approved', 'paid', 'disputed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Bill #</th>
              <th className="px-4 py-3 text-left">Month</th>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">Units</th>
              <th className="px-4 py-3 text-left">Subtotal</th>
              <th className="px-4 py-3 text-left">Debit Adj</th>
              <th className="px-4 py-3 text-left">Total Payable</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No bills</td></tr>
            ) : rows.map((r) => (
              <tr key={r.bill_id}>
                <td className="px-4 py-3 font-medium">
                  <Link to={`/vendor-billing/bills/${r.bill_id}`} className="text-blue-600 hover:underline">{r.bill_number}</Link>
                </td>
                <td className="px-4 py-3">{MONTHS[r.bill_month]} {r.bill_year}</td>
                <td className="px-4 py-3">{r.vendor_name}</td>
                <td className="px-4 py-3">{r.unit_count || 0}</td>
                <td className="px-4 py-3">{fmt(r.subtotal)}</td>
                <td className="px-4 py-3">{fmt(r.debit_note_adjustment)}</td>
                <td className="px-4 py-3 font-medium">{fmt(r.total_payable)}</td>
                <td className="px-4 py-3"><VendorBillStatusBadge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Link to={`/vendor-billing/bills/${r.bill_id}`} className="text-xs text-blue-600">View</Link>
                    {r.status === 'generated' && (
                      <PermissionGate section="vendor_billing_mgmt" action="edit">
                        <button type="button" onClick={() => handleApprove(r.bill_id)} className="text-xs text-blue-600">Approve</button>
                      </PermissionGate>
                    )}
                    {r.status === 'approved' && (
                      <PermissionGate section="vendor_billing_mgmt" action="edit">
                        <button type="button" onClick={() => handlePaid(r.bill_id)} className="text-xs text-green-600">Paid</button>
                      </PermissionGate>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setGenOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3">
            <h3 className="font-semibold">Generate Vendor Bill</h3>
            <select value={genForm.vendor_id} onChange={(e) => setGenForm((f) => ({ ...f, vendor_id: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Vendor…</option>
              {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={genForm.month} onChange={(e) => setGenForm((f) => ({ ...f, month: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
                {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" value={genForm.year} onChange={(e) => setGenForm((f) => ({ ...f, year: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setGenOpen(false)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
              <button type="button" onClick={handleGenerate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
