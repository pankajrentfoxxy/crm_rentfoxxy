import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, RefreshCw, User, Filter, Ticket, Layers, Clock, CheckCircle2, ChevronDown, ChevronRight, Cpu } from 'lucide-react';

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
    from.setDate(from.getDate() - 30);
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
    };
}

export default function Reports({ api }) {
    const defaults = useMemo(() => defaultDateRange(), []);
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState(null);
    const [workloadDashboard, setWorkloadDashboard] = useState(null);
    const [dashExpanded, setDashExpanded] = useState(false);
    const [hwExpanded, setHwExpanded] = useState(false);
    const [qcExpanded, setQcExpanded] = useState(false);
    const [technicians, setTechnicians] = useState([]);
    const [stages, setStages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [from, setFrom] = useState(defaults.from);
    const [to, setTo] = useState(defaults.to);
    const [allTime, setAllTime] = useState(false);
    const [userId, setUserId] = useState('');
    const [ticketStatus, setTicketStatus] = useState('');
    const [segmentStatus, setSegmentStatus] = useState('');
    const [stageId, setStageId] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'assigned_at', direction: 'desc' });

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
            if (ticketStatus) params.set('ticket_status', ticketStatus);
            if (segmentStatus) params.set('segment_status', segmentStatus);
            if (stageId) params.set('stage_id', stageId);

            const { data } = await api.get('/reports/technician-performance?' + params.toString());
            setRows(data.rows || data.report || []);
            setSummary(data.summary || null);
            setWorkloadDashboard(data.workload_dashboard || null);
            setTechnicians(data.technicians || []);
            setStages(data.stages || []);
        } catch (error) {
            console.error('Report load error:', error);
            setRows([]);
            setSummary(null);
            setWorkloadDashboard(null);
            const msg = error.response?.data?.message || error.message;
            if (msg) alert(`Report failed to load: ${msg}. Check backend is running and database is connected.`);
        } finally {
            setLoading(false);
        }
    }, [api, allTime, from, to, userId, ticketStatus, segmentStatus, stageId]);

    useEffect(() => {
        loadReport();
    }, [loadReport]);

    const sortedRows = useMemo(() => {
        const list = [...rows];
        const { key, direction } = sortConfig;
        list.sort((a, b) => {
            let va = a[key];
            let vb = b[key];
            if (key === 'assigned_at' || key === 'completed_at') {
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
                        Each row is one assignment segment: same ticket can appear multiple times when different technicians work it.
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
                            Dashboard counts follow the filters in the section below so totals stay in sync with the segment list.
                        </p>
                    </div>
                )}
            </div>

            {/* Summary counts */}
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        From
                        <input
                            type="date"
                            value={from}
                            disabled={allTime}
                            onChange={(e) => setFrom(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-100"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
                        To
                        <input
                            type="date"
                            value={to}
                            disabled={allTime}
                            onChange={(e) => setTo(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-100"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 mt-5 md:mt-6">
                        <input
                            type="checkbox"
                            checked={allTime}
                            onChange={(e) => setAllTime(e.target.checked)}
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
                        Segment stage
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
                        Ticket status (now)
                        <select
                            value={ticketStatus}
                            onChange={(e) => setTicketStatus(e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                            <option value="">Any</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                            <option value="on_hold">On hold</option>
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
                    Date range uses <strong>assigned at</strong> for open/all segments. When segment is <strong>Ended</strong>, the
                    range uses <strong>segment end</strong> so today&apos;s completions appear even if work started earlier.
                </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[1100px]">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className={th} onClick={() => handleSort('ticket_id')}>
                                    Ticket #
                                </th>
                                <th className={th} onClick={() => handleSort('machine_number')}>
                                    Machine / serial
                                </th>
                                <th className={th} onClick={() => handleSort('technician_name')}>
                                    Technician
                                </th>
                                <th className={th} onClick={() => handleSort('team_name')}>
                                    Team
                                </th>
                                <th className={th} onClick={() => handleSort('stage_at_assignment')}>
                                    Stage (this segment)
                                </th>
                                <th className={th} onClick={() => handleSort('ticket_status')}>
                                    Ticket status
                                </th>
                                <th className={th} onClick={() => handleSort('current_stage_name')}>
                                    Current stage
                                </th>
                                <th className={th} onClick={() => handleSort('segment_status')}>
                                    Segment
                                </th>
                                <th className={th} onClick={() => handleSort('assigned_at')}>
                                    Assigned at
                                </th>
                                <th className={th} onClick={() => handleSort('completed_at')}>
                                    Segment end
                                </th>
                                <th className={th} onClick={() => handleSort('duration_seconds')}>
                                    Duration
                                </th>
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
                                        No work segments match the filters. New segments appear when tickets are assigned, claimed, or moved
                                        between stages after deployment.
                                    </td>
                                </tr>
                            ) : (
                                sortedRows.map((row) => (
                                    <tr key={row.log_id ?? `${row.ticket_id}-${row.technician_id}-${row.assigned_at}`} className="hover:bg-gray-50">
                                        <td className={`${td} font-mono font-semibold text-indigo-700`}>{row.ticket_id}</td>
                                        <td className={`${td} font-mono text-blue-700`}>
                                            {row.machine_number}
                                            {row.serial_number && row.serial_number !== row.machine_number ? (
                                                <div className="text-[10px] text-gray-500 font-sans">{row.serial_number}</div>
                                            ) : null}
                                        </td>
                                        <td className={td}>
                                            <span className="font-medium text-gray-900 inline-flex items-center gap-1">
                                                <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                {row.technician_name}
                                            </span>
                                        </td>
                                        <td className={`${td} text-gray-600`}>{row.team_name}</td>
                                        <td className={`${td} text-gray-800`}>{row.stage_at_assignment}</td>
                                        <td className={td}>
                                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize">
                                                {row.ticket_status?.replace(/_/g, ' ') || '—'}
                                            </span>
                                        </td>
                                        <td className={`${td} text-gray-700`}>{row.current_stage_name}</td>
                                        <td className={td}>
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    row.segment_status === 'active'
                                                        ? 'bg-amber-100 text-amber-900'
                                                        : 'bg-emerald-50 text-emerald-800'
                                                }`}
                                            >
                                                {row.segment_status === 'active' ? 'Active' : 'Ended'}
                                            </span>
                                        </td>
                                        <td className={`${td} text-gray-600 whitespace-nowrap`}>
                                            {row.assigned_at ? new Date(row.assigned_at).toLocaleString() : '—'}
                                        </td>
                                        <td className={`${td} text-gray-600 whitespace-nowrap`}>
                                            {row.completed_at ? new Date(row.completed_at).toLocaleString() : '—'}
                                        </td>
                                        <td className={`${td} font-mono text-gray-700`}>{row.duration_human}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
