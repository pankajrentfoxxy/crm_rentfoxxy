import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import DebitNoteForm from '../components/DebitNoteForm';
import { approveDebitNote, listDebitNotes } from '../vendorBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  adjusted: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function DebitNotesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDebitNotes({});
      setRows(res.data?.debit_notes || []);
    } catch {
      toast.error('Failed to load debit notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id) => {
    try {
      await approveDebitNote(id);
      toast.success('Approved');
      load();
    } catch {
      toast.error('Approve failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Debit Notes</h1>
          <p className="text-sm text-gray-500">DN-* series</p>
        </div>
        <PermissionGate section="debit_notes" action="create">
          <button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Create Debit Note
          </button>
        </PermissionGate>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">DN #</th>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">PO</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No debit notes</td></tr>
            ) : rows.map((r) => (
              <tr key={r.debit_note_id}>
                <td className="px-4 py-3 font-medium">{r.debit_note_number}</td>
                <td className="px-4 py-3">{r.vendor_name}</td>
                <td className="px-4 py-3">{r.po_id || '—'}</td>
                <td className="px-4 py-3">{r.reason}</td>
                <td className="px-4 py-3">{fmt(r.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3">
                  {r.status === 'pending' && (
                    <PermissionGate section="debit_notes" action="edit">
                      <button type="button" onClick={() => handleApprove(r.debit_note_id)} className="text-xs text-blue-600 hover:underline">Approve</button>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DebitNoteForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
    </div>
  );
}
