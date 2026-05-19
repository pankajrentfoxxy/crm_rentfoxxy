import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, Plus } from 'lucide-react';
import api from '../../utils/api';
import { isSupportLead } from '../../utils/supportAccess';
import { useAuth } from '../../context/AuthContext';

export default function SupportTicketList() {
    const { user } = useAuth();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (debounced) params.set('search', debounced);
            const { data } = await api.get(`/support/tickets?${params}`);
            setTickets(data.tickets || []);
        } catch (e) {
            console.error(e);
            setTickets([]);
        } finally {
            setLoading(false);
        }
    }, [debounced]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl font-bold text-slate-900">Support tickets</h1>
                {isSupportLead(user) && (
                    <Link
                        to="/support/tickets/new"
                        className="inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-3 rounded-lg text-sm font-medium min-h-[44px]"
                    >
                        <Plus className="w-4 h-4" /> New ticket
                    </Link>
                )}
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search customer or ticket #"
                    className="w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg text-sm min-h-[44px]"
                />
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {tickets.map((t) => (
                        <Link
                            key={t.id}
                            to={`/support/tickets/${t.id}`}
                            className="block bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 min-h-[44px]"
                        >
                            <div className="flex justify-between items-start gap-2">
                                <span className="text-xs font-mono text-slate-500">#{t.id}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 capitalize">{t.status}</span>
                            </div>
                            <div className="font-semibold text-slate-900 mt-1">{t.customer_name || 'Customer'}</div>
                            <div className="text-sm text-slate-600 mt-1">{t.customer_phone || '—'}</div>
                            <div className="text-xs text-slate-500 mt-2">
                                {t.open_item_count ?? 0} open / {t.item_count ?? 0} machines
                            </div>
                        </Link>
                    ))}
                    {!tickets.length && (
                        <p className="text-slate-500 text-sm col-span-full text-center py-8">No tickets yet.</p>
                    )}
                </div>
            )}
        </div>
    );
}
