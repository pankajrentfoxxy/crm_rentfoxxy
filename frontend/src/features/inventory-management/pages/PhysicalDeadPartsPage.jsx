import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowUpFromLine, Loader2, PackagePlus, Search } from 'lucide-react';
import { PageHeader, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { partCategoryLabel } from '../../../constants/laptopConditions';
import {
  fetchPhysicalInwards,
  fetchPhysicalOutwards,
  fetchPhysicalParts,
} from '../physicalDeadPartApi';
import { fmtDate, outwardStatusLabel, physicalPhotoList, physicalUploadUrl, statusChip } from '../physicalDeadPartUi';
import PhysicalPartOutwardModal from '../components/PhysicalPartOutwardModal';
import PhysicalPartDetailDrawer from '../components/PhysicalPartDetailDrawer';

const TABS = [
  { id: 'available', label: 'Available / Dead' },
  { id: 'pending', label: 'Pending dispatch' },
  { id: 'out', label: 'Out' },
  { id: 'inwards', label: 'Inward history' },
  { id: 'outwards', label: 'Outward history' },
];

export default function PhysicalDeadPartsPage() {
  const [tab, setTab] = useState('available');
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState([]);
  const [inwards, setInwards] = useState([]);
  const [outwards, setOutwards] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 50 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [showOutward, setShowOutward] = useState(false);
  const [detailDp, setDetailDp] = useState(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 320);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'inwards') {
        const { data } = await fetchPhysicalInwards({ search: debouncedSearch || undefined, page, limit: 25 });
        setInwards(data.inwards || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: 25 });
      } else if (tab === 'outwards') {
        const { data } = await fetchPhysicalOutwards({ search: debouncedSearch || undefined, page, limit: 25 });
        setOutwards(data.outwards || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: 25 });
      } else {
        const { data } = await fetchPhysicalParts({
          status: tab,
          search: debouncedSearch || undefined,
          page,
          limit: 50,
        });
        setParts(data.parts || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0, limit: 50 });
        setSelected(new Set());
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load physical parts');
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedSearch, page]);

  useEffect(() => { setPage(1); }, [tab, debouncedSearch]);
  useEffect(() => { load(); }, [load]);

  const eligible = useMemo(() => parts.filter((p) => p.status === 'available'), [parts]);
  const selectedParts = useMemo(() => eligible.filter((p) => selected.has(p.part_id)), [eligible, selected]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map((p) => p.part_id)));
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Dead / Physical Parts"
        subtitle="Warehouse-found parts that did not exist in CRM — inward creates the record, outward ships them out"
        icon={PackagePlus}
        actions={(
          <Link
            to="/inventory-management/physical-parts/inward"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold bg-teal-700 text-white hover:bg-teal-800"
          >
            <PackagePlus className="w-4 h-4" /> Part Inward
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-end justify-between">
        <div className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
            placeholder="Search DP / part / serial / PIN / POUT…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tab === 'available' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">{selected.size} selected</span>
            <button
              type="button"
              disabled={selected.size < 1}
              onClick={() => setShowOutward(true)}
              className="h-9 px-3 rounded-lg text-sm font-semibold bg-slate-900 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <ArrowUpFromLine className="w-4 h-4" /> Part Outward
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        {tab === 'inwards' ? (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Inward</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Warehouse</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Parts</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
              ) : inwards.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">No inward transactions</td></tr>
              ) : inwards.map((row) => (
                <tr key={row.inward_id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/inventory-management/physical-parts/inward/${encodeURIComponent(row.inward_number)}`} className="font-mono text-blue-700 font-medium">
                      {row.inward_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{fmtDate(row.inward_date)}</td>
                  <td className="px-3 py-2">{row.warehouse}</td>
                  <td className="px-3 py-2 text-xs">{row.inward_reason}</td>
                  <td className="px-3 py-2 tabular-nums">{row.part_count}</td>
                  <td className="px-3 py-2 text-xs">{row.created_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'outwards' ? (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Outward</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Receiver</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Parts</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
              ) : outwards.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">No outward transactions</td></tr>
              ) : outwards.map((row) => (
                <tr key={row.outward_id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/inventory-management/physical-parts/outward/${encodeURIComponent(row.outward_number)}`} className="font-mono text-blue-700 font-medium">
                      {row.outward_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{fmtDate(row.outward_date)}</td>
                  <td className="px-3 py-2">{row.receiver_name}</td>
                  <td className="px-3 py-2 text-xs">{row.purpose}</td>
                  <td className="px-3 py-2 tabular-nums">{row.part_count}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusChip(row.status)}`}>
                      {outwardStatusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.reference_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {tab === 'available' ? (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={eligible.length > 0 && selected.size === eligible.length}
                      onChange={toggleAll}
                      disabled={!eligible.length}
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2">DP</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Warehouse</th>
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Inward</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></td></tr>
              ) : parts.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">No physical parts in this view</td></tr>
              ) : parts.map((p) => (
                <tr key={p.part_id} className="border-t hover:bg-slate-50">
                  {tab === 'available' ? (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(p.part_id)} onChange={() => toggle(p.part_id)} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setDetailDp(p.dp_number)} className="font-mono text-blue-700 font-semibold">
                      {p.dp_number}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium m-0">{p.part_name}</p>
                    {p.serial_number ? <p className="text-xs text-slate-500 m-0 font-mono">{p.serial_number}</p> : null}
                  </td>
                  <td className="px-3 py-2">{partCategoryLabel(p.category)}</td>
                  <td className="px-3 py-2">{p.warehouse}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      const photos = physicalPhotoList(p);
                      if (!photos.length) return '—';
                      return (
                        <span className="inline-flex items-center gap-1">
                          <a href={physicalUploadUrl(photos[0])} target="_blank" rel="noreferrer">
                            <img src={physicalUploadUrl(photos[0])} alt="" className="h-10 w-10 object-cover rounded border" />
                          </a>
                          {photos.length > 1 ? <span className="text-[11px] text-slate-500">+{photos.length - 1}</span> : null}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <p className="m-0">{fmtDate(p.inward_date)}</p>
                    <p className="m-0 font-mono text-slate-500">{p.inward_number}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusChip(p.status)}`}>
                      {p.status_label}
                    </span>
                    {p.outward_number ? (
                      <Link to={`/inventory-management/physical-parts/outward/${encodeURIComponent(p.outward_number)}`} className="block text-[11px] font-mono text-blue-700 mt-1">
                        {p.outward_number}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        pageSize={pagination.limit}
        onPageChange={setPage}
      />

      {showOutward ? (
        <PhysicalPartOutwardModal
          parts={selectedParts}
          onClose={() => { setShowOutward(false); load(); }}
        />
      ) : null}
      {detailDp ? (
        <PhysicalPartDetailDrawer dpNumber={detailDp} onClose={() => setDetailDp(null)} />
      ) : null}
    </div>
  );
}
