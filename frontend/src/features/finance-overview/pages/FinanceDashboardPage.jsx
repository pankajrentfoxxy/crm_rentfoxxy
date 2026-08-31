import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { approveCreditNote } from '../../customer-billing/customerBillingApi';
import { approveDebitNote, approveVendorBill, markVendorBillPaid } from '../../vendor-billing/vendorBillingApi';
import { getFinanceDashboard } from '../financeOverviewApi';

const PIE_COLORS = ['#94a3b8', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b'];

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function FinanceDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFinanceDashboard();
      setData(res.data);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="p-6 text-gray-500">Loading dashboard…</div>;
  }

  const ci = data.customer_invoices || {};
  const vb = data.vendor_bills || {};
  const revenueData = (data.monthly_revenue || []).map((r) => ({
    name: `${r.month}/${r.year}`,
    revenue: parseFloat(r.revenue || 0),
  }));
  const pieData = (data.invoice_status_distribution || []).map((r) => ({
    name: r.status,
    value: r.count,
  }));

  const handleApproveCn = async (id) => {
    try {
      await approveCreditNote(id);
      toast.success('Credit note approved and applied to the invoice');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const handleApproveDn = async (id) => {
    try {
      await approveDebitNote(id);
      toast.success('Debit note approved');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const handleApproveBill = async (id) => {
    try {
      await approveVendorBill(id);
      toast.success('Bill approved');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const handleBillPaid = async (id) => {
    try {
      await markVendorBillPaid(id, { payment_reference: 'Dashboard payment' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Finance Dashboard</h1>
        <p className="text-sm text-gray-500">Billing overview & action queues</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Draft Invoices', ci.draft?.count, ci.draft?.total_value],
          ['Sent Unpaid', ci.sent_unpaid?.count, ci.sent_unpaid?.total_value],
          ['Overdue', ci.overdue?.count, ci.overdue?.total_value],
          ['Vendor Bills Due', vb.pending_approval?.count, vb.pending_approval?.total_value],
        ].map(([label, count, total]) => (
          <div key={label} className="bg-white border rounded-xl p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-semibold mt-1">{count || 0}</p>
            <p className="text-sm text-gray-600">{fmt(total)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-xl p-4 h-72">
          <h3 className="font-semibold text-sm mb-3">Monthly Revenue Collected</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={revenueData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border rounded-xl p-4 h-72">
          <h3 className="font-semibold text-sm mb-3">Invoice Status Distribution</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Pending Credit Notes</h3>
            <Link to="/customer-billing/credit-notes" className="text-xs text-blue-600">View all</Link>
          </div>
          {(data.pending_credit_notes || []).length === 0 ? (
            <p className="text-sm text-gray-500">None pending</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.pending_credit_notes.map((cn) => (
                <li key={cn.credit_note_id} className="flex justify-between items-center">
                  <span>{cn.credit_note_number} · {cn.customer_name} · {fmt(cn.amount)}</span>
                  <PermissionGate section="credit_notes" action="edit">
                    <button type="button" onClick={() => handleApproveCn(cn.credit_note_id)} className="text-xs text-blue-600">Approve</button>
                  </PermissionGate>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Pending Debit Notes</h3>
            <Link to="/vendor-billing/debit-notes" className="text-xs text-blue-600">View all</Link>
          </div>
          {(data.pending_debit_notes || []).length === 0 ? (
            <p className="text-sm text-gray-500">None pending</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.pending_debit_notes.map((dn) => (
                <li key={dn.debit_note_id} className="flex justify-between items-center">
                  <span>{dn.debit_note_number} · {dn.vendor_name} · {fmt(dn.amount)}</span>
                  <PermissionGate section="debit_notes" action="edit">
                    <button type="button" onClick={() => handleApproveDn(dn.debit_note_id)} className="text-xs text-blue-600">Approve</button>
                  </PermissionGate>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">E-Invoice Queue ({data.einvoice_queue || 0})</h3>
          <Link to="/finance/einvoice-queue" className="text-xs text-blue-600">View queue</Link>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <h3 className="font-semibold p-4 border-b">Vendor Bills — Action Required</h3>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">Month</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(data.vendor_bills_queue || []).map((b) => (
              <tr key={b.bill_id}>
                <td className="px-4 py-3">{b.vendor_name}</td>
                <td className="px-4 py-3">{b.bill_month}/{b.bill_year}</td>
                <td className="px-4 py-3">{fmt(b.total_payable)}</td>
                <td className="px-4 py-3 capitalize">{b.status}</td>
                <td className="px-4 py-3">
                  {b.status === 'generated' && (
                    <button type="button" onClick={() => handleApproveBill(b.bill_id)} className="text-xs text-blue-600 mr-2">Approve</button>
                  )}
                  {b.status === 'approved' && (
                    <button type="button" onClick={() => handleBillPaid(b.bill_id)} className="text-xs text-green-600">Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
