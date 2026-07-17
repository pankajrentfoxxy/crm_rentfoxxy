import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRightLeft, Loader2, Search } from 'lucide-react';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { SearchField } from '../../../components/ui/primitives';
import {
  bulkMoveInventoryAssets,
  searchInventoryAssetsForMovement
} from '../inventoryManagementApi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';

const TARGET_OPTIONS = [
  { value: 'qc_pending', label: 'QC Pending' },
  { value: 'qc_process', label: 'QC Process (creates ticket)' },
  { value: 'passed', label: 'Ready to Rent/Sell' },
  { value: 'dead', label: 'Dead Laptop' }
];

export default function AssetMovementPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [target, setTarget] = useState('qc_pending');
  const [remark, setRemark] = useState('');
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    if (search.length < 2) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await searchInventoryAssetsForMovement(search);
      if (data.success) setRows(data.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const selectableRows = useMemo(() => rows.filter((r) => !r.blocked), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.includes(r.serial_id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableRows.map((r) => r.serial_id));
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const handleMove = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one laptop');
      return;
    }
    const label = TARGET_OPTIONS.find((o) => o.value === target)?.label || target;
    if (!window.confirm(`Move ${selectedIds.length} laptop(s) to ${label}?`)) return;

    setMoving(true);
    try {
      const { data } = await bulkMoveInventoryAssets({
        serial_ids: selectedIds,
        target,
        remark: remark.trim() || undefined
      });
      if (data.success) {
        toast.success(data.message || 'Assets moved');
        setSelectedIds([]);
        setRemark('');
        invalidateInventoryManagement();
        load();
      } else {
        toast.error(data.message || 'Move failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Move failed');
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ArrowRightLeft className="w-6 h-6 text-teal-700" />
          Asset Movement
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Search by serial number or TTSPL, select multiple laptops, and move them between inventory buckets.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search serial number or TTSPL (min 2 chars)…"
          className="max-w-xl"
        />

        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Move to</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[220px]"
            >
              {TARGET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm flex-1 min-w-[200px] max-w-md">
            <span className="text-xs font-medium text-slate-600">Remark (optional, applied to all selected)</span>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Reason for move…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleMove}
            disabled={moving || !selectedIds.length}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            Move {selectedIds.length ? `(${selectedIds.length})` : ''}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        {search.length < 2 ? (
          <div className="py-16 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
            <Search className="w-8 h-8 text-slate-300" />
            Enter a serial number or TTSPL to find laptops
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            Searching…
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!selectableRows.length} />
                </th>
                <th className="px-3 py-3">Serial</th>
                <th className="px-3 py-3">TTSPL</th>
                <th className="px-3 py-3">PO</th>
                <th className="px-3 py-3">Current QC</th>
                <th className="px-3 py-3">Inventory</th>
                <th className="px-3 py-3">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">No laptops found</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.serial_id} className={row.blocked ? 'bg-red-50/40' : 'hover:bg-slate-50/60'}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.serial_id)}
                        disabled={row.blocked}
                        onChange={() => toggleRow(row.serial_id)}
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-sky-800">{row.serial_number}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.unique_product_serial || '—'}</td>
                    <td className="px-3 py-3 text-xs">{row.purchase_order_number || '—'}</td>
                    <td className="px-3 py-3 capitalize text-xs">{row.qc_status?.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-3 text-xs">
                      {row.blocked ? (
                        <span className="text-red-700 font-medium">{row.block_reason}</span>
                      ) : (
                        row.inventory_status?.replace(/_/g, ' ')
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 max-w-[200px] truncate">{row.remark || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
