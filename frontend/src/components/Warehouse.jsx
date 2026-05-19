import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Package, CheckCircle, RefreshCw, X, Scan, RotateCcw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';

const PAGE_SIZE = 50;

function formatOrderDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Warehouse({ api }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalAll, setTotalAll] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [replaceModal, setReplaceModal] = useState(null);

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const offset = (page - 1) * PAGE_SIZE;
            let url = `/warehouse?limit=${PAGE_SIZE}&offset=${offset}`;
            if (searchTerm.trim()) {
                url += `&search=${encodeURIComponent(searchTerm.trim())}`;
            }
            const { data } = await api.get(url);
            setItems(data.items || []);
            setTotal(data.total ?? 0);
            setTotalAll(data.total_all ?? data.total ?? 0);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [api, page, searchTerm]);

    useEffect(() => {
        const t = setTimeout(() => loadItems(), searchTerm.trim() ? 350 : 0);
        return () => clearTimeout(t);
    }, [loadItems, searchTerm]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm]);

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    const showSerialColumn = items.some((it) => it.serial_number);

    const handleMarkReady = async (itemId) => {
        if (!window.confirm('Mark this laptop as ready? It will move to QC.')) return;
        try {
            const { data } = await api.post(`/warehouse/items/${itemId}/ready`);
            alert(`Laptop marked ready. Order #${data.order_id} moved to QC.`);
            loadItems();
        } catch (e) {
            alert(e.response?.data?.message || 'Failed to mark ready');
        }
    };

    const handleReplace = async (e) => {
        e.preventDefault();
        const { item_id, new_machine_number } = replaceModal;
        if (!new_machine_number?.trim()) {
            alert('Enter machine number');
            return;
        }
        try {
            const { data } = await api.post(`/warehouse/items/${item_id}/replace`, {
                new_machine_number: new_machine_number.trim()
            });
            alert(`Machine replaced. New: ${data.new_machine_number}\nOld laptop marked In Repair.`);
            setReplaceModal(null);
            loadItems();
        } catch (e) {
            alert(e.response?.data?.message || 'Failed to replace');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Package className="w-5 h-5 text-teal-600" />
                        Warehouse
                    </h2>
                    <p className="text-gray-600 text-xs">
                        Every machine assigned from stock appears here first (cooling or ready). Confirm or replace, then mark
                        ready for QC.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs w-64 max-w-full"
                            placeholder="Machine #, serial, company…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={loadItems}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="bg-teal-50 p-3 rounded-lg border border-teal-100 flex items-center gap-3">
                <div className="bg-white p-2 rounded-lg"><Package className="w-5 h-5 text-teal-600" /></div>
                <div>
                    <div className="text-lg font-bold text-teal-700">{searchTerm.trim() ? total : totalAll}</div>
                    <div className="text-xs text-teal-600">Warehouse queue{searchTerm.trim() ? ' (filtered)' : ''}</div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Order ID</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Order date</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Laptop</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Machine #</th>
                            {showSerialColumn ? (
                                <th className="px-3 py-2 font-medium text-gray-500 text-xs">Serial</th>
                            ) : null}
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Company</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {items.map((item) => (
                            <tr key={item.item_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">#{item.order_id}</span>
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatOrderDate(item.order_date)}</td>
                                <td className="px-3 py-2">
                                    <div className="font-semibold text-gray-900 text-xs">{item.brand} {item.preferred_model || 'Laptop'}</div>
                                    <div className="text-[11px] text-gray-500 leading-snug">{item.processor}{item.generation ? ` / ${item.generation}` : ''} / {item.ram} / {item.storage}</div>
                                    {item.stock_type ? (
                                        <div className="text-[10px] text-teal-700 mt-0.5">Stock: {item.stock_type}</div>
                                    ) : null}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">{item.machine_number || '-'}</td>
                                {showSerialColumn ? (
                                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{item.serial_number || '—'}</td>
                                ) : null}
                                <td className="px-3 py-2">
                                    <div className="text-xs font-medium">{item.company_name || item.customer_name || '-'}</div>
                                    <div className="text-[10px] text-gray-500">{item.gst_no ? `GST: ${item.gst_no}` : item.customer_email}</div>
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex gap-1.5 flex-wrap">
                                        <button
                                            onClick={() => handleMarkReady(item.item_id)}
                                            className="bg-green-600 text-white px-2 py-1 rounded-md text-xs font-medium hover:bg-green-700 flex items-center gap-0.5"
                                        >
                                            <CheckCircle className="w-3 h-3" /> Ready
                                        </button>
                                        <button
                                            onClick={() => setReplaceModal({ item_id: item.item_id, order_id: item.order_id, new_machine_number: '' })}
                                            className="bg-amber-600 text-white px-2 py-1 rounded-md text-xs font-medium hover:bg-amber-700 flex items-center gap-0.5"
                                        >
                                            <RotateCcw className="w-3 h-3" /> Replace
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {items.length === 0 && !loading && (
                    <div className="p-8 text-center text-gray-500">No cooling period items in warehouse.</div>
                )}
            </div>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between bg-white px-4 py-2 rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">
                        Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-3 py-2 text-sm font-medium text-gray-700">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            {replaceModal && (
                <ReplaceModal
                    replaceModal={replaceModal}
                    setReplaceModal={setReplaceModal}
                    onSubmit={handleReplace}
                />
            )}
        </div>
    );
}

function ReplaceModal({ replaceModal, setReplaceModal, onSubmit }) {
    const inputRef = useRef(null);
    const [showScanner, setShowScanner] = useState(false);

    const handleBarcodeScan = (code) => {
        setReplaceModal(prev => ({ ...prev, new_machine_number: code }));
        setShowScanner(false);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
                <div className="p-6 border-b flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <RotateCcw className="text-amber-600" /> Replace Machine
                        </h3>
                        <p className="text-sm text-gray-500">Order #{replaceModal.order_id}</p>
                    </div>
                    <button onClick={() => setReplaceModal(null)}><X className="w-6 h-6 text-gray-400" /></button>
                </div>

                <form onSubmit={onSubmit} className="p-6 space-y-4">
                    <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 text-sm text-amber-800">
                        Old laptop will be marked <strong>In Repair</strong> and won&apos;t appear for new orders.
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">New Machine Number</label>
                        {showScanner ? (
                            <div className="border rounded-lg overflow-hidden">
                                <BarcodeScanner
                                    onResult={handleBarcodeScan}
                                    onError={() => setShowScanner(false)}
                                />
                                <button type="button" onClick={() => setShowScanner(false)} className="w-full py-2 bg-gray-100 text-gray-700 text-sm">Cancel Scan</button>
                            </div>
                        ) : (
                            <>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={replaceModal.new_machine_number}
                                    onChange={e => setReplaceModal(prev => ({ ...prev, new_machine_number: e.target.value }))}
                                    placeholder="Scan or enter machine number"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowScanner(true)}
                                    className="mt-2 w-full py-2 border-2 border-dashed border-amber-300 text-amber-600 font-medium rounded-xl hover:bg-amber-50 flex items-center justify-center gap-2"
                                >
                                    <Scan className="w-5 h-5" /> Use Camera Scanner
                                </button>
                            </>
                        )}
                    </div>
                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => setReplaceModal(null)} className="flex-1 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" disabled={!replaceModal.new_machine_number?.trim()} className="flex-1 py-2 bg-amber-600 text-white rounded-lg font-bold disabled:opacity-50">
                            Replace
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
