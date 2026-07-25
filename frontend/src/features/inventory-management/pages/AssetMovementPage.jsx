import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRightLeft, Loader2, Search } from 'lucide-react';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  bulkMoveInventoryAssets,
  searchInventoryAssetsForMovement
} from '../inventoryManagementApi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';

export const BUCKET_OPTIONS = [
  { value: 'qc_pending', label: 'QC Pending' },
  { value: 'qc_process', label: 'QC Process' },
  { value: 'passed', label: 'Ready to Rent/Sell' },
  { value: 'dead', label: 'Dead Laptop' },
  { value: 'missing', label: 'Missing Laptop' }
];

const MAX_BATCH = 100;

function parseTerms(input) {
  return [...new Set(
    String(input || '')
      .split(/[,;\n\r\t]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function canSearch(input) {
  const terms = parseTerms(input);
  if (!terms.length) return false;
  if (terms.length > 1) return true;
  return terms[0].length >= 2;
}

function bucketLabel(value) {
  return BUCKET_OPTIONS.find((o) => o.value === value)?.label || value;
}

function UnmovableAssetsPanel({ title, tone, items, emptyHint }) {
  if (!items?.length) return null;
  const toneClasses = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : 'border-slate-200 bg-slate-50 text-slate-800';

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${toneClasses}`}>
      <p className="font-semibold mb-2">{title} ({items.length})</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide opacity-70">
              <th className="pr-4 pb-1 font-semibold">Searched</th>
              <th className="pr-4 pb-1 font-semibold">TTSPL</th>
              <th className="pr-4 pb-1 font-semibold">Serial</th>
              <th className="pb-1 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.serial_id}-${item.matched_term || item.unique_product_serial}`} className="border-t border-black/5">
                <td className="py-1.5 pr-4 font-mono">{item.matched_term || '—'}</td>
                <td className="py-1.5 pr-4 font-mono font-semibold">{item.unique_product_serial || '—'}</td>
                <td className="py-1.5 pr-4 font-mono">{item.serial_number || '—'}</td>
                <td className="py-1.5 capitalize">{item.inventory_status?.replace(/_/g, ' ') || item.block_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {emptyHint ? <p className="mt-2 opacity-80">{emptyHint}</p> : null}
    </div>
  );
}

export default function AssetMovementPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 400);
  const [rows, setRows] = useState([]);
  const [searchMeta, setSearchMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('qc_pending');
  const [remark, setRemark] = useState('');
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    if (!canSearch(search)) {
      setRows([]);
      setSearchMeta(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await searchInventoryAssetsForMovement(search);
      if (data.success) {
        setRows(data.data || []);
        setSearchMeta(data.meta || null);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setMoveFrom('');
    setSelectedIds([]);
  }, [search]);

  const activeRows = useMemo(
    () => rows.filter((r) => !r.blocked && !r.ineligible),
    [rows]
  );

  const blockedRows = useMemo(() => {
    if (searchMeta?.blocked?.length) return searchMeta.blocked;
    return rows.filter((r) => r.blocked).map((r) => ({
      serial_id: r.serial_id,
      serial_number: r.serial_number,
      unique_product_serial: r.unique_product_serial,
      inventory_status: r.inventory_status,
      block_reason: r.block_reason,
      matched_term: r.matched_term,
    }));
  }, [rows, searchMeta]);

  const ineligibleRows = useMemo(() => {
    if (searchMeta?.ineligible?.length) return searchMeta.ineligible;
    return rows.filter((r) => r.ineligible && !r.blocked).map((r) => ({
      serial_id: r.serial_id,
      serial_number: r.serial_number,
      unique_product_serial: r.unique_product_serial,
      inventory_status: r.inventory_status,
      block_reason: r.block_reason,
      matched_term: r.matched_term,
    }));
  }, [rows, searchMeta]);

  const bucketCounts = useMemo(() => {
    const counts = Object.fromEntries(BUCKET_OPTIONS.map((o) => [o.value, 0]));
    let other = 0;
    for (const row of activeRows) {
      if (row.bucket && counts[row.bucket] != null) {
        counts[row.bucket] += 1;
      } else {
        other += 1;
      }
    }
    return { counts, other };
  }, [activeRows]);

  const filteredRows = useMemo(() => {
    if (!moveFrom) return [];
    return activeRows.filter((r) => r.bucket === moveFrom);
  }, [activeRows, moveFrom]);

  useEffect(() => {
    if (!moveFrom) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(filteredRows.slice(0, MAX_BATCH).map((r) => r.serial_id));
  }, [moveFrom, filteredRows]);

  useEffect(() => {
    if (moveTo === moveFrom) {
      const fallback = BUCKET_OPTIONS.find((o) => o.value !== moveFrom);
      if (fallback) setMoveTo(fallback.value);
    }
  }, [moveFrom, moveTo]);

  const moveToOptions = useMemo(
    () => BUCKET_OPTIONS.filter((o) => o.value !== moveFrom),
    [moveFrom]
  );

  const selectableRows = filteredRows;
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((r) => selectedIds.includes(r.serial_id));
  const pastedCount = parseTerms(searchInput).length;
  const sameCategory = moveFrom && moveTo === moveFrom;
  const overLimit = selectedIds.length > MAX_BATCH;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableRows.slice(0, MAX_BATCH).map((r) => r.serial_id));
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= MAX_BATCH) {
        toast.error(`Maximum ${MAX_BATCH} laptops per batch`);
        return ids;
      }
      return [...ids, id];
    });
  };

  const handleMove = async () => {
    if (!moveFrom) {
      toast.error('Select Move From category first');
      return;
    }
    if (!selectedIds.length) {
      toast.error('No laptops selected in the chosen Move From category');
      return;
    }
    if (selectedIds.length > MAX_BATCH) {
      toast.error(`Maximum ${MAX_BATCH} laptops per batch`);
      return;
    }
    if (sameCategory) {
      toast.error('Move From and Move To must be different');
      return;
    }

    const fromLabel = bucketLabel(moveFrom);
    const toLabel = bucketLabel(moveTo);
    if (!window.confirm(`Move ${selectedIds.length} laptop(s) from ${fromLabel} to ${toLabel}?`)) return;

    setMoving(true);
    try {
      const { data } = await bulkMoveInventoryAssets({
        serial_ids: selectedIds,
        from_target: moveFrom,
        target: moveTo,
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

  const showEmptyPrompt = !canSearch(search);
  const hiddenCount = moveFrom ? activeRows.length - filteredRows.length : activeRows.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ArrowRightLeft className="w-6 h-6 text-teal-700" />
          Asset Movement
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Paste TTSPLs or serials, pick <strong>Move From</strong> to filter by current category, then <strong>Move To</strong> and move up to {MAX_BATCH} at a time.
          Returned customer units (support closed, on floor/QC) appear under <strong>QC Process</strong> and can be moved to Ready, Dead, QC Pending, or Missing.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <label className="block text-sm max-w-3xl">
          <span className="text-xs font-medium text-slate-600">
            Serial numbers or TTSPLs {pastedCount > 1 ? `(${pastedCount} pasted)` : ''}
          </span>
          <textarea
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Single search or paste comma-separated: TTSPL001, TTSPL002, ABC123…"
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono resize-y min-h-[72px]"
          />
        </label>

        {searchMeta?.not_found?.length ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            <span className="font-semibold">Not found ({searchMeta.not_found.length}):</span>{' '}
            {searchMeta.not_found.slice(0, 20).join(', ')}
            {searchMeta.not_found.length > 20 ? ` … +${searchMeta.not_found.length - 20} more` : ''}
            <p className="mt-1 text-[11px] opacity-80">No matching serial or TTSPL in inventory for these values.</p>
          </div>
        ) : null}

        <UnmovableAssetsPanel
          title="Found but blocked — cannot move"
          tone="amber"
          items={blockedRows}
          emptyHint="These laptops are rented, sold, in transit, or otherwise deployed."
        />

        <UnmovableAssetsPanel
          title="Found but not eligible for asset movement"
          tone="slate"
          items={ineligibleRows}
        />

        {activeRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Found {activeRows.length} movable laptop(s)
              {blockedRows.length ? ` · ${blockedRows.length} blocked` : ''}
              {ineligibleRows.length ? ` · ${ineligibleRows.length} ineligible` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BUCKET_OPTIONS.map((opt) => {
                const count = bucketCounts.counts[opt.value] || 0;
                if (!count) return null;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMoveFrom(opt.value)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                      moveFrom === opt.value
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-teal-300'
                    }`}
                  >
                    {opt.label}: {count}
                  </button>
                );
              })}
              {bucketCounts.other > 0 ? (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                  Other: {bucketCounts.other}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 pt-1">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Move from</span>
            <select
              value={moveFrom}
              onChange={(e) => setMoveFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[200px]"
            >
              <option value="">Select current category…</option>
              {BUCKET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={!(bucketCounts.counts[opt.value] > 0)}>
                  {opt.label} ({bucketCounts.counts[opt.value] || 0})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Move to</span>
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              disabled={!moveFrom}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[220px] disabled:opacity-50"
            >
              {moveToOptions.map((opt) => (
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
              disabled={!moveFrom}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            onClick={handleMove}
            disabled={moving || !moveFrom || !selectedIds.length || sameCategory || overLimit}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            Move {selectedIds.length ? `(${selectedIds.length})` : ''}
          </button>
        </div>

        {moveFrom ? (
          <p className="text-xs text-slate-600">
            Showing {filteredRows.length} in <strong>{bucketLabel(moveFrom)}</strong>
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden in other categories` : ''}
            {selectedIds.length ? ` · ${selectedIds.length} selected` : ''}
            {filteredRows.length > MAX_BATCH ? (
              <span className="text-amber-700"> · First {MAX_BATCH} auto-selected (batch limit)</span>
            ) : null}
          </p>
        ) : activeRows.length > 0 ? (
          <p className="text-xs text-teal-700 font-medium">Select Move From to see laptops in that category.</p>
        ) : null}

        {overLimit ? (
          <p className="text-xs text-red-600">Deselect laptops — maximum {MAX_BATCH} per move.</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        {showEmptyPrompt ? (
          <div className="py-16 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
            <Search className="w-8 h-8 text-slate-300" />
            Enter a serial/TTSPL (min 2 chars) or paste comma-separated values
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            Searching…
          </div>
        ) : !loading && canSearch(search) && !activeRows.length && (blockedRows.length || ineligibleRows.length) ? (
          <div className="py-16 text-center text-slate-500 text-sm px-6">
            No movable laptops for this search.
            {blockedRows.length ? (
              <p className="mt-2 text-amber-800 text-xs">
                {blockedRows.length} blocked asset(s) listed above with TTSPL IDs.
              </p>
            ) : null}
          </div>
        ) : !moveFrom ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {activeRows.length
              ? 'Choose Move From above to list laptops in that category.'
              : canSearch(search)
                ? 'No movable laptops found for this search.'
                : 'Enter a serial/TTSPL (min 2 chars) or paste comma-separated values'}
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
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No laptops in {bucketLabel(moveFrom)} for this search.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.serial_id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.serial_id)}
                        onChange={() => toggleRow(row.serial_id)}
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-sky-800">{row.serial_number}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.unique_product_serial || '—'}</td>
                    <td className="px-3 py-3 text-xs">{row.purchase_order_number || '—'}</td>
                    <td className="px-3 py-3 capitalize text-xs">{row.qc_status?.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-3 text-xs">
                      {row.inventory_status?.replace(/_/g, ' ')}
                      {row.is_returned_floor ? (
                        <span className="ml-1 text-[10px] font-medium text-teal-700">(returned)</span>
                      ) : null}
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
