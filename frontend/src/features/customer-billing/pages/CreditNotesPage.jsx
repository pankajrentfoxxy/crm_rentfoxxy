import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import CreditNoteForm from '../components/CreditNoteForm';
import TtsplHistoryModal from '../../../components/TtsplHistoryModal';
import { approveCreditNote, listCreditNotes } from '../customerBillingApi';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  applied: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function ttsplList(ids) {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids;
  try { const p = JSON.parse(ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

export default function CreditNotesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [historyTtspl, setHistoryTtspl] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await listCreditNotes(params);
      setRows(res.data?.credit_notes || []);
    } catch {
      toast.error('Failed to load credit notes');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id) => {
    try {
      await approveCreditNote(id);
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
          <h1 className="text-2xl font-semibold text-gray-900">Credit Notes</h1>
          <p className="text-sm text-gray-500">CN-* series</p>
        </div>
        <PermissionGate section="credit_notes" action="create">
          <button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Create Credit Note
          </button>
        </PermissionGate>
      </div>

      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mb-4 border rounded-lg px-3 py-1.5 text-sm">
        <option value="">All statuses</option>
        {['pending', 'approved', 'applied', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">CN #</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Justification</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Links</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No credit notes</td></tr>
            ) : rows.map((r) => {
              const ttspls = ttsplList(r.ttspl_ids);
              return (
              <tr key={r.credit_note_id} className="align-top">
                <td className="px-4 py-3 font-medium">{r.credit_note_number}</td>
                <td className="px-4 py-3">{r.customer_name}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.reason}</div>
                  {ttspls.length > 0 && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      Laptop: {ttspls.join(', ')}
                    </div>
                  )}
                  {(r.from_date || r.to_date) && (
                    <div className="text-xs text-gray-500">
                      {String(r.from_date || '').slice(0, 10)} → {String(r.to_date || '').slice(0, 10)}
                      {r.quantity ? ` · ${r.quantity} day(s)` : ''}{r.unit_rate ? ` × ${fmt(r.unit_rate)}/day` : ''}
                    </div>
                  )}
                  {r.invoice_number && <div className="text-xs text-gray-400">Applied in {r.invoice_number}</div>}
                </td>
                <td className="px-4 py-3 text-right font-medium">{fmt(r.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-xs space-y-1">
                  {ttspls[0] && (
                    <button type="button" onClick={() => setHistoryTtspl(ttspls[0])} className="flex items-center gap-1 text-blue-600 hover:underline">
                      <Clock className="w-3 h-3" /> Laptop history
                    </button>
                  )}
                  {r.return_ticket_id && (
                    <Link to={`/floor-pipeline/tickets/${r.return_ticket_id}`} className="block text-blue-600 hover:underline">
                      Return ticket #{r.return_ticket_id}
                    </Link>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.status === 'pending' && (
                    <PermissionGate section="credit_notes" action="edit">
                      <button type="button" onClick={() => handleApprove(r.credit_note_id)} className="text-xs text-blue-600 hover:underline">Approve</button>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>

      <CreditNoteForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      {historyTtspl && <TtsplHistoryModal ttsplId={historyTtspl} onClose={() => setHistoryTtspl(null)} />}
    </div>
  );
}
