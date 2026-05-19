import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Users, ClipboardList, AlertTriangle, Laptop } from 'lucide-react';

export default function ManagerDashboard({ api }) {
    const [data, setData] = useState(null);
    const [orderStats, setOrderStats] = useState(null);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [loading, setLoading] = useState(true);

    const loadReports = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            const [leadsRes, statsRes] = await Promise.all([
                api.get('/leads/reports'),
                api.get('/sales/orders/stats' + (params.toString() ? '?' + params.toString() : ''))
            ]);
            setData(leadsRes.data);
            setOrderStats(statsRes.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api, dateFrom, dateTo]);

    useEffect(() => {
        loadReports();
    }, [loadReports]);

    if (loading) return <div className="text-center py-12">Loading reports...</div>;
    if (!data) return <div className="text-center py-12">No data</div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <BarChart3 className="text-purple-600" />
                        Manager Dashboard
                    </h2>
                    <p className="text-gray-600">Lead intelligence & order overview</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                        type="date"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                </div>
            </div>

            {/* Order Stats: New vs Existing */}
            {orderStats && (
                <div className="bg-white border rounded-xl p-6">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                        <Laptop className="w-4 h-4" /> Orders by Customer Type
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50">
                            <div className="text-xs text-emerald-600 font-medium">New Customers</div>
                            <div className="text-2xl font-bold text-emerald-700">{orderStats.newCustomerOrders}</div>
                            <div className="text-xs text-emerald-600 mt-1">{orderStats.newCustomerLaptops} laptops</div>
                        </div>
                        <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50">
                            <div className="text-xs text-blue-600 font-medium">Existing Customers</div>
                            <div className="text-2xl font-bold text-blue-700">{orderStats.existingCustomerOrders}</div>
                            <div className="text-xs text-blue-600 mt-1">{orderStats.existingCustomerLaptops} laptops</div>
                        </div>
                        <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50">
                            <div className="text-xs text-gray-600 font-medium">Total Orders</div>
                            <div className="text-2xl font-bold text-gray-700">{orderStats.totalOrders}</div>
                        </div>
                        <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50">
                            <div className="text-xs text-gray-600 font-medium">Total Laptops</div>
                            <div className="text-2xl font-bold text-gray-700">{orderStats.totalLaptops}</div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border rounded-xl p-4">
                    <div className="text-sm text-gray-500">Total Leads</div>
                    <div className="text-2xl font-bold">{data.totals.totalLeads}</div>
                </div>
                <div className="bg-white border rounded-xl p-4">
                    <div className="text-sm text-gray-500">Pending Leads</div>
                    <div className="text-2xl font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        {data.totals.pendingLeads}
                    </div>
                </div>
                <div className="bg-white border rounded-xl p-4">
                    <div className="text-sm text-gray-500">Deals</div>
                    <div className="text-2xl font-bold">{data.totals.deals}</div>
                </div>
                <div className="bg-white border rounded-xl p-4">
                    <div className="text-sm text-gray-500">Orders</div>
                    <div className="text-2xl font-bold">{data.totals.orders}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border rounded-xl p-6">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" /> Status Breakdown
                    </h3>
                    <div className="space-y-2 text-sm">
                        {data.statusWise.map(item => (
                            <div key={item.status} className="flex items-center justify-between">
                                <span>{item.status}</span>
                                <span className="font-semibold">{item.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-white border rounded-xl p-6">
                    <h3 className="font-bold mb-4 flex items-center gap-2">
                        <Users className="w-4 h-4" /> Assignee Distribution
                    </h3>
                    <div className="space-y-2 text-sm">
                        {data.teamWise.map(item => (
                            <div key={item.team_name || 'Unassigned'} className="flex items-center justify-between">
                                <span>{item.team_name || 'Unassigned'}</span>
                                <span className="font-semibold">{item.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
