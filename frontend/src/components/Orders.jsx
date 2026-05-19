import React, { useState, useEffect } from 'react';
import {
    ClipboardList, Eye,
    Loader2, X, RefreshCw, User, Ban, Save, Search, Download
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Orders({ api }) {
    const { user } = useAuth();
    const location = useLocation();
    const isLeadOrdersRoute = location.pathname === '/lead-orders';
    const [orders, setOrders] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all');
    const [customerTypeFilter, setCustomerTypeFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [companySearch, setCompanySearch] = useState('');
    const [debouncedCompany, setDebouncedCompany] = useState('');
    const [orderTypeFilter, setOrderTypeFilter] = useState('');
    const [exportingCsv, setExportingCsv] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const isAdmin = user?.role === 'admin';
    const isManager = ['admin', 'manager'].includes(user?.role);
    const [viewAll, setViewAll] = useState(false);

    React.useEffect(() => {
        if (isAdmin) setViewAll(true);
    }, [isAdmin]);

    useEffect(() => {
        const id = setTimeout(() => setDebouncedCompany(companySearch.trim()), isLeadOrdersRoute ? 350 : 0);
        return () => clearTimeout(id);
    }, [companySearch, isLeadOrdersRoute]);

    const loadOrders = React.useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (activeTab !== 'all') params.append('status', activeTab);
            if (customerTypeFilter) params.append('customer_type', customerTypeFilter);
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            if (!viewAll && isManager) params.append('owner', 'mine');
            if (isLeadOrdersRoute && debouncedCompany) params.append('company_search', debouncedCompany);
            if (isLeadOrdersRoute && orderTypeFilter) params.append('order_type', orderTypeFilter);

            const statsParams = new URLSearchParams();
            if (activeTab !== 'all') statsParams.append('status', activeTab);
            if (customerTypeFilter) statsParams.append('customer_type', customerTypeFilter);
            if (dateFrom) statsParams.append('date_from', dateFrom);
            if (dateTo) statsParams.append('date_to', dateTo);
            if (!viewAll && isManager) statsParams.append('owner', 'mine');
            if (isLeadOrdersRoute && debouncedCompany) statsParams.append('company_search', debouncedCompany);
            if (isLeadOrdersRoute && orderTypeFilter) statsParams.append('order_type', orderTypeFilter);

            const [ordersRes, statsRes] = await Promise.all([
                api.get('/sales/orders' + (params.toString() ? '?' + params.toString() : '')),
                api.get('/sales/orders/stats' + (statsParams.toString() ? '?' + statsParams.toString() : ''))
            ]);
            setOrders(ordersRes.data.orders || []);
            setStats(statsRes.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [api, activeTab, customerTypeFilter, dateFrom, dateTo, viewAll, isManager, debouncedCompany, isLeadOrdersRoute, orderTypeFilter]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const buildExportQuery = () => {
        const params = new URLSearchParams();
        if (activeTab !== 'all') params.append('status', activeTab);
        if (customerTypeFilter) params.append('customer_type', customerTypeFilter);
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        if (!viewAll && isManager) params.append('owner', 'mine');
        if (isLeadOrdersRoute && (companySearch.trim() || debouncedCompany)) {
            params.append('company_search', (companySearch.trim() || debouncedCompany));
        }
        if (isLeadOrdersRoute && orderTypeFilter) params.append('order_type', orderTypeFilter);
        return params.toString();
    };

    const handleExportOrdersCsv = async () => {
        setExportingCsv(true);
        try {
            const qs = buildExportQuery();
            const response = await api.get('/sales/orders/export-csv' + (qs ? '?' + qs : ''), { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'orders-export.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            alert('Export failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setExportingCsv(false);
        }
    };

    const getStatusBadge = (status) => {
        const colors = {
            'New Lead': 'bg-blue-100 text-blue-700',
            'Procurement Pending': 'bg-yellow-100 text-yellow-700',
            'Warehouse Pending': 'bg-teal-100 text-teal-700',
            'Processing': 'bg-orange-100 text-orange-700',
            'QC Pending': 'bg-purple-100 text-purple-700',
            'QC Passed': 'bg-indigo-100 text-indigo-700',
            'Ready to Dispatch': 'bg-green-100 text-green-700',
            'Dispatched': 'bg-cyan-100 text-cyan-700',
            'Delivered': 'bg-emerald-100 text-emerald-700',
            'Cancelled': 'bg-rose-100 text-rose-700'
        };
        return colors[status] || 'bg-gray-100 text-gray-700';
    };

    const tabs = [
        { key: 'all', label: 'All Orders' },
        { key: 'Procurement Pending', label: 'Procurement' },
        { key: 'Warehouse Pending', label: 'Warehouse' },
        { key: 'QC Pending', label: 'QC Pending' },
        { key: 'QC Passed', label: 'QC Passed' },
        { key: 'Dispatched', label: 'Dispatched' },
        { key: 'Delivered', label: 'Delivered' },
        { key: 'Cancelled', label: 'Cancelled' }
    ];

    const tableText = isLeadOrdersRoute ? 'text-[12px] leading-snug' : 'text-sm';
    const thText = isLeadOrdersRoute ? 'text-[11px] font-semibold uppercase tracking-wide text-gray-600' : '';
    const cellPad = isLeadOrdersRoute ? 'py-1.5 px-2' : 'py-1.5 px-3';
    const headPad = isLeadOrdersRoute ? 'py-1.5 px-2' : 'py-1.5 px-3';

    return (
        <div className={`${isLeadOrdersRoute ? 'space-y-3 max-w-[100%]' : 'space-y-6'}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className={`${isLeadOrdersRoute ? 'text-xl' : 'text-2xl'} font-bold flex items-center gap-2`}>
                        <ClipboardList className="text-blue-600" />
                        {isLeadOrdersRoute ? 'Lead Orders' : 'Orders'}
                    </h2>
                    <p className={`text-gray-600 ${isLeadOrdersRoute ? 'text-xs' : 'text-sm'}`}>
                        {isLeadOrdersRoute ? 'Sales orders from leads — filter, search by company, export CSV' : 'Track and manage all orders'}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {isLeadOrdersRoute && (
                        <div className="relative flex-1 min-w-[200px] max-w-sm">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={companySearch}
                                onChange={(e) => setCompanySearch(e.target.value)}
                                placeholder="Search company name…"
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-xs"
                            />
                        </div>
                    )}
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        className={`px-2 py-1.5 border border-gray-300 rounded-lg ${isLeadOrdersRoute ? 'text-xs' : 'text-sm'}`}
                        placeholder="From"
                    />
                    <input
                        type="date"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        className={`px-2 py-1.5 border border-gray-300 rounded-lg ${isLeadOrdersRoute ? 'text-xs' : 'text-sm'}`}
                        placeholder="To"
                    />
                    <select
                        value={customerTypeFilter}
                        onChange={e => setCustomerTypeFilter(e.target.value)}
                        className={`px-2 py-1.5 border border-gray-300 rounded-lg ${isLeadOrdersRoute ? 'text-xs' : 'text-sm'}`}
                    >
                        <option value="">All (New + Existing)</option>
                        <option value="New">New Customers</option>
                        <option value="Existing">Existing Customers</option>
                    </select>
                    {isLeadOrdersRoute && (
                        <select
                            value={orderTypeFilter}
                            onChange={(e) => setOrderTypeFilter(e.target.value)}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                            title="Order type"
                        >
                            <option value="">All order types</option>
                            <option value="Rent">Rent</option>
                            <option value="Sales">Sales</option>
                            <option value="Demo">Demo</option>
                        </select>
                    )}
                    {isManager && (
                        <label className={`flex items-center gap-2 ${isLeadOrdersRoute ? 'text-xs' : 'text-sm'}`}>
                            <input
                                type="checkbox"
                                checked={viewAll}
                                onChange={e => setViewAll(e.target.checked)}
                                className="rounded"
                            />
                            View All Orders
                        </label>
                    )}
                    {isLeadOrdersRoute && (
                        <button
                            type="button"
                            onClick={handleExportOrdersCsv}
                            disabled={exportingCsv}
                            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs disabled:opacity-50"
                        >
                            <Download className="w-4 h-4" />
                            {exportingCsv ? '…' : 'CSV'}
                        </button>
                    )}
                    <button onClick={loadOrders} className={`flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors ${isLeadOrdersRoute ? 'text-xs' : ''}`}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Customer + totals stats (compact) */}
            <div className={isLeadOrdersRoute ? 'grid grid-cols-2 lg:grid-cols-4 gap-2' : 'grid grid-cols-2 gap-3'}>
                <div className={`rounded-lg border border-emerald-200 bg-emerald-50/90 ${isLeadOrdersRoute ? 'p-2.5' : 'p-4'}`}>
                    <div className={`text-emerald-700 font-medium ${isLeadOrdersRoute ? 'text-[11px]' : 'text-xs'}`}>New Customers</div>
                    <div className={`font-bold text-emerald-800 ${isLeadOrdersRoute ? 'text-[18px] leading-tight' : 'text-2xl'}`}>{stats?.newCustomerOrders ?? '-'}</div>
                    <div className={`text-emerald-600 mt-0.5 ${isLeadOrdersRoute ? 'text-[12px]' : 'text-xs'}`}>{stats?.newCustomerLaptops ?? 0} laptops</div>
                </div>
                <div className={`rounded-lg border border-blue-200 bg-blue-50/90 ${isLeadOrdersRoute ? 'p-2.5' : 'p-4'}`}>
                    <div className={`text-blue-700 font-medium ${isLeadOrdersRoute ? 'text-[11px]' : 'text-xs'}`}>Existing Customers</div>
                    <div className={`font-bold text-blue-800 ${isLeadOrdersRoute ? 'text-[18px] leading-tight' : 'text-2xl'}`}>{stats?.existingCustomerOrders ?? '-'}</div>
                    <div className={`text-blue-600 mt-0.5 ${isLeadOrdersRoute ? 'text-[12px]' : 'text-xs'}`}>{stats?.existingCustomerLaptops ?? 0} laptops</div>
                </div>
                {isLeadOrdersRoute && (
                    <>
                        <div className="rounded-lg border border-slate-200 bg-gray-50 p-2.5">
                            <div className="text-gray-600 font-medium text-[11px]">Total Orders</div>
                            <div className="font-bold text-gray-900 text-[18px] leading-tight">{stats?.totalOrders ?? '-'}</div>
                            <div className="text-gray-500 mt-0.5 text-[12px]">{stats?.totalLaptops ?? 0} laptops</div>
                        </div>
                        <div className="rounded-lg border border-violet-200 bg-violet-50/90 p-2.5">
                            <div className="text-violet-700 font-medium text-[11px]">Demo Orders</div>
                            <div className="font-bold text-violet-900 text-[18px] leading-tight">{stats?.demoOrders ?? 0}</div>
                            <div className="text-violet-600 mt-0.5 text-[12px]">{stats?.demoLaptops ?? 0} laptops</div>
                        </div>
                    </>
                )}
            </div>

            {/* Stage breakdown — order + laptop counts (API uses dimension filters only, not active tab) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-1.5">
                {tabs.slice(1).map(tab => {
                    const hasBreakdown = stats && typeof stats.stageBreakdown === 'object' && stats.stageBreakdown !== null;
                    const oCount = hasBreakdown
                        ? (stats.stageBreakdown[tab.key]?.orderCount ?? 0)
                        : orders.filter(o => o.status === tab.key).length;
                    const lCount = hasBreakdown
                        ? (stats.stageBreakdown[tab.key]?.laptopCount ?? 0)
                        : orders.filter(o => o.status === tab.key).reduce((s, o) => s + Number(o.items_count || 0), 0);
                    return (
                        <div
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`rounded-lg border cursor-pointer transition-all px-2 py-1.5 ${isLeadOrdersRoute ? '' : 'p-3 rounded-xl'} ${activeTab === tab.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                        >
                            <div className={`text-gray-500 ${isLeadOrdersRoute ? 'text-[11px] leading-tight' : 'text-xs'}`}>{tab.label}</div>
                            <div className={`font-bold text-gray-900 ${isLeadOrdersRoute ? 'text-[18px] leading-tight' : 'text-2xl'}`}>{oCount}</div>
                            <div className={`text-gray-500 ${isLeadOrdersRoute ? 'text-[12px]' : 'text-xs'}`}>{lCount} laptops</div>
                        </div>
                    );
                })}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b overflow-x-auto">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`font-medium border-b-2 transition-all whitespace-nowrap ${isLeadOrdersRoute ? 'px-2.5 py-1.5 text-[11px]' : 'px-4 py-2'} ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Orders Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
                <table className={`w-full ${tableText}`}>
                    <thead className="bg-gray-100">
                        <tr>
                            <th className={`text-left ${headPad} ${thText}`}>Order ID</th>
                            {isLeadOrdersRoute && <th className={`text-left ${headPad} whitespace-nowrap ${thText}`}>Order date</th>}
                            <th className={`text-left ${headPad} ${thText}`}>Company</th>
                            {isLeadOrdersRoute && <th className={`text-center ${headPad} whitespace-nowrap ${thText}`}>Order type</th>}
                            <th className={`text-center ${headPad} ${thText}`}>{isLeadOrdersRoute ? 'Customer' : 'Type'}</th>
                            <th className={`text-center ${headPad} ${thText}`}>Items</th>
                            <th className={`text-left ${headPad} ${thText}`}>Status</th>
                            <th className={`text-left ${headPad} ${thText}`}>Owner</th>
                            <th className={`text-left ${headPad} ${thText}`}>Dispatch</th>
                            <th className={`text-right ${headPad} ${thText}`}>Value</th>
                            <th className={`${headPad} ${thText}`}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.order_id} className="border-t hover:bg-gray-50">
                                <td className={`${cellPad} font-bold text-blue-600`}>#{order.order_id}</td>
                                {isLeadOrdersRoute && (
                                    <td className={`${cellPad} text-gray-600 whitespace-nowrap`}>
                                        {order.created_at ? new Date(order.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                                    </td>
                                )}
                                <td className={cellPad}>
                                    <div className={`font-medium ${isLeadOrdersRoute ? 'text-xs' : ''}`}>{order.company_name || order.customer_name || '-'}</div>
                                    <div className={`text-gray-400 ${isLeadOrdersRoute ? 'text-[10px]' : 'text-xs'}`}>{order.customer_email}</div>
                                </td>
                                {isLeadOrdersRoute && (
                                    <td className={`${cellPad} text-center`}>
                                        <span className="px-2 py-0.5 rounded font-semibold text-[11px] bg-violet-100 text-violet-800">
                                            {order.order_type || 'Sales'}
                                        </span>
                                    </td>
                                )}
                                <td className={`${cellPad} text-center`}>
                                    <span className={`px-2 py-0.5 rounded font-semibold ${isLeadOrdersRoute ? 'text-[11px]' : 'text-xs'} ${(order.customer_type || 'New') === 'New' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {order.customer_type || 'New'}
                                    </span>
                                </td>
                                <td className={`${cellPad} text-center font-bold`}>{order.items_count}</td>
                                <td className={cellPad}>
                                    <span className={`${isLeadOrdersRoute ? 'px-2 py-0.5 rounded-full text-[11px]' : 'px-3 py-1 rounded-full text-xs'} font-bold ${getStatusBadge(order.status)}`}>
                                        {order.status}
                                    </span>
                                </td>
                                <td className={`${cellPad} text-gray-600 ${isLeadOrdersRoute ? 'text-[10px]' : 'text-xs'}`}>
                                    <div className="flex items-center gap-1">
                                        <User className="w-3 h-3 shrink-0" />
                                        <span className="truncate max-w-[120px]">{order.owner_name || '-'}</span>
                                    </div>
                                </td>
                                <td className={`${cellPad} ${isLeadOrdersRoute ? 'text-[10px]' : 'text-xs'}`}>
                                    {order.dispatched_at ? (
                                        <div>
                                            <div className="text-gray-600">{order.courier_partner}</div>
                                            <div className="text-blue-600 font-mono">{order.tracker_id}</div>
                                            {order.estimated_delivery && (
                                                <div className="text-green-600">ETA: {new Date(order.estimated_delivery).toLocaleDateString()}</div>
                                            )}
                                        </div>
                                    ) : '-'}
                                </td>
                                <td className={`${cellPad} text-right font-bold text-gray-700`}>₹{parseInt(order.total_value || 0).toLocaleString()}</td>
                                <td className={cellPad}>
                                    <button type="button" onClick={() => setSelectedOrder(order)} className="text-blue-600 hover:text-blue-800">
                                        <Eye className={`${isLeadOrdersRoute ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {orders.length === 0 && !loading && (
                            <tr><td colSpan={isLeadOrdersRoute ? 11 : 9} className="p-8 text-center text-gray-500">No orders found</td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan={isLeadOrdersRoute ? 11 : 9} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedOrder && (
                <OrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} api={api} onRefresh={loadOrders} user={user} />
            )}
        </div>
    );
}

export function OrderDetailsModal({ order, onClose, api, onRefresh, user }) {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [itemEdits, setItemEdits] = useState({});
    const [savingItemId, setSavingItemId] = useState(null);
    const [orderChargesEdit, setOrderChargesEdit] = useState({ security_amount: '', lockin_period_days: '' });
    const [savingCharges, setSavingCharges] = useState(false);

    const canDispatchFlow =
        user?.role !== 'sales' &&
        (['admin', 'manager', 'floor_manager'].includes(user?.role) || user?.permissions?.includes('dispatch_access'));
    const canSalesEdit =
        ['sales', 'admin', 'manager'].includes(user?.role) ||
        user?.permissions?.includes('sales_access');
    const canEditPrice = canSalesEdit && details?.order?.status && !['Cancelled', 'Delivered', 'Dispatched'].includes(details.order.status);
    const canEditQuantity = false;
    const canEditSecurityLockin = canSalesEdit && details?.order?.status && !['Cancelled', 'Delivered', 'Dispatched'].includes(details.order.status);
    const availableOfficeAddresses = React.useMemo(() => {
        const fromProfile = details?.customer_addresses || [];
        if (fromProfile.length) return fromProfile;
        const map = new Map();
        (details?.items || []).forEach((item) => {
            if (!item.customer_address_id || !item.delivery_address) return;
            const key = String(item.customer_address_id);
            if (map.has(key)) return;
            map.set(key, {
                customer_address_id: item.customer_address_id,
                concern_person: item.delivery_contact_name || 'Contact',
                address: item.delivery_address,
                pincode: item.delivery_pincode || '',
                is_head_office: false
            });
        });
        return Array.from(map.values());
    }, [details]);

    useEffect(() => {
        const loadDetails = async () => {
            try {
                const { data } = await api.get(`/sales/orders/${order.order_id}`);
                setDetails(data);
                const initialEdits = {};
                (data.items || []).forEach((item) => {
                    initialEdits[item.item_id] = {
                        delivery_mode: item.delivery_mode || (item.is_wfh ? 'WFH' : 'Office'),
                        customer_address_id: item.customer_address_id ? String(item.customer_address_id) : '',
                        shipping_charge: item.shipping_charge || 0,
                        delivery_contact_name: item.delivery_contact_name || '',
                        delivery_contact_phone: item.delivery_contact_phone || '',
                        delivery_address: item.delivery_address || '',
                        delivery_pincode: item.delivery_pincode || '',
                        unit_price: item.unit_price ?? '',
                        quantity: item.quantity ?? 1
                    };
                });
                setItemEdits(initialEdits);
                setOrderChargesEdit({
                    security_amount: data?.order?.security_amount ?? '',
                    lockin_period_days: data?.order?.lockin_period_days ?? ''
                });
            } catch (e) { console.error(e); } finally { setLoading(false); }
        };
        loadDetails();
    }, [order.order_id, api]);

    const handleSaveCharges = async () => {
        setSavingCharges(true);
        try {
            const body = {};
            const sec = parseFloat(orderChargesEdit.security_amount);
            if (Number.isFinite(sec) && sec >= 0) body.security_amount = sec;
            const lock = parseInt(orderChargesEdit.lockin_period_days, 10);
            if (Number.isInteger(lock) && lock >= 0) body.lockin_period_days = lock;
            if (Object.keys(body).length === 0) {
                alert('Enter valid Security and/or Lock-in to update');
                return;
            }
            await api.put(`/sales/orders/${order.order_id}/charges`, body);
            const { data } = await api.get(`/sales/orders/${order.order_id}`);
            setDetails(data);
            setOrderChargesEdit({ security_amount: data?.order?.security_amount ?? '', lockin_period_days: data?.order?.lockin_period_days ?? '' });
            alert('Security and lock-in updated');
            onRefresh();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setSavingCharges(false);
        }
    };

    const handleCancelOrder = async () => {
        const reason = window.prompt('Reason for cancellation (optional):', 'Cancelled by customer');
        if (reason === null) return;
        if (!window.confirm('Cancel this order? It will be removed from QC/Procurement/Dispatch flow.')) return;
        setProcessing(true);
        try {
            await api.put(`/sales/orders/${order.order_id}/cancel`, { reason });
            alert('Order cancelled successfully');
            onRefresh();
            onClose();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally { setProcessing(false); }
    };

    const handleSaveItemLogistics = async (itemId) => {
        const payload = itemEdits[itemId];
        if (!payload) return;
        setSavingItemId(itemId);
        try {
            const currentItem = details?.items?.find(i => i.item_id === itemId);
            const newPrice = parseFloat(payload.unit_price);
            const priceChanged = Number.isFinite(newPrice) && parseFloat(currentItem?.unit_price) !== newPrice;
            if (priceChanged) {
                await api.put(`/sales/orders/${order.order_id}/items/${itemId}/price`, {
                    unit_price: parseFloat(payload.unit_price)
                });
            }
            await api.put(`/sales/orders/${order.order_id}/items/${itemId}/logistics`, {
                delivery_mode: payload.delivery_mode,
                customer_address_id: payload.customer_address_id || undefined,
                shipping_charge: payload.shipping_charge,
                delivery_contact_name: payload.delivery_contact_name,
                delivery_contact_phone: payload.delivery_contact_phone,
                delivery_address: payload.delivery_address,
                delivery_pincode: payload.delivery_pincode
            });
            const { data } = await api.get(`/sales/orders/${order.order_id}`);
            setDetails(data);
            setItemEdits(prev => {
                const next = { ...prev };
                (data.items || []).forEach((it) => {
                    next[it.item_id] = { ...(next[it.item_id] || {}), unit_price: it.unit_price ?? '', quantity: it.quantity ?? 1 };
                });
                return next;
            });
            const updates = [priceChanged && 'rent price'].filter(Boolean);
            alert(updates.length ? `${updates.join(' and ')} and laptop details updated` : 'Laptop details updated');
            onRefresh();
        } catch (e) {
            alert('Failed to update: ' + (e.response?.data?.message || e.message));
        } finally {
            setSavingItemId(null);
        }
    };

    const getItemStatusBadge = (status) => {
        const colors = { 'Assigned': 'bg-green-100 text-green-700', 'Procurement': 'bg-orange-100 text-orange-700', 'Warehouse': 'bg-teal-100 text-teal-700' };
        return colors[status] || 'bg-gray-100 text-gray-700';
    };
    const getTrackingStatusBadge = (status) => {
        const colors = {
            'Not Dispatched': 'bg-gray-100 text-gray-700',
            'On The Way': 'bg-blue-100 text-blue-700',
            'Delivered': 'bg-emerald-100 text-emerald-700'
        };
        return colors[status] || 'bg-gray-100 text-gray-700';
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-xl z-10">
                    <div>
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <ClipboardList className="text-blue-600 w-4 h-4" /> Order #{order.order_id}
                        </h3>
                        <p className="text-xs text-gray-500">{order.company_name || order.customer_name || '-'} | Owner: {details?.order?.owner_name || order.owner_name || 'Unknown'}</p>
                    </div>
                    <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
                </div>

                <div className="p-4">
                    {loading ? (
                        <div className="text-center py-6"><Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto" /></div>
                    ) : details ? (
                        <div className="space-y-3">
                            {/* Status & Dispatch Info */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Status</div>
                                    <div className="font-semibold text-blue-600 text-xs">{details.order.status}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Delivered</div>
                                    <div className="font-semibold text-emerald-700 text-xs">{details.tracking_summary?.delivered || 0}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">On The Way</div>
                                    <div className="font-semibold text-blue-700 text-xs">{details.tracking_summary?.on_the_way || 0}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Not Dispatched</div>
                                    <div className="font-semibold text-gray-700 text-xs">{details.tracking_summary?.not_dispatched || 0}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Created</div>
                                    <div className="font-semibold text-xs">{new Date(details.order.created_at).toLocaleString()}</div>
                                </div>
                                {details.order.courier_partner && (
                                    <div className="bg-gray-50 p-2 rounded text-sm">
                                        <div className="text-[10px] text-gray-500">Courier</div>
                                        <div className="font-semibold text-xs">{details.order.courier_partner}</div>
                                    </div>
                                )}
                                {details.order.tracker_id && (
                                    <div className="bg-gray-50 p-2 rounded text-sm">
                                        <div className="text-[10px] text-gray-500">Tracker ID</div>
                                        <div className="font-semibold text-blue-600 font-mono text-xs">{details.order.tracker_id}</div>
                                    </div>
                                )}
                                {details.order.estimated_delivery && (
                                    <div className="bg-green-50 p-2 rounded border border-green-200 text-sm">
                                        <div className="text-[10px] text-green-600">ETA</div>
                                        <div className="font-semibold text-green-700 text-xs">{new Date(details.order.estimated_delivery).toLocaleDateString()}</div>
                                    </div>
                                )}
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Customer Type</div>
                                    <div className="font-semibold text-xs">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${(details.order.customer_type || 'New') === 'New' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {details.order.customer_type || 'New'}
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Order type</div>
                                    <div className="font-semibold text-xs text-violet-800">{details.order.order_type || 'Sales'}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Lock-in (Days)</div>
                                    {canEditSecurityLockin ? (
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs font-semibold"
                                            value={orderChargesEdit.lockin_period_days}
                                            onChange={(e) => setOrderChargesEdit(prev => ({ ...prev, lockin_period_days: e.target.value }))}
                                        />
                                    ) : (
                                        <div className="font-semibold text-xs">{details.order.lockin_period_days ?? 0}</div>
                                    )}
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Subtotal</div>
                                    <div className="font-semibold text-xs">₹{parseFloat(details.order.subtotal_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">GST (Items)</div>
                                    <div className="font-semibold text-xs">₹{parseFloat(details.order.items_gst_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Security</div>
                                    {canEditSecurityLockin ? (
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs">₹</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs font-semibold"
                                                value={orderChargesEdit.security_amount}
                                                onChange={(e) => setOrderChargesEdit(prev => ({ ...prev, security_amount: e.target.value }))}
                                            />
                                        </div>
                                    ) : (
                                        <div className="font-semibold text-xs">₹{parseFloat(details.order.security_amount || 0).toFixed(2)}</div>
                                    )}
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Grand Total</div>
                                    <div className="font-semibold text-xs text-blue-600">₹{parseFloat(details.order.grand_total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                                </div>
                                {canEditSecurityLockin && (
                                    <div className="bg-gray-50 p-2 rounded text-sm flex items-end">
                                        <button
                                            onClick={handleSaveCharges}
                                            disabled={savingCharges}
                                            className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-900 flex items-center gap-1 disabled:opacity-60"
                                        >
                                            <Save className="w-3 h-3" /> {savingCharges ? 'Saving...' : 'Save Security & Lock-in'}
                                        </button>
                                    </div>
                                )}
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Estimate ID</div>
                                    <div className="font-semibold text-xs truncate">{details.order.estimate_id || '-'}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">Invoice</div>
                                    <div className="font-semibold text-xs truncate">{details.order.invoice_number || '-'}</div>
                                </div>
                                <div className="bg-gray-50 p-2 rounded text-sm">
                                    <div className="text-[10px] text-gray-500">E-way Bill</div>
                                    <div className="font-semibold text-xs truncate">{details.order.eway_bill_number || '-'}</div>
                                </div>
                            </div>

                            {/* Status Timeline */}
                            <div>
                                <h4 className="font-semibold text-gray-800 text-sm mb-2">Status Timeline</h4>
                                <div className="space-y-1.5">
                                    {(details.status_history || []).map((entry, idx) => (
                                        <div key={entry.history_id || idx} className="bg-gray-50 border rounded p-2 text-xs">
                                            <div className="flex items-center justify-between">
                                                <div className="font-medium text-gray-900">
                                                    {entry.from_status ? `${entry.from_status} → ${entry.to_status}` : entry.to_status}
                                                </div>
                                                <div className="text-[10px] text-gray-500">
                                                    {new Date(entry.changed_at).toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-gray-500">By: {entry.changed_by_name || 'System'}</div>
                                            {entry.notes && <div className="text-[10px] text-gray-600 mt-0.5">{entry.notes}</div>}
                                        </div>
                                    ))}
                                    {(!details.status_history || details.status_history.length === 0) && (
                                        <div className="text-xs text-gray-500">No status history yet.</div>
                                    )}
                                </div>
                            </div>

                            {/* Items */}
                            <div>
                                <h4 className="font-semibold text-gray-800 text-sm mb-2">Order Items</h4>
                                <div className="space-y-1.5">
                                    {details.items.map((item, idx) => (
                                        <div key={idx} className="bg-gray-50 p-2 rounded text-sm">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="min-w-0">
                                                    <div className="font-medium text-xs">{item.brand} {item.preferred_model}</div>
                                                    <div className="text-[10px] text-gray-500">{item.processor}{item.generation ? ` | ${item.generation}` : ''} | {item.ram} | {item.storage}</div>
                                                    {item.machine_number && <div className="text-[10px] text-blue-600">Machine: {item.machine_number}</div>}
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getItemStatusBadge(item.status)}`}>{item.status}</span>
                                                    <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${getTrackingStatusBadge(item.tracking_status)}`}>{item.tracking_status || 'Not Dispatched'}</span>
                                                    <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
                                                        {canEditQuantity ? (
                                                            <>
                                                                <span>Qty:</span>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    className="w-10 border border-slate-200 rounded px-1 py-0.5 text-[10px]"
                                                                    value={itemEdits[item.item_id]?.quantity ?? item.quantity ?? 1}
                                                                    onChange={(e) => setItemEdits(prev => ({
                                                                        ...prev,
                                                                        [item.item_id]: { ...(prev[item.item_id] || {}), quantity: e.target.value }
                                                                    }))}
                                                                />
                                                            </>
                                                        ) : (
                                                            <>Qty: {item.quantity}</>
                                                        )}
                                                        <span>|</span>
                                                        {canEditPrice ? (
                                                            <>
                                                                <span>₹</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="w-16 border border-slate-200 rounded px-1 py-0.5 text-[10px]"
                                                                    value={itemEdits[item.item_id]?.unit_price ?? item.unit_price ?? ''}
                                                                    onChange={(e) => setItemEdits(prev => ({
                                                                        ...prev,
                                                                        [item.item_id]: { ...(prev[item.item_id] || {}), unit_price: e.target.value }
                                                                    }))}
                                                                />
                                                                <span className="text-slate-400">(rent)</span>
                                                            </>
                                                        ) : (
                                                            <>₹{item.unit_price}</>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-2 grid grid-cols-1 md:grid-cols-6 gap-1.5 text-[11px]">
                                                <select
                                                    className="border rounded px-2 py-1"
                                                    value={itemEdits[item.item_id]?.delivery_mode ?? item.delivery_mode ?? (item.is_wfh ? 'WFH' : 'Office')}
                                                    disabled={!canSalesEdit}
                                                    onChange={(e) => setItemEdits(prev => ({
                                                        ...prev,
                                                        [item.item_id]: {
                                                            ...(prev[item.item_id] || {}),
                                                            delivery_mode: e.target.value,
                                                            shipping_charge: e.target.value === 'WFH'
                                                                ? (prev[item.item_id]?.shipping_charge || item.shipping_charge || 0)
                                                                : 0
                                                        }
                                                    }))}
                                                >
                                                    <option value="Office">Office</option>
                                                    <option value="WFH">WFH</option>
                                                </select>
                                                {(itemEdits[item.item_id]?.delivery_mode ?? item.delivery_mode ?? (item.is_wfh ? 'WFH' : 'Office')) === 'Office' ? (
                                                    <select
                                                        className="border rounded px-2 py-1 md:col-span-4"
                                                        disabled={!canSalesEdit}
                                                        value={itemEdits[item.item_id]?.customer_address_id ?? (item.customer_address_id ? String(item.customer_address_id) : '')}
                                                        onChange={(e) => setItemEdits(prev => ({
                                                            ...prev,
                                                            [item.item_id]: { ...(prev[item.item_id] || {}), customer_address_id: e.target.value }
                                                        }))}
                                                    >
                                                        <option value="">Select office address</option>
                                                        {availableOfficeAddresses.map((row) => (
                                                            <option key={row.customer_address_id} value={row.customer_address_id}>
                                                                {row.is_head_office ? '[Head Office] ' : ''}{row.concern_person || 'Contact'} - {row.address} {row.pincode ? `(${row.pincode})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <>
                                                        <input
                                                            className="border rounded px-2 py-1"
                                                            placeholder="WFH Shipping"
                                                            type="number"
                                                            min="0"
                                                            disabled={!canSalesEdit}
                                                            value={itemEdits[item.item_id]?.shipping_charge ?? item.shipping_charge ?? 0}
                                                            onChange={(e) => setItemEdits(prev => ({
                                                                ...prev,
                                                                [item.item_id]: { ...(prev[item.item_id] || {}), shipping_charge: e.target.value }
                                                            }))}
                                                        />
                                                        <input
                                                            className="border rounded px-2 py-1"
                                                            placeholder="Name"
                                                            disabled={!canSalesEdit}
                                                            value={itemEdits[item.item_id]?.delivery_contact_name ?? item.delivery_contact_name ?? ''}
                                                            onChange={(e) => setItemEdits(prev => ({
                                                                ...prev,
                                                                [item.item_id]: { ...(prev[item.item_id] || {}), delivery_contact_name: e.target.value }
                                                            }))}
                                                        />
                                                        <input
                                                            className="border rounded px-2 py-1"
                                                            placeholder="Phone"
                                                            disabled={!canSalesEdit}
                                                            value={itemEdits[item.item_id]?.delivery_contact_phone ?? item.delivery_contact_phone ?? ''}
                                                            onChange={(e) => setItemEdits(prev => ({
                                                                ...prev,
                                                                [item.item_id]: { ...(prev[item.item_id] || {}), delivery_contact_phone: e.target.value }
                                                            }))}
                                                        />
                                                        <input
                                                            className="border rounded px-2 py-1 md:col-span-2"
                                                            placeholder="Address"
                                                            disabled={!canSalesEdit}
                                                            value={itemEdits[item.item_id]?.delivery_address ?? item.delivery_address ?? ''}
                                                            onChange={(e) => setItemEdits(prev => ({
                                                                ...prev,
                                                                [item.item_id]: { ...(prev[item.item_id] || {}), delivery_address: e.target.value }
                                                            }))}
                                                        />
                                                        <input
                                                            className="border rounded px-2 py-1"
                                                            placeholder="Pincode"
                                                            disabled={!canSalesEdit}
                                                            value={itemEdits[item.item_id]?.delivery_pincode ?? item.delivery_pincode ?? ''}
                                                            onChange={(e) => setItemEdits(prev => ({
                                                                ...prev,
                                                                [item.item_id]: { ...(prev[item.item_id] || {}), delivery_pincode: e.target.value }
                                                            }))}
                                                        />
                                                    </>
                                                )}
                                                {canSalesEdit ? (
                                                    <button
                                                        onClick={() => handleSaveItemLogistics(item.item_id)}
                                                        disabled={savingItemId === item.item_id}
                                                        className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-900 flex items-center justify-center gap-1 disabled:opacity-60"
                                                    >
                                                        <Save className="w-2.5 h-2.5" /> {savingItemId === item.item_id ? 'Saving...' : 'Save'}
                                                    </button>
                                                ) : (
                                                    <div className="text-gray-500">
                                                        {item.delivery_mode === 'WFH' ? 'WFH' : 'Office'} | {item.delivery_contact_name || '-'} | {item.delivery_contact_phone || '-'}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-gray-600 mt-1">
                                                Delivery: {item.delivery_address || '-'} {item.delivery_pincode ? `(${item.delivery_pincode})` : ''}
                                            </div>
                                            {(item.item_courier_partner || item.item_tracker_id) && (
                                                <div className="mt-1 text-[10px] text-gray-600">
                                                    Courier: {item.item_courier_partner || '-'} | Tracker: {item.item_tracker_id || '-'}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-3 border-t flex-wrap">
                                {canSalesEdit && details.order.status !== 'Cancelled' && details.order.status !== 'Delivered' && details.order.status !== 'Dispatched' && (
                                    <button
                                        onClick={handleCancelOrder}
                                        disabled={processing}
                                        className="px-4 py-2 bg-rose-600 text-white font-semibold rounded text-sm hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        <Ban className="w-3.5 h-3.5" /> Cancel Order
                                    </button>
                                )}
                                {!canDispatchFlow && (
                                    <div className="text-xs text-gray-500">Status actions restricted to Dispatch team.</div>
                                )}
                            </div>
                        </div>
                    ) : <div className="text-center text-gray-500 py-8">Failed to load order details</div>}
                </div>

                <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-900 text-white font-semibold rounded-lg text-sm hover:bg-gray-800">Close</button>
                </div>
            </div>
        </div>
    );
}
