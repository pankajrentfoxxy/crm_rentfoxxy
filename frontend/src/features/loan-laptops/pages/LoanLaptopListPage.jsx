import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Laptop, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, Button, SearchField } from '../../../components/ui/primitives';
import LoanStatusBadge from '../components/LoanStatusBadge';
import { listLoans, getLoanCounts, errorMessage } from '../loanLaptopApi';
import { QUEUE_TABS, formatDate } from '../loanConstants';

export default function LoanLaptopListPage() {
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') || '';
  const [q, setQ] = useState(params.get('q') || '');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, c] = await Promise.all([
        listLoans({ queue: queue || undefined, q: q || undefined, limit: 200 }),
        getLoanCounts(),
      ]);
      setRows(list.data?.data || []);
      setCounts(c.data?.data?.queues || {});
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load loan laptops'));
    } finally {
      setLoading(false);
    }
  }, [queue, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const setQueue = (key) => {
    const next = new URLSearchParams(params);
    if (key) next.set('queue', key); else next.delete('queue');
    setParams(next, { replace: true });
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Loan Laptops"
        subtitle="Temporary laptops lent to customers while their own is repaired — never charged unless kept"
        icon={Laptop}
        actions={(
          <PermissionGate section={['loan_laptop_policy', 'loan_laptop_approval']} action="view">
            <Link to="/loan-laptops/policy">
              <Button variant="secondary" icon={Settings2}>Replacement Policy</Button>
            </Link>
          </PermissionGate>
        )}
      />

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {QUEUE_TABS.map((tab) => {
          const active = tab.key === queue;
          const n = tab.key ? counts[tab.key] : null;
          return (
            <button
              key={tab.key || 'all'}
              type="button"
              onClick={() => setQueue(tab.key)}
              className={`shrink-0 px-3 min-h-[36px] rounded-full text-sm font-medium border transition-colors ${
                active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              {n ? <span className={`ml-1.5 text-xs ${active ? 'text-blue-100' : 'text-slate-400'}`}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      <SearchField
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search request, TTSPL, customer, Loan DC or ticket #"
        className="mb-4"
      />

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <p className="text-center text-sm text-slate-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">No loan laptops</p>
        ) : rows.map((r) => (
          <Link key={r.id} to={`/loan-laptops/${r.id}`} className="block bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{r.request_number}</span>
              <LoanStatusBadge status={r.status} />
            </div>
            <p className="text-sm text-slate-700 mt-1 truncate">{r.customer_name || `Customer #${r.customer_id}`}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-2">
              <span>Loan {r.loan_ttspl_id}</span>
              <span>Repairing {r.original_ttspl_id || '—'}</span>
              <span>Ticket #{r.ticket_id}</span>
              {r.loan_dc_number && <span>{r.loan_dc_number}</span>}
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden sm:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Request</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Loan laptop</th>
              <th className="px-4 py-3 text-left">Under repair</th>
              <th className="px-4 py-3 text-left">Ticket</th>
              <th className="px-4 py-3 text-left">Loan DC</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No loan laptops</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/loan-laptops/${r.id}`} className="font-semibold text-blue-700 hover:underline whitespace-nowrap">{r.request_number}</Link>
                </td>
                <td className="px-4 py-3 max-w-[220px] truncate">{r.customer_name || `#${r.customer_id}`}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.loan_ttspl_id}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.original_ttspl_id || '—'}</td>
                <td className="px-4 py-3">
                  <Link to={`/support/tickets/${r.ticket_id}`} className="text-blue-700 hover:underline">#{r.ticket_id}</Link>
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">{r.loan_dc_number || '—'}</td>
                <td className="px-4 py-3"><LoanStatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(r.updated_at, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
