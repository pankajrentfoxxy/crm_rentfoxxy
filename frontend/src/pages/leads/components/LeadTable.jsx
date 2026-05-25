import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
    TableContainer, Table, TableRow, TableCell, TableEmpty, Pagination, Tag, ACCENT
} from '../../../components/ui';
import { LEAD_PAGE_SIZE } from '../constants';
import LeadTableToolbar from './LeadTableToolbar';
import StatusDropdown from './StatusDropdown';
import FollowUpCell from './FollowUpCell';
import ExpandedRowContent from './ExpandedRowContent';

export default function LeadTable({
    api,
    user,
    leads,
    loading,
    page,
    onPageChange,
    canAssignLeads,
    canManualCreate,
    canManage,
    selectedLeads,
    onToggleSelect,
    onSelectAllPage,
    allPageSelected,
    somePageSelected,
    expandedLeadId,
    onToggleRowExpand,
    statusDropdownLeadId,
    setStatusDropdownLeadId,
    onLeadStatusIntent,
    followUpLeadId,
    setFollowUpLeadId,
    onLeadsUpdated,
    activeFilterCount,
    onOpenFilters,
    onOpenManualEntry,
    onOpenAssign,
    onRefresh,
    onExport,
    exportingCsv,
    onDownloadSample,
    onUpload,
    uploading
}) {
    const navigate = useNavigate();
    const selectAllRef = useRef(null);

    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = somePageSelected && !allPageSelected;
        }
    }, [allPageSelected, somePageSelected]);

    const columns = useMemo(() => {
        const cols = [];
        if (canAssignLeads) {
            cols.push({
                label: (
                    <input
                        type="checkbox"
                        ref={selectAllRef}
                        checked={allPageSelected}
                        onChange={onSelectAllPage}
                        title="Select all on page"
                    />
                ),
                align: 'left'
            });
        }
        cols.push('ID', 'DATE', 'LEAD', 'COMPANY', 'SOURCE', 'STATUS', 'ASSIGNEE', 'FOLLOW-UP', 'ACTION');
        return cols;
    }, [canAssignLeads, allPageSelected, onSelectAllPage]);

    const pagedLeads = leads.slice((page - 1) * LEAD_PAGE_SIZE, page * LEAD_PAGE_SIZE);

    const toolbar = (
        <LeadTableToolbar
            activeFilterCount={activeFilterCount}
            onOpenFilters={onOpenFilters}
            onOpenManualEntry={onOpenManualEntry}
            onOpenAssign={onOpenAssign}
            selectedCount={selectedLeads.length}
            canManualCreate={canManualCreate}
            canAssignLeads={canAssignLeads}
            onRefresh={onRefresh}
            loading={loading}
            onExport={onExport}
            exportingCsv={exportingCsv}
            onDownloadSample={onDownloadSample}
            onUpload={onUpload}
            uploading={uploading}
            canManage={canManage}
        />
    );

    return (
        <TableContainer toolbar={toolbar}>
            <Table columns={columns} minWidth={960}>
                {loading ? (
                    <TableRow>
                        <TableCell colSpan={columns.length} style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b' }}>
                            Loading leads…
                        </TableCell>
                    </TableRow>
                ) : pagedLeads.length === 0 ? (
                    <TableEmpty colSpan={columns.length} message="No leads found." />
                ) : (
                    pagedLeads.map((lead) => (
                        <React.Fragment key={lead.leadId}>
                            <TableRow
                                onClick={() => onToggleRowExpand(lead.leadId)}
                                style={expandedLeadId === lead.leadId ? { background: '#f8fafc' } : undefined}
                            >
                                {canAssignLeads && (
                                    <TableCell>
                                        <div onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedLeads.includes(lead.leadId)}
                                                onChange={() => onToggleSelect(lead.leadId)}
                                            />
                                        </div>
                                    </TableCell>
                                )}
                                <TableCell small nowrap>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        {expandedLeadId === lead.leadId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        #{lead.leadId}
                                    </span>
                                </TableCell>
                                <TableCell muted small nowrap>
                                    {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '-'}
                                </TableCell>
                                <TableCell>
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <div style={{ fontWeight: 600 }}>{lead.name}</div>
                                        <div style={{ fontSize: 11, color: '#64748b' }}>{lead.email || '-'}</div>
                                        <div style={{ fontSize: 11, color: '#64748b' }}>{lead.phone || '-'}</div>
                                        {lead.isDuplicate && <Tag bg="#fef3c7" color="#92400e">Dup</Tag>}
                                    </div>
                                </TableCell>
                                <TableCell muted small>{lead.companyName || '-'}</TableCell>
                                <TableCell small>{lead.source || '-'}</TableCell>
                                <TableCell align="center">
                                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                                        <StatusDropdown
                                            lead={lead}
                                            statusDropdownLeadId={statusDropdownLeadId}
                                            setStatusDropdownLeadId={setStatusDropdownLeadId}
                                            onStatusIntent={onLeadStatusIntent}
                                            user={user}
                                        />
                                        {lead.leadStage && (
                                            <span style={{ fontSize: 10, color: '#64748b', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={lead.leadStage}>
                                                {lead.leadStage}
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell muted small>{lead.assignedUser?.name || '-'}</TableCell>
                                <TableCell align="center">
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <FollowUpCell
                                            lead={lead}
                                            api={api}
                                            followUpLeadId={followUpLeadId}
                                            setFollowUpLeadId={setFollowUpLeadId}
                                            onUpdated={onLeadsUpdated}
                                            user={user}
                                        />
                                    </div>
                                </TableCell>
                                <TableCell align="center">
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/leads/${lead.leadId}?fromPage=${page}`)}
                                            style={{ background: 'none', border: 'none', color: ACCENT, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                                        >
                                            View
                                        </button>
                                    </div>
                                </TableCell>
                            </TableRow>
                            {expandedLeadId === lead.leadId && (
                                <TableRow>
                                    <TableCell colSpan={columns.length} style={{ padding: '8px 16px', background: '#f8fafc' }}>
                                        <ExpandedRowContent
                                            leadId={lead.leadId}
                                            api={api}
                                            onRemarkSaved={onLeadsUpdated}
                                            user={user}
                                        />
                                    </TableCell>
                                </TableRow>
                            )}
                        </React.Fragment>
                    ))
                )}
            </Table>
            {!loading && leads.length > 0 && (
                <Pagination
                    current={page}
                    total={leads.length}
                    pageSize={LEAD_PAGE_SIZE}
                    onChange={onPageChange}
                />
            )}
        </TableContainer>
    );
}
