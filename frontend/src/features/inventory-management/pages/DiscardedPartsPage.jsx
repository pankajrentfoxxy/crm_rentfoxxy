import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Recycle, Search } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { searchPartUnits } from '../partTrackingApi';
import CreateScrapChallanModal from '../components/CreateScrapChallanModal';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function DiscardedPartsPage() {
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [showCreate, setShowCreate] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim(), 320);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await searchPartUnits({
        status: 'discarded',
        search: debouncedSearch || undefined,
        limit: 200,
      });
      setUnits(data.units || []);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load discarded parts');
      setUnits([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const eligible = useMemo(
    () => units.filter((u) => !u.scrap_challan_number),
    [units]
  );

  const selectedUnits = useMemo(
    () => eligible.filter((u) => selected.has(u.instance_id)),
    [eligible, selected]
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((u) => u.instance_id)));
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Discarded Parts"
        subtitle="Parts flagged discarded — convert to Scrap Challan for disposal"
        icon={Recycle}
        actions={(
          <Link
            to="/inventory-management/scrap-challans"
            className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
          >
            Scrap Challans →
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-2 items-end justify-between">
        <div className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
            placeholder="Search PRT / part / serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">{selected.size} selected</span>
          <button
            type="button"
            disabled={selected.size < 1}
            onClick={() => setShowCreate(true)}
            className="h-9 px-3 rounded-lg text-sm font-semibold bg-slate-900 text-white disabled:opacity-40"
          >
            Convert to Scrap
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={eligible.length > 0 && selected.size === eligible.length}
                  onChange={toggleAll}
                  disabled={!eligible.length}
                />
              </th>
              <th className="px-3 py-2">PRT-ID</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Unit cost</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Scrap DC</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                  <Loader2 className="inline w-5 h-5 animate-spin" />
                </td>
              </tr>
            ) : units.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-500">No discarded parts</td>
              </tr>
            ) : units.map((u) => {
              const locked = Boolean(u.scrap_challan_number);
              return (
                <tr key={u.instance_id} className={`border-t ${locked ? 'bg-slate-50/80' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={selected.has(u.instance_id)}
                      onChange={() => toggle(u.instance_id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-blue-700">{u.prt_id}</td>
                  <td className="px-3 py-2">{u.part_name || '—'}</td>
                  <td className="px-3 py-2 capitalize">{u.category || '—'}</td>
                  <td className="px-3 py-2">
                    {u.unit_cost != null ? `₹${Number(u.unit_cost).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(u.updated_at || u.created_at)}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={u.notes || ''}>{u.notes || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {u.scrap_challan_number ? (
                      <Link
                        to={`/inventory-management/scrap-challans/${encodeURIComponent(u.scrap_challan_number)}`}
                        className="text-blue-700 hover:underline"
                      >
                        {u.scrap_challan_number}
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <CreateScrapChallanModal
          units={selectedUnits}
          onClose={() => { setShowCreate(false); load(); }}
        />
      ) : null}
    </div>
  );
}
