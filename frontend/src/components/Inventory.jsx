import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Package, RefreshCw, Loader2, Search, Plus, X, History, Undo2, Pencil, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 50;

const emptyAddForm = () => ({
    stock_type: 'Cooling Period',
    device_type: 'Laptop',
    machine_number: '',
    serial_number: '',
    brand: '',
    model: '',
    processor: '',
    generation: '',
    ram: '',
    storage: '',
    gpu: '',
    screen_size: '',
    grade: ''
});

/** Editable inventory fields — machine_number / serial_number are read-only identifiers. */
const rowToEditForm = (row) => ({
    stock_type: row?.stock_type || 'Cooling Period',
    device_type: row?.device_type || 'Laptop',
    brand: row?.brand ?? '',
    model: row?.model ?? '',
    processor: row?.processor ?? '',
    generation: row?.generation ?? '',
    ram: row?.ram ?? '',
    storage: row?.storage ?? '',
    gpu: row?.gpu ?? '',
    screen_size: row?.screen_size ?? '',
    grade: row?.grade ?? '',
    status: row?.status ?? 'In Stock',
    stage: row?.stage ?? row?.workflow_stage ?? ''
});

/** Total + two wrap rows: stock type counts, status counts (from DB GROUP BY). */
function StockSummaryWidget({ summary, loading, listTotal }) {
    const apiTotal = summary?.total;
    const displayTotal =
        typeof apiTotal === 'number' && apiTotal > 0 ? apiTotal : typeof listTotal === 'number' ? listTotal : apiTotal ?? 0;
    const byStock = summary?.byStockType || [];
    const byStat = summary?.byStatus || [];

    return (
        <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-white via-slate-50/50 to-slate-50 px-3 py-2.5 shadow-sm w-full">
            {loading && !summary ? (
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" /> Loading summary…
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Total units</span>
                        <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{displayTotal}</span>
                    </div>
                    <div className="flex flex-col min-[520px]:flex-row min-[520px]:items-start min-[520px]:gap-6 gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold text-teal-800 uppercase tracking-wide mb-1.5">By stock type</div>
                            <div className="flex flex-wrap gap-1.5">
                                {byStock.length === 0 ? (
                                    <span className="text-[11px] text-gray-500">No data</span>
                                ) : (
                                    byStock.map((r) => (
                                        <span
                                            key={r.label}
                                            className="inline-flex items-center gap-1 rounded-lg bg-teal-50 border border-teal-100 px-2 py-1 text-[11px]"
                                        >
                                            <span className="text-teal-900 font-medium truncate max-w-[120px]" title={r.label}>
                                                {r.label}
                                            </span>
                                            <span className="tabular-nums font-bold text-teal-800">{r.count}</span>
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>
                        <div className="min-w-0 flex-1 min-[520px]:border-l min-[520px]:border-slate-200/80 min-[520px]:pl-6">
                            <div className="text-[10px] font-semibold text-indigo-800 uppercase tracking-wide mb-1.5">By status</div>
                            <div className="flex flex-wrap gap-1.5">
                                {byStat.length === 0 ? (
                                    <span className="text-[11px] text-gray-500">No data</span>
                                ) : (
                                    byStat.map((r) => (
                                        <span
                                            key={r.label}
                                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-100 px-2 py-1 text-[11px]"
                                        >
                                            <span className="text-indigo-900 font-medium truncate max-w-[120px]" title={r.label}>
                                                {r.label}
                                            </span>
                                            <span className="tabular-nums font-bold text-indigo-800">{r.count}</span>
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatTs(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return String(iso);
    }
}

export default function Inventory({ api }) {
    const { user } = useAuth();
    const perms = Array.isArray(user?.permissions) ? user.permissions : [];

    const canWriteInventory = useMemo(() => {
        const roles = ['admin', 'manager', 'floor_manager', 'team_member'];
        if (user?.role && roles.includes(user.role)) return true;
        return perms.includes('inventory_write') || perms.includes('inventory_access');
    }, [user?.role, perms]);

    const canSeeHistory = user?.role === 'admin' || user?.role === 'manager';

    const canEditInventory = canSeeHistory;

    const canMarkReturn = ['admin', 'manager', 'floor_manager'].includes(user?.role || '');

    const canGetFromErp = user?.role === 'admin' || user?.role === 'manager';

    const showActionsColumn = canMarkReturn || canSeeHistory;

    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sumLoading, setSumLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [stockType, setStockType] = useState('');
    const [offset, setOffset] = useState(0);

    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState(emptyAddForm);
    const [addSaving, setAddSaving] = useState(false);

    const [historyFor, setHistoryFor] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyData, setHistoryData] = useState(null);

    const [returnRow, setReturnRow] = useState(null);
    const [returnSaving, setReturnSaving] = useState(false);
    const [returnStockType, setReturnStockType] = useState('Ready');
    const [returnStatus, setReturnStatus] = useState('In Stock');

    const [editRow, setEditRow] = useState(null);
    const [editForm, setEditForm] = useState(null);
    const [editSaving, setEditSaving] = useState(false);

    const [erpLookupId, setErpLookupId] = useState('');
    const [erpSyncing, setErpSyncing] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        setOffset(0);
    }, [debouncedSearch, stockType]);

    const loadSummary = useCallback(async () => {
        setSumLoading(true);
        try {
            const { data } = await api.get('/inventory/summary');
            if (data?.success && typeof data.total === 'number' && Array.isArray(data.byStockType) && Array.isArray(data.byStatus)) {
                setSummary(data);
            } else setSummary(null);
        } catch (e) {
            console.error(e);
            setSummary(null);
        } finally {
            setSumLoading(false);
        }
    }, [api]);

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', String(PAGE_SIZE));
            params.set('offset', String(offset));
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (stockType) params.set('stock_type', stockType);
            const { data } = await api.get('/inventory?' + params.toString());
            setItems(data.items || []);
            setTotal(Number(data.total) || 0);
        } catch (e) {
            console.error(e);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [api, debouncedSearch, stockType, offset]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    const refreshAll = () => {
        loadSummary();
        loadItems();
    };

    const openHistory = async (row) => {
        if (!canSeeHistory || !row?.inventory_id) return;
        setHistoryFor(row);
        setHistoryData(null);
        setHistoryLoading(true);
        try {
            const { data } = await api.get(`/inventory/${row.inventory_id}/history`);
            if (data?.success) setHistoryData(data);
            else setHistoryData({ error: data?.message || 'Failed to load history' });
        } catch (e) {
            setHistoryData({ error: e.response?.data?.message || e.message || 'Failed to load history' });
        } finally {
            setHistoryLoading(false);
        }
    };

    const submitAddStock = async (e) => {
        e.preventDefault();
        const f = addForm;
        if (!f.machine_number?.trim() || !f.serial_number?.trim() || !f.brand?.trim() || !f.model?.trim()) {
            alert('Machine #, Serial, Brand, and Model are required.');
            return;
        }
        setAddSaving(true);
        try {
            await api.post('/inventory', {
                stock_type: f.stock_type,
                device_type: f.device_type,
                machine_number: f.machine_number.trim(),
                serial_number: f.serial_number.trim(),
                brand: f.brand.trim(),
                model: f.model.trim(),
                processor: f.processor?.trim() || null,
                generation: f.generation?.trim() || null,
                ram: f.ram?.trim() || null,
                storage: f.storage?.trim() || null,
                gpu: f.gpu?.trim() || null,
                screen_size: f.screen_size?.trim() || null,
                grade: f.grade?.trim() || null
            });
            setShowAddModal(false);
            setAddForm(emptyAddForm());
            refreshAll();
        } catch (err) {
            alert(err.response?.data?.message || 'Could not add stock');
        } finally {
            setAddSaving(false);
        }
    };

    const submitReturn = async (e) => {
        e.preventDefault();
        if (!returnRow?.inventory_id) return;
        setReturnSaving(true);
        try {
            await api.put(`/inventory/${returnRow.inventory_id}`, {
                status: returnStatus,
                stock_type: returnStockType
            });
            setReturnRow(null);
            refreshAll();
        } catch (err) {
            alert(err.response?.data?.message || 'Could not update inventory');
        } finally {
            setReturnSaving(false);
        }
    };

    const trimOrNull = (v) => {
        const t = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
        return t === '' ? null : t;
    };

    const runGetFromErp = async () => {
        const id = erpLookupId.trim();
        if (!id) {
            alert('Enter serial number or TTSPL / machine id');
            return;
        }
        setErpSyncing(true);
        try {
            const { data } = await api.post(`/inventory/sync/${encodeURIComponent(id)}`);
            if (data?.success) {
                alert(
                    data.action === 'inserted'
                        ? `Added to inventory: ${data.machine_number || id}`
                        : `Updated inventory: ${data.machine_number || id}`
                );
                setErpLookupId('');
                refreshAll();
            } else {
                alert(data?.message || 'Could not fetch from ERP');
            }
        } catch (err) {
            const msg = err.response?.data?.message || err.response?.data?.error || 'ERP fetch failed';
            alert(msg);
        } finally {
            setErpSyncing(false);
        }
    };

    const submitEditInventory = async (e) => {
        e.preventDefault();
        if (!editRow?.inventory_id || !editForm) return;
        if (!editForm.brand?.trim() || !editForm.model?.trim()) {
            alert('Brand and Model are required.');
            return;
        }
        setEditSaving(true);
        try {
            await api.put(`/inventory/${editRow.inventory_id}`, {
                stock_type: editForm.stock_type,
                device_type: editForm.device_type,
                brand: editForm.brand.trim(),
                model: editForm.model.trim(),
                processor: trimOrNull(editForm.processor),
                generation: trimOrNull(editForm.generation),
                ram: trimOrNull(editForm.ram),
                storage: trimOrNull(editForm.storage),
                gpu: trimOrNull(editForm.gpu),
                screen_size: trimOrNull(editForm.screen_size),
                grade: trimOrNull(editForm.grade),
                status: editForm.status || 'In Stock',
                stage: trimOrNull(editForm.stage)
            });
            setEditRow(null);
            setEditForm(null);
            refreshAll();
        } catch (err) {
            alert(err.response?.data?.message || 'Could not save inventory updates');
        } finally {
            setEditSaving(false);
        }
    };

    const th = 'text-left py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600';
    const td = 'py-1.5 px-2 text-[12px] leading-snug';

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Package className="text-amber-600 w-6 h-6" />
                        Inventory
                    </h2>
                    <p className="text-gray-600 text-[12px]">Machines in stock — compact view</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-start">
                    {canWriteInventory && (
                        <button
                            type="button"
                            onClick={() => {
                                setAddForm(emptyAddForm());
                                setShowAddModal(true);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[12px] font-medium"
                        >
                            <Plus className="w-4 h-4" />
                            Add stock
                        </button>
                    )}
                    {canGetFromErp ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={erpLookupId}
                                onChange={(e) => setErpLookupId(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        runGetFromErp();
                                    }
                                }}
                                placeholder="Serial or TTSPL / machine #"
                                className="w-44 sm:w-52 px-2 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                                disabled={erpSyncing}
                            />
                            <button
                                type="button"
                                onClick={runGetFromErp}
                                disabled={erpSyncing || !erpLookupId.trim()}
                                className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-[12px] font-medium"
                            >
                                {erpSyncing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Download className="w-4 h-4" />
                                )}
                                Get from ERP
                            </button>
                            <button
                                type="button"
                                title="Reload list from CRM (no ERP call)"
                                onClick={refreshAll}
                                className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading || sumLoading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={refreshAll}
                            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[12px]"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading || sumLoading ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <StockSummaryWidget summary={summary} loading={sumLoading} listTotal={total} />
                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                    <div className="relative flex-1 min-w-0 max-w-md">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search Machine #, Serial, Brand…"
                            className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                        />
                    </div>
                    <select
                        value={stockType}
                        onChange={(e) => setStockType(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-[12px] w-full md:w-auto"
                    >
                        <option value="">All Types</option>
                        <option value="Cooling Period">Cooling Period</option>
                        <option value="Ready">Ready</option>
                    </select>
                </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[860px]">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className={th}>Machine #</th>
                            <th className={th}>Serial / Details</th>
                            <th className={th}>Device</th>
                            <th className={th}>Specs</th>
                            <th className={th}>Stage</th>
                            <th className={th}>Grade</th>
                            <th className={th}>Stock type</th>
                            <th className={th}>Status</th>
                            {showActionsColumn && <th className={th}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((row) => (
                            <tr key={row.inventory_id ?? row.machine_number} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className={td}>
                                    {canSeeHistory ? (
                                        <button
                                            type="button"
                                            onClick={() => openHistory(row)}
                                            className="font-semibold text-blue-700 hover:text-blue-900 hover:underline text-left"
                                        >
                                            {row.machine_number || '—'}
                                        </button>
                                    ) : (
                                        <span className="font-semibold text-blue-700">{row.machine_number || '—'}</span>
                                    )}
                                </td>
                                <td className={`${td} text-gray-700`}>
                                    <div>{row.serial_number || '—'}</div>
                                </td>
                                <td className={td}>
                                    <div className="font-medium text-gray-800">{row.brand || ''} {row.model || ''}</div>
                                    <div className="text-[11px] text-gray-500">{row.device_type || ''}</div>
                                </td>
                                <td className={`${td} text-gray-600 text-[11px]`}>
                                    {[row.processor, row.generation, row.ram, row.storage].filter(Boolean).join(' · ') || '—'}
                                </td>
                                <td className={td}>
                                    <span className="text-[11px] text-gray-700">{row.stage || row.workflow_stage || '—'}</span>
                                </td>
                                <td className={td}>
                                    <span className="text-[11px]">{row.grade || '—'}</span>
                                </td>
                                <td className={td}>
                                    <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-800">{row.stock_type || '—'}</span>
                                </td>
                                <td className={td}>
                                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-800">{row.status || '—'}</span>
                                </td>
                                {showActionsColumn && (
                                    <td className={td}>
                                        <div className="flex flex-wrap gap-1">
                                            {canSeeHistory && (
                                                <button
                                                    type="button"
                                                    title="History"
                                                    onClick={() => openHistory(row)}
                                                    className="p-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-700"
                                                >
                                                    <History className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            {canEditInventory && (
                                                <button
                                                    type="button"
                                                    title="Edit details (identifiers fixed)"
                                                    onClick={() => {
                                                        setEditRow(row);
                                                        setEditForm(rowToEditForm(row));
                                                    }}
                                                    className="p-1 rounded border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-900"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            {canMarkReturn && row.status === 'Outward' && (
                                                <button
                                                    type="button"
                                                    title="Customer returned — put back in stock"
                                                    onClick={() => {
                                                        setReturnRow(row);
                                                        setReturnStockType('Ready');
                                                        setReturnStatus('In Stock');
                                                    }}
                                                    className="p-1 rounded border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900"
                                                >
                                                    <Undo2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {!loading && items.length === 0 && (
                            <tr>
                                <td colSpan={showActionsColumn ? 9 : 8} className="py-8 text-center text-gray-500 text-[12px]">
                                    No items found
                                </td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan={showActionsColumn ? 9 : 8} className="py-8 text-center">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-[12px] text-gray-600">
                    <span>
                        Showing {offset + 1}–{Math.min(offset + items.length, total)} of {total}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={offset === 0}
                            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            disabled={offset + PAGE_SIZE >= total}
                            onClick={() => setOffset((o) => o + PAGE_SIZE)}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}

            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <h3 className="font-bold text-gray-900">Add stock</h3>
                            <button type="button" onClick={() => setShowAddModal(false)} className="p-1 rounded hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <form onSubmit={submitAddStock} className="p-4 space-y-3 text-[13px]">
                            <div className="grid grid-cols-2 gap-2">
                                <label className="col-span-2 sm:col-span-1">
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Stock type</span>
                                    <select
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.stock_type}
                                        onChange={(e) => setAddForm({ ...addForm, stock_type: e.target.value })}
                                    >
                                        <option value="Cooling Period">Cooling Period</option>
                                        <option value="Ready">Ready</option>
                                    </select>
                                </label>
                                <label className="col-span-2 sm:col-span-1">
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Device type</span>
                                    <select
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.device_type}
                                        onChange={(e) => setAddForm({ ...addForm, device_type: e.target.value })}
                                    >
                                        <option value="Laptop">Laptop</option>
                                        <option value="Desktop">Desktop</option>
                                    </select>
                                </label>
                            </div>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Machine # *</span>
                                <input
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={addForm.machine_number}
                                    onChange={(e) => setAddForm({ ...addForm, machine_number: e.target.value })}
                                    required
                                />
                            </label>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Serial # *</span>
                                <input
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={addForm.serial_number}
                                    onChange={(e) => setAddForm({ ...addForm, serial_number: e.target.value })}
                                    required
                                />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Brand *</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.brand}
                                        onChange={(e) => setAddForm({ ...addForm, brand: e.target.value })}
                                        required
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Model *</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.model}
                                        onChange={(e) => setAddForm({ ...addForm, model: e.target.value })}
                                        required
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Processor</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.processor}
                                        onChange={(e) => setAddForm({ ...addForm, processor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Generation</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.generation}
                                        onChange={(e) => setAddForm({ ...addForm, generation: e.target.value })}
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">RAM</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.ram}
                                        onChange={(e) => setAddForm({ ...addForm, ram: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Storage</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.storage}
                                        onChange={(e) => setAddForm({ ...addForm, storage: e.target.value })}
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">GPU</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.gpu}
                                        onChange={(e) => setAddForm({ ...addForm, gpu: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Screen</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={addForm.screen_size}
                                        onChange={(e) => setAddForm({ ...addForm, screen_size: e.target.value })}
                                    />
                                </label>
                            </div>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Grade</span>
                                <input
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={addForm.grade}
                                    onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })}
                                />
                            </label>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700" onClick={() => setShowAddModal(false)}>
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={addSaving}
                                    className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium disabled:opacity-50"
                                >
                                    {addSaving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {editRow && editForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <div>
                                <h3 className="font-bold text-gray-900">Edit inventory</h3>
                                <p className="text-[11px] text-gray-500 mt-0.5">Machine # and serial cannot be changed.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditRow(null);
                                    setEditForm(null);
                                }}
                                className="p-1 rounded hover:bg-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <form onSubmit={submitEditInventory} className="p-4 space-y-3 text-[13px]">
                            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[12px] text-gray-700 space-y-1">
                                <div>
                                    <span className="text-gray-500">Machine #</span>{' '}
                                    <span className="font-semibold">{editRow.machine_number || '—'}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Serial #</span>{' '}
                                    <span className="font-semibold">{editRow.serial_number || '—'}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="col-span-2 sm:col-span-1">
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Stock type</span>
                                    <select
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.stock_type}
                                        onChange={(e) => setEditForm({ ...editForm, stock_type: e.target.value })}
                                    >
                                        <option value="Cooling Period">Cooling Period</option>
                                        <option value="Ready">Ready</option>
                                    </select>
                                </label>
                                <label className="col-span-2 sm:col-span-1">
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Device type</span>
                                    <select
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.device_type}
                                        onChange={(e) => setEditForm({ ...editForm, device_type: e.target.value })}
                                    >
                                        <option value="Laptop">Laptop</option>
                                        <option value="Desktop">Desktop</option>
                                    </select>
                                </label>
                            </div>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Status</span>
                                <select
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={editForm.status}
                                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                                >
                                    <option value="In Stock">In Stock</option>
                                    <option value="Ready">Ready</option>
                                    <option value="In Repair">In Repair</option>
                                    <option value="Reserved">Reserved</option>
                                    <option value="Floor">Floor</option>
                                    <option value="Outward">Outward</option>
                                </select>
                            </label>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Stage</span>
                                <input
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={editForm.stage}
                                    onChange={(e) => setEditForm({ ...editForm, stage: e.target.value })}
                                    placeholder="Workflow / QC stage label"
                                />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Brand *</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.brand}
                                        onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                                        required
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Model *</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.model}
                                        onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                                        required
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Processor</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.processor}
                                        onChange={(e) => setEditForm({ ...editForm, processor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Generation</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.generation}
                                        onChange={(e) => setEditForm({ ...editForm, generation: e.target.value })}
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">RAM</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.ram}
                                        onChange={(e) => setEditForm({ ...editForm, ram: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Storage</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.storage}
                                        onChange={(e) => setEditForm({ ...editForm, storage: e.target.value })}
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">GPU</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.gpu}
                                        onChange={(e) => setEditForm({ ...editForm, gpu: e.target.value })}
                                    />
                                </label>
                                <label>
                                    <span className="text-gray-600 text-[11px] block mb-0.5">Screen</span>
                                    <input
                                        className="w-full border rounded-lg px-2 py-1.5"
                                        value={editForm.screen_size}
                                        onChange={(e) => setEditForm({ ...editForm, screen_size: e.target.value })}
                                    />
                                </label>
                            </div>
                            <label>
                                <span className="text-gray-600 text-[11px] block mb-0.5">Grade</span>
                                <input
                                    className="w-full border rounded-lg px-2 py-1.5"
                                    value={editForm.grade}
                                    onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}
                                />
                            </label>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700"
                                    onClick={() => {
                                        setEditRow(null);
                                        setEditForm(null);
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={editSaving}
                                    className="px-3 py-1.5 rounded-lg bg-teal-600 text-white font-medium disabled:opacity-50 hover:bg-teal-700"
                                >
                                    {editSaving ? 'Saving…' : 'Save changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {historyFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-lg max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
                            <div>
                                <h3 className="font-bold text-gray-900">Machine history</h3>
                                <p className="text-[11px] text-gray-500">
                                    {historyFor.machine_number} · {historyFor.serial_number}
                                </p>
                            </div>
                            <button type="button" onClick={() => { setHistoryFor(null); setHistoryData(null); }} className="p-1 rounded hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1 text-[12px]">
                            {historyLoading && (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                                </div>
                            )}
                            {!historyLoading && historyData?.error && (
                                <p className="text-red-600">{historyData.error}</p>
                            )}
                            {!historyLoading && historyData?.events && (
                                <ul className="space-y-3 border-l-2 border-blue-100 pl-3 ml-1">
                                    {historyData.events.map((ev, i) => (
                                        <li key={`${ev.type}-${i}-${ev.at}`} className="relative">
                                            <span className="absolute -left-[15px] top-1.5 w-2 h-2 rounded-full bg-blue-500" />
                                            <div className="text-[11px] text-gray-500">{formatTs(ev.at)}</div>
                                            <div className="font-medium text-gray-900">{ev.title}</div>
                                            {ev.detail && typeof ev.detail === 'object' && (
                                                <div className="text-[11px] text-gray-600 mt-0.5 space-y-0.5">
                                                    {ev.detail.customer_name && (
                                                        <div>Customer: {ev.detail.customer_name}{ev.detail.customer_phone ? ` · ${ev.detail.customer_phone}` : ''}</div>
                                                    )}
                                                    {ev.detail.order_id != null && (
                                                        <div>Order #{ev.detail.order_id}</div>
                                                    )}
                                                    {ev.detail.ticket_id != null && (
                                                        <div>Ticket #{ev.detail.ticket_id} ({ev.detail.status})</div>
                                                    )}
                                                    {ev.type === 'inventory_added' && (
                                                        <div>
                                                            Stock: {ev.detail.stock_type} · Status: {ev.detail.status}
                                                            {ev.detail.grade ? ` · Grade: ${ev.detail.grade}` : ''}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {!historyLoading && historyData?.events?.length === 0 && (
                                <p className="text-gray-500">No timeline events yet besides inventory record.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {returnRow && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <form onSubmit={submitReturn} className="bg-white rounded-xl shadow-lg max-w-sm w-full border border-gray-200 p-4 space-y-3 text-[13px]">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="font-bold text-gray-900">Customer return</h3>
                                <p className="text-[11px] text-gray-600 mt-1">
                                    Mark {returnRow.machine_number} back in stock after return (was Outward).
                                </p>
                            </div>
                            <button type="button" onClick={() => setReturnRow(null)} className="p-1 rounded hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <label>
                            <span className="text-gray-600 text-[11px] block mb-0.5">Stock type after return</span>
                            <select
                                className="w-full border rounded-lg px-2 py-1.5"
                                value={returnStockType}
                                onChange={(e) => setReturnStockType(e.target.value)}
                            >
                                <option value="Ready">Ready</option>
                                <option value="Cooling Period">Cooling Period</option>
                            </select>
                        </label>
                        <label>
                            <span className="text-gray-600 text-[11px] block mb-0.5">Status</span>
                            <select
                                className="w-full border rounded-lg px-2 py-1.5"
                                value={returnStatus}
                                onChange={(e) => setReturnStatus(e.target.value)}
                            >
                                <option value="In Stock">In Stock</option>
                                <option value="Ready">Ready</option>
                            </select>
                        </label>
                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" className="px-3 py-1.5 rounded-lg border border-gray-200" onClick={() => setReturnRow(null)}>
                                Cancel
                            </button>
                            <button type="submit" disabled={returnSaving} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium disabled:opacity-50">
                                {returnSaving ? 'Saving…' : 'Update inventory'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
