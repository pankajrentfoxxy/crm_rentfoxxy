import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, RefreshCw, User, Users, Filter, Ticket, Layers, Clock, CheckCircle2, ChevronDown, ChevronRight, Cpu, Timer, Activity, Search, ChevronLeft } from 'lucide-react';

const PRODUCTIVITY_CARDS = [
    { key: 'total_technicians', label: 'Total Technicians', hint: 'Floor technicians (team filter applies)', icon: Users, accent: 'text-indigo-600' },
    { key: 'total_assigned', label: 'Total Assigned', hint: 'Tickets with an assigned technician in range', icon: Ticket, accent: 'text-blue-600' },
    { key: 'active_tickets', label: 'Active', hint: 'Tickets currently in progress', icon: Activity, accent: 'text-amber-600' },
    { key: 'pending_tickets', label: 'Pending', hint: 'Tickets on hold', icon: Clock, accent: 'text-orange-600' },
    { key: 'completed_tickets', label: 'Completed', hint: 'Tickets marked completed', icon: CheckCircle2, accent: 'text-emerald-600' },
    { key: 'qc1_completed', label: 'QC1', hint: 'Current at stage / completed in range', icon: CheckCircle2, accent: 'text-violet-600', stageKey: 'qc1' },
    { key: 'qc2_completed', label: 'QC2', hint: 'Current at stage / completed in range', icon: CheckCircle2, accent: 'text-purple-600', stageKey: 'qc2' },
    { key: 'chip_repair_completed', label: 'Chip Level Repair', hint: 'Current at stage / completed in range', icon: Cpu, accent: 'text-rose-600', stageKey: 'chip_repair' },
    { key: 'body_paint_completed', label: 'Body & Paint', hint: 'Current at stage / completed in range', icon: Layers, accent: 'text-pink-600', stageKey: 'body_paint' },
    { key: 'assembly_completed', label: 'Assembly & Software', hint: 'Current at stage / completed in range', icon: Cpu, accent: 'text-cyan-600', stageKey: 'assembly' },
    { key: 'final_testing_completed', label: 'Final Testing', hint: 'Current at stage / completed in range', icon: CheckCircle2, accent: 'text-teal-600', stageKey: 'final_testing' },
    { key: 'average_resolution_human', label: 'Avg Resolution Time', hint: 'First assignment to ticket completion', icon: Timer, accent: 'text-slate-700', isText: true }
];

function formatStageCardValue(productivity, card) {
    if (card.isText) return productivity?.[card.key] ?? '—';
    if (!card.stageKey || !productivity) {
        return productivity?.[card.key] ?? '—';
    }
    const atStage = productivity[`${card.stageKey}_at_stage`] ?? 0;
    const completed = productivity[card.key] ?? 0;
    return `${atStage} / ${completed}`;
}

const EXTRA_METRICS = [
    { key: 'reassigned_tickets', label: 'Reassigned tickets' },
    { key: 'diagnosis_completed', label: 'Diagnosis completed' },
    { key: 'returned_to_vendor', label: 'Returned to vendor' },
    { key: 'currently_working_tickets', label: 'Currently working' },
    { key: 'average_stage_human', label: 'Avg time per stage' },
    { key: 'total_working_human', label: 'Total working time' }
];

const BASE_COLUMNS = [
    { key: 'total_tickets', label: 'Distinct tickets (same rules as segment table below)', short: 'Total Ticket' },
    { key: 'active_till_today', label: 'Open segments now (assigned at)', short: 'Active Till Today' },
    { key: 'completed_segments', label: 'Ended segments in filtered set (matches Ended segments card)', short: 'Completed Stage' }
];

const HW_COLUMNS = [
    ...BASE_COLUMNS,
    { key: 'chip_tickets', label: 'Sent to Chip Level Repair from diagnosis', short: 'Chip Ticket' },
    { key: 'body_tickets', label: 'Sent to Body & Paint from diagnosis', short: 'Body Ticket' },
    { key: 'parts_used_count', label: 'Parts attached during work segments', short: 'Parts Used' },
    { key: 'upgrades_done', label: 'Config upgrades via parts', short: 'Upgrades Done' }
];

const QC_COLUMNS = [
    ...BASE_COLUMNS,
    { key: 'qc1_segments', label: 'QC1 ended segments in filtered set', short: 'QC1 Stage' },
    { key: 'qc2_segments', label: 'QC2 ended segments in filtered set', short: 'QC2 Stage' },
    { key: 'parts_used_count', label: 'Parts attached during work segments', short: 'Parts Used' },
    { key: 'upgrades_done', label: 'Config upgrades via parts', short: 'Upgrades Done' }
];

function formatHwSummary(totals) {
    if (!totals) return 'No activity in range';
    return `${totals.total_tickets} Ticket · ${totals.active_till_today} active · ${totals.completed_segments} completed · Chip ${totals.chip_tickets} · Body ${totals.body_tickets} · Parts ${totals.parts_used_count || 0} · Upgrades ${totals.upgrades_done || 0}`;
}

function formatQcSummary(totals) {
    if (!totals) return 'No activity in range';
    return `${totals.total_tickets} Ticket · ${totals.active_till_today} active · ${totals.completed_segments} completed stage · QC1 ${totals.qc1_segments} · QC2 ${totals.qc2_segments}`;
}

function WorkloadSection({ title, icon: Icon, accent, summaryText, totals, columns, members, expanded, onToggle, loading }) {
    const thClass = 'px-2 py-2 text-[10px] font-semibold text-gray-600 text-right whitespace-nowrap';
    const tdClass = 'px-2 py-2 text-xs text-right tabular-nums font-medium text-gray-800';

    return (
        <div className={`rounded-lg border ${accent.border} overflow-hidden`}>
            <button
                type="button"
                onClick={onToggle}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left ${accent.header} hover:opacity-95 transition-opacity`}
            >
                {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                {Icon && <Icon className={`w-4 h-4 shrink-0 ${accent.icon}`} />}
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900">{title}</div>
                    {!expanded && (
                        <div className="text-[11px] text-gray-600 truncate mt-0.5">{summaryText}</div>
                    )}
                </div>
            </button>

            {expanded && (
                <div className="bg-white px-4 pb-4 pt-2 border-t border-gray-100">
                    {loading ? (
                        <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
                    ) : (
                        <>
                            <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4 p-3 rounded-lg ${accent.totalsBg}`}>
                                {columns.map((col) => (
                                    <div key={col.key} className="text-center">
                                        <div className="text-[10px] font-medium text-gray-500 uppercase">{col.short}</div>
                                        <div className={`text-lg font-bold tabular-nums ${accent.totalsNum}`}>
                                            {totals?.[col.key] ?? 0}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {members.length === 0 ? (
                                <p className="text-sm text-gray-500 py-3 text-center">No activity for this category in the selected range.</p>
                            ) : (
                                <div className="overflow-x-auto -mx-1">
                                    <table className="w-full min-w-[720px]">
                                        <thead>
                                            <tr className="border-b border-gray-200">
                                                <th className="px-2 py-2 text-[10px] font-semibold text-gray-600 text-left sticky left-0 bg-white">
                                                    Technician
                                                </th>
                                                {columns.map((col) => (
                                                    <th key={col.key} className={thClass} title={col.label}>
                                                        {col.short}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {members.map((row) => (
                                                <tr key={row.user_id} className="hover:bg-gray-50/80">
                                                    <td className="px-2 py-2 text-sm font-medium text-gray-900 sticky left-0 bg-white">
                                                        {row.name}
                                                    </td>
                                                    {columns.map((col) => (
                                                        <td key={col.key} className={tdClass}>
                                                            {row[col.key] ?? 0}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p className="text-[10px] text-gray-500 mt-3">
                                Uses the same filters as the report below. Total Ticket = unique tickets in that list.
                                Completed Stage = ended segments in that list (same as Ended segments when all stages are included).
                                QC1/QC2 Stage = ended QC1 or QC2 segments in that list. Active Till Today = open segments now.
                            </p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function defaultDateRange() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 29);
    return {
        from: localYmd(from),
        to: localYmd(to)
    };
}

function localYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const DATE_PRESETS = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: 'Last 7 Days' },
    { key: 'last30', label: 'Last 30 Days' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'custom', label: 'Custom Date Range' },
];

function rangeForPreset(preset) {
    const today = new Date();
    const todayStr = localYmd(today);
    switch (preset) {
        case 'today':
            return { from: todayStr, to: todayStr };
        case 'yesterday': {
            const y = new Date(today);
            y.setDate(y.getDate() - 1);
            return { from: localYmd(y), to: localYmd(y) };
        }
        case 'last7': {
            const f = new Date(today);
            f.setDate(f.getDate() - 6);
            return { from: localYmd(f), to: todayStr };
        }
        case 'last30': {
            const f = new Date(today);
            f.setDate(f.getDate() - 29);
            return { from: localYmd(f), to: todayStr };
        }
        case 'thisMonth': {
            const f = new Date(today.getFullYear(), today.getMonth(), 1);
            return { from: localYmd(f), to: todayStr };
        }
        default:
            return null;
    }
}

const TECH_SUMMARY_COLUMNS = [
    { key: 'total_assigned', label: 'Assigned', short: 'Assigned' },
    { key: 'active_tickets', label: 'Active', short: 'Active' },
    { key: 'completed_tickets', label: 'Completed', short: 'Done' },
    { key: 'pending_tickets', label: 'Pending', short: 'Pending' },
    { key: 'overdue_tickets', label: 'Overdue', short: 'Overdue' },
    { key: 'qc1_tickets', label: 'QC1', short: 'QC1' },
    { key: 'qc2_tickets', label: 'QC2', short: 'QC2' },
    { key: 'chip_repair_tickets', label: 'Chip Repair', short: 'Chip' },
    { key: 'body_paint_tickets', label: 'Body & Paint', short: 'Body' },
    { key: 'average_completion_human', label: 'Avg completion', short: 'Avg time' },
    { key: 'total_working_human', label: 'Total working time', short: 'Work time' },
];

const TEAM_SUMMARY_METRICS = [
    { key: 'total_tickets', label: 'Total tickets' },
    { key: 'total_assigned', label: 'Assigned' },
    { key: 'active_tickets', label: 'Active' },
    { key: 'completed_tickets', label: 'Completed' },
    { key: 'pending_tickets', label: 'Pending' },
    { key: 'overdue_tickets', label: 'Overdue' },
    { key: 'average_completion_human', label: 'Avg completion' },
    { key: 'total_working_human', label: 'Total work time' },
];

const TEAM_MEMBER_COLUMNS = [
    { key: 'total_assigned', short: 'Assigned' },
    { key: 'active_tickets', short: 'Active' },
    { key: 'completed_tickets', short: 'Completed' },
    { key: 'pending_tickets', short: 'Pending' },
    { key: 'overdue_tickets', short: 'Overdue' },
    { key: 'average_completion_human', short: 'Avg time' },
    { key: 'total_working_human', short: 'Work time' },
];

const TECHNICIAN_SINGLE_METRICS = [
    { key: 'total_assigned', label: 'Assigned' },
    { key: 'completed_tickets', label: 'Completed' },
    { key: 'pending_tickets', label: 'Pending' },
    { key: 'active_tickets', label: 'Active' },
    { key: 'overdue_tickets', label: 'Overdue' },
    { key: 'qc1_tickets', label: 'QC1' },
    { key: 'qc2_tickets', label: 'QC2' },
    { key: 'chip_repair_tickets', label: 'Chip repair' },
    { key: 'body_paint_tickets', label: 'Body & paint' },
    { key: 'average_completion_human', label: 'Avg completion' },
    { key: 'total_working_human', label: 'Total work time' },
];

const STAGE_SUMMARY_METRICS = [
    { key: 'total_assigned', label: 'Total entered' },
    { key: 'completed_tickets', label: 'Completed' },
    { key: 'pending_tickets', label: 'Pending' },
    { key: 'active_tickets', label: 'Active' },
    { key: 'failed_tickets', label: 'Failed' },
    { key: 'returned_tickets', label: 'Returned' },
    { key: 'average_stage_human', label: 'Avg time in stage' },
    { key: 'currently_working', label: 'Currently working' },
];

function SummaryMetricCards({ metrics, fields, loading }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 p-4">
            {fields.map((field) => (
                <div key={field.key} className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{field.label}</div>
                    <div className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {loading ? '—' : (metrics?.[field.key] ?? 0)}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TechnicianSummaryTable({
    columns,
    rows,
    loading,
    userId,
    onSelect,
    emptyMessage = 'No technicians found for the current filters.',
}) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                        <th className="px-3 py-2 text-xs font-semibold text-gray-700 sticky left-0 bg-gray-50">Technician</th>
                        {columns.map((col) => (
                            <th key={col.key} className="px-2 py-2 text-[10px] font-semibold text-gray-600 text-right whitespace-nowrap">
                                {col.short}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {loading ? (
                        <tr>
                            <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">
                                Loading summary…
                            </td>
                        </tr>
                    ) : !rows.length ? (
                        <tr>
                            <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">
                                {emptyMessage}
                            </td>
                        </tr>
                    ) : (
                        rows.map((tech) => {
                            const selected = String(userId) === String(tech.user_id);
                            const hasActivity = columns.some((col) => {
                                const val = tech[col.key];
                                return typeof val === 'number' ? val > 0 : false;
                            });
                            return (
                                <tr
                                    key={tech.user_id}
                                    onClick={() => onSelect?.(tech.user_id)}
                                    className={`${onSelect ? 'cursor-pointer' : ''} transition-colors ${
                                        selected
                                            ? 'bg-indigo-50 hover:bg-indigo-100'
                                            : hasActivity
                                                ? 'hover:bg-gray-50'
                                                : 'text-gray-500 hover:bg-gray-50/80'
                                    }`}
                                >
                                    <td className={`px-3 py-2 text-sm font-medium sticky left-0 ${selected ? 'bg-indigo-50 text-indigo-900' : 'bg-white text-gray-900'}`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            <User className="w-3.5 h-3.5 shrink-0" />
                                            {tech.name}
                                            {selected && (
                                                <span className="text-[10px] font-semibold uppercase text-indigo-600">Filtered</span>
                                            )}
                                        </span>
                                    </td>
                                    {columns.map((col) => (
                                        <td key={col.key} className="px-2 py-2 text-xs text-right tabular-nums font-medium">
                                            {tech[col.key] ?? '—'}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

export default function Reports({ api }) {
    const defaults = useMemo(() => defaultDateRange(), []);
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState(null);
    const [workloadDashboard, setWorkloadDashboard] = useState(null);
    const [dynamicSummary, setDynamicSummary] = useState({ mode: 'technicians', technicians: [] });
    const [dashExpanded, setDashExpanded] = useState(false);
    const [hwExpanded, setHwExpanded] = useState(false);
    const [qcExpanded, setQcExpanded] = useState(false);
    const [technicians, setTechnicians] = useState([]);
    const [teams, setTeams] = useState([]);
    const [stages, setStages] = useState([]);
    const [productivity, setProductivity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [datePreset, setDatePreset] = useState('last30');
    const [from, setFrom] = useState(defaults.from);
    const [to, setTo] = useState(defaults.to);
    const [allTime, setAllTime] = useState(false);
    const [userId, setUserId] = useState('');
    const [teamId, setTeamId] = useState('');
    const [ticketStatus, setTicketStatus] = useState('');
    const [segmentStatus, setSegmentStatus] = useState('');
    const [stageId, setStageId] = useState('');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
    const [sortConfig, setSortConfig] = useState({ key: 'assigned_at', direction: 'desc' });

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [allTime, from, to, userId, teamId, ticketStatus, segmentStatus, stageId, debouncedSearch, pageSize]);

    const loadReport = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (!allTime) {
                params.set('from', from);
                params.set('to', to);
            } else {
                params.set('all_time', '1');
            }
            if (userId) params.set('user_id', userId);
            if (teamId) params.set('team_id', teamId);
            if (ticketStatus) params.set('ticket_status', ticketStatus);
            if (segmentStatus) params.set('segment_status', segmentStatus);
            if (stageId) params.set('stage_id', stageId);
            if (debouncedSearch) params.set('search', debouncedSearch);
            params.set('page', String(page));
            params.set('limit', String(pageSize));

            const { data } = await api.get('/reports/technician-performance?' + params.toString());
            setRows(data.rows || data.report || []);
            setSummary(data.summary || null);
            setProductivity(data.productivity || data.summary?.productivity || null);
            setWorkloadDashboard(data.workload_dashboard || null);
            setDynamicSummary(data.dynamic_summary || {
                mode: data.summary_mode || 'technicians',
                technicians: data.technician_summary || [],
            });
            setTechnicians(data.technicians || []);
            setTeams(data.teams || []);
            setStages(data.stages || []);
            setPagination(data.pagination || { page, limit: pageSize, total: 0, totalPages: 1 });
        } catch (error) {
            console.error('Report load error:', error);
            setRows([]);
            setSummary(null);
            setProductivity(null);
            setWorkloadDashboard(null);
            setDynamicSummary({ mode: 'technicians', technicians: [] });
            const msg = error.response?.data?.message || error.message;
            if (msg) alert(`Report failed to load: ${msg}. Check backend is running and database is connected.`);
        } finally {
            setLoading(false);
        }
    }, [api, allTime, from, to, userId, teamId, ticketStatus, segmentStatus, stageId, debouncedSearch, page, pageSize]);

    useEffect(() => {
        loadReport();
    }, [loadReport]);

    const sortedRows = useMemo(() => {
        const list = [...rows];
        const { key, direction } = sortConfig;
        list.sort((a, b) => {
            let va = a[key];
            let vb = b[key];
            if (key === 'assigned_at' || key === 'completed_at' || key === 'assignment_time' || key === 'start_time' || key === 'end_time') {
                va = va ? new Date(va).getTime() : 0;
                vb = vb ? new Date(vb).getTime() : 0;
            } else if (key === 'duration_seconds') {
                va = Number(va) || 0;
                vb = Number(vb) || 0;
            } else {
                va = va == null ? '' : String(va).toLowerCase();
                vb = vb == null ? '' : String(vb).toLowerCase();
            }
            if (va < vb) return direction === 'asc' ? -1 : 1;
            if (va > vb) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        return list;
    }, [rows, sortConfig]);

    const handleSort = (key) => {
        setSortConfig((prev) => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const applyDatePreset = (preset) => {
        setDatePreset(preset);
        if (preset === 'custom') return;
        const range = rangeForPreset(preset);
        if (!range) return;
        setAllTime(false);
        setFrom(range.from);
        setTo(range.to);
    };

    const handleFromChange = (value) => {
        setFrom(value);
        setDatePreset('custom');
    };

    const handleToChange = (value) => {
        setTo(value);
        setDatePreset('custom');
    };

    const selectTechnician = (techUserId) => {
        setUserId(String(techUserId) === String(userId) ? '' : String(techUserId));
    };

    const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '—');

    const summaryMode = dynamicSummary?.mode || 'technicians';
    const technicianRows = dynamicSummary?.technicians || [];

    const detailSubtitle = useMemo(() => {
        const teamName = teams.find((t) => String(t.team_id) === String(teamId))?.team_name || dynamicSummary?.label;
        const techName = technicians.find((t) => String(t.user_id) === String(userId))?.name
            || dynamicSummary?.technicians?.find((t) => String(t.user_id) === String(userId))?.name;
        if (teamId && userId) {
            return `Showing ${techName || 'selected technician'}'s tickets for ${teamName || 'selected team'}`;
        }
        if (userId) {
            return `Showing tickets for ${techName || dynamicSummary?.label || 'selected technician'}`;
        }
        if (stageId) {
            return `Showing ${stages.find((s) => String(s.stage_id) === String(stageId))?.stage_name || dynamicSummary?.label || 'selected stage'} stage tickets`;
        }
        if (teamId) {
            return `Showing tickets for ${teamName || 'selected team'}`;
        }
        return 'All technicians in the selected date range';
    }, [userId, stageId, teamId, technicians, teams, stages, dynamicSummary?.label, dynamicSummary?.technicians]);

    const th = 'px-3 py-3 text-left text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 whitespace-nowrap';
    const td = 'px-3 py-2 text-xs text-gray-800 align-top';

    const breakdown = summary?.ticket_status_breakdown || {};
    const hw = workloadDashboard?.hardware_software;
    const qc = workloadDashboard?.qc;
    const dateLabel = allTime
        ? 'all time'
        : workloadDashboard?.date_range
            ? `${workloadDashboard.date_range.from} → ${workloadDashboard.date_range.to}`
            : summary?.date_range
                ? `${summary.date_range.from} → ${summary.date_range.to}`
                : `${from} → ${to}`;

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <BarChart3 className="text-indigo-600" />
                        Technician performance
                    </h2>
                    <p className="text-gray-600 text-sm mt-0.5">
                        Productivity dashboard with assignment segments, stage metrics, QC performance, and workload filters.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={loadReport}
                    className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-100 font-medium text-sm self-start"
                >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {/* Manager dashboard — collapsible HW/SW + QC */}
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/40 to-white shadow-sm overflow-hidden">
                <button
                    type="button"
                    onClick={() => setDashExpanded((v) => !v)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-indigo-50/50 transition-colors"
                >
                    {dashExpanded ? <ChevronDown className="w-5 h-5 text-indigo-600" /> : <ChevronRight className="w-5 h-5 text-indigo-600" />}
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-gray-900">Manager dashboard</h3>
                        <p className="text-[11px] text-gray-600 mt-0.5">
                            Hardware & Software + QC · Unique tickets & segments · {dateLabel}
                        </p>
                        {!dashExpanded && !loading && (
                            <div className="flex flex-col sm:flex-row sm:gap-4 gap-1 mt-2 text-[11px] text-gray-700">
                                <span>{formatHwSummary(hw?.totals)}</span>
                                <span className="hidden sm:inline text-gray-300">|</span>
                                <span>{formatQcSummary(qc?.totals)}</span>
                            </div>
                        )}
                    </div>
                </button>

                {dashExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-indigo-100">
                        <WorkloadSection
                            title="Hardware & Software"
                            icon={Cpu}
                            accent={{
                                border: 'border-blue-200',
                                header: 'bg-blue-50',
                                icon: 'text-blue-600',
                                totalsBg: 'bg-blue-50/60',
                                totalsNum: 'text-blue-800'
                            }}
                            summaryText={formatHwSummary(hw?.totals)}
                            totals={hw?.totals}
                            columns={HW_COLUMNS}
                            members={hw?.members || []}
                            expanded={hwExpanded}
                            onToggle={() => setHwExpanded((v) => !v)}
                            loading={loading}
                        />
                        <WorkloadSection
                            title="QC (QC1 & QC2)"
                            icon={CheckCircle2}
                            accent={{
                                border: 'border-violet-200',
                                header: 'bg-violet-50',
                                icon: 'text-violet-600',
                                totalsBg: 'bg-violet-50/60',
                                totalsNum: 'text-violet-800'
                            }}
                            summaryText={formatQcSummary(qc?.totals)}
                            totals={qc?.totals}
                            columns={QC_COLUMNS}
                            members={qc?.members || []}
                            expanded={qcExpanded}
                            onToggle={() => setQcExpanded((v) => !v)}
                            loading={loading}
                        />
                        <p className="text-[10px] text-gray-500 px-1">
                            Total Ticket = currently assigned tickets at relevant stages. Completed Stage = ended work segments in range.
                            Stage cards show <strong>current / completed</strong> ticket counts.
                        </p>
                    </div>
                )}
            </div>

            {/* Productivity dashboard */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
                {PRODUCTIVITY_CARDS.map((card) => {
                    const { key, label, hint, icon: Icon, accent, isText } = card;
                    return (
                    <div key={key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className={`flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide ${accent}`}>
                            <Icon className={`w-4 h-4 ${accent}`} /> {label}
                        </div>
                        <div className={`${isText ? 'text-lg' : 'text-2xl'} font-bold text-gray-900 mt-1 tabular-nums`}>
                            {loading ? '—' : formatStageCardValue(productivity, card)}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>
                    </div>
                    );
                })}
            </div>

            {/* Additional productivity metrics */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">Additional metrics</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {EXTRA_METRICS.map(({ key, label }) => (
                        <div key={key} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-medium text-gray-500">{label}</div>
                            <div className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
                                {loading ? '—' : productivity?.[key] ?? 0}
                            </div>
                        </div>
                    ))}
                </div>
                {!loading && productivity?.stage_averages?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Average time spent per stage
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {productivity.stage_averages.map((row) => (
                                <span
                                    key={row.stage_name}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-900"
                                >
                                    {row.stage_name}
                                    <span className="tabular-nums text-indigo-600">{row.average_human}</span>
                                    <span className="text-indigo-400">({row.segment_count})</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Segment summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        <Layers className="w-4 h-4 text-indigo-500" /> Segments
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{summary?.total_segments ?? '—'}</div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Assignment spans (filters applied)</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        <Ticket className="w-4 h-4 text-blue-500" /> Unique tickets
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{summary?.unique_tickets ?? '—'}</div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Distinct ticket IDs in results</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        <Clock className="w-4 h-4 text-amber-500" /> Active segments
                    </div>
                    <div className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">{summary?.active_segments ?? '—'}</div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Still in progress (no end time)</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Ended segments
                    </div>
                    <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{summary?.closed_segments ?? '—'}</div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Completed / handed off</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm col-span-2 xl:col-span-2">
                    <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Tickets by current status</div>
                    <div className="flex flex-wrap gap-2">
                        {Object.keys(breakdown).length === 0 ? (
                            <span className="text-xs text-gray-400">No tickets in range</span>
                        ) : (
                            Object.entries(breakdown).map(([st, cnt]) => (
                                <span
                                    key={st}
                                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-800"
                                >
                                    {st}
                                    <span className="tabular-nums text-indigo-600">{cnt}</span>
                                </span>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
                    <Filter className="w-4 h-4 text-gray-500" /> Filters
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                    {DATE_PRESETS.map((preset) => (
                        <button
                            key={preset.key}
                            type="button"
                            onClick={() => applyDatePreset(preset.key)}
                            disabled={allTime && preset.key !== 'custom'}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                datePreset === preset.key
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-300'
                            } ${allTime && preset.key !== 'custom' ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        From
                        <input
                            type="date"
                            value={from}
                            disabled={allTime}
                            onChange={(e) => handleFromChange(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-100"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        To
                        <input
                            type="date"
                            value={to}
                            disabled={allTime}
                            onChange={(e) => handleToChange(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-100"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 mt-5 md:mt-6">
                        <input
                            type="checkbox"
                            checked={allTime}
                            onChange={(e) => {
                                setAllTime(e.target.checked);
                                if (e.target.checked) setDatePreset('custom');
                            }}
                            className="rounded border-gray-300"
                        />
                        All time
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Technician
                        <select
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">All</option>
                            {technicians.map((t) => (
                                <option key={t.user_id} value={t.user_id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Team
                        <select
                            value={teamId}
                            onChange={(e) => setTeamId(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">All teams</option>
                            {teams.map((t) => (
                                <option key={t.team_id} value={t.team_id}>
                                    {t.team_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Stage
                        <select
                            value={stageId}
                            onChange={(e) => setStageId(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">All stages</option>
                            {stages.map((s) => (
                                <option key={s.stage_id} value={s.stage_id}>
                                    {s.stage_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Ticket status
                        <select
                            value={ticketStatus}
                            onChange={(e) => setTicketStatus(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">Any</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                            <option value="on_hold">On hold</option>
                            <option value="qc_failed_return_vendor">Returned to vendor</option>
                            <option value="failed">Failed</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Segment
                        <select
                            value={segmentStatus}
                            onChange={(e) => setSegmentStatus(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">All (by assigned date)</option>
                            <option value="active">Active (by assigned date)</option>
                            <option value="completed">Ended (by segment end date)</option>
                        </select>
                    </label>
                </div>
                <p className="text-[11px] text-gray-500 mt-3">
                    Selecting a <strong>Team</strong> shows a team summary plus only that team&apos;s members.
                    Click a member to filter the detailed report. With no team filter, all technicians are listed.
                    <strong> Stage</strong> and standalone <strong>Technician</strong> filters switch the summary view accordingly.
                </p>
            </div>

            {/* Dynamic summary — changes with Team / Technician / Stage filters */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-slate-50">
                    <h3 className="text-sm font-bold text-gray-900 capitalize">
                        {dynamicSummary?.title || 'Summary'}
                    </h3>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                        {dynamicSummary?.subtitle || 'Counts reflect the selected date range and filters.'}
                    </p>
                </div>

                {summaryMode === 'technicians' && (
                    <TechnicianSummaryTable
                        columns={TECH_SUMMARY_COLUMNS}
                        rows={technicianRows}
                        loading={loading}
                        userId={userId}
                        onSelect={selectTechnician}
                    />
                )}

                {summaryMode === 'team' && (
                    <>
                        <SummaryMetricCards
                            loading={loading}
                            metrics={dynamicSummary?.metrics}
                            fields={TEAM_SUMMARY_METRICS}
                        />
                        <div className="border-t border-gray-200 px-4 py-2 bg-slate-50/80">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Team members</h4>
                            <p className="text-[11px] text-gray-500 mt-0.5">Click a row to filter the detailed report to that technician.</p>
                        </div>
                        <TechnicianSummaryTable
                            columns={TEAM_MEMBER_COLUMNS}
                            rows={technicianRows}
                            loading={loading}
                            userId={userId}
                            onSelect={selectTechnician}
                            emptyMessage="No members found for this team."
                        />
                    </>
                )}

                {(summaryMode === 'technician' || summaryMode === 'stage') && (
                    <SummaryMetricCards
                        loading={loading}
                        metrics={dynamicSummary?.metrics}
                        fields={summaryMode === 'stage' ? STAGE_SUMMARY_METRICS : TECHNICIAN_SINGLE_METRICS}
                    />
                )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600 flex-1 max-w-xl">
                        Search
                        <div className="relative">
                            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Ticket ID, TTSPL ID, serial number, technician name…"
                                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
                            />
                        </div>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        Rows per page
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="border border-gray-300 rounded-lg px-2 py-2 text-sm"
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </label>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-slate-50">
                    <h3 className="text-sm font-bold text-gray-900">Detailed report</h3>
                    <p className="text-[11px] text-gray-600 mt-0.5">{detailSubtitle}</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[1400px]">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className={th} onClick={() => handleSort('ticket_id')}>Ticket ID</th>
                                <th className={th} onClick={() => handleSort('ttspl_id')}>TTSPL</th>
                                <th className={th} onClick={() => handleSort('customer_name')}>Customer</th>
                                <th className={th} onClick={() => handleSort('team_name')}>Team</th>
                                <th className={th} onClick={() => handleSort('current_stage_name')}>Current stage</th>
                                <th className={th} onClick={() => handleSort('ticket_status')}>Ticket status</th>
                                <th className={th} onClick={() => handleSort('assignment_time')}>Assignment time</th>
                                <th className={th} onClick={() => handleSort('start_time')}>Start time</th>
                                <th className={th} onClick={() => handleSort('end_time')}>End time</th>
                                <th className={th} onClick={() => handleSort('duration_seconds')}>Total duration</th>
                                <th className={th} onClick={() => handleSort('technician_name')}>Current assignee</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {loading ? (
                                <tr>
                                    <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                                        Loading report…
                                    </td>
                                </tr>
                            ) : sortedRows.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                                        No tickets match the filters. New segments appear when tickets are assigned, claimed, or moved
                                        between stages after deployment.
                                    </td>
                                </tr>
                            ) : (
                                sortedRows.map((row) => (
                                    <tr key={row.log_id ?? `${row.ticket_id}-${row.technician_id}-${row.assigned_at}`} className="hover:bg-gray-50">
                                        <td className={`${td} font-mono font-semibold text-indigo-700`}>{row.ticket_id}</td>
                                        <td className={`${td} font-mono text-blue-700`}>{row.ttspl_id}</td>
                                        <td className={`${td} text-gray-800 max-w-[160px] truncate`} title={row.customer_name}>{row.customer_name || '—'}</td>
                                        <td className={`${td} text-gray-600`}>{row.team_name}</td>
                                        <td className={`${td} text-gray-800`}>{row.current_stage_name}</td>
                                        <td className={td}>
                                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize">
                                                {row.ticket_status?.replace(/_/g, ' ') || '—'}
                                            </span>
                                        </td>
                                        <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDateTime(row.assignment_time)}</td>
                                        <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDateTime(row.start_time || row.assigned_at)}</td>
                                        <td className={`${td} text-gray-600 whitespace-nowrap`}>{formatDateTime(row.end_time || row.completed_at)}</td>
                                        <td className={`${td} font-mono text-gray-700`}>{row.duration_human}</td>
                                        <td className={td}>
                                            <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                                                <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                {row.technician_name || 'Unassigned'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
                    <span>
                        Showing{' '}
                        {pagination.total === 0
                            ? '0'
                            : `${(pagination.page - 1) * pagination.limit + 1} to ${Math.min(pagination.page * pagination.limit, pagination.total)}`}{' '}
                        of {pagination.total} tickets
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={loading || pagination.page <= 1}
                            onClick={() => setPage((p) => Math.max(p - 1, 1))}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-50 hover:bg-gray-100"
                        >
                            <ChevronLeft className="w-4 h-4" /> Previous
                        </button>
                        <span className="tabular-nums px-2">
                            Page {pagination.page} of {pagination.totalPages || 1}
                        </span>
                        <button
                            type="button"
                            disabled={loading || pagination.page >= (pagination.totalPages || 1)}
                            onClick={() => setPage((p) => p + 1)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-50 hover:bg-gray-100"
                        >
                            Next <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
