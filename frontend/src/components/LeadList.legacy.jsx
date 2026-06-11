import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Upload, UserPlus, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Plus, MessageSquarePlus, Save, Pencil, Download } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    STATUSES_WITHOUT_STAGE_CHOICE,
    stagesForStatus
} from '../constants/leadStages';

const STATUS_OPTIONS = ['Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected', 'Call Back', 'Demo', 'Deal'];
const SOURCE_OPTIONS = ['Google', 'LinkedIn', 'Team', 'References', 'Apollo'];
const todayDate = () => new Date().toISOString().slice(0, 10);

export default function LeadList({ api }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState(() => [...STATUS_OPTIONS]);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [sourceFilter, setSourceFilter] = useState(() => [...SOURCE_OPTIONS]);
    const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
    const [assigneeSelection, setAssigneeSelection] = useState(null);
    const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
    const [exportingCsv, setExportingCsv] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [search, setSearch] = useState('');
    const [salesUsers, setSalesUsers] = useState([]);
    const [selectedLeads, setSelectedLeads] = useState([]);
    const [assignTo, setAssignTo] = useState('');
    const [assignUsers, setAssignUsers] = useState([]);
    const [assigningUnassigned, setAssigningUnassigned] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState('');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const setPage = useCallback((pOrUpdater) => {
        const next = typeof pOrUpdater === 'function' ? pOrUpdater(page) : pOrUpdater;
        const safe = Math.max(1, next);
        setSearchParams(prev => {
            const nextParams = new URLSearchParams(prev);
            if (safe === 1) nextParams.delete('page');
            else nextParams.set('page', String(safe));
            return nextParams;
        });
    }, [page, setSearchParams]);
    const [manualLead, setManualLead] = useState({
        date: todayDate(),
        name: '',
        company_name: '',
        email: '',
        phone: '',
        city: '',
        source: 'Google'
    });
    const [creatingLead, setCreatingLead] = useState(false);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showAssignPanel, setShowAssignPanel] = useState(false);
    const [expandedLeadId, setExpandedLeadId] = useState(null);
    const [statusDropdownLeadId, setStatusDropdownLeadId] = useState(null);
    const [leadStageModal, setLeadStageModal] = useState(null);
    const [gstModal, setGstModal] = useState(null);
    const [followUpLeadId, setFollowUpLeadId] = useState(null);
    const pageSize = 50;

    const toggleRowExpand = (leadId) => {
        setExpandedLeadId(prev => prev === leadId ? null : leadId);
        setStatusDropdownLeadId(null);
        setFollowUpLeadId(null);
    };

    const canManage = ['admin', 'manager'].includes(user?.role);
    const canAssignLeads = ['admin', 'manager'].includes(user?.role);
    const canManualCreate = ['admin', 'manager', 'sales'].includes(user?.role);

    const fullAssigneeKeys = useMemo(
        () => (canAssignLeads ? ['unassigned', ...salesUsers.map((u) => String(u.user_id))] : []),
        [canAssignLeads, salesUsers]
    );

    useEffect(() => {
        if (!canAssignLeads || !salesUsers.length) return;
        setAssigneeSelection((prev) =>
            prev === null ? ['unassigned', ...salesUsers.map((u) => String(u.user_id))] : prev
        );
    }, [canAssignLeads, salesUsers]);

    const filtersRef = useRef({});
    filtersRef.current = {
        statusFilter,
        sourceFilter,
        assigneeSelection,
        fullAssigneeKeys,
        canAssignLeads,
        dateFrom,
        dateTo,
        search
    };
    const isFirstMount = useRef(true);

    const loadLeads = useCallback(async () => {
        const f = filtersRef.current;
        setLoading(true);
        try {
            const params = {};
            if (f.statusFilter.length > 0 && f.statusFilter.length < STATUS_OPTIONS.length) {
                params.status = f.statusFilter.join(',');
            }
            if (f.sourceFilter.length > 0 && f.sourceFilter.length < SOURCE_OPTIONS.length) {
                params.source = f.sourceFilter.join(',');
            }
            if (
                f.canAssignLeads &&
                f.assigneeSelection &&
                f.fullAssigneeKeys.length > 0 &&
                f.assigneeSelection.length < f.fullAssigneeKeys.length
            ) {
                params.assigned_to = f.assigneeSelection.join(',');
            }
            if (f.dateFrom) params.date_from = f.dateFrom;
            if (f.dateTo) params.date_to = f.dateTo;
            if (f.search?.trim()) params.search = f.search.trim();
            const url = '/leads' + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
            const { data } = await api.get(url);
            setLeads(data.leads || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api]);

    const loadSalesUsers = useCallback(async () => {
        if (!canAssignLeads) return;
        try {
            const { data } = await api.get('/auth/users');
            const sales = (data.users || []).filter(u => u.role === 'sales');
            setSalesUsers(sales);
        } catch (err) {
            console.error(err);
        }
    }, [api, canAssignLeads]);

    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            loadLeads();
        } else {
            setPage(1);
            loadLeads();
        }
    }, [statusFilter, sourceFilter, assigneeSelection, dateFrom, dateTo, search, loadLeads]);

    useEffect(() => {
        loadSalesUsers();
    }, [loadSalesUsers]);

    const toggleSelect = (leadId) => {
        setSelectedLeads(prev => prev.includes(leadId)
            ? prev.filter(id => id !== leadId)
            : [...prev, leadId]
        );
    };

    const handleAssign = async () => {
        if (!assignTo || selectedLeads.length === 0) return;
        try {
            await api.post('/leads/assign', {
                lead_ids: selectedLeads,
                sales_user_id: assignTo
            });
            setMessage('Leads assigned successfully');
            setSelectedLeads([]);
            setAssignTo('');
            loadLeads();
        } catch (err) {
            setMessage('Failed to assign leads');
        }
    };

    const toggleAssignUser = (userId) => {
        setAssignUsers(prev => prev.includes(userId)
            ? prev.filter(id => id !== userId)
            : [...prev, userId]
        );
    };

    const handleAssignUnassigned = async () => {
        if (assignUsers.length === 0) return;
        setAssigningUnassigned(true);
        try {
            const { data } = await api.post('/leads/assign', {
                assign_unassigned_only: true,
                sales_user_ids: assignUsers
            });
            setMessage(data?.message ? `${data.message}. Total: ${data.total_assigned || 0}` : 'Unassigned leads distributed');
            loadLeads();
        } catch (err) {
            setMessage(err.response?.data?.message || 'Failed to assign unassigned leads');
        } finally {
            setAssigningUnassigned(false);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setMessage('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const { data } = await api.post('/leads/upload', formData);
            setMessage(data.message || 'Upload complete');
            loadLeads();
        } catch (err) {
            setMessage(err.response?.data?.message || 'Upload failed');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const buildLeadQueryString = () => {
        const f = filtersRef.current;
        const params = {};
        if (f.statusFilter.length > 0 && f.statusFilter.length < STATUS_OPTIONS.length) {
            params.status = f.statusFilter.join(',');
        }
        if (f.sourceFilter.length > 0 && f.sourceFilter.length < SOURCE_OPTIONS.length) {
            params.source = f.sourceFilter.join(',');
        }
        if (
            f.canAssignLeads &&
            f.assigneeSelection &&
            f.fullAssigneeKeys.length > 0 &&
            f.assigneeSelection.length < f.fullAssigneeKeys.length
        ) {
            params.assigned_to = f.assigneeSelection.join(',');
        }
        if (f.dateFrom) params.date_from = f.dateFrom;
        if (f.dateTo) params.date_to = f.dateTo;
        if (f.search?.trim()) params.search = f.search.trim();
        return Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    };

    const handleExportLeadsCsv = async () => {
        setExportingCsv(true);
        try {
            const response = await api.get('/leads/export-csv' + buildLeadQueryString(), { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'leads-export.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            setMessage('Failed to export CSV');
        } finally {
            setExportingCsv(false);
        }
    };

    const handleDownloadSample = async () => {
        try {
            const response = await api.get('/leads/sample', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'lead_sample.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setMessage('Failed to download sample CSV');
        }
    };

    const normalizeGstInput = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    const isValidIndianGstin = (s) =>
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizeGstInput(s));

    const applyLeadStatusApi = async (leadRow, newStatus, leadStage, gstOverride) => {
        const body = {
            status: newStatus,
            lead_stage: leadStage
        };
        if (gstOverride !== undefined && gstOverride !== null && String(gstOverride).trim()) {
            body.gst = normalizeGstInput(gstOverride);
        }
        await api.put(`/leads/${leadRow.leadId}/status`, body);
        loadLeads();
    };

    const onLeadStatusIntent = (leadRow, newStatus) => {
        if (newStatus === leadRow.status) {
            setStatusDropdownLeadId(null);
            return;
        }
        if (STATUSES_WITHOUT_STAGE_CHOICE.includes(newStatus)) {
            if ((newStatus === 'Deal' || newStatus === 'Demo') && !isValidIndianGstin(leadRow.research?.gst)) {
                setGstModal({
                    lead: leadRow,
                    newStatus,
                    input: normalizeGstInput(leadRow.research?.gst || '') || ''
                });
                setStatusDropdownLeadId(null);
                return;
            }
            applyLeadStatusApi(leadRow, newStatus, newStatus);
            setStatusDropdownLeadId(null);
            return;
        }
        const opts = stagesForStatus(newStatus);
        if (opts.length > 0) {
            setLeadStageModal({ lead: leadRow, newStatus, options: opts, selectedStage: opts[0] });
            setStatusDropdownLeadId(null);
            return;
        }
        applyLeadStatusApi(leadRow, newStatus, null);
        setStatusDropdownLeadId(null);
    };

    const handleManualLeadChange = (key, value) => {
        setManualLead(prev => ({ ...prev, [key]: value }));
    };

    const handleManualCreateLead = async () => {
        if (!manualLead.phone.trim()) {
            setMessage('Phone is required for manual lead entry');
            return;
        }
        setCreatingLead(true);
        setMessage('');
        try {
            await api.post('/leads', {
                name: manualLead.name.trim() || null,
                company_name: manualLead.company_name.trim() || null,
                email: manualLead.email.trim() || null,
                phone: manualLead.phone.trim() || null,
                city: manualLead.city.trim() || null,
                source: manualLead.source
            });
            setMessage('Lead created successfully');
            setManualLead({
                date: todayDate(),
                name: '',
                company_name: '',
                email: '',
                phone: '',
                city: '',
                source: 'Google'
            });
            loadLeads();
        } catch (err) {
            setMessage(err.response?.data?.message || 'Failed to create lead manually');
        } finally {
            setCreatingLead(false);
        }
    };

    const duplicateCount = useMemo(
        () => leads.filter(lead => lead.isDuplicate).length,
        [leads]
    );

    const totalPages = Math.max(1, Math.ceil(leads.length / pageSize));
    const pagedLeads = leads.slice((page - 1) * pageSize, page * pageSize);
    const pageLeadIds = useMemo(() => pagedLeads.map(l => l.leadId), [pagedLeads]);
    const allPageSelected = pageLeadIds.length > 0 && pageLeadIds.every(id => selectedLeads.includes(id));
    const somePageSelected = pageLeadIds.some(id => selectedLeads.includes(id));

    const handleSelectAllPage = () => {
        if (allPageSelected) {
            setSelectedLeads(prev => prev.filter(id => !pageLeadIds.includes(id)));
        } else {
            setSelectedLeads(prev => {
                const combined = new Set([...prev, ...pageLeadIds]);
                return [...combined];
            });
        }
    };

    const selectAllRef = useRef(null);
    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = somePageSelected && !allPageSelected;
        }
    }, [allPageSelected, somePageSelected]);

    return (
        <div className="space-y-4 w-full max-w-6xl mx-auto px-2 sm:px-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-slate-800">Leads</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Manage sales leads and assignments</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={loadLeads}
                        className="px-3 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={handleExportLeadsCsv}
                        disabled={exportingCsv}
                        className="px-3 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        {exportingCsv ? 'Exporting…' : 'Download CSV'}
                    </button>
                    <button
                        onClick={handleDownloadSample}
                        className="px-3 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <Upload className="w-4 h-4" />
                        Sample CSV
                    </button>
                    {canManage && (
                        <label className="px-3 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer flex items-center gap-2 transition-colors">
                            <Upload className="w-4 h-4" />
                            {uploading ? 'Uploading...' : 'Upload CSV'}
                            <input type="file" accept=".csv" className="hidden" onChange={handleUpload} />
                        </label>
                    )}
                </div>
            </div>

            {message && (
                <div className="py-2.5 px-3 text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg">{message}</div>
            )}

            <div className="bg-slate-50/80 border border-slate-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name, company, email, phone..."
                            className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                        />
                    </div>
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setStatusDropdownOpen(prev => !prev)}
                            className="border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 bg-white focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 w-[148px] text-left flex items-center justify-between gap-1"
                        >
                            <span className="truncate">
                                {statusFilter.length >= STATUS_OPTIONS.length ? 'All status' : statusFilter.length === 1 ? statusFilter[0] : `${statusFilter.length} status`}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${statusDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {statusDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setStatusDropdownOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[190px] max-h-60 overflow-y-auto">
                                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer font-medium">
                                        <input
                                            type="checkbox"
                                            checked={statusFilter.length === STATUS_OPTIONS.length}
                                            ref={(el) => {
                                                if (el) el.indeterminate = statusFilter.length > 0 && statusFilter.length < STATUS_OPTIONS.length;
                                            }}
                                            onChange={(e) => {
                                                if (e.target.checked) setStatusFilter([...STATUS_OPTIONS]);
                                                else setStatusFilter([]);
                                            }}
                                            className="rounded"
                                        />
                                        <span>All</span>
                                    </label>
                                    {STATUS_OPTIONS.map((s) => (
                                        <label key={s} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={statusFilter.includes(s)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setStatusFilter((prev) => [...new Set([...prev, s])]);
                                                    } else {
                                                        setStatusFilter((prev) => prev.filter((x) => x !== s));
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                            <span>{s}</span>
                                        </label>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setSourceDropdownOpen((p) => !p)}
                            className="border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 bg-white focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 w-[148px] text-left flex items-center justify-between gap-1"
                        >
                            <span className="truncate">
                                {sourceFilter.length >= SOURCE_OPTIONS.length ? 'All sources' : sourceFilter.length === 1 ? sourceFilter[0] : `${sourceFilter.length} sources`}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${sourceDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {sourceDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setSourceDropdownOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[180px] max-h-60 overflow-y-auto">
                                    <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer font-medium">
                                        <input
                                            type="checkbox"
                                            checked={sourceFilter.length === SOURCE_OPTIONS.length}
                                            ref={(el) => {
                                                if (el) el.indeterminate = sourceFilter.length > 0 && sourceFilter.length < SOURCE_OPTIONS.length;
                                            }}
                                            onChange={(e) => {
                                                if (e.target.checked) setSourceFilter([...SOURCE_OPTIONS]);
                                                else setSourceFilter([]);
                                            }}
                                            className="rounded"
                                        />
                                        <span>All</span>
                                    </label>
                                    {SOURCE_OPTIONS.map((s) => (
                                        <label key={s} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={sourceFilter.includes(s)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSourceFilter((prev) => [...new Set([...prev, s])]);
                                                    } else {
                                                        setSourceFilter((prev) => prev.filter((x) => x !== s));
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                            <span>{s}</span>
                                        </label>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    {canAssignLeads && fullAssigneeKeys.length > 0 && (
                        <div className="relative shrink-0">
                            <button
                                type="button"
                                onClick={() => setAssigneeDropdownOpen((p) => !p)}
                                className="border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 bg-white focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 w-[152px] text-left flex items-center justify-between gap-1"
                            >
                                <span className="truncate">
                                    {assigneeSelection && assigneeSelection.length >= fullAssigneeKeys.length
                                        ? 'All assignees'
                                        : assigneeSelection && assigneeSelection.length === 1
                                          ? assigneeSelection[0] === 'unassigned'
                                            ? 'Unassigned'
                                            : salesUsers.find((u) => String(u.user_id) === assigneeSelection[0])?.name || assigneeSelection[0]
                                          : assigneeSelection
                                            ? `${assigneeSelection.length} assignees`
                                            : '…'}
                                </span>
                                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${assigneeDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {assigneeDropdownOpen && assigneeSelection && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setAssigneeDropdownOpen(false)} />
                                    <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-60 overflow-y-auto">
                                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer font-medium">
                                            <input
                                                type="checkbox"
                                                checked={assigneeSelection.length === fullAssigneeKeys.length}
                                                ref={(el) => {
                                                    if (el) {
                                                        el.indeterminate =
                                                            assigneeSelection.length > 0 &&
                                                            assigneeSelection.length < fullAssigneeKeys.length;
                                                    }
                                                }}
                                                onChange={(e) => {
                                                    if (e.target.checked) setAssigneeSelection([...fullAssigneeKeys]);
                                                    else setAssigneeSelection([]);
                                                }}
                                                className="rounded"
                                            />
                                            <span>All</span>
                                        </label>
                                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={assigneeSelection.includes('unassigned')}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setAssigneeSelection((prev) => [...new Set([...prev, 'unassigned'])]);
                                                    } else {
                                                        setAssigneeSelection((prev) => prev.filter((x) => x !== 'unassigned'));
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                            <span>Unassigned</span>
                                        </label>
                                        {salesUsers.map((u) => (
                                            <label key={u.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={assigneeSelection.includes(String(u.user_id))}
                                                    onChange={(e) => {
                                                        const id = String(u.user_id);
                                                        if (e.target.checked) {
                                                            setAssigneeSelection((prev) => [...new Set([...prev, id])]);
                                                        } else {
                                                            setAssigneeSelection((prev) => prev.filter((x) => x !== id));
                                                        }
                                                    }}
                                                    className="rounded"
                                                />
                                                <span>{u.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 w-[120px]"
                            title="From date"
                        />
                        <span className="text-slate-400 text-xs">–</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 w-[120px]"
                            title="To date"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setStatusFilter([...STATUS_OPTIONS]);
                            setSourceFilter([...SOURCE_OPTIONS]);
                            if (fullAssigneeKeys.length) setAssigneeSelection([...fullAssigneeKeys]);
                            setDateFrom('');
                            setDateTo('');
                            setSearch('');
                            setPage(1);
                        }}
                        className="shrink-0 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </div>

            {canManualCreate && (
                <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                    <button
                        onClick={() => setShowManualEntry(!showManualEntry)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            {showManualEntry ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <Plus className="w-4 h-4" />
                            Manual Lead Entry
                        </span>
                    </button>
                    {showManualEntry && (
                    <div className="px-4 pb-4 pt-0 border-t border-slate-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Date</label>
                            <input
                                type="date"
                                value={manualLead.date}
                                readOnly
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Name</label>
                            <input
                                value={manualLead.name}
                                onChange={(e) => handleManualLeadChange('name', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Lead name (optional)"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Company</label>
                            <input
                                value={manualLead.company_name}
                                onChange={(e) => handleManualLeadChange('company_name', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Company name"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Email</label>
                            <input
                                type="email"
                                value={manualLead.email}
                                onChange={(e) => handleManualLeadChange('email', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Email"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Phone *</label>
                            <input
                                value={manualLead.phone}
                                onChange={(e) => handleManualLeadChange('phone', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Phone (required)"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">City</label>
                            <input
                                value={manualLead.city}
                                onChange={(e) => handleManualLeadChange('city', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="City"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Source</label>
                            <select
                                value={manualLead.source}
                                onChange={(e) => handleManualLeadChange('source', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            >
                                {SOURCE_OPTIONS.map((source) => (
                                    <option key={source} value={source}>{source}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={handleManualCreateLead}
                                disabled={creatingLead}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                            >
                                {creatingLead ? 'Saving...' : 'Create Lead'}
                            </button>
                        </div>
                    </div>
                    </div>
                    )}
                </div>
            )}

            {canAssignLeads && (
                <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                    <button
                        onClick={() => setShowAssignPanel(!showAssignPanel)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            {showAssignPanel ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <UserPlus className="w-4 h-4" />
                            Assign Leads
                        </span>
                    </button>
                    {showAssignPanel && (
                    <div className="px-4 pb-4 pt-0 border-t border-slate-100 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center pt-4">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Assign selected</span>
                        <select
                            value={assignTo}
                            onChange={(e) => setAssignTo(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1"
                        >
                            <option value="">Select sales user</option>
                            {salesUsers.map(user => (
                                <option key={user.user_id} value={user.user_id}>{user.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={handleAssign}
                            disabled={!assignTo || selectedLeads.length === 0}
                            className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                        >
                            Assign
                        </button>
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-3">
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Distribute unassigned equally</div>
                        <p className="text-xs text-slate-500">Select who receives unassigned leads. Future leads (manual, upload, email) will also be auto-assigned to the selected users until you change this.</p>
                        <div className="flex flex-wrap gap-2">
                            {salesUsers.map((salesUser) => (
                                <label key={salesUser.user_id} className="flex items-center gap-2 text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={assignUsers.includes(salesUser.user_id)}
                                        onChange={() => toggleAssignUser(salesUser.user_id)}
                                        className="rounded"
                                    />
                                    <span>{salesUser.name}</span>
                                </label>
                            ))}
                        </div>
                        <button
                            onClick={handleAssignUnassigned}
                            disabled={assignUsers.length === 0 || assigningUnassigned}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                        >
                            {assigningUnassigned ? 'Assigning...' : 'Auto Assign Unassigned'}
                        </button>
                    </div>
                    </div>
                    )}
                </div>
            )}

            {duplicateCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-2.5 px-3">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {duplicateCount} duplicate lead(s) detected.
                </div>
            )}

            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                <table className="w-full table-fixed text-xs">
                    <colgroup>
                        {canAssignLeads && <col style={{ width: '2%' }} />}
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '5%' }} />
                    </colgroup>
                    <thead className="bg-slate-50">
                        <tr>
                            {canAssignLeads && (
                                <th className="px-2 py-2 w-8 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                                    <input
                                        type="checkbox"
                                        ref={selectAllRef}
                                        checked={allPageSelected}
                                        onChange={handleSelectAllPage}
                                        className="rounded border-slate-300"
                                        title="Select all on page"
                                    />
                                </th>
                            )}
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">ID</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">Date</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">Lead</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">Company</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">Source</th>
                            <th className="px-2 py-2 text-center text-[10px] font-medium text-slate-500 uppercase tracking-wide">Status</th>
                            <th className="px-2 py-2 text-left text-[10px] font-medium text-slate-500 uppercase tracking-wide">Assignee</th>
                            <th className="px-2 py-2 text-center text-[10px] font-medium text-slate-500 uppercase tracking-wide">Follow-up</th>
                            <th className="px-2 py-2 text-center text-[10px] font-medium text-slate-500 uppercase tracking-wide w-14">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pagedLeads.map(lead => (
                            <React.Fragment key={lead.leadId}>
                                <tr
                                    onClick={() => toggleRowExpand(lead.leadId)}
                                    className={`border-t border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer ${expandedLeadId === lead.leadId ? 'bg-slate-50' : ''}`}
                                >
                                    {canAssignLeads && (
                                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedLeads.includes(lead.leadId)}
                                                onChange={() => toggleSelect(lead.leadId)}
                                                className="rounded border-slate-300"
                                            />
                                        </td>
                                    )}
                                    <td className="px-2 py-2">
                                        <span className="inline-flex items-center gap-0.5 min-w-0">
                                            {expandedLeadId === lead.leadId ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                                            <span className="font-mono text-slate-600 truncate">#{lead.leadId}</span>
                                        </span>
                                    </td>
                                    <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '-'}</td>
                                    <td className="px-2 py-2 min-w-0" onClick={(e) => e.stopPropagation()}>
                                        <div className="font-medium text-slate-800 truncate" title={lead.name}>{lead.name}</div>
                                        <div className="text-[10px] text-slate-500 truncate" title={lead.email || '-'}>{lead.email || '-'}</div>
                                        <div className="text-[10px] text-slate-500 truncate" title={lead.phone || '-'}>{lead.phone || '-'}</div>
                                        {lead.isDuplicate && <span className="text-[10px] text-amber-600">Dup</span>}
                                    </td>
                                    <td className="px-2 py-2 text-slate-600 min-w-0" onClick={(e) => e.stopPropagation()}>
                                        <span className="truncate block" title={lead.companyName || '-'}>{lead.companyName || '-'}</span>
                                    </td>
                                    <td className="px-2 py-2 text-slate-600">{lead.source || '-'}</td>
                                    <td className="px-2 py-2 text-center min-w-0" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex flex-col gap-1 items-center">
                                            <StatusDropdown
                                                lead={lead}
                                                statusDropdownLeadId={statusDropdownLeadId}
                                                setStatusDropdownLeadId={setStatusDropdownLeadId}
                                                onStatusIntent={onLeadStatusIntent}
                                                user={user}
                                            />
                                            {lead.leadStage && (
                                                <div className="text-[9px] text-slate-600 text-center max-w-[7rem] mx-auto truncate" title={lead.leadStage}>
                                                    {lead.leadStage}
                                                </div>
                                            )}
                                            {(lead.brand || lead.processor || lead.generation || lead.ram || lead.storage) && (
                                                <div className="text-[9px] text-slate-500 text-center break-words leading-tight" title={[lead.brand, lead.processor, lead.generation, lead.ram, lead.storage].filter(Boolean).join(' | ')}>
                                                    {[lead.brand, lead.processor, lead.generation, lead.ram, lead.storage].filter(Boolean).join(' · ')}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 text-slate-600 min-w-0">
                                        <span className="truncate block" title={lead.assignedUser?.name || '-'}>{lead.assignedUser?.name || '-'}</span>
                                    </td>
                                    <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                        <FollowUpCell
                                            lead={lead}
                                            api={api}
                                            followUpLeadId={followUpLeadId}
                                            setFollowUpLeadId={(id) => { setFollowUpLeadId(id); setStatusDropdownLeadId(null); }}
                                            onUpdated={loadLeads}
                                            user={user}
                                        />
                                    </td>
                                    <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => navigate(`/leads/${lead.leadId}?fromPage=${page}`)}
                                            className="text-indigo-600 hover:text-indigo-700 font-medium text-[10px]"
                                        >
                                            View
                                        </button>
                                    </td>
                                </tr>
                                {expandedLeadId === lead.leadId && (
                                    <tr>
                                        <td colSpan={canAssignLeads ? 10 : 9} className="px-2 py-0 bg-slate-50/50 border-b border-slate-100">
                                            <ExpandedRowContent
                                                leadId={lead.leadId}
                                                api={api}
                                                onRemarkSaved={loadLeads}
                                                user={user}
                                            />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                        {leads.length === 0 && !loading && (
                            <tr>
                                <td colSpan={canAssignLeads ? 10 : 9} className="px-2 py-12 text-center text-slate-500 text-xs">
                                    No leads found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-500">
                <span>
                    Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, leads.length)} of {leads.length}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-sm"
                    >
                        <span className="sr-only">Previous</span>‹
                    </button>
                    <span className="text-slate-600 text-sm">{page} / {totalPages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-sm"
                    >
                        <span className="sr-only">Next</span>›
                    </button>
                </div>
            </div>

            {gstModal && (
                <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-800">GSTIN required</h3>
                        <p className="text-xs text-slate-500 mt-1">
                            Status <strong>{gstModal.newStatus}</strong> requires a valid 15-character GSTIN before the lead is
                            linked to Customers.
                        </p>
                        <label className="block mt-3 text-xs font-medium text-slate-600">GSTIN</label>
                        <input
                            type="text"
                            autoComplete="off"
                            maxLength={15}
                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-wide"
                            placeholder="e.g. 22AAAAA0000A1Z5"
                            value={gstModal.input}
                            onChange={(e) =>
                                setGstModal((m) => (m ? { ...m, input: e.target.value.toUpperCase() } : m))
                            }
                        />
                        <div className="flex gap-2 justify-end mt-4">
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                                onClick={() => setGstModal(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                onClick={async () => {
                                    if (!isValidIndianGstin(gstModal.input)) {
                                        setMessage('Enter a valid 15-character GSTIN (format: 22AAAAA0000A1Z5).');
                                        return;
                                    }
                                    try {
                                        await applyLeadStatusApi(
                                            gstModal.lead,
                                            gstModal.newStatus,
                                            gstModal.newStatus,
                                            gstModal.input
                                        );
                                        setGstModal(null);
                                        setMessage('');
                                    } catch (err) {
                                        alert(err.response?.data?.message || 'Failed to update status');
                                    }
                                }}
                            >
                                Save &amp; continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {leadStageModal && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-800">Select lead stage</h3>
                        <p className="text-xs text-slate-500 mt-1">
                            Status: <strong>{leadStageModal.newStatus}</strong> — choose the stage (reason) for this update.
                        </p>
                        <label className="block mt-3 text-xs font-medium text-slate-600">Lead stage</label>
                        <select
                            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            value={leadStageModal.selectedStage}
                            onChange={(e) => setLeadStageModal((m) => ({ ...m, selectedStage: e.target.value }))}
                        >
                            {leadStageModal.options.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                        <div className="flex gap-2 justify-end mt-4">
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                                onClick={() => setLeadStageModal(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                onClick={async () => {
                                    try {
                                        await applyLeadStatusApi(
                                            leadStageModal.lead,
                                            leadStageModal.newStatus,
                                            leadStageModal.selectedStage
                                        );
                                        setLeadStageModal(null);
                                    } catch (err) {
                                        alert(err.response?.data?.message || 'Failed to update');
                                    }
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

function toDateTimeLocalValue(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function FollowUpCell({ lead, api, followUpLeadId, setFollowUpLeadId, onUpdated, user }) {
    const [followUpValue, setFollowUpValue] = useState(toDateTimeLocalValue(lead.followUpDate));
    const [saving, setSaving] = useState(false);
    const currentUserId = user?.user_id ?? user?.userId;
    const canUpdate = ['admin', 'manager', 'sales'].includes(user?.role) && (user?.role !== 'sales' || String(lead.assignedUserId) === String(currentUserId));
    const isOpen = followUpLeadId === lead.leadId;

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/leads/${lead.leadId}/follow-up`, {
                follow_up_date: followUpValue ? new Date(followUpValue).toISOString() : null
            });
            setFollowUpLeadId(null);
            onUpdated?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to update follow-up');
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        setSaving(true);
        try {
            await api.put(`/leads/${lead.leadId}/follow-up`, { follow_up_date: null });
            setFollowUpValue('');
            setFollowUpLeadId(null);
            onUpdated?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to clear follow-up');
        } finally {
            setSaving(false);
        }
    };

    const formatCompact = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    if (!canUpdate) {
        return (
            <span className="text-slate-600 text-[10px] inline-block whitespace-nowrap">
                {formatCompact(lead.followUpDate)}
            </span>
        );
    }

    return (
        <div className="relative flex justify-center items-center">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFollowUpLeadId(isOpen ? null : lead.leadId); setFollowUpValue(toDateTimeLocalValue(lead.followUpDate)); }}
                className="text-slate-600 hover:text-slate-800 text-[10px] hover:underline whitespace-nowrap"
            >
                {lead.followUpDate ? formatCompact(lead.followUpDate) : 'Set'}
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setFollowUpLeadId(null); }} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-[200px]">
                        <input
                            type="datetime-local"
                            value={followUpValue}
                            onChange={(e) => setFollowUpValue(e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 mb-2"
                        />
                        <div className="flex gap-1">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="flex-1 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {saving ? '...' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={handleClear}
                                disabled={saving}
                                className="py-1.5 px-2 text-xs font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-50"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function StatusDropdown({ lead, statusDropdownLeadId, setStatusDropdownLeadId, onStatusIntent, user }) {
    const currentUserId = user?.user_id ?? user?.userId;
    const canUpdate = ['admin', 'manager', 'sales'].includes(user?.role) && (user?.role !== 'sales' || String(lead.assignedUserId) === String(currentUserId));
    const isOpen = statusDropdownLeadId === lead.leadId;

    const handleStatusSelect = (newStatus) => {
        onStatusIntent(lead, newStatus);
    };

    if (!canUpdate) {
        return (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                {lead.status}
            </span>
        );
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setStatusDropdownLeadId(isOpen ? null : lead.leadId); }}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
                <span className="flex items-center gap-0.5">{lead.status} {isOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}</span>
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setStatusDropdownLeadId(null); }} />
                    <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[100px]">
                        {STATUS_OPTIONS.map(s => (
                            <button
                                key={s}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleStatusSelect(s); }}
                                className={`block w-full text-left px-2 py-1 text-[10px] hover:bg-slate-50 ${s === lead.status ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function ExpandedRowContent({ leadId, api, onRemarkSaved, user }) {
    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [remarkText, setRemarkText] = useState('');
    const [savingRemark, setSavingRemark] = useState(false);
    const [personalRemarks, setPersonalRemarks] = useState('');
    const [savingPersonalRemarks, setSavingPersonalRemarks] = useState(false);
    const [editingPersonalRemarks, setEditingPersonalRemarks] = useState(false);
    const currentUserId = user?.user_id ?? user?.userId;
    const canEditPersonalRemarks = ['admin', 'manager', 'sales'].includes(user?.role) && (user?.role !== 'sales' || String(lead?.assignedUserId) === String(currentUserId));

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/leads/${leadId}`);
            setLead(data.lead);
            setPersonalRemarks(data.lead?.personalRemarks ?? data.lead?.personal_remarks ?? '');
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api, leadId]);

    useEffect(() => {
        loadLead();
    }, [loadLead]);

    const handleSavePersonalRemarks = async () => {
        setSavingPersonalRemarks(true);
        try {
            await api.put(`/leads/${leadId}/basic`, { personal_remarks: personalRemarks });
            setLead(prev => ({ ...prev, personalRemarks: personalRemarks }));
            setEditingPersonalRemarks(false);
            onRemarkSaved?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to save personal remarks');
        } finally {
            setSavingPersonalRemarks(false);
        }
    };

    const handleAddRemark = async (e) => {
        e.preventDefault();
        if (!remarkText.trim()) return;
        setSavingRemark(true);
        try {
            const { data } = await api.post(`/leads/${leadId}/remarks`, { note: remarkText.trim() });
            setLead(prev => ({ ...prev, remarks: [data.remark, ...(prev.remarks || [])] }));
            setRemarkText('');
            onRemarkSaved?.();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to add remark');
        } finally {
            setSavingRemark(false);
        }
    };

    const mergedItems = useMemo(() => {
        if (!lead) return [];
        const activities = (lead.activities || []).map(a => ({
            type: 'activity',
            id: a.activityId,
            text:
                a.action === 'status_updated'
                    ? `Status: ${a.statusFrom || '?'} → ${a.statusTo || '-'}${
                        a.stageTo ? ` · Stage: ${a.stageTo}` : ''
                    }`
                    : a.action.replace(/_/g, ' '),
            detail: a.notes,
            user: a.user?.name,
            createdAt: a.createdAt
        }));
        const remarks = (lead.remarks || []).map(r => ({
            type: 'remark',
            id: r.remarkId,
            text: r.note,
            detail: null,
            user: r.userName,
            createdAt: r.createdAt
        }));
        return [...activities, ...remarks]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);
    }, [lead]);

    return (
        <div className="py-2 px-2">
            {loading ? (
                <div className="text-center py-6 text-slate-500 text-sm">Loading...</div>
            ) : (
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-600 mb-2">Last 5 activities</div>
                        <div className="space-y-2">
                            {mergedItems.length === 0 ? (
                                <div className="text-xs text-slate-500 py-2">No activity yet.</div>
                            ) : (
                                mergedItems.map(item => (
                                    <div key={`${item.type}-${item.id}`} className="border border-slate-100 rounded p-2 text-xs bg-white">
                                        <div className="font-medium text-slate-700">{item.text}</div>
                                        {item.detail && <div className="text-slate-500 mt-0.5">{item.detail}</div>}
                                        <div className="text-slate-400 mt-1">{item.user || '-'} · {new Date(item.createdAt).toLocaleString()}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    <div className="sm:w-72 shrink-0 flex flex-col gap-3">
                        <div className="border border-slate-200 rounded-lg p-3 bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-slate-600">Personal Remarks</span>
                                {canEditPersonalRemarks && !editingPersonalRemarks && (
                                    <button
                                        onClick={() => setEditingPersonalRemarks(true)}
                                        className="text-slate-500 hover:text-indigo-600 p-0.5"
                                        title="Edit"
                                    >
                                        <Pencil className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                            {canEditPersonalRemarks && editingPersonalRemarks ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={personalRemarks}
                                        onChange={(e) => setPersonalRemarks(e.target.value)}
                                        placeholder="Sales notes about this lead..."
                                        rows={3}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                    <div className="flex gap-1">
                                        <button
                                            onClick={handleSavePersonalRemarks}
                                            disabled={savingPersonalRemarks}
                                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                            <Save className="w-3 h-3" /> {savingPersonalRemarks ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => { setEditingPersonalRemarks(false); setPersonalRemarks(lead?.personalRemarks ?? lead?.personal_remarks ?? ''); }}
                                            className="px-2 py-1 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-600 whitespace-pre-wrap min-h-[2rem]">{lead?.personalRemarks || lead?.personal_remarks || '-'}</div>
                            )}
                        </div>
                        <form onSubmit={handleAddRemark} className="border border-slate-200 rounded-lg p-3 bg-white">
                            <label className="block text-xs font-medium text-slate-600 mb-1">Add Remark</label>
                            <textarea
                                value={remarkText}
                                onChange={e => setRemarkText(e.target.value)}
                                placeholder="Customer query or note..."
                                rows={2}
                                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            <button
                                type="submit"
                                disabled={savingRemark || !remarkText.trim()}
                                className="mt-2 w-full py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1"
                            >
                                <MessageSquarePlus className="w-3 h-3" /> {savingRemark ? 'Saving...' : 'Save'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
