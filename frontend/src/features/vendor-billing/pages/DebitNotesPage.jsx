import React, { useCallback, useEffect, useState } from 'react';
import { Plus, FilePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import DebitNoteForm from '../components/DebitNoteForm';
import { PageHeader, Button } from '../../../components/ui/primitives';
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
      <PageHeader
        title="Debit Notes"
        subtitle="DN-* series"
        icon={FilePlus}
        actions={(
          <PermissionGate section="debit_notes" action="create">
            <Button icon={Plus} onClick={() => setFormOpen(true)}>Create Debit Note</Button>
          </PermissionGate>
        )}
      />

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">No debit notes</p>
        ) : rows.map((r) => (
          <div key={r.debit_note_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{r.debit_note_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{r.status}</span>
            </div>
            <p className="font-medium text-slate-800">{r.vendor_name}</p>
            <p className="text-sm text-slate-600">{r.reason}</p>
            {r.po_id && <p className="text-xs text-slate-400">PO {r.po_id}</p>}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-base font-bold text-slate-900">{fmt(r.amount)}</span>
              {r.status === 'pending' && (
                <PermissionGate section="debit_notes" action="edit">
                  <button type="button" onClick={() => handleApprove(r.debit_note_id)} className="text-sm text-blue-600 font-semibold">Approve</button>
                </PermissionGate>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
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
