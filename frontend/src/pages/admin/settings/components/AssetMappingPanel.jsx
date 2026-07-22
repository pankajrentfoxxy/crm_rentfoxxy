import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Search, ArrowRightLeft, CheckCircle2, Ban, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchMapping,
  bulkCreateMapping,
  reassignMapping,
  bulkDeleteMapping,
  bulkStatusMapping,
} from '../../../../utils/assetConfigurationApi';

/**
 * Manage a parent → children relationship in one screen.
 *   type = 'brand-models'  (Brand → Models)
 *        | 'processor-generations'  (Processor → Generations)
 */
export default function AssetMappingPanel({ type, parentLabel, childLabel }) {
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [parentSearch, setParentSearch] = useState('');
  const [selectedChildren, setSelectedChildren] = useState(() => new Set());
  const [addText, setAddText] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMapping(type);
      const rows = res.data?.parents || [];
      setParents(rows);
      setSelectedId((prev) => (prev && rows.some((p) => p.id === prev) ? prev : rows[0]?.id || null));
    } catch {
      toast.error('Failed to load mapping');
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  // Clear child selection whenever the active parent changes.
  useEffect(() => { setSelectedChildren(new Set()); setAddText(''); setMoveTarget(''); }, [selectedId]);

  const selected = useMemo(() => parents.find((p) => p.id === selectedId) || null, [parents, selectedId]);

  const filteredParents = useMemo(() => {
    const q = parentSearch.trim().toLowerCase();
    if (!q) return parents;
    return parents.filter((p) => p.name.toLowerCase().includes(q));
  }, [parents, parentSearch]);

  const children = selected?.children || [];
  const allChecked = children.length > 0 && selectedChildren.size === children.length;

  const toggleChild = (id) => {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedChildren(allChecked ? new Set() : new Set(children.map((c) => c.id)));
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast.success(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await load();
      setSelectedChildren(new Set());
      return r;
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => {
    const names = addText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) { toast.error(`Enter at least one ${childLabel.toLowerCase()}`); return; }
    run(
      async () => {
        const res = await bulkCreateMapping(type, selectedId, names);
        return res.data;
      },
      (d) => {
        const created = d?.created?.length || 0;
        const skipped = d?.skipped?.length || 0;
        return `Added ${created} ${childLabel.toLowerCase()}${created === 1 ? '' : 's'}${skipped ? ` · ${skipped} already existed` : ''}`;
      }
    ).then((d) => { if (d) setAddText(''); });
  };

  const handleDelete = () => {
    if (!selectedChildren.size) return;
    if (!window.confirm(`Remove ${selectedChildren.size} ${childLabel.toLowerCase()}(s) from "${selected.name}"?`)) return;
    run(() => bulkDeleteMapping(type, [...selectedChildren]), 'Removed');
  };

  const handleStatus = (status) => {
    if (!selectedChildren.size) return;
    run(() => bulkStatusMapping(type, [...selectedChildren], status), status === 'active' ? 'Activated' : 'Deactivated');
  };

  const handleMove = () => {
    if (!selectedChildren.size || !moveTarget) return;
    run(
      async () => {
        const res = await reassignMapping(type, [...selectedChildren], parseInt(moveTarget, 10));
        return res.data;
      },
      (d) => {
        const moved = d?.moved || 0;
        const conflicts = d?.conflicts?.length || 0;
        return `Moved ${moved}${conflicts ? ` · ${conflicts} skipped (name already exists there)` : ''}`;
      }
    ).then(() => setMoveTarget(''));
  };

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Pick a {parentLabel.toLowerCase()} on the left, then add or manage the {childLabel.toLowerCase()}s mapped to it.
        These mappings drive the cascading dropdowns in Quotation, Sales Order, Purchase Order and Delivery Challan forms.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        {/* Parent list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={parentSearch}
                onChange={(e) => setParentSearch(e.target.value)}
                placeholder={`Search ${parentLabel.toLowerCase()}…`}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : filteredParents.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">No {parentLabel.toLowerCase()}s</div>
            ) : filteredParents.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm border-b border-gray-50 last:border-0 transition ${
                  p.id === selectedId ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.status !== 'active' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">inactive</span>
                  )}
                </span>
                <span className="flex items-center gap-1 shrink-0 text-xs text-gray-400">
                  {p.children.length}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Children of the selected parent */}
        <div className="bg-white border border-gray-200 rounded-xl">
          {!selected ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              Select a {parentLabel.toLowerCase()} to manage its {childLabel.toLowerCase()}s.
            </div>
          ) : (
            <div className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-semibold text-gray-800">
                  {selected.name} <span className="text-gray-400 font-normal">· {children.length} {childLabel.toLowerCase()}(s)</span>
                </h3>
              </div>

              {/* Add new children */}
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <input
                  value={addText}
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                  placeholder={`Add ${childLabel.toLowerCase()}(s) — separate multiple with comma`}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={busy || !addText.trim()}
                  className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>

              {/* Bulk action bar */}
              {selectedChildren.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="text-xs text-gray-600 font-medium px-1">{selectedChildren.size} selected</span>
                  <div className="flex items-center gap-1">
                    <select
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                    >
                      <option value="">Move to {parentLabel.toLowerCase()}…</option>
                      {parents.filter((p) => p.id !== selectedId).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={handleMove} disabled={busy || !moveTarget}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-white disabled:opacity-50">
                      <ArrowRightLeft className="w-3.5 h-3.5" /> Move
                    </button>
                  </div>
                  <button type="button" onClick={() => handleStatus('active')} disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-white disabled:opacity-50">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Activate
                  </button>
                  <button type="button" onClick={() => handleStatus('inactive')} disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-white disabled:opacity-50">
                    <Ban className="w-3.5 h-3.5 text-gray-500" /> Deactivate
                  </button>
                  <button type="button" onClick={handleDelete} disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}

              {/* Children checklist */}
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-xs text-gray-500 uppercase">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={!children.length} className="rounded" />
                  <span>Name</span>
                </div>
                <div className="max-h-[360px] overflow-y-auto divide-y">
                  {children.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">No {childLabel.toLowerCase()}s mapped yet.</div>
                  ) : children.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedChildren.has(c.id)}
                        onChange={() => toggleChild(c.id)}
                        className="rounded"
                      />
                      <span className="font-medium flex-1 min-w-0 truncate">{c.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
