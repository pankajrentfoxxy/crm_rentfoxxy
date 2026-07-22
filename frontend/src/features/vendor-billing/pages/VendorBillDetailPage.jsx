import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import VendorBillStatusBadge from '../components/VendorBillStatusBadge';
import { Button } from '../../../components/ui/primitives';
import { approveVendorBill, getVendorBill, markVendorBillPaid } from '../vendorBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function VendorBillDetailPage() {
  const { billId } = useParams();
  const [bill, setBill] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getVendorBill(billId);
      setBill(res.data?.bill);
    } catch {
      toast.error('Bill not found');
    }
  }, [billId]);

  useEffect(() => { load(); }, [load]);

  if (!bill) return <div className="p-6 text-gray-500">Loading…</div>;

  const lineItems = typeof bill.line_items === 'string'
    ? JSON.parse(bill.line_items)
    : (bill.line_items || []);

  const handleApprove = async () => {
    try {
      await approveVendorBill(billId);
      toast.success('Approved');
      load();
    } catch {
      toast.error('Approve failed');
    }
  };

  const handlePaid = async () => {
    const ref = window.prompt('Payment reference:');
    try {
      await markVendorBillPaid(billId, { payment_reference: ref || '' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <Link to="/vendor-billing/bills" className="text-sm text-blue-600 hover:underline">← Vendor Bills</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{bill.bill_number}</h1>
          <p className="text-sm text-gray-500">{bill.vendor_name} · {bill.from_date} – {bill.to_date}</p>
          <div className="mt-2"><VendorBillStatusBadge status={bill.status} /></div>
        </div>
        <div className="flex gap-2">
          {bill.status === 'generated' && (
            <PermissionGate section="vendor_billing_mgmt" action="edit">
              <Button onClick={handleApprove}>Approve</Button>
            </PermissionGate>
          )}
          {bill.status === 'approved' && (
            <PermissionGate section="vendor_billing_mgmt" action="edit">
              <Button variant="secondary" onClick={handlePaid}>Mark Paid</Button>
            </PermissionGate>
          )}
        </div>
      </div>

      {/* Mobile line-item cards */}
      <div className="grid gap-3 sm:hidden mb-4">
        {lineItems.map((line, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{line.ttspl_id || '—'}</span>
              <span className="font-semibold text-slate-900">{fmt(line.amount)}</span>
            </div>
            {line.serial_number && <p className="text-xs text-slate-500">SN: {line.serial_number}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>Recv {line.received_date || '—'}</span>
              <span>Ret {line.return_date || '—'}</span>
              <span>{line.days_in_month} days</span>
              <span>{fmt(line.monthly_rate)}/mo</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">TTSPL ID</th>
              <th className="px-4 py-3 text-left">Serial</th>
              <th className="px-4 py-3 text-left">Received</th>
              <th className="px-4 py-3 text-left">Return</th>
              <th className="px-4 py-3 text-right">Days</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lineItems.map((line, idx) => (
              <tr key={idx}>
                <td className="px-4 py-3">{line.ttspl_id || '—'}</td>
                <td className="px-4 py-3">{line.serial_number}</td>
                <td className="px-4 py-3">{line.received_date}</td>
                <td className="px-4 py-3">{line.return_date || '—'}</td>
                <td className="px-4 py-3 text-right">{line.days_in_month}</td>
                <td className="px-4 py-3 text-right">{fmt(line.monthly_rate)}</td>
                <td className="px-4 py-3 text-right">{fmt(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border rounded-xl p-5 text-sm space-y-1 max-w-sm ml-auto">
        <div className="flex justify-between"><span>Subtotal</span><span>{fmt(bill.subtotal)}</span></div>
        <div className="flex justify-between"><span>GST 18%</span><span>{fmt(bill.gst_amount)}</span></div>
        {parseFloat(bill.debit_note_adjustment) > 0 && (
          <div className="flex justify-between text-red-600"><span>Debit Adjustments</span><span>-{fmt(bill.debit_note_adjustment)}</span></div>
        )}
        <div className="flex justify-between font-semibold border-t pt-2"><span>Total Payable</span><span>{fmt(bill.total_payable)}</span></div>
      </div>
    </div>
  );
}
