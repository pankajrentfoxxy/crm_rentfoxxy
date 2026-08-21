import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, PageHeader } from '../../../components/ui/supportPrimitives';
import { decideSupportCharge, fetchSupportCharges } from '../supportV2Api';

export default function SupportChargesPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState('');
  const [waiveId, setWaiveId] = useState(null);
  const [waiveReason, setWaiveReason] = useState('');

  const load = () => {
    fetchSupportCharges({ billing_mode: mode || undefined })
      .then((r) => {
        setRows(r.data?.rows || []);
        setTotal(r.data?.total_pending || 0);
      })
      .catch(() => toast.error('Could not load charges'));
  };

  useEffect(() => { load(); }, [mode]);

  const act = async (id, action, reason) => {
    if (action === 'WAIVE' && !reason) { setWaiveId(id); return; }
    try {
      await decideSupportCharge(id, { action, reason });
      toast.success(action === 'BILL_NOW' ? 'Will bill now' : action === 'MONTHLY' ? 'Added to monthly' : 'Waived');
      setWaiveId(null); setWaiveReason('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <PageHeader title="Support charges" subtitle={`Total pending to bill ₹${Number(total).toFixed(0)}`} />
      <select value={mode} onChange={(e) => setMode(e.target.value)} className="border rounded px-2 py-1.5 text-[12px]">
        <option value="">All modes</option>
        <option value="MONTHLY">Monthly</option>
        <option value="IMMEDIATE">Immediate</option>
      </select>
      <div className="overflow-auto bg-white rounded-[10px] border border-sup-lineSoft">
        <table className="w-full text-[12px]">
          <thead className="bg-sup-canvas2 text-sup-muted">
            <tr>
              <th className="text-left px-2 py-1.5">Customer</th>
              <th className="text-left px-2 py-1.5">Ticket</th>
              <th className="text-left px-2 py-1.5">Machine</th>
              <th className="text-left px-2 py-1.5">Description</th>
              <th className="text-right px-2 py-1.5">Amount</th>
              <th className="text-left px-2 py-1.5">Mode</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.extra_line_id} className="border-t border-sup-lineSoft">
                <td className="px-2 py-1.5">{r.customer_name}</td>
                <td className="px-2 py-1.5">{r.ticket_number}</td>
                <td className="px-2 py-1.5">{r.ttspl_id || '—'}</td>
                <td className="px-2 py-1.5">{r.description}</td>
                <td className="px-2 py-1.5 text-right">₹{Number(r.amount || 0).toFixed(0)}</td>
                <td className="px-2 py-1.5">{r.billing_mode}</td>
                <td className="px-2 py-1.5 space-x-1">
                  <Button size="sm" variant="secondary" onClick={() => act(r.extra_line_id, 'BILL_NOW')}>Bill now</Button>
                  <Button size="sm" variant="secondary" onClick={() => act(r.extra_line_id, 'MONTHLY')}>Add to monthly</Button>
                  <Button size="sm" variant="danger" onClick={() => act(r.extra_line_id, 'WAIVE')}>Waive</Button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sup-muted">No pending support charges.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {waiveId && (
        <div className="flex gap-2 items-center text-[12px]">
          <input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Waiver reason" className="border rounded px-2 py-1.5 flex-1" />
          <Button size="sm" onClick={() => act(waiveId, 'WAIVE', waiveReason)}>Confirm waive</Button>
        </div>
      )}
    </div>
  );
}
