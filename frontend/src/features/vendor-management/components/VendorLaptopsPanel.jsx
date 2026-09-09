import React, { useCallback, useEffect, useState } from 'react';
import { Download, Laptop } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { exportVendorLaptopsExcel, fetchVendorLaptops } from '../vendorManagementApi';

const PAGE_SIZE = 25;

const LIFECYCLE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'in_stock', label: 'In Stock' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'returned', label: 'Returned' },
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
    active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60',
    returned: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/60',
    in_transit: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60',
    in_stock: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/60',
  };
  const label = lifecycle === 'active'
    ? 'Active'
    : lifecycle === 'returned'
      ? 'Returned'
      : lifecycle === 'in_transit'
        ? 'In Transit'
        : 'In Stock';
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${map[lifecycle] || map.in_stock}`}>
      {label}
    </span>
  );
}

function tabCount(tabId, counts) {
  if (tabId === 'all') return counts.total;
  if (tabId === 'active') return counts.active;
  if (tabId === 'returned') return counts.returned;
  if (tabId === 'in_stock') return counts.in_stock;
  if (tabId === 'in_transit') return counts.in_transit;
  return 0;
}

/**
 * Paginated vendor laptop inventory — used on detail page and inside modal.
 */
export default function VendorLaptopsPanel({
  vendorId,
  vendorName,
  embedded = false,
  onCountsLoaded,
}) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, returned: 0, in_stock: 0, in_transit: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setPage(1); }, [tab, search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportVendorLaptopsExcel(vendorId, {
        lifecycle: tab,
        search: search || undefined,
      });
      const tabLabel = LIFECYCLE_TABS.find((t) => t.id === tab)?.label || tab;
      toast.success(`Exported ${tabLabel.toLowerCase()} laptops${search ? ' matching search' : ''}`);
    } catch (e) {
      toast.error(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    try {
      const { data } = await fetchVendorLaptops(vendorId, {
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        lifecycle: tab,
      });
      if (!data?.success) throw new Error(data?.message || 'Failed to load laptops');
      const c = data.counts || { total: 0, active: 0, returned: 0, in_transit: 0 };
      const inStock = c.in_stock ?? Math.max(0, (c.total || 0) - (c.active || 0) - (c.returned || 0));
      const nextCounts = { ...c, in_stock: inStock, in_transit: c.in_transit || 0 };
      setRows(data.laptops || []);
      setCounts(nextCounts);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
      onCountsLoaded?.(nextCounts);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load laptops');
    } finally {
      setLoading(false);
    }
  }, [vendorId, page, search, tab, onCountsLoaded]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className={embedded ? 'space-y-4' : 'p-5 space-y-4'}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Laptop className="w-5 h-5" />
          </span>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Vendor Laptops</h3>
            <p className="text-xs text-slate-500">{vendorName || `Vendor #${vendorId}`}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {LIFECYCLE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
              <span className={`tabular-nums ${tab === t.id ? 'text-blue-100' : 'text-slate-400'}`}>
                ({tabCount(t.id, counts)})
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto lg:min-w-[320px]">
          <div className="flex-1 min-w-[200px]">
            <SearchField
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search asset tag, serial, model, customer…"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            loading={exporting}
            onClick={handleExport}
            className="shrink-0"
          >
            Export
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 w-12">#</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Asset Tag</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Serial No</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Model</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rental Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">DC Number</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Lifecycle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">Loading laptops…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">No laptops match your filters.</td>
                </tr>
              ) : rows.map((lap, i) => (
                <tr key={lap.serial_id || `${lap.ttspl_id}-${i}`} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 text-slate-400 tabular-nums">{(pagination.page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="px-4 py-3 font-mono text-sm font-medium text-blue-700">{lap.ttspl_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{lap.serial_number || '—'}</td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <p className="font-medium text-slate-900">{laptopModel(lap)}</p>
                    {laptopConfig(lap) && <p className="text-xs text-slate-400 mt-0.5">{laptopConfig(lap)}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate" title={lap.customer_name || ''}>
                    {lap.customer_name || '—'}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-600">{lap.rental_status || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{lap.current_dc_number || '—'}</td>
                  <td className="px-4 py-3"><CurrentStatusBadge lifecycle={lap.lifecycle} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/40">
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
