import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ClipboardCheck,
    Eye,
    Loader2,
    RefreshCw,
    Search,
    X,
    MessageSquarePlus,
    BadgeCheck,
    RotateCcw,
    Truck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 50;

/** Orders where at least some lines can be QC-checked (including mixed procurement + assigned). */
const QC_ELIGIBLE_ORDER_STATUSES = ['Procurement Pending', 'Warehouse Pending', 'QC Pending'];

const QC_CHECK_KEYS = [
    'physical_integrity',
    'keyboard_trackpad',
    'ports',
    'battery',
    'display',
    'webcam',
    'os'
];

const QC_CHECK_LABELS = {
    physical_integrity: 'Physical integrity',
    keyboard_trackpad: 'Keyboard & trackpad',
    ports: 'Ports',
    battery: 'Battery',
    display: 'Display',
    webcam: 'Webcam',
    os: 'OS / image'
};

function formatOrderDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Time in QC: from qc_received_at to qc_completed_at, or elapsed since received if not completed. */
function formatQcDuration(order) {
    if (!order?.qc_received_at) return '—';
    const start = new Date(order.qc_received_at).getTime();
    if (Number.isNaN(start)) return '—';
    const end = order.qc_completed_at ? new Date(order.qc_completed_at).getTime() : Date.now();
    if (Number.isNaN(end)) return '—';
    let ms = Math.max(0, end - start);
    const days = Math.floor(ms / 86400000);
    ms %= 86400000;
    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const mins = Math.floor(ms / 60000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);
    return parts.join(' ');
}

function statusBadgeClass(status) {
    const m = {
        'Procurement Pending': 'bg-amber-100 text-amber-800',
        'Warehouse Pending': 'bg-teal-100 text-teal-800',
        'QC Pending': 'bg-purple-100 text-purple-800'
    };
    return m[status] || 'bg-gray-100 text-gray-800';
}

/** One order line (may represent qty &gt; 1 until each unit has its own row/machine). */
function LaptopLineSummary({ item }) {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const specBits = [item.processor, item.generation, item.ram, item.storage].filter(Boolean);
    const spec = specBits.join(' | ');
    const title = [item.brand, item.preferred_model].filter(Boolean).join(' ').trim() || '—';
    const awaitingWarehouse = item.status === 'Warehouse';
    const hasMachineVisible =
        !awaitingWarehouse && !!(item.inventory_id && (item.machine_number || item.serial_number));
    const qtyMismatch = qty > 1 && !hasMachineVisible && !awaitingWarehouse;
    const partialMachine = qty > 1 && hasMachineVisible;

    return (
        <div className="text-[12px] text-gray-800 leading-snug border-l-2 border-slate-200 pl-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">{title}</span>
                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5 tabular-nums">
                    Qty {qty}
                </span>
            </div>
            {spec ? <div className="text-[11px] text-gray-600 mt-0.5">{spec}</div> : null}
            {awaitingWarehouse ? (
                <div className="text-[11px] text-teal-800 font-medium mt-0.5">
                    Warehouse queue — confirm machine or replace there first. Machine number appears here after warehouse
                    marks the line ready for QC.
                </div>
            ) : hasMachineVisible ? (
                <div className="text-[11px] text-blue-600 font-medium mt-0.5">
                    Machine: {item.machine_number || item.serial_number}
                    {partialMachine ? (
                        <span className="block text-amber-700 font-normal mt-0.5">
                            This line is quantity {qty} — only one machine is linked. Assign more machines (split lines or
                            link units) so each laptop is tracked.
                        </span>
                    ) : null}
                </div>
            ) : (
                <div className="text-[11px] text-amber-600 mt-0.5">
                    {qtyMismatch ? `Pending assignment for all ${qty} unit(s)` : 'Pending assignment'}
                </div>
            )}
        </div>
    );
}

/**
 * QC-only detail: machines, checklists, notes — no customer / security / pricing / delivery.
 */
function QcOrderPeekModal({ orderId, initialExpandItemId, api, onClose, onSaved }) {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submittingId, setSubmittingId] = useState(null);
    const [checklistByItem, setChecklistByItem] = useState({});
    const [ramStorageByItem, setRamStorageByItem] = useState({});
    const [replaceModal, setReplaceModal] = useState(null);
    const expandRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get(`/sales/orders/${orderId}`);
                if (!cancelled) {
                    setDetails(data);
                    const ch = {};
                    const rs = {};
                    (data.items || []).forEach((it) => {
                        const blank = {};
                        QC_CHECK_KEYS.forEach((k) => {
                            blank[k] = false;
                        });
                        ch[it.item_id] = blank;
                        rs[it.item_id] = { ram: it.ram ?? '', storage: it.storage ?? '' };
                    });
                    setChecklistByItem(ch);
                    setRamStorageByItem(rs);
                }
            } catch (e) {
                console.error(e);
                if (!cancelled) setDetails(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [orderId, api]);

    useEffect(() => {
        if (!initialExpandItemId || !expandRef.current) return;
        const el = document.getElementById(`qc-item-${initialExpandItemId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [initialExpandItemId, details, loading]);

    const canSubmitItem = (item) => {
        const st = details?.order?.status;
        return (
            item.status === 'Assigned' &&
            item.inventory_id &&
            item.qc_passed !== true &&
            QC_ELIGIBLE_ORDER_STATUSES.includes(st)
        );
    };

    const canQcAssetActions = (item) => {
        const st = details?.order?.status;
        if (!QC_ELIGIBLE_ORDER_STATUSES.includes(st)) return false;
        if (item.qc_passed === true) return false;
        return ['Assigned', 'Warehouse'].includes(item.status);
    };

    const reloadDetails = async () => {
        const { data } = await api.get(`/sales/orders/${orderId}`);
        setDetails(data);
        const ch = {};
        const rs = {};
        (data.items || []).forEach((it) => {
            const blank = {};
            QC_CHECK_KEYS.forEach((k) => {
                blank[k] = false;
            });
            ch[it.item_id] = blank;
            rs[it.item_id] = { ram: it.ram ?? '', storage: it.storage ?? '' };
        });
        setChecklistByItem(ch);
        setRamStorageByItem(rs);
    };

    const handleQcReplace = async (e) => {
        e.preventDefault();
        if (!replaceModal?.new_machine_number?.trim()) {
            alert('Enter new machine number');
            return;
        }
        const itemId = replaceModal.item_id;
        setSubmittingId(`replace-${itemId}`);
        try {
            await api.post(`/sales/orders/${orderId}/items/${itemId}/qc-replace`, {
                new_machine_number: replaceModal.new_machine_number.trim()
            });
            setReplaceModal(null);
            onSaved?.();
            await reloadDetails();
        } catch (err) {
            alert(err.response?.data?.message || err.message || 'Replace failed');
        } finally {
            setSubmittingId(null);
        }
    };

    const handleSendToProcurement = async (item) => {
        if (
            !window.confirm(
                'Send this line to procurement? The current machine will be released to stock (if any). Order may move to Procurement Pending.'
            )
        ) {
            return;
        }
        setSubmittingId(`proc-${item.item_id}`);
        try {
            await api.post(`/sales/orders/${orderId}/items/${item.item_id}/send-to-procurement`);
            onSaved?.();
            await reloadDetails();
        } catch (err) {
            alert(err.response?.data?.message || err.message || 'Request failed');
        } finally {
            setSubmittingId(null);
        }
    };

    const submitQc = async (item) => {
        const itemId = item.item_id;
        const checklist = checklistByItem[itemId];
        if (!checklist || !QC_CHECK_KEYS.every((k) => checklist[k] === true)) {
            alert('Confirm every checklist item before QC pass.');
            return;
        }
        setSubmittingId(itemId);
        try {
            const ramSnap = ramStorageByItem[itemId] || {};
            await api.post(`/sales/orders/${orderId}/items/${itemId}/qc-pass-submit`, {
                checklist,
                ram: ramSnap.ram || undefined,
                storage: ramSnap.storage || undefined
            });
            onSaved?.();
            const { data } = await api.get(`/sales/orders/${orderId}`);
            setDetails(data);
            const ch = {};
            const nextRamStorage = {};
            (data.items || []).forEach((it) => {
                const blank = {};
                QC_CHECK_KEYS.forEach((k) => {
                    blank[k] = false;
                });
                ch[it.item_id] = blank;
                nextRamStorage[it.item_id] = { ram: it.ram ?? '', storage: it.storage ?? '' };
            });
            setChecklistByItem(ch);
            setRamStorageByItem(nextRamStorage);
        } catch (e) {
            alert(e.response?.data?.message || e.message || 'QC pass failed');
        } finally {
            setSubmittingId(null);
        }
    };

    const qcNotesOnly = useMemo(() => {
        const h = details?.status_history || [];
        return h.filter((row) => String(row.notes || '').includes('QC Note'));
    }, [details]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="px-4 py-3 border-b flex justify-between items-center shrink-0 bg-slate-50">
                    <div>
                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <ClipboardCheck className="w-4 h-4 text-purple-600" />
                            Order #{orderId}
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">QC view — assignment & checklists only</p>
                        {details?.order?.qc_received_at ? (
                            <p className="text-[10px] text-slate-600 mt-1">
                                QC received: {formatDateTime(details.order.qc_received_at)}
                                {details.order.qc_completed_at
                                    ? ` · QC completed: ${formatDateTime(details.order.qc_completed_at)}`
                                    : null}
                            </p>
                        ) : null}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200" aria-label="Close">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div ref={expandRef} className="overflow-y-auto p-4 space-y-4 flex-1">
                    {loading ? (
                        <div className="py-10 flex justify-center">
                            <Loader2 className="w-7 h-7 animate-spin text-purple-600" />
                        </div>
                    ) : !details?.order ? (
                        <p className="text-sm text-red-600 text-center py-6">Could not load order.</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-2 items-center text-[12px]">
                                <span className="text-slate-500">Status</span>
                                <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadgeClass(
                                        details.order.status
                                    )}`}
                                >
                                    {details.order.status}
                                </span>
                                <span className="text-slate-400">·</span>
                                <span className="text-slate-600">{formatOrderDate(details.order.created_at)}</span>
                            </div>

                            <div className="space-y-3">
                                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Laptops</div>
                                {(details.items || []).map((it) => (
                                    <div
                                        key={it.item_id}
                                        id={`qc-item-${it.item_id}`}
                                        className="rounded-lg border border-slate-200 p-3 bg-white"
                                    >
                                        <LaptopLineSummary item={it} />
                                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                            <span className="text-slate-500">Line status:</span>
                                            <span className="font-medium text-slate-800">{it.status}</span>
                                            <span className="text-slate-400">|</span>
                                            <span className="font-medium text-slate-700 tabular-nums">
                                                Qty {Math.max(1, parseInt(it.quantity, 10) || 1)}
                                            </span>
                                            {it.qc_passed ? (
                                                <span className="text-emerald-600 font-medium">QC passed</span>
                                            ) : null}
                                        </div>

                                        {canQcAssetActions(it) ? (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {it.inventory_id ? (
                                                    <button
                                                        type="button"
                                                        disabled={submittingId != null}
                                                        onClick={() =>
                                                            setReplaceModal({ item_id: it.item_id, new_machine_number: '' })
                                                        }
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-[11px] font-medium hover:bg-amber-100 disabled:opacity-50"
                                                    >
                                                        <RotateCcw className="w-3.5 h-3.5" />
                                                        Replace machine
                                                    </button>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    disabled={submittingId != null}
                                                    onClick={() => handleSendToProcurement(it)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 bg-slate-50 text-slate-800 text-[11px] font-medium hover:bg-slate-100 disabled:opacity-50"
                                                >
                                                    <Truck className="w-3.5 h-3.5" />
                                                    Send to procurement
                                                </button>
                                            </div>
                                        ) : null}

                                        {canSubmitItem(it) ? (
                                            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                                                <div className="text-[11px] font-medium text-slate-700">QC checklist</div>
                                                <div className="grid gap-1.5">
                                                    {QC_CHECK_KEYS.map((key) => (
                                                        <label
                                                            key={key}
                                                            className="flex items-center gap-2 text-[12px] text-slate-800 cursor-pointer"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={!!checklistByItem[it.item_id]?.[key]}
                                                                onChange={(e) =>
                                                                    setChecklistByItem((prev) => ({
                                                                        ...prev,
                                                                        [it.item_id]: {
                                                                            ...(prev[it.item_id] || {}),
                                                                            [key]: e.target.checked
                                                                        }
                                                                    }))
                                                                }
                                                                className="rounded border-slate-300"
                                                            />
                                                            {QC_CHECK_LABELS[key]}
                                                        </label>
                                                    ))}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 block">RAM (optional fix)</label>
                                                        <input
                                                            className="w-full border rounded px-2 py-1 text-[12px]"
                                                            value={ramStorageByItem[it.item_id]?.ram ?? ''}
                                                            onChange={(e) =>
                                                                setRamStorageByItem((prev) => ({
                                                                    ...prev,
                                                                    [it.item_id]: { ...prev[it.item_id], ram: e.target.value }
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 block">Storage (optional fix)</label>
                                                        <input
                                                            className="w-full border rounded px-2 py-1 text-[12px]"
                                                            value={ramStorageByItem[it.item_id]?.storage ?? ''}
                                                            onChange={(e) =>
                                                                setRamStorageByItem((prev) => ({
                                                                    ...prev,
                                                                    [it.item_id]: { ...prev[it.item_id], storage: e.target.value }
                                                                }))
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={submittingId === it.item_id}
                                                    onClick={() => submitQc(it)}
                                                    className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[12px] font-semibold hover:bg-purple-700 disabled:opacity-50"
                                                >
                                                    {submittingId === it.item_id ? 'Saving…' : 'Submit QC pass'}
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>

                            {qcNotesOnly.length > 0 ? (
                                <div>
                                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                        QC notes (history)
                                    </div>
                                    <ul className="space-y-2 text-[11px] text-slate-600 max-h-40 overflow-y-auto">
                                        {qcNotesOnly.map((row, i) => (
                                            <li key={i} className="border-l-2 border-amber-200 pl-2">
                                                <span className="text-slate-400">
                                                    {row.changed_at ? new Date(row.changed_at).toLocaleString() : ''}
                                                </span>
                                                <div className="text-slate-800">{row.notes}</div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>

                <div className="px-4 py-2 border-t bg-slate-50 flex justify-end shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-[12px] font-medium hover:bg-slate-900"
                    >
                        Close
                    </button>
                </div>
            </div>

            {replaceModal ? (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        setReplaceModal(null);
                    }}
                >
                    <form
                        className="bg-white rounded-xl shadow-xl p-4 w-full max-w-sm border border-slate-200"
                        onMouseDown={(e) => e.stopPropagation()}
                        onSubmit={handleQcReplace}
                    >
                        <div className="text-sm font-semibold text-slate-900 mb-1">Replace machine (line #{replaceModal.item_id})</div>
                        <p className="text-[11px] text-slate-600 mb-3">
                            Enter TTSPL / machine number. Order, dispatch, and lead snapshot update from inventory.
                        </p>
                        <input
                            className="w-full border rounded-lg px-3 py-2 text-sm font-mono mb-3"
                            placeholder="Machine number"
                            value={replaceModal.new_machine_number}
                            onChange={(e) =>
                                setReplaceModal((prev) => ({ ...prev, new_machine_number: e.target.value }))
                            }
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                className="px-3 py-1.5 text-[12px] rounded-lg border border-slate-200"
                                onClick={() => setReplaceModal(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submittingId != null || !replaceModal.new_machine_number?.trim()}
                                className="px-3 py-1.5 text-[12px] rounded-lg bg-amber-600 text-white font-medium disabled:opacity-50"
                            >
                                {submittingId?.startsWith('replace-') ? 'Saving…' : 'Replace'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </div>
    );
}

export default function QCOrders({ api }) {
    const { user } = useAuth();
    const userRole = String(user?.role ?? '').toLowerCase();
    const isManager = ['admin', 'manager'].includes(userRole);
    const isAdmin = userRole === 'admin';
    const authKey = String(user?.user_id ?? user?.userId ?? user?.sub ?? '');
    const [orders, setOrders] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [peek, setPeek] = useState(null);
    const [peekFocusItemId, setPeekFocusItemId] = useState(null);
    const [viewAll, setViewAll] = useState(isAdmin);

    useEffect(() => {
        if (isAdmin) setViewAll(true);
    }, [isAdmin]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        setOffset(0);
    }, [debouncedSearch, viewAll]);

    const load = useCallback(async () => {
        if (!api) return;
        setLoading(true);
        setLoadError(null);
        try {
            const params = new URLSearchParams();
            params.set('limit', String(PAGE_SIZE));
            params.set('offset', String(offset));
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (isManager && !viewAll) params.set('owner', 'mine');
            const { data } = await api.get('/sales/qc-pipeline-orders?' + params.toString());
            setOrders(data.orders || []);
            setTotal(Number(data.total) || 0);
        } catch (e) {
            console.error(e);
            setOrders([]);
            setTotal(0);
            const d = e.response?.data;
            let msg =
                e.response?.status === 401 || e.response?.status === 403
                    ? 'Session or permission problem — try refreshing the page or logging in again.'
                    : d?.message || e.message || 'Could not load QC orders.';
            if (d?.hint) msg += ` ${d.hint}`;
            setLoadError(msg);
        } finally {
            setLoading(false);
        }
    }, [api, debouncedSearch, offset, isManager, viewAll, authKey, userRole]);

    useEffect(() => {
        load();
    }, [load]);

    const openPeek = (order, focusItemId) => {
        setPeekFocusItemId(focusItemId || null);
        setPeek(order.order_id);
    };

    const firstQcItemId = (order) => {
        const it = (order.items || []).find(
            (i) =>
                i.status === 'Assigned' &&
                i.inventory_id &&
                i.qc_passed !== true &&
                QC_ELIGIBLE_ORDER_STATUSES.includes(order.status)
        );
        return it?.item_id ?? null;
    };

    const handleAddNote = async (order) => {
        const notes = window.prompt(`QC note for order #${order.order_id}:`, '');
        if (notes == null || !String(notes).trim()) return;
        try {
            await api.post(`/sales/orders/${order.order_id}/qc-note`, { notes: String(notes).trim() });
            await load();
        } catch (e) {
            alert(e.response?.data?.message || e.message || 'Failed to add note');
        }
    };

    const th = 'text-left py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600';
    const td = 'py-1.5 px-2 align-top';

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ClipboardCheck className="text-purple-600 w-6 h-6" />
                        QC Orders
                    </h2>
                    <p className="text-gray-600 text-[12px]">
                        Track procurement and QC. Assigned machines pass through Warehouse first; QC checklist applies after
                        warehouse marks a line ready.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {isManager && (
                        <label className="flex items-center gap-1.5 text-[12px] text-gray-700">
                            <input
                                type="checkbox"
                                checked={viewAll}
                                onChange={(e) => setViewAll(e.target.checked)}
                                className="rounded"
                            />
                            View all
                        </label>
                    )}
                    <button
                        type="button"
                        onClick={load}
                        className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[12px]"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Machine #, serial, company…"
                    className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                />
            </div>

            {loadError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    {loadError}
                </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[960px]">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className={th}>Order ID</th>
                            <th className={`${th} whitespace-nowrap`}>Order date</th>
                            <th className={`${th} whitespace-nowrap`}>QC received</th>
                            <th className={`${th} whitespace-nowrap`}>QC time</th>
                            <th className={th}>Laptop details</th>
                            <th className={th}>Status</th>
                            <th className={`${th} text-center w-[52px]`}>Items</th>
                            <th className={`${th} whitespace-nowrap`}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((order) => {
                            const qcItemId = firstQcItemId(order);
                            const showAddNote = ['Procurement Pending', 'Warehouse Pending'].includes(order.status);
                            const showQcPass = !!qcItemId;
                            return (
                                <tr key={order.order_id} className="border-t border-gray-100 hover:bg-gray-50">
                                    <td className={`${td} text-[12px] font-bold text-blue-600`}>#{order.order_id}</td>
                                    <td className={`${td} text-[11px] text-gray-600 whitespace-nowrap`}>
                                        {formatOrderDate(order.created_at)}
                                    </td>
                                    <td className={`${td} text-[11px] text-gray-700 whitespace-nowrap max-w-[140px]`}>
                                        {formatDateTime(order.qc_received_at)}
                                    </td>
                                    <td className={`${td} text-[11px] text-gray-800 whitespace-nowrap`} title={order.qc_completed_at ? `Completed: ${formatDateTime(order.qc_completed_at)}` : 'Elapsed since QC received'}>
                                        {formatQcDuration(order)}
                                    </td>
                                    <td className={td}>
                                        <div className="flex flex-col gap-1.5 max-w-md">
                                            {(order.items || []).map((it) => (
                                                <LaptopLineSummary key={it.item_id} item={it} />
                                            ))}
                                            {!(order.items || []).length && (
                                                <span className="text-[12px] text-gray-400">—</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className={td}>
                                        <span
                                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusBadgeClass(
                                                order.status
                                            )}`}
                                        >
                                            {order.status}
                                        </span>
                                    </td>
                                    <td className={`${td} text-center text-[12px] font-semibold text-gray-800`}>
                                        {order.items_count ?? '—'}
                                    </td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex flex-wrap items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => openPeek(order, null)}
                                                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 border border-transparent"
                                                aria-label="QC detail"
                                                title="QC detail"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            {showAddNote && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleAddNote(order)}
                                                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-900 border border-amber-200 text-[11px] font-medium hover:bg-amber-100"
                                                >
                                                    <MessageSquarePlus className="w-3.5 h-3.5" />
                                                    Add Note
                                                </button>
                                            )}
                                            {showQcPass && (
                                                <button
                                                    type="button"
                                                    onClick={() => openPeek(order, qcItemId)}
                                                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md bg-purple-50 text-purple-900 border border-purple-200 text-[11px] font-medium hover:bg-purple-100"
                                                >
                                                    <BadgeCheck className="w-3.5 h-3.5" />
                                                    QC Pass
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {!loading && orders.length === 0 && (
                            <tr>
                                <td colSpan={8} className="py-8 text-center text-gray-500 text-[12px]">
                                    No QC pipeline orders
                                </td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan={8} className="py-8 text-center">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600" />
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-[12px] text-gray-600">
                    <span>
                        Showing {offset + 1}–{Math.min(offset + orders.length, total)} of {total}
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

            {peek != null && (
                <QcOrderPeekModal
                    orderId={peek}
                    initialExpandItemId={peekFocusItemId}
                    api={api}
                    onClose={() => {
                        setPeek(null);
                        setPeekFocusItemId(null);
                    }}
                    onSaved={load}
                />
            )}
        </div>
    );
}