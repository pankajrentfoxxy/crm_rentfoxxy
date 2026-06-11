import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import SecurityDepositForm from '../components/SecurityDepositForm';
import { listSecurityDeposits, refundSecurityDeposit } from '../customerBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

const STATUS_STYLES = {
  held: 'bg-blue-100 text-blue-800',
  partially_refunded: 'bg-amber-100 text-amber-800',
  refunded: 'bg-green-100 text-green-800',
  adjusted: 'bg-gray-100 text-gray-800',
};

export default function SecurityDepositsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSecurityDeposits({});
      setRows(res.data?.deposits || []);
    } catch {
      toast.error('Failed to load deposits');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefund = async (row) => {
    const amount = window.prompt('Refund amount:', String(row.amount - (row.refund_amount || 0)));
    if (!amount) return;
    const ref = window.prompt('Refund reference (optional):');
    try {
      await refundSecurityDeposit(row.deposit_id, { refund_amount: parseFloat(amount), refund_reference: ref || '' });
      toast.success('Refund recorded');
      load();
    } catch {
      toast.error('Refund failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Security Deposits</h1>
        </div>
        <PermissionGate section="security_deposits" action="create">
          <button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Record Deposit
          </button>
        </PermissionGate>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">SO #</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Received</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Refund</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No deposits</td></tr>
            ) : rows.map((r) => (
              <tr key={r.deposit_id}>
                <td className="px-4 py-3">{r.customer_name}</td>
                <td className="px-4 py-3">{r.sales_order_number || '—'}</td>
                <td className="px-4 py-3">{fmt(r.amount)}</td>
                <td className="px-4 py-3">{r.received_date?.slice?.(0, 10) || r.received_date}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{r.status?.replace('_', ' ')}</span>
                </td>
                <td className="px-4 py-3">{fmt(r.refund_amount)}</td>
                <td className="px-4 py-3">
                  {['held', 'partially_refunded'].includes(r.status) && (
                    <PermissionGate section="security_deposits" action="edit">
                      <button type="button" onClick={() => handleRefund(r)} className="text-xs text-blue-600 hover:underline">Refund</button>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SecurityDepositForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
    </div>
  );
}
