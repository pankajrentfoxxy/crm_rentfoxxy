import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import InventoryPageShell from '../components/InventoryPageShell';
import { SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { fetchCustomerAssets } from '../inventoryManagementApi';

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'reserved', label: 'Allocated' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'rented', label: 'On Rent' },
  { key: 'on_demo', label: 'On Demo' },
  { key: 'sold', label: 'Sold' },
];

const STATUS_STYLES = {
  reserved: 'bg-slate-100 text-slate-700',
  in_transit: 'bg-amber-100 text-amber-800',
  rented: 'bg-blue-100 text-blue-800',
  on_demo: 'bg-violet-100 text-violet-800',
  sold: 'bg-emerald-100 text-emerald-800',
};

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
const fmtMoney = (n) => (n != null && n !== '' ? `₹${Number(n).toLocaleString('en-IN')}` : '—');

export default function CustomerAssetsPage() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ all: 0, reserved: 0, in_transit: 0, rented: 0, on_demo: 0, sold: 0 });
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPage(1); }, [search, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCustomerAssets({
        status: status || undefined,
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(res.data?.data || []);
      if (res.data?.counts) setCounts(res.data.counts);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load customer assets');
    } finally {
      setLoading(false);
    }
  }, [status, search, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <InventoryPageShell
      title="Customer Assets — Deployed Fleet"
      description="Every laptop currently out with customers — derived live from inventory (vendor serial numbers). Use this to see what is in the field; click a customer to open their full asset list."
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_TABS.map((t) => {
          const c = t.key ? counts[t.key] : counts.all;
          const active = status === t.key;
          return (
            <button
              key={t.key || 'all'}
              type="button"
              onClick={() => setStatus(t.key)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                active ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
              ].join(' ')}
            >
              {t.label}
              <span className={['ml-2 text-xs', active ? 'text-sky-100' : 'text-gray-400'].join(' ')}>{c ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search TTSPL, serial, customer, model, DC…"
        />
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {loading ? (
          <p className="px-3 py-8 text-center text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-gray-400">No assets currently with customers</p>
        ) : rows.map((r) => (
          <div key={r.serial_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900">{r.ttspl_id || r.serial_number || '—'}</span>
              <span className={['inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize', STATUS_STYLES[r.inventory_status] || 'bg-gray-100 text-gray-700'].join(' ')}>
                {String(r.inventory_status || '').replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm text-gray-900">{r.brand} {r.model}</p>
            <p className="text-[11px] text-gray-400">{[r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {r.customer_id ? (
                <Link to={`/lead-crm/customers/${r.customer_id}`} className="text-blue-600 font-medium">{r.company_name || r.customer_name || `#${r.customer_id}`}</Link>
              ) : <span>—</span>}
              {r.dc_number && <span>DC {r.dc_number}</span>}
              {r.entity_code && <span className="capitalize">{r.entity_code}</span>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-gray-500">
              <span>Disp: {fmtDate(r.dispatched_at)} · Del: {fmtDate(r.delivered_at)}</span>
              <span className="font-semibold text-gray-700">{r.purchase_order_type === 'direct_purchase' || r.inventory_status === 'sold' ? '—' : fmtMoney(r.rent_monthly_rate)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-3 text-left">TTSPL ID</th>
              <th className="px-3 py-3 text-left">Serial</th>
              <th className="px-3 py-3 text-left">Model</th>
              <th className="px-3 py-3 text-left">Customer</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left">DC</th>
              <th className="px-3 py-3 text-left">Entity</th>
              <th className="px-3 py-3 text-left">Dispatched</th>
              <th className="px-3 py-3 text-left">Delivered</th>
              <th className="px-3 py-3 text-right">Monthly Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No assets currently with customers</td></tr>
            ) : rows.map((r) => (
              <tr key={r.serial_id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-semibold text-gray-900">{r.ttspl_id || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{r.serial_number}</td>
                <td className="px-3 py-2">
                  <div className="text-gray-900">{r.brand} {r.model}</div>
                  <div className="text-[11px] text-gray-400">{[r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-3 py-2">
                  {r.customer_id ? (
                    <Link to={`/lead-crm/customers/${r.customer_id}`} className="text-blue-600 hover:underline">
                      {r.company_name || r.customer_name || `#${r.customer_id}`}
                    </Link>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={['inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize', STATUS_STYLES[r.inventory_status] || 'bg-gray-100 text-gray-700'].join(' ')}>
                    {String(r.inventory_status || '').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{r.dc_number || '—'}</td>
                <td className="px-3 py-2 text-gray-600 capitalize">{r.entity_code || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{fmtDate(r.dispatched_at)}</td>
                <td className="px-3 py-2 text-gray-600">{fmtDate(r.delivered_at)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{r.purchase_order_type === 'direct_purchase' || r.inventory_status === 'sold' ? '—' : fmtMoney(r.rent_monthly_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination
        page={page}
        totalPages={pagination.totalPages || 1}
        total={pagination.total || 0}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </InventoryPageShell>
  );
}
