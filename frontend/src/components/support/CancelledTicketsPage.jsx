import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import api from '../../utils/api';
import { formatTicketId } from './utils';

function primaryType(ticket) {
  const types = (ticket.items || []).map((i) => i.item_type);
  return types[0] || ticket.ticket_category || '—';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CancelledTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: 'cancelled', limit: '100' });
      if (debounced) params.set('search', debounced);
      const res = await api.get(`/support/tickets?${params}`);
      setTickets(res.data?.tickets || []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cancelled tickets</h1>
          <p className="text-sm text-slate-500">ERP migration tickets cancelled with audit trail.</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>
      ) : !tickets.length ? (
        <p className="text-sm text-slate-500 py-12 text-center">No cancelled tickets.</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600 uppercase">
                <th className="p-3">Ticket #</th>
                <th className="p-3">Customer</th>
                <th className="p-3">TTSPL</th>
                <th className="p-3">Type</th>
                <th className="p-3">Created</th>
                <th className="p-3">Cancelled</th>
                <th className="p-3">Cancelled by</th>
                <th className="p-3">Remark</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50/80">
                  <td className="p-3 font-mono text-blue-700">{formatTicketId(ticket.id)}</td>
                  <td className="p-3">{ticket.customer_name || '—'}</td>
                  <td className="p-3 font-mono text-xs">{ticket.ttspl_id || '—'}</td>
                  <td className="p-3 capitalize">{primaryType(ticket)}</td>
                  <td className="p-3">{formatDate(ticket.created_at)}</td>
                  <td className="p-3">{formatDate(ticket.cancelled_at)}</td>
                  <td className="p-3">{ticket.cancelled_by_name || '—'}</td>
                  <td className="p-3 max-w-xs truncate" title={ticket.cancellation_remark || ''}>{ticket.cancellation_remark || '—'}</td>
                  <td className="p-3"><span className="support-pill cancelled">Cancelled</span></td>
                  <td className="p-3">
                    <Link to={`/support/tickets/${ticket.id}`} className="text-blue-600 font-semibold hover:underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
