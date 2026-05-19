import React, { useCallback, useEffect, useState } from 'react';
import {
    Search,
    RefreshCw,
    Loader2,
    Eye,
    Building2,
    X,
    History,
    Package
} from 'lucide-react';

const PAGE_SIZE = 50;

function formatTs(value) {
    if (!value) return '—';
    try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return String(value);
    }
}

export default function CustomerInventory({ api }) {
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailCustomer, setDetailCustomer] = useState(null);
    const [detailAssets, setDetailAssets] = useState([]);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        setOffset(0);
    }, [debouncedSearch]);

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('limit', String(PAGE_SIZE));
            params.set('offset', String(offset));
            if (debouncedSearch) params.set('search', debouncedSearch);
            const { data } = await api.get('/customer-inventory/customers?' + params.toString());
            setItems(data.items || []);
            setTotal(Number(data.total) || 0);
        } catch (e) {
            console.error(e);
            setItems([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [api, debouncedSearch, offset]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    const openDetail = async (row) => {
        if (!row?.customer_id) return;
        setDetailOpen(true);
        setDetailCustomer(row);
        setDetailAssets([]);
        setDetailLoading(true);
        try {
            const { data } = await api.get(`/customer-inventory/customers/${row.customer_id}`);
            if (data?.success) {
                setDetailCustomer(data.customer);
                setDetailAssets(data.assets || []);
            }
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || 'Could not load assets');
        } finally {
            setDetailLoading(false);
        }
    };

    const runFullSync = async () => {
        if (!window.confirm('Start full sync from ERP for all customers? This may take several minutes.')) return;
        setSyncing(true);
        try {
            await api.post('/customer-inventory/sync?async=1');
            alert('Sync started in background. Refresh this page in a few minutes.');
        } catch (e) {
            alert(e.response?.data?.message || 'Sync request failed');
        } finally {
            setSyncing(false);
        }
    };

    const th = 'text-left py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600';
    const td = 'py-1.5 px-2 text-[12px] leading-snug';

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Building2 className="text-indigo-600 w-6 h-6" />
                        Customer Inventory
                    </h2>
                    <p className="text-gray-600 text-[12px]">
                        ERP customers and linked assets (rental / sale / demo). Synced periodically from ERP.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={runFullSync}
                        disabled={syncing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[12px] font-medium disabled:opacity-50"
                    >
                        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />}
                        Sync from ERP
                    </button>
                    <button
                        type="button"
                        onClick={() => loadItems()}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[12px]"
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
                    placeholder="Search name, customer ID, phone, machine # or serial…"
                    className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-[12px]"
                />
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[720px]">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className={th}>ID</th>
                            <th className={th}>Customer</th>
                            <th className={th}>Contact</th>
                            <th className={th}>Email</th>
                            <th className={th}>Assets</th>
                            <th className={th}>Updated</th>
                            <th className={th}>View</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((row) => (
                            <tr key={row.customer_id} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className={td}>
                                    <span className="font-mono text-[11px] text-gray-700">{row.customer_id}</span>
                                </td>
                                <td className={`${td} font-medium text-gray-900`}>{row.customer_name || '—'}</td>
                                <td className={`${td} text-gray-600 text-[11px]`}>
                                    <div>{row.contact_person_name || '—'}</div>
                                    <div className="text-gray-500">{row.contact_person_number || row.customer_number || ''}</div>
                                </td>
                                <td className={`${td} text-gray-600 text-[11px] break-all max-w-[200px]`}>
                                    {row.email || '—'}
                                </td>
                                <td className={td}>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-[11px] font-semibold text-slate-800">
                                        <Package className="w-3 h-3" />
                                        {row.asset_count ?? 0}
                                    </span>
                                </td>
                                <td className={`${td} text-[11px] text-gray-500`}>{formatTs(row.updated_at)}</td>
                                <td className={td}>
                                    <button
                                        type="button"
                                        title="View assets"
                                        onClick={() => openDetail(row)}
                                        className="p-1.5 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-900"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!loading && items.length === 0 && (
                            <tr>
                                <td colSpan={7} className="py-10 text-center text-gray-500 text-[12px]">
                                    No customers found. Run “Sync from ERP” if this is the first time.
                                </td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan={7} className="py-10 text-center">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
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

            {detailOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col border border-gray-200">
                        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 shrink-0">
                            <div>
                                <h3 className="font-bold text-gray-900 text-lg">Customer assets</h3>
                                <p className="text-[12px] text-gray-600 mt-0.5">
                                    {detailCustomer?.customer_name || '—'}{' '}
                                    <span className="font-mono text-gray-500">({detailCustomer?.customer_id})</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setDetailOpen(false);
                                    setDetailCustomer(null);
                                    setDetailAssets([]);
                                }}
                                className="p-1 rounded hover:bg-gray-100"
                            >
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        <div className="px-4 py-3 bg-slate-50 border-b border-gray-100 text-[12px] grid sm:grid-cols-2 gap-2 shrink-0">
                            <div>
                                <span className="text-gray-500">Contact</span>
                                <div className="font-medium">
                                    {detailCustomer?.contact_person_name || '—'} ·{' '}
                                    {detailCustomer?.contact_person_number || detailCustomer?.customer_number || '—'}
                                </div>
                            </div>
                            <div>
                                <span className="text-gray-500">Email</span>
                                <div className="font-medium break-all">{detailCustomer?.email || '—'}</div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-4">
                            {detailLoading && (
                                <div className="flex justify-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                                </div>
                            )}
                            {!detailLoading && (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[960px] text-[11px]">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className={th}>Type</th>
                                                <th className={th}>Bucket</th>
                                                <th className={th}>DC</th>
                                                <th className={th}>Delivered</th>
                                                <th className={th}>Machine #</th>
                                                <th className={th}>Serial</th>
                                                <th className={th}>Model</th>
                                                <th className={th}>Specs</th>
                                                <th className={th}>Rate</th>
                                                <th className={th}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailAssets.map((a) => (
                                                <tr key={a.id} className="border-t border-gray-100">
                                                    <td className={td}>
                                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 capitalize">
                                                            {a.asset_kind}
                                                        </span>
                                                    </td>
                                                    <td className={td}>
                                                        <span className="capitalize text-gray-700">{a.asset_bucket}</span>
                                                    </td>
                                                    <td className={`${td} font-mono`}>{a.dc_number || '—'}</td>
                                                    <td className={`${td} whitespace-nowrap`}>{formatTs(a.delivery_date)}</td>
                                                    <td className={`${td} font-mono text-indigo-800`}>
                                                        {a.unique_serial_number || '—'}
                                                    </td>
                                                    <td className={`${td} font-mono`}>{a.serial_number || '—'}</td>
                                                    <td className={td}>{a.model_name || '—'}</td>
                                                    <td className={`${td} text-gray-600`}>
                                                        {[a.processor, a.generation, a.ram, a.storage].filter(Boolean).join(' · ') ||
                                                            '—'}
                                                    </td>
                                                    <td className={td}>{a.rate != null ? a.rate : '—'}</td>
                                                    <td className={td}>
                                                        <span className="text-gray-700">{a.delivery_status || '—'}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {detailAssets.length === 0 && (
                                                <tr>
                                                    <td colSpan={10} className="py-8 text-center text-gray-500">
                                                        No assets stored yet for this customer.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
