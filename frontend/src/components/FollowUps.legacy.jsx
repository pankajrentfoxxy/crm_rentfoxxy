import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function FollowUps({ api }) {
    const navigate = useNavigate();
    const [today, setToday] = useState([]);
    const [overdue, setOverdue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [notifiedIds, setNotifiedIds] = useState([]);

    const loadFollowUps = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/leads/follow-ups');
            setToday(data.today || []);
            setOverdue(data.overdue || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => {
        loadFollowUps();
    }, [loadFollowUps]);

    useEffect(() => {
        const allLeads = [...today, ...overdue];
        const upcoming = allLeads.filter((lead) => getFollowUpState(lead.followUpDate) === 'upcoming_10m');
        if (!upcoming.length || typeof window === 'undefined' || !('Notification' in window)) return;

        const sendNotifications = () => {
            const newIds = [];
            upcoming.forEach((lead) => {
                if (notifiedIds.includes(lead.leadId)) return;
                new Notification(`Follow-up in 10 minutes: ${lead.name}`, {
                    body: `${lead.companyName || 'No company'} - ${new Date(lead.followUpDate).toLocaleString()}`
                });
                newIds.push(lead.leadId);
            });
            if (newIds.length) {
                setNotifiedIds((prev) => [...prev, ...newIds]);
            }
        };

        if (Notification.permission === 'granted') {
            sendNotifications();
            return;
        }
        if (Notification.permission === 'default') {
            Notification.requestPermission().then((permission) => {
                if (permission === 'granted') sendNotifications();
            });
        }
    }, [today, overdue, notifiedIds]);

    if (loading) return <div className="text-center py-12 text-slate-500 text-sm">Loading follow-ups...</div>;

    const getFollowUpState = (followUpDate) => {
        if (!followUpDate) return 'normal';
        const now = new Date();
        const due = new Date(followUpDate);
        const diff = due.getTime() - now.getTime();
        if (diff < 0) return 'overdue';
        if (diff <= 10 * 60 * 1000) return 'upcoming_10m';
        return 'normal';
    };

    const formatFollowUpDateTime = (dateStr) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return (
            <div className="leading-tight">
                <div className="text-slate-600">{d.toLocaleDateString()}</div>
                <div className="text-xs text-slate-500">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        );
    };

    const renderTable = (items) => (
        <div className="overflow-x-auto min-w-0">
        <table className="w-full text-sm table-fixed">
            <colgroup>
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[22%]" />
                <col className="w-[15%]" />
            </colgroup>
            <thead className="bg-slate-50">
                <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Lead</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Company</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Assignee</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Follow-up</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Action</th>
                </tr>
            </thead>
            <tbody>
                {items.map(lead => (
                    <tr
                        key={lead.leadId}
                        className={`border-t border-slate-100 hover:bg-slate-50/50 transition-colors ${
                            getFollowUpState(lead.followUpDate) === 'overdue'
                                ? 'bg-red-50/50'
                                : getFollowUpState(lead.followUpDate) === 'upcoming_10m'
                                    ? 'bg-emerald-50/50'
                                    : ''
                        }`}
                    >
                        <td className="px-2 py-2 text-slate-800 truncate" title={lead.name}>{lead.name}</td>
                        <td className="px-2 py-2 text-slate-600 truncate" title={lead.companyName || ''}>{lead.companyName || '-'}</td>
                        <td className="px-2 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                                {lead.status}
                            </span>
                        </td>
                        <td className="px-2 py-2 text-slate-600 truncate" title={lead.assignedUser?.name || ''}>{lead.assignedUser?.name || '-'}</td>
                        <td className="px-2 py-2 text-slate-600 align-top">
                            {formatFollowUpDateTime(lead.followUpDate)}
                            {getFollowUpState(lead.followUpDate) === 'upcoming_10m' && (
                                <div className="text-xs text-emerald-600 font-medium mt-0.5">Due in 10 min</div>
                            )}
                            {getFollowUpState(lead.followUpDate) === 'overdue' && (
                                <div className="text-xs text-red-600 font-medium mt-0.5">Overdue</div>
                            )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap align-top">
                            <button
                                onClick={() => navigate(`/leads/${lead.leadId}`)}
                                className="text-indigo-600 hover:text-indigo-700 font-medium text-xs"
                            >
                                Update
                            </button>
                        </td>
                    </tr>
                ))}
                {items.length === 0 && (
                    <tr>
                                    <td colSpan="6" className="px-2 py-6 text-center text-slate-500 text-sm">
                            No follow-ups found.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
        </div>
    );

    return (
        <div className="space-y-4 max-w-6xl mx-auto">
            <div>
                <h1 className="text-lg font-medium text-slate-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    Follow-ups
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">Today and overdue follow-ups</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                        <h3 className="text-xs font-medium text-slate-600">Today</h3>
                    </div>
                    {renderTable(today)}
                </div>

                <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <h3 className="text-xs font-medium text-amber-800">Overdue</h3>
                    </div>
                    {renderTable(overdue)}
                </div>
            </div>
        </div>
    );
}
