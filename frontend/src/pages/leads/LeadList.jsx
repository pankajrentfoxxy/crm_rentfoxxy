import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    STATUSES_WITHOUT_STAGE_CHOICE,
    stagesForStatus
} from '../../constants/leadStages';
import { PageWrapper } from '../../components/ui';
import { STATUS_OPTIONS, SOURCE_OPTIONS, todayDate, LEAD_PAGE_SIZE } from './constants';
import { normalizeGstInput, isValidIndianGstin } from './utils';
import LeadMessageBanner from './components/LeadMessageBanner';
import DuplicateBanner from './components/DuplicateBanner';
import ManualLeadEntryDrawer from './components/ManualLeadEntryDrawer';
import AssignLeadsDrawer from './components/AssignLeadsDrawer';
import LeadFilterDrawer from './components/LeadFilterDrawer';
import LeadTable from './components/LeadTable';
import GstModal from './components/GstModal';
import LeadStageModal from './components/LeadStageModal';

export default function LeadList({ api }) {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState(() => [...STATUS_OPTIONS]);
    const [sourceFilter, setSourceFilter] = useState(() => [...SOURCE_OPTIONS]);
    const [assigneeSelection, setAssigneeSelection] = useState(null);
    const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
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
        setSearchParams((prev) => {
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
    const [manualEntryDrawerOpen, setManualEntryDrawerOpen] = useState(false);
    const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
    const [expandedLeadId, setExpandedLeadId] = useState(null);
    const [statusDropdownLeadId, setStatusDropdownLeadId] = useState(null);
    const [leadStageModal, setLeadStageModal] = useState(null);
    const [gstModal, setGstModal] = useState(null);
    const [followUpLeadId, setFollowUpLeadId] = useState(null);

    const toggleRowExpand = (leadId) => {
        setExpandedLeadId((prev) => (prev === leadId ? null : leadId));
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
            const sales = (data.users || []).filter((u) => u.role === 'sales');
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
        setSelectedLeads((prev) => prev.includes(leadId)
            ? prev.filter((id) => id !== leadId)
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
            setAssignDrawerOpen(false);
            loadLeads();
        } catch (err) {
            setMessage('Failed to assign leads');
        }
    };

    const toggleAssignUser = (userId) => {
        setAssignUsers((prev) => prev.includes(userId)
            ? prev.filter((id) => id !== userId)
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
        setManualLead((prev) => ({ ...prev, [key]: value }));
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
            setManualEntryDrawerOpen(false);
            loadLeads();
        } catch (err) {
            setMessage(err.response?.data?.message || 'Failed to create lead manually');
        } finally {
            setCreatingLead(false);
        }
    };

    const duplicateCount = useMemo(
        () => leads.filter((lead) => lead.isDuplicate).length,
        [leads]
    );

    const pagedLeads = leads.slice((page - 1) * LEAD_PAGE_SIZE, page * LEAD_PAGE_SIZE);
    const pageLeadIds = useMemo(() => pagedLeads.map((l) => l.leadId), [pagedLeads]);
    const allPageSelected = pageLeadIds.length > 0 && pageLeadIds.every((id) => selectedLeads.includes(id));
    const somePageSelected = pageLeadIds.some((id) => selectedLeads.includes(id));

    const handleSelectAllPage = () => {
        if (allPageSelected) {
            setSelectedLeads((prev) => prev.filter((id) => !pageLeadIds.includes(id)));
        } else {
            setSelectedLeads((prev) => {
                const combined = new Set([...prev, ...pageLeadIds]);
                return [...combined];
            });
        }
    };

    const resetFilters = () => {
        setStatusFilter([...STATUS_OPTIONS]);
        setSourceFilter([...SOURCE_OPTIONS]);
        if (fullAssigneeKeys.length) setAssigneeSelection([...fullAssigneeKeys]);
        setDateFrom('');
        setDateTo('');
        setSearch('');
        setPage(1);
    };

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (search.trim()) count += 1;
        if (statusFilter.length < STATUS_OPTIONS.length) count += 1;
        if (sourceFilter.length < SOURCE_OPTIONS.length) count += 1;
        if (canAssignLeads && assigneeSelection && fullAssigneeKeys.length > 0 && assigneeSelection.length < fullAssigneeKeys.length) count += 1;
        if (dateFrom) count += 1;
        if (dateTo) count += 1;
        return count;
    }, [search, statusFilter, sourceFilter, assigneeSelection, fullAssigneeKeys, canAssignLeads, dateFrom, dateTo]);

    const handleFollowUpLeadIdChange = (id) => {
        setFollowUpLeadId(id);
        setStatusDropdownLeadId(null);
    };

    return (
        <PageWrapper>
            <LeadMessageBanner message={message} />

            <DuplicateBanner count={duplicateCount} />

            <LeadTable
                api={api}
                user={user}
                leads={leads}
                loading={loading}
                page={page}
                onPageChange={setPage}
                canAssignLeads={canAssignLeads}
                canManualCreate={canManualCreate}
                canManage={canManage}
                selectedLeads={selectedLeads}
                onToggleSelect={toggleSelect}
                onSelectAllPage={handleSelectAllPage}
                allPageSelected={allPageSelected}
                somePageSelected={somePageSelected}
                expandedLeadId={expandedLeadId}
                onToggleRowExpand={toggleRowExpand}
                statusDropdownLeadId={statusDropdownLeadId}
                setStatusDropdownLeadId={setStatusDropdownLeadId}
                onLeadStatusIntent={onLeadStatusIntent}
                followUpLeadId={followUpLeadId}
                setFollowUpLeadId={handleFollowUpLeadIdChange}
                onLeadsUpdated={loadLeads}
                activeFilterCount={activeFilterCount}
                onOpenFilters={() => setFilterDrawerOpen(true)}
                onOpenManualEntry={() => setManualEntryDrawerOpen(true)}
                onOpenAssign={() => setAssignDrawerOpen(true)}
                onRefresh={loadLeads}
                onExport={handleExportLeadsCsv}
                exportingCsv={exportingCsv}
                onDownloadSample={handleDownloadSample}
                onUpload={handleUpload}
                uploading={uploading}
            />

            <LeadFilterDrawer
                open={filterDrawerOpen}
                onClose={() => setFilterDrawerOpen(false)}
                search={search}
                onSearchChange={setSearch}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                sourceFilter={sourceFilter}
                onSourceFilterChange={setSourceFilter}
                assigneeSelection={assigneeSelection}
                onAssigneeSelectionChange={setAssigneeSelection}
                fullAssigneeKeys={fullAssigneeKeys}
                salesUsers={salesUsers}
                canAssignLeads={canAssignLeads}
                dateFrom={dateFrom}
                onDateFromChange={setDateFrom}
                dateTo={dateTo}
                onDateToChange={setDateTo}
                onReset={resetFilters}
            />

            {canManualCreate && (
                <ManualLeadEntryDrawer
                    open={manualEntryDrawerOpen}
                    onClose={() => setManualEntryDrawerOpen(false)}
                    manualLead={manualLead}
                    onFieldChange={handleManualLeadChange}
                    onCreate={handleManualCreateLead}
                    creating={creatingLead}
                />
            )}

            {canAssignLeads && (
                <AssignLeadsDrawer
                    open={assignDrawerOpen}
                    onClose={() => setAssignDrawerOpen(false)}
                    salesUsers={salesUsers}
                    assignTo={assignTo}
                    onAssignToChange={setAssignTo}
                    selectedCount={selectedLeads.length}
                    onAssign={handleAssign}
                    assignUsers={assignUsers}
                    onToggleAssignUser={toggleAssignUser}
                    onAssignUnassigned={handleAssignUnassigned}
                    assigningUnassigned={assigningUnassigned}
                />
            )}

            <GstModal
                modal={gstModal}
                onClose={() => setGstModal(null)}
                onInputChange={(input) => setGstModal((m) => (m ? { ...m, input } : m))}
                onValidationError={setMessage}
                onConfirm={async () => {
                    await applyLeadStatusApi(
                        gstModal.lead,
                        gstModal.newStatus,
                        gstModal.newStatus,
                        gstModal.input
                    );
                    setGstModal(null);
                    setMessage('');
                }}
            />

            <LeadStageModal
                modal={leadStageModal}
                onClose={() => setLeadStageModal(null)}
                onStageChange={(selectedStage) => setLeadStageModal((m) => ({ ...m, selectedStage }))}
                onSave={async () => {
                    await applyLeadStatusApi(
                        leadStageModal.lead,
                        leadStageModal.newStatus,
                        leadStageModal.selectedStage
                    );
                    setLeadStageModal(null);
                }}
            />
        </PageWrapper>
    );
}
