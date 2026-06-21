import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, FileText, Image as ImageIcon, Search, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPartsHistory } from '../../support/supportPartsApi';
import { uploadBase } from '../../../components/support/utils';
import { PageHeader, StatCard } from '../../../components/ui/primitives';

const fileUrl = (p) => (p ? `${uploadBase()}/${p}` : null);

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'issued', label: 'With technician' },
  { value: 'used', label: 'Used' },
  { value: 'return_requested', label: 'Return pending' },
  { value: 'returned', label: 'Returned' },
];

const STATUS_PILL = {
  issued: 'bg-blue-100 text-blue-700',
  used: 'bg-green-100 text-green-700',
  return_requested: 'bg-amber-100 text-amber-800',
  returned: 'bg-gray-100 text-gray-600',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function usedOrReturn(status) {
  switch (status) {
    case 'used': return { label: 'Used', cls: 'bg-green-100 text-green-700' };
    case 'returned': return { label: 'Returned', cls: 'bg-gray-100 text-gray-600' };
    case 'return_requested': return { label: 'Return pending', cls: 'bg-amber-100 text-amber-800' };
    default: return { label: 'Held', cls: 'bg-blue-100 text-blue-700' };
  }
}

function EsignLink({ url, label }) {
  if (!url) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <a
      href={fileUrl(url)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
    >
      <ImageIcon className="w-3.5 h-3.5" /> {label}
    </a>
  );
}

export default function PartsMovementHistoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (debounced) params.search = debounced;
      if (status) params.status = status;
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await getPartsHistory(params);
      setRows(data.history || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load parts history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, status, from, to]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    total: rows.length,
    held: rows.filter((r) => r.status === 'issued').length,
    used: rows.filter((r) => r.status === 'used').length,
    returned: rows.filter((r) => r.status === 'returned').length,
  }), [rows]);

  return (
    <div className="p-4 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Parts Movement History"
        subtitle="Full ledger of spare parts issued to support technicians — who took what, against which ticket and machine, the signed challan, and the return record."
        icon={History}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total movements" value={counts.total} tone="blue" />
        <StatCard label="With technician" value={counts.held} tone="purple" />
        <StatCard label="Used on machine" value={counts.used} tone="green" />
        <StatCard label="Returned" value={counts.returned} tone="gray" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm flex-1 min-w-[220px]">
          <span className="block text-gray-500 text-xs mb-1">Search</span>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Part, technician, TTSPL, ticket #, PRT-ID"
            />
          </div>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Status</span>
          <select className="border rounded-lg px-3 py-2 text-sm min-w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Issued from</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Issued to</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" onClick={() => { setSearch(''); setStatus(''); setFrom(''); setTo(''); }} className="text-sm text-blue-600 hover:underline pb-2">
          Clear filters
        </button>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-600" /></div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No parts movement recorded for these filters.</p>
        ) : rows.map((r) => {
          const uor = usedOrReturn(r.status);
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{r.part_name}</p>
                  <p className="font-mono text-[11px] text-gray-400">{r.prt_id || r.request_number} · Qty {r.quantity}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${uor.cls}`}>{uor.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="font-mono text-blue-600">{r.ticket_number}</span>
                <span className="font-mono text-teal-700">{r.ttspl_id || r.serial_number || '—'}</span>
                <span>{r.tech_name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                <span>Out: {fmtDate(r.issued_at)}</span>
                <span>Back: {fmtDate(r.returned_at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
                <EsignLink url={r.tech_esign_url} label="Tech sign" />
                {r.pdf_path && (
                  <a href={fileUrl(r.pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
                    <FileText className="w-3.5 h-3.5" /> {r.challan_number || 'Challan'}
                  </a>
                )}
                <EsignLink url={r.wh_esign_url} label="WH sign" />
                {r.return_pdf_path && (
                  <a href={fileUrl(r.return_pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
                    <FileText className="w-3.5 h-3.5" /> Return doc
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden sm:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-600" /></div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No parts movement recorded for these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="p-3">Part</th>
                <th className="p-3">Ticket</th>
                <th className="p-3">Machine</th>
                <th className="p-3">Taken by</th>
                <th className="p-3">Date received</th>
                <th className="p-3">Issue e-sign</th>
                <th className="p-3">Return date</th>
                <th className="p-3">Status</th>
                <th className="p-3">Used / Return</th>
                <th className="p-3">Return e-sign</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const uor = usedOrReturn(r.status);
                return (
                  <tr key={r.id} className="border-t border-gray-50 align-top">
                    <td className="p-3">
                      <p className="font-medium text-gray-900">{r.part_name}</p>
                      <p className="font-mono text-[11px] text-gray-400">{r.prt_id || r.request_number}</p>
                      <p className="text-[11px] text-gray-400">Qty {r.quantity}</p>
                    </td>
                    <td className="p-3">
                      <p className="font-mono text-blue-600">{r.ticket_number}</p>
                      <p className="text-[11px] text-gray-400">{r.customer_name || '—'}</p>
                    </td>
                    <td className="p-3 font-mono text-teal-700">{r.ttspl_id || r.serial_number || '—'}</td>
                    <td className="p-3">{r.tech_name}</td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(r.issued_at)}</td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1">
                        <EsignLink url={r.tech_esign_url} label="Tech sign" />
                        {r.pdf_path && (
                          <a href={fileUrl(r.pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
                            <FileText className="w-3.5 h-3.5" /> {r.challan_number || 'Challan'}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">{fmtDate(r.returned_at)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_PILL[r.status] || 'bg-gray-100 text-gray-600'}`}>
                        {String(r.status).replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${uor.cls}`}>{uor.label}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1">
                        <EsignLink url={r.wh_esign_url} label="WH sign" />
                        {r.return_pdf_path && (
                          <a href={fileUrl(r.return_pdf_path)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
                            <FileText className="w-3.5 h-3.5" /> Return doc
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
