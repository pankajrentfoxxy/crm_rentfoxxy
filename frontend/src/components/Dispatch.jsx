import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Calendar, Hash, CheckCircle, Loader2, X, Eye, RefreshCw, Laptop, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 50;

function formatOrderDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const emptySummary = {
    procurement_laptops: 0,
    warehouse_laptops: 0,
    qc_pending_laptops: 0,
    qc_passed_laptops: 0,
    dispatched_today_laptops: 0,
    on_the_way_laptops: 0,
    total_pipeline_laptops: 0,
    delivered_order_count: 0,
    delivered_laptops: 0
};

export default function Dispatch({ api }) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [dispatchModal, setDispatchModal] = useState(null);
    const [dispatchVerify, setDispatchVerify] = useState(null); // { order_id }
    const [dispatchVerifyLoading, setDispatchVerifyLoading] = useState(false);
    const [dispatchVerifyOrder, setDispatchVerifyOrder] = useState(null);
    const [dispatchVerifyAck, setDispatchVerifyAck] = useState(false);
    const [detailsModal, setDetailsModal] = useState(null);
    const [laptopDetailsModal, setLaptopDetailsModal] = useState(false);
    const [laptopDetails, setLaptopDetails] = useState([]);
    const [laptopDetailsLoading, setLaptopDetailsLoading] = useState(false);

    const isDispatch = user?.team_name?.includes('Dispatch') ||
        user?.role === 'admin' ||
        user?.role === 'manager' ||
        user?.role === 'floor_manager' ||
        user?.role === 'dispatch' ||
        user?.permissions?.includes('dispatch_access');

    const [pipelineOrders, setPipelineOrders] = useState([]);
    const [pipelineTotal, setPipelineTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [summary, setSummary] = useState(emptySummary);
    const [showDeliveredModal, setShowDeliveredModal] = useState(false);
    const [deliveredOrders, setDeliveredOrders] = useState([]);
    const [deliveredTotal, setDeliveredTotal] = useState(0);
    const [deliveredPage, setDeliveredPage] = useState(1);
    const [deliveredLoading, setDeliveredLoading] = useState(false);

    const loadPipeline = useCallback(async () => {
        setLoading(true);
        try {
            const offset = (page - 1) * PAGE_SIZE;
            let url = `/sales/dispatch-pipeline-orders?limit=${PAGE_SIZE}&offset=${offset}`;
            if (searchTerm.trim()) {
                url += `&search=${encodeURIComponent(searchTerm.trim())}`;
            }
            const { data } = await api.get(url);
            setPipelineOrders(data.orders || []);
            setPipelineTotal(data.total ?? 0);
            if (data.summary) {
                setSummary({ ...emptySummary, ...data.summary });
            }
        } catch (e) {
            console.error(e);
            setPipelineOrders([]);
            setPipelineTotal(0);
        } finally {
            setLoading(false);
        }
    }, [api, page, searchTerm]);

    const loadDelivered = useCallback(async () => {
        setDeliveredLoading(true);
        try {
            const offset = (deliveredPage - 1) * PAGE_SIZE;
            const { data } = await api.get(
                `/sales/orders?status=Delivered&limit=${PAGE_SIZE}&offset=${offset}`
            );
            setDeliveredOrders(data.orders || []);
            setDeliveredTotal(data.total ?? (data.orders?.length ?? 0));
        } catch (e) {
            console.error(e);
            setDeliveredOrders([]);
            setDeliveredTotal(0);
        } finally {
            setDeliveredLoading(false);
        }
    }, [api, deliveredPage]);

    const loadOrders = loadPipeline;

    useEffect(() => {
        if (!isDispatch) return;
        const t = setTimeout(() => loadPipeline(), searchTerm.trim() ? 350 : 0);
        return () => clearTimeout(t);
    }, [isDispatch, page, searchTerm, loadPipeline]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (showDeliveredModal && isDispatch) loadDelivered();
    }, [showDeliveredModal, isDispatch, loadDelivered]);

    const pipelineTotalPages = Math.ceil(pipelineTotal / PAGE_SIZE) || 1;
    const deliveredTotalPages = Math.ceil(deliveredTotal / PAGE_SIZE) || 1;

    const canUpdateOrder = (order) => {
        const status = order?.status;
        const hasReadyForDispatch = Number(order?.ready_for_dispatch_count || 0) > 0;
        return ['QC Passed', 'Dispatched', 'Delivered'].includes(status) || hasReadyForDispatch;
    };

    const downloadPdf = (blob, filename) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const handleGenerateInvoice = async (orderId) => {
        try {
            const { data } = await api.get(`/sales/orders/${orderId}/invoice-pdf`, { responseType: 'blob' });
            downloadPdf(data, `invoice-${orderId}.pdf`);
            loadOrders();
        } catch (e) {
            console.error(e);
            alert('Failed to download invoice: ' + (e.response?.data?.message || e.message));
        }
    };

    const handleGenerateEway = async (orderId) => {
        try {
            const { data } = await api.get(`/sales/orders/${orderId}/eway-pdf`, { responseType: 'blob' });
            downloadPdf(data, `eway-bill-${orderId}.pdf`);
            loadOrders();
        } catch (e) {
            console.error(e);
            alert('Failed to download e-way bill: ' + (e.response?.data?.message || e.message));
        }
    };

    const handleDelivered = async (orderId) => {
        if (!window.confirm('Mark this order as Delivered?')) return;
        try {
            await api.put(`/sales/orders/${orderId}/delivered`);
            alert('Order marked as Delivered');
            loadOrders();
        } catch (e) {
            console.error(e);
            alert('Failed to mark delivered: ' + (e.response?.data?.message || e.message));
        }
    };

    const handleOpenLaptopDetails = async () => {
        setLaptopDetailsModal(true);
        setLaptopDetailsLoading(true);
        try {
            const { data } = await api.get('/sales/orders/pipeline-laptops');
            setLaptopDetails(data.laptops || []);
        } catch (e) {
            console.error(e);
            setLaptopDetails([]);
        } finally {
            setLaptopDetailsLoading(false);
        }
    };

    const handleDispatch = async () => {
        if (!dispatchModal) return;
        const { order_id, dispatch_date, tracker_id, courier_partner } = dispatchModal;

        if (!dispatch_date || !courier_partner) {
            alert('Please fill dispatch date and courier partner');
            return;
        }

        try {
            await api.put(`/sales/orders/${order_id}/dispatch`, {
                dispatch_date,
                tracker_id,
                courier_partner,
                estimated_delivery: dispatchModal.estimated_delivery || null
            });
            alert('Order dispatched successfully!');
            setDispatchModal(null);
            loadOrders();
        } catch (e) {
            console.error(e);
            alert('Failed to dispatch: ' + (e.response?.data?.message || e.message));
        }
    };

    const openDispatchVerify = (orderId) => {
        setDispatchVerify({ order_id: orderId });
        setDispatchVerifyAck(false);
        setDispatchVerifyOrder(null);
    };

    useEffect(() => {
        if (!dispatchVerify?.order_id) return;
        let cancel = false;
        (async () => {
            setDispatchVerifyLoading(true);
            try {
                const { data } = await api.get(`/sales/orders/${dispatchVerify.order_id}`);
                if (!cancel) setDispatchVerifyOrder(data);
            } catch (e) {
                console.error(e);
                if (!cancel) {
                    setDispatchVerifyOrder(null);
                    alert('Failed to load order: ' + (e.response?.data?.message || e.message));
                    setDispatchVerify(null);
                }
            } finally {
                if (!cancel) setDispatchVerifyLoading(false);
            }
        })();
        return () => {
            cancel = true;
        };
    }, [dispatchVerify?.order_id, api]);

    const proceedDispatchAfterVerify = () => {
        if (!dispatchVerify?.order_id || !dispatchVerifyAck) return;
        const rows = (dispatchVerifyOrder?.items || []).filter(
            (i) => i.qc_passed && i.tracking_status === 'Not Dispatched'
        );
        if (rows.length === 0) {
            alert('No QC-passed laptops are waiting for dispatch for this order.');
            return;
        }
        const oid = dispatchVerify.order_id;
        setDispatchVerify(null);
        setDispatchModal({
            order_id: oid,
            dispatch_date: new Date().toISOString().split('T')[0],
            tracker_id: '',
            courier_partner: '',
            estimated_delivery: ''
        });
    };

    if (!user) return null;
    if (!isDispatch) {
        return (
            <div className="flex items-center justify-center h-64 bg-gray-50 rounded-xl">
                <div className="text-center text-gray-500">
                    <Truck className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p className="font-medium">Access Denied</p>
                    <p className="text-sm">Dispatch access required</p>
                </div>
            </div>
        );
    }

    const getStatusBadge = (status) => {
        const colors = {
            'Procurement Pending': 'bg-amber-100 text-amber-700 border-amber-200',
            'Warehouse Pending': 'bg-teal-100 text-teal-700 border-teal-200',
            'QC Pending': 'bg-purple-100 text-purple-700 border-purple-200',
            'QC Passed': 'bg-green-100 text-green-700 border-green-200',
            'Ready to Dispatch': 'bg-green-100 text-green-700 border-green-200',
            'Dispatched': 'bg-blue-100 text-blue-700 border-blue-200',
            'Delivered': 'bg-emerald-100 text-emerald-700 border-emerald-200'
        };
        return colors[status] || 'bg-gray-100 text-gray-700';
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Truck className="text-blue-600" />
                        Dispatch Center
                    </h2>
                    <p className="text-gray-600">Manage order dispatches and shipping</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-64 max-w-full"
                            placeholder="Machine #, serial, company…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleOpenLaptopDetails}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
                    >
                        <Laptop className="w-4 h-4" />
                        Laptop Details
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setDeliveredPage(1);
                            setShowDeliveredModal(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-100 hover:bg-emerald-200 rounded-lg text-emerald-700 transition-colors"
                    >
                        <CheckCircle className="w-4 h-4" />
                        View Delivered Orders ({summary.delivered_order_count})
                    </button>
                    <button type="button" onClick={loadPipeline} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Stats - Laptop counts */}
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-8 gap-4">
                <div className="bg-gradient-to-r from-teal-50 to-cyan-50 p-4 rounded-xl border border-teal-100">
                    <div className="text-sm text-teal-600 font-medium">Warehouse</div>
                    <div className="text-3xl font-bold text-teal-700">{summary.warehouse_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-amber-50 to-yellow-50 p-4 rounded-xl border border-amber-100">
                    <div className="text-sm text-amber-600 font-medium">Procurement</div>
                    <div className="text-3xl font-bold text-amber-700">{summary.procurement_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 rounded-xl border border-purple-100">
                    <div className="text-sm text-purple-600 font-medium">QC Pending</div>
                    <div className="text-3xl font-bold text-purple-700">{summary.qc_pending_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-xl border border-green-100">
                    <div className="text-sm text-green-600 font-medium">QC Passed</div>
                    <div className="text-3xl font-bold text-green-700">{summary.qc_passed_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-xl border border-blue-100">
                    <div className="text-sm text-blue-600 font-medium">Dispatched Today</div>
                    <div className="text-3xl font-bold text-blue-700">{summary.dispatched_today_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-100">
                    <div className="text-sm text-emerald-600 font-medium">On The Way</div>
                    <div className="text-3xl font-bold text-emerald-700">{summary.on_the_way_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-amber-50 to-yellow-50 p-4 rounded-xl border border-amber-100">
                    <div className="text-sm text-amber-600 font-medium">Delivered</div>
                    <div className="text-3xl font-bold text-amber-700">{summary.delivered_laptops}</div>
                </div>
                <div className="bg-gradient-to-r from-gray-50 to-slate-50 p-4 rounded-xl border border-gray-200">
                    <div className="text-sm text-gray-600 font-medium">Total In Pipeline</div>
                    <div className="text-3xl font-bold text-gray-700">{summary.total_pipeline_laptops}</div>
                </div>
            </div>

            {/* Orders Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <h3 className="font-bold text-gray-700">All Orders in Pipeline</h3>
                    <p className="text-xs text-gray-500 mt-1">View-only until QC Passed. Dispatch actions available after QC Team marks order as QC Passed.</p>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="text-left p-3">Order ID</th>
                            <th className="text-left p-3">Order date</th>
                            <th className="text-center p-3">Order type</th>
                            <th className="text-left p-3">Company</th>
                            <th className="text-center p-3">Items</th>
                            <th className="text-left p-3">Status</th>
                            <th className="text-left p-3">Tracker</th>
                            <th className="text-left p-3">Courier</th>
                            <th className="text-left p-3">Laptop Tracking</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pipelineOrders.map(order => (
                            <tr key={order.order_id} className="border-t hover:bg-gray-50">
                                <td className="p-3 font-bold text-blue-600">#{order.order_id}</td>
                                <td className="p-3 text-gray-600 whitespace-nowrap text-sm">{formatOrderDate(order.created_at)}</td>
                                <td className="p-3 text-center">
                                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-800">
                                        {order.order_type || 'Sales'}
                                    </span>
                                </td>
                                <td className="p-3">
                                    <div className="font-medium">{order.company_name || order.customer_name || '-'}</div>
                                    <div className="text-xs text-gray-400">GST: {order.gst_no || '-'}</div>
                                </td>
                                <td className="p-3 text-center font-bold">{order.items_count}</td>
                                <td className="p-3">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(order.status)}`}>
                                        {order.status}
                                    </span>
                                </td>
                                <td className="p-3 text-gray-600">{order.tracker_id || '-'}</td>
                                <td className="p-3 text-gray-600">{order.courier_partner || '-'}</td>
                                <td className="p-3 text-xs">
                                    <div className="text-emerald-700">Delivered: {order.delivered_laptops || 0}</div>
                                    <div className="text-blue-700">On The Way: {order.on_the_way_laptops || 0}</div>
                                    <div className="text-gray-700">Not Dispatched: {order.not_dispatched_laptops || 0}</div>
                                </td>
                                <td className="p-3">
                                    <div className="flex gap-2 justify-center flex-wrap">
                                        <button onClick={() => setDetailsModal(order)} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View details">
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        {canUpdateOrder(order) && (
                                            <>
                                                {(order.status === 'QC Passed' || Number(order.ready_for_dispatch_count) > 0) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openDispatchVerify(order.order_id)}
                                                        className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 flex items-center gap-1"
                                                    >
                                                        <Truck className="w-3 h-3" /> Dispatch
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleGenerateInvoice(order.order_id)}
                                                    className="px-3 py-1 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800"
                                                >
                                                    Invoice
                                                </button>
                                                <button
                                                    onClick={() => handleGenerateEway(order.order_id)}
                                                    className="px-3 py-1 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
                                                >
                                                    E-way
                                                </button>
                                                {order.status === 'Dispatched' && (
                                                    <button
                                                        onClick={() => handleDelivered(order.order_id)}
                                                        className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                                                    >
                                                        <CheckCircle className="w-3 h-3" /> Delivered
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {!canUpdateOrder(order) && (
                                            <span className="text-xs text-gray-400 px-2 py-1" title="Updates available after QC Pass">View only</span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {pipelineOrders.length === 0 && !loading && (
                            <tr><td colSpan={10} className="p-8 text-center text-gray-500">No orders in pipeline</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {pipelineTotal > PAGE_SIZE && (
                <div className="flex items-center justify-between bg-white px-4 py-2 rounded-lg border border-gray-200">
                    <span className="text-sm text-gray-600">
                        Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, pipelineTotal)} of {pipelineTotal}
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
                            Page {page} of {pipelineTotalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(pipelineTotalPages, p + 1))}
                            disabled={page >= pipelineTotalPages}
                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            {/* Verify configuration before dispatch */}
            {dispatchVerify && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6 max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900">Verify configuration</h3>
                                <p className="text-sm text-gray-500 mt-1">Order #{dispatchVerify.order_id} — confirm RAM and storage match QC before entering dispatch details.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDispatchVerify(null)}
                                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-6">
                            {dispatchVerifyLoading ? (
                                <div className="grid place-items-center py-16">
                                    <Loader2 className="w-10 h-10 animate-spin text-green-600" />
                                </div>
                            ) : !dispatchVerifyOrder?.items?.length ? (
                                <p className="text-sm text-gray-600">No line items loaded.</p>
                            ) : (
                                <>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Showing laptop lines that are QC passed and not yet dispatched (values reflect latest QC / inventory sync).
                                    </p>
                                    <div className="overflow-x-auto border border-gray-100 rounded-xl">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-100">
                                                <tr>
                                                    <th className="text-left p-2">Item</th>
                                                    <th className="text-left p-2">Machine #</th>
                                                    <th className="text-left p-2">Serial</th>
                                                    <th className="text-left p-2">RAM</th>
                                                    <th className="text-left p-2">Storage</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dispatchVerifyOrder.items
                                                    .filter(
                                                        (i) =>
                                                            i.qc_passed &&
                                                            i.tracking_status === 'Not Dispatched'
                                                    )
                                                    .map((row) => (
                                                        <tr key={row.item_id} className="border-t">
                                                            <td className="p-2 font-medium">#{row.item_id}</td>
                                                            <td className="p-2 font-mono text-xs">{row.machine_number || '—'}</td>
                                                            <td className="p-2 font-mono text-xs">{row.serial_number || '—'}</td>
                                                            <td className="p-2">{row.ram || '—'}</td>
                                                            <td className="p-2">{row.storage || '—'}</td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {dispatchVerifyOrder.items.filter(
                                        (i) => i.qc_passed && i.tracking_status === 'Not Dispatched'
                                    ).length === 0 && (
                                        <p className="text-sm text-amber-700 mt-3">
                                            No QC-passed units are waiting for dispatch. If the order is partially dispatched, only remaining units appear here.
                                        </p>
                                    )}
                                    <label className="flex items-start gap-3 mt-6 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="mt-1 rounded border-gray-300 text-green-600 focus:ring-green-500"
                                            checked={dispatchVerifyAck}
                                            onChange={(e) => setDispatchVerifyAck(e.target.checked)}
                                        />
                                        <span className="text-sm text-gray-800">
                                            <span className="font-semibold">Mark as verified</span>
                                            <span className="block text-gray-600">
                                                I confirm the RAM and storage above match the physical configuration for dispatch.
                                            </span>
                                        </span>
                                    </label>
                                </>
                            )}
                        </div>
                        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={() => setDispatchVerify(null)}
                                className="px-6 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={dispatchVerifyLoading || !dispatchVerifyAck}
                                onClick={proceedDispatchAfterVerify}
                                className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Continue to dispatch details
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dispatch Modal */}
            {dispatchModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
                        <div className="p-6 border-b flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold flex items-center gap-2"><Truck className="text-green-600" /> Dispatch Order</h3>
                                <p className="text-sm text-gray-500">Order #{dispatchModal.order_id}</p>
                            </div>
                            <button onClick={() => setDispatchModal(null)}><X className="w-6 h-6 text-gray-400" /></button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Calendar className="w-4 h-4 inline mr-1" /> Dispatch Date
                                </label>
                                <input
                                    type="date"
                                    value={dispatchModal.dispatch_date}
                                    onChange={e => setDispatchModal({ ...dispatchModal, dispatch_date: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Hash className="w-4 h-4 inline mr-1" /> Tracker ID (AWB Number)
                                </label>
                                <input
                                    type="text"
                                    value={dispatchModal.tracker_id}
                                    onChange={e => setDispatchModal({ ...dispatchModal, tracker_id: e.target.value })}
                                    placeholder="e.g. 1234567890"
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Truck className="w-4 h-4 inline mr-1" /> Courier Partner
                                </label>
                                <select
                                    value={dispatchModal.courier_partner}
                                    onChange={e => setDispatchModal({ ...dispatchModal, courier_partner: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                                >
                                    <option value="">Select Courier</option>
                                    <option value="Bluedart">Bluedart</option>
                                    <option value="Delhivery">Delhivery</option>
                                    <option value="DTDC">DTDC</option>
                                    <option value="FedEx">FedEx</option>
                                    <option value="India Post">India Post</option>
                                    <option value="Professional Courier">Professional Courier</option>
                                    <option value="Self Delivery">Self Delivery</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Calendar className="w-4 h-4 inline mr-1" /> Estimated Delivery
                                </label>
                                <input
                                    type="date"
                                    value={dispatchModal.estimated_delivery || ''}
                                    onChange={e => setDispatchModal({ ...dispatchModal, estimated_delivery: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3">
                            <button onClick={() => setDispatchModal(null)} className="px-6 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
                            <button onClick={handleDispatch} className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-lg flex items-center gap-2">
                                <Truck className="w-4 h-4" /> Mark Dispatched
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Laptop Details Modal */}
            {laptopDetailsModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Laptop className="w-5 h-5 text-blue-600" />
                                All Laptops in Pipeline
                            </h3>
                            <button
                                onClick={() => setLaptopDetailsModal(false)}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {laptopDetailsLoading ? (
                                <div className="grid place-items-center py-16">
                                    <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                                </div>
                            ) : laptopDetails.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">No laptops in pipeline</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100 sticky top-0">
                                            <tr>
                                                <th className="text-left p-2">Order #</th>
                                                <th className="text-left p-2">Machine #</th>
                                                <th className="text-left p-2">Serial #</th>
                                                <th className="text-left p-2">Brand</th>
                                                <th className="text-left p-2">Processor</th>
                                                <th className="text-left p-2">Generation</th>
                                                <th className="text-left p-2">RAM</th>
                                                <th className="text-left p-2">Storage / Model</th>
                                                <th className="text-left p-2">QC Passed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {laptopDetails.map((row, idx) => (
                                                <tr key={`${row.order_id}-${row.item_id}-${idx}`} className="border-t hover:bg-gray-50">
                                                    <td className="p-2 font-medium text-blue-600">#{row.order_id}</td>
                                                    <td className="p-2 font-mono text-xs">{row.machine_number || '-'}</td>
                                                    <td className="p-2 font-mono text-xs">{row.serial_number || '-'}</td>
                                                    <td className="p-2">{row.brand || '-'}</td>
                                                    <td className="p-2">{row.processor || '-'}</td>
                                                    <td className="p-2">{row.generation || '-'}</td>
                                                    <td className="p-2">{row.ram || '-'}</td>
                                                    <td className="p-2">{row.storage || row.preferred_model || '-'}</td>
                                                    <td className="p-2">
                                                        {row.qc_passed ? (
                                                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Yes</span>
                                                        ) : (
                                                            <span className="text-xs text-gray-400">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Delivered Orders Modal */}
            {showDeliveredModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-emerald-600" />
                                Delivered Orders
                            </h3>
                            <button
                                onClick={() => setShowDeliveredModal(false)}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {deliveredLoading ? (
                                <div className="grid place-items-center py-16">
                                    <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                                </div>
                            ) : deliveredOrders.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">No delivered orders</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="text-left p-3">Order ID</th>
                                            <th className="text-left p-3">Company</th>
                                            <th className="text-center p-3">Laptops</th>
                                            <th className="text-left p-3">Tracker</th>
                                            <th className="text-left p-3">Courier</th>
                                            <th className="text-left p-3">Delivered At</th>
                                            <th className="p-3">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {deliveredOrders.map(order => (
                                            <tr key={order.order_id} className="border-t hover:bg-gray-50">
                                                <td className="p-3 font-bold text-blue-600">#{order.order_id}</td>
                                                <td className="p-3">
                                                    <div className="font-medium">{order.company_name || order.customer_name || '-'}</div>
                                                    <div className="text-xs text-gray-400">GST: {order.gst_no || '-'}</div>
                                                </td>
                                                <td className="p-3 text-center font-bold">{order.items_count}</td>
                                                <td className="p-3 text-gray-600 font-mono text-xs">{order.tracker_id || '-'}</td>
                                                <td className="p-3 text-gray-600">{order.courier_partner || '-'}</td>
                                                <td className="p-3 text-gray-600 text-xs">
                                                    {order.dispatched_at ? new Date(order.dispatched_at).toLocaleDateString() : '-'}
                                                </td>
                                                <td className="p-3">
                                                    <button
                                                        onClick={() => { setDetailsModal(order); setShowDeliveredModal(false); }}
                                                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                                        title="View details"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            {!deliveredLoading && deliveredTotal > PAGE_SIZE && (
                                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                                    <span className="text-sm text-gray-600">
                                        Showing {((deliveredPage - 1) * PAGE_SIZE) + 1}–{Math.min(deliveredPage * PAGE_SIZE, deliveredTotal)} of {deliveredTotal}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setDeliveredPage((p) => Math.max(1, p - 1))}
                                            disabled={deliveredPage <= 1}
                                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            <ChevronLeft className="w-5 h-5" />
                                        </button>
                                        <span className="px-3 py-2 text-sm">
                                            Page {deliveredPage} of {deliveredTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setDeliveredPage((p) => Math.min(deliveredTotalPages, p + 1))}
                                            disabled={deliveredPage >= deliveredTotalPages}
                                            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                                        >
                                            <ChevronRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Details Modal */}
            {detailsModal && (
                <OrderDetailsQuick
                    order={detailsModal}
                    onClose={() => setDetailsModal(null)}
                    api={api}
                    onRefresh={loadOrders}
                    canEdit={canUpdateOrder(detailsModal)}
                />
            )}
        </div>
    );
}

function OrderDetailsQuick({ order, onClose, api, onRefresh, canEdit = true }) {
    const [items, setItems] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [savingItemId, setSavingItemId] = useState(null);
    const [trackingEdits, setTrackingEdits] = useState({});

    useEffect(() => {
        const loadItems = async () => {
            try {
                const { data } = await api.get(`/sales/orders/${order.order_id}`);
                setItems(data.items || []);
                setSummary(data.tracking_summary || null);
                const initialEdits = {};
                (data.items || []).forEach((item) => {
                    initialEdits[item.item_id] = {
                        tracking_status: item.tracking_status || 'Not Dispatched',
                        item_tracker_id: item.item_tracker_id || '',
                        item_courier_partner: item.item_courier_partner || '',
                        item_dispatch_date: item.item_dispatch_date ? String(item.item_dispatch_date).split('T')[0] : '',
                        item_estimated_delivery: item.item_estimated_delivery ? String(item.item_estimated_delivery).split('T')[0] : ''
                    };
                });
                setTrackingEdits(initialEdits);
            } catch (e) { console.error(e); } finally { setLoading(false); }
        };
        loadItems();
    }, [order.order_id, api]);

    const handleSaveTracking = async (itemId) => {
        const payload = trackingEdits[itemId];
        if (!payload) return;
        setSavingItemId(itemId);
        try {
            await api.put(`/sales/orders/${order.order_id}/items/${itemId}/tracking`, {
                ...payload,
                item_dispatch_date: payload.item_dispatch_date || null,
                item_estimated_delivery: payload.item_estimated_delivery || null
            });
            const { data } = await api.get(`/sales/orders/${order.order_id}`);
            setItems(data.items || []);
            setSummary(data.tracking_summary || null);
            onRefresh();
        } catch (e) {
            alert('Failed to update tracking: ' + (e.response?.data?.message || e.message));
        } finally {
            setSavingItemId(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-2xl">
                    <div>
                        <h3 className="text-xl font-bold">Order #{order.order_id}</h3>
                        <p className="text-sm text-gray-500">{order.company_name || order.customer_name || '-'} {order.gst_no ? `| GST: ${order.gst_no}` : ''}</p>
                    </div>
                    <button onClick={onClose}><X className="w-6 h-6 text-gray-400" /></button>
                </div>

                <div className="p-6">
                    {loading ? (
                        <div className="text-center py-8"><Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" /></div>
                    ) : (
                        <div className="space-y-3">
                            <h4 className="font-bold text-gray-800">Items to Dispatch</h4>
                            {summary && (
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div className="bg-emerald-50 text-emerald-700 rounded p-2">Delivered: {summary.delivered || 0}</div>
                                    <div className="bg-blue-50 text-blue-700 rounded p-2">On The Way: {summary.on_the_way || 0}</div>
                                    <div className="bg-gray-50 text-gray-700 rounded p-2">Not Dispatched: {summary.not_dispatched || 0}</div>
                                </div>
                            )}
                            {items.map((item, idx) => (
                                <div key={idx} className="bg-gray-50 p-3 rounded-lg">
                                    <div>
                                        <div className="font-medium">{item.brand} {item.preferred_model}</div>
                                        <div className="text-xs text-gray-500">{item.processor}{item.generation ? ` | ${item.generation}` : ''} | {item.ram} | {item.storage}</div>
                                        {item.machine_number && <div className="text-xs text-blue-600 mt-1 font-mono">Machine: {item.machine_number}</div>}
                                        {item.serial_number && <div className="text-xs text-gray-500 font-mono">Serial: {item.serial_number}</div>}
                                        <div className="text-xs text-gray-500 mt-1">
                                            Delivery Type: {item.delivery_mode || (item.is_wfh ? 'WFH' : 'Office')}
                                            {item.delivery_mode === 'WFH' || item.is_wfh ? ` | WFH Shipping: ₹${parseFloat(item.shipping_charge || 0).toFixed(2)}` : ''}
                                        </div>
                                        <div className="text-xs text-gray-600 mt-1">
                                            Contact: {item.delivery_contact_name || '-'} | Phone: {item.delivery_contact_phone || '-'}
                                        </div>
                                        <div className="text-xs text-gray-600 mt-1">
                                            Address: {item.delivery_address || '-'} {item.delivery_pincode ? `(${item.delivery_pincode})` : ''}
                                            {item.proposed_delivery_date && (
                                                <span className="ml-2 text-indigo-600 font-medium">
                                                    | Proposed: {new Date(item.proposed_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-gray-500 mt-1">
                                            Dates: Dispatch Date (when laptop left warehouse) and ETA (expected delivery date)
                                        </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
                                        <select
                                            className={`border rounded px-2 py-1 ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                            value={trackingEdits[item.item_id]?.tracking_status || 'Not Dispatched'}
                                            onChange={(e) => canEdit && setTrackingEdits(prev => ({
                                                ...prev,
                                                [item.item_id]: { ...(prev[item.item_id] || {}), tracking_status: e.target.value }
                                            }))}
                                            disabled={!canEdit}
                                        >
                                            <option value="Not Dispatched">Not Dispatched</option>
                                            <option value="On The Way">On The Way</option>
                                            <option value="Delivered">Delivered</option>
                                        </select>
                                        <input
                                            className={`border rounded px-2 py-1 ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                            placeholder="Tracker ID"
                                            value={trackingEdits[item.item_id]?.item_tracker_id || ''}
                                            onChange={(e) => canEdit && setTrackingEdits(prev => ({
                                                ...prev,
                                                [item.item_id]: { ...(prev[item.item_id] || {}), item_tracker_id: e.target.value }
                                            }))}
                                            disabled={!canEdit}
                                        />
                                        <input
                                            className={`border rounded px-2 py-1 ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                            placeholder="Courier"
                                            value={trackingEdits[item.item_id]?.item_courier_partner || ''}
                                            onChange={(e) => canEdit && setTrackingEdits(prev => ({
                                                ...prev,
                                                [item.item_id]: { ...(prev[item.item_id] || {}), item_courier_partner: e.target.value }
                                            }))}
                                            disabled={!canEdit}
                                        />
                                        <div>
                                            <div className="text-[10px] text-gray-500 mb-1">Dispatch Date</div>
                                            <input
                                                className={`border rounded px-2 py-1 w-full ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                type="date"
                                                value={trackingEdits[item.item_id]?.item_dispatch_date || ''}
                                                onChange={(e) => canEdit && setTrackingEdits(prev => ({
                                                    ...prev,
                                                    [item.item_id]: { ...(prev[item.item_id] || {}), item_dispatch_date: e.target.value }
                                                }))}
                                                disabled={!canEdit}
                                            />
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-gray-500 mb-1">ETA</div>
                                            <input
                                                className={`border rounded px-2 py-1 w-full ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                type="date"
                                                value={trackingEdits[item.item_id]?.item_estimated_delivery || ''}
                                                onChange={(e) => canEdit && setTrackingEdits(prev => ({
                                                    ...prev,
                                                    [item.item_id]: { ...(prev[item.item_id] || {}), item_estimated_delivery: e.target.value }
                                                }))}
                                                disabled={!canEdit}
                                            />
                                        </div>
                                        {canEdit ? (
                                            <button
                                                onClick={() => handleSaveTracking(item.item_id)}
                                                disabled={savingItemId === item.item_id}
                                                className="bg-slate-800 text-white rounded px-2 py-1 hover:bg-slate-900 disabled:opacity-60"
                                            >
                                                {savingItemId === item.item_id ? 'Saving...' : 'Save'}
                                            </button>
                                        ) : (
                                            <span className="text-gray-400 text-[10px] self-center">View only</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-end">
                    <button onClick={onClose} className="px-6 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800">Close</button>
                </div>
            </div>
        </div>
    );
}
