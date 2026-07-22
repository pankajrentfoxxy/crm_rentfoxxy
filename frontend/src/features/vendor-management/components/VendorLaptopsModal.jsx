import React, { useCallback, useEffect, useState } from 'react';
import { X, Laptop } from 'lucide-react';
import toast from 'react-hot-toast';
import { SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { fetchVendorLaptops } from '../vendorManagementApi';

const PAGE_SIZE = 25;

const LIFECYCLE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'returned', label: 'Returned' },
  { id: 'in_stock', label: 'In Stock' },
];

function laptopConfig(lap) {
  return [lap.processor, lap.generation, lap.ram, lap.storage]
    .filter(Boolean)
    .join(' · ');
}

function laptopModel(lap) {
  const model = (lap.model_name || '').trim();
  const brand = (lap.brand || '').trim();
  if (!model) return brand || '—';
  if (brand && !model.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${model}`;
  return model;
}

function CurrentStatusBadge({ lifecycle }) {
  const map = {
    active: 'bg-green-100 text-green-700',
    returned: 'bg-amber-100 text-amber-700',
    in_stock: 'bg-slate-100 text-slate-600',
  };
  const label = lifecycle === 'active' ? 'Active' : lifecycle === 'returned' ? 'Returned' : 'In Stock';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${map[lifecycle] || map.in_stock}`}>
      {label}
    </span>
  );
}

export default function VendorLaptopsModal({ open, vendorId, vendorName, onClose }) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, returned: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });

  useEffect(() => { setPage(1); }, [tab, search]);

  const load = useCallback(async () => {
    if (!open || !vendorId) return;
    setLoading(true);
    try {
      const { data } = await fetchVendorLaptops(vendorId, {
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        lifecycle: tab,
      });
      if (!data?.success) throw new Error(data?.message || 'Failed to load laptops');
      setRows(data.laptops || []);
      setCounts(data.counts || { total: 0, active: 0, returned: 0 });
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load laptops');
    } finally {
      setLoading(false);
    }
  }, [open, vendorId, page, search, tab]);

  useEffect(() => { load(); }, [load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Laptop className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Vendor Laptops</h3>
              <p className="text-xs text-slate-500">{vendorName || `Vendor #${vendorId}`}</p>
            </div>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-green-200 bg-green-50 p-3">
              <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Active</p>
              <p className="text-2xl font-bold text-green-800">{counts.active}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Returned</p>
              <p className="text-2xl font-bold text-amber-800">{counts.returned}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold text-slate-800">{counts.total}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {LIFECYCLE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <SearchField
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search asset tag, serial, model, customer…"
          />

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase text-left">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Asset Tag</th>
                  <th className="px-4 py-3">Serial No</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Rental Status</th>
                  <th className="px-4 py-3">DC Number</th>
                  <th className="px-4 py-3">Current Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No laptops found for this vendor.</td></tr>
                ) : rows.map((lap, i) => (
                  <tr key={lap.serial_id || `${lap.ttspl_id}-${i}`}>
                    <td className="px-4 py-3 text-slate-400">{(pagination.page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-4 py-3 font-mono text-blue-700">{lap.ttspl_id || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lap.serial_number || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{laptopModel(lap)}</p>
                      {laptopConfig(lap) && <p className="text-xs text-slate-400">{laptopConfig(lap)}</p>}
                    </td>
                    <td className="px-4 py-3">{lap.customer_name || '—'}</td>
                    <td className="px-4 py-3 capitalize">{lap.rental_status || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lap.current_dc_number || '—'}</td>
                    <td className="px-4 py-3"><CurrentStatusBadge lifecycle={lap.lifecycle} /></td>
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
        </div>
      </div>
    </div>
  );
}
