import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, ArrowRight, CheckCircle } from 'lucide-react';
import api from '../../utils/api';
import BulkMoveModal from './components/BulkMoveModal';
import {
  PageWrapper, TableContainer, Table, TableRow, TableCell, TableEmpty,
  SearchBar, Btn, Tag, Pagination, PRIMARY, ACCENT
} from '../../components/ui';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

const selectSm = {
  fontSize: 11, padding: '4px 8px', borderRadius: 8,
  border: '1px solid #e2e8f0', background: '#fff', width: '100%', minWidth: 0
};

const viewTabs = [
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
];

function StatusTag({ status, priority }) {
  if (priority) {
    return <Tag bg="#fef3c7" color="#92400e">Priority</Tag>;
  }
  const map = {
    in_progress: { bg: '#e0f2fe', color: ACCENT },
    completed: { bg: '#dcfce7', color: '#166534' },
    failed: { bg: '#fee2e2', color: '#991b1b' },
    on_hold: { bg: '#fef9c3', color: '#854d0e' },
  };
  const s = map[status] || { bg: '#f1f5f9', color: '#475569' };
  return <Tag bg={s.bg} color={s.color}>{status?.replace(/_/g, ' ') || '—'}</Tag>;
}

export default function TicketsList() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [viewStatus, setViewStatus] = useState('in_progress');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [ticketPriorityAssign, setTicketPriorityAssign] = useState({});

  const isManager = ['floor_manager', 'admin', 'manager'].includes(user?.role);
  const canBulk = ['floor_manager', 'manager', 'admin'].includes(user?.role);

  const loadStages = useCallback(async () => {
    try {
      const { data } = await api.get('/tickets/stages');
      setStages(data.stages);
    } catch (e) { console.error(e); }
  }, []);

  const loadUsers = useCallback(async () => {
    if (isManager) {
      try {
        const { data } = await api.get('/auth/users');
        setUsers(data.users);
      } catch (e) { console.error(e); }
    }
  }, [isManager]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/tickets?view=${viewStatus}`);
      setTickets(data.tickets || []);
    } catch (error) {
      console.error('Load tickets error:', error);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [viewStatus]);

  useEffect(() => { loadStages(); }, [loadStages]);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
    setPage(1);
  }, [search, stageFilter, viewStatus, pageSize]);

  const handleAssign = async (ticketId, userId) => {
    try {
      if (!userId) return;
      await api.post(`/tickets/${ticketId}/assign`, { user_id: userId });
      loadTickets();
    } catch (error) {
      console.error(error);
      alert('Failed to assign');
    }
  };

  const handlePriorityAssign = async (ticketId) => {
    const sel = ticketPriorityAssign[ticketId];
    if (!sel?.user_id || !sel?.stage_id) return;
    try {
      await api.post(`/tickets/${ticketId}/assign`, {
        user_id: sel.user_id,
        target_stage_id: parseInt(sel.stage_id, 10)
      });
      setTicketPriorityAssign(prev => ({ ...prev, [ticketId]: {} }));
      loadTickets();
    } catch (error) {
      console.error(error);
      alert('Failed to assign');
    }
  };

  const handleClaim = async (ticketId, e) => {
    e.stopPropagation();
    try {
      await api.post(`/tickets/${ticketId}/claim`);
      loadTickets();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || 'Failed to claim ticket');
    }
  };

  const handleBulkMove = async (currentStageId, targetStageId) => {
    try {
      const { data } = await api.post('/tickets/bulk-move', {
        current_stage_id: currentStageId,
        target_stage_id: targetStageId
      });
      alert(data.message);
      setShowBulkModal(false);
      loadTickets();
    } catch (error) {
      console.error('Bulk move error:', error);
      alert(error.response?.data?.message || 'Failed to move tickets');
    }
  };

  const filteredTickets = useMemo(() => {
    const q = search.toLowerCase().trim();
    return tickets.filter(t => {
      const matchesSearch = !q || (
        t.serial_number?.toLowerCase().includes(q) ||
        t.brand?.toLowerCase().includes(q) ||
        t.model?.toLowerCase().includes(q) ||
        t.machine_number?.toLowerCase().includes(q) ||
        (t.ttspl_id && t.ttspl_id.toLowerCase().includes(q))
      );
      const matchesStage = !stageFilter || String(t.current_stage_id) === String(stageFilter);
      return matchesSearch && matchesStage;
    });
  }, [tickets, search, stageFilter]);

  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTickets.slice(start, start + pageSize);
  }, [filteredTickets, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const columns = isManager
    ? ['SERIAL', 'DEVICE', 'STAGE', 'ASSIGNEE', 'STATUS', 'ACTIONS']
    : ['SERIAL', 'DEVICE', 'STAGE', 'ASSIGNEE', 'STATUS', ''];

  const toolbar = (
    <>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {viewTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setViewStatus(tab.id)}
            style={{
              padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: viewStatus === tab.id ? PRIMARY : '#f1f5f9',
              color: viewStatus === tab.id ? '#fff' : '#64748b'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 180, maxWidth: 360 }}>
        <SearchBar
          placeholder="Search serial, brand, model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {isManager && (
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          style={{ ...selectSm, width: 'auto', minWidth: 130, flexShrink: 0 }}
        >
          <option value="">All stages</option>
          {stages.map(s => (
            <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
          ))}
        </select>
      )}
      <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        {isManager && (
          <Link to="/tickets/create" style={{ textDecoration: 'none' }}>
            <Btn icon={Plus} small>Create</Btn>
          </Link>
        )}
        {canBulk && (
          <Btn variant="outline" icon={ArrowRight} small onClick={() => setShowBulkModal(true)}>
            Bulk
          </Btn>
        )}
      </div>
    </>
  );

  return (
    <PageWrapper>
      <TableContainer toolbar={toolbar}>
        <Table columns={columns} minWidth={720}>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length} style={{ textAlign: 'center', padding: '28px 16px' }}>
                <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto', color: ACCENT }} />
              </TableCell>
            </TableRow>
          ) : filteredTickets.length === 0 ? (
            <TableEmpty
              colSpan={columns.length}
              message={`No ${viewStatus.replace('_', ' ')} tickets found.`}
            />
          ) : (
            paginatedTickets.map((ticket) => {
              const isPriority = ticket.stage_name === 'Floor Manager'
                && ['high', 'urgent'].includes(ticket.priority);
              const canClaim = !ticket.assigned_user_id
                && !isManager
                && ticket.assigned_team_id === user?.team_id;

              return (
                <TableRow
                  key={ticket.ticket_id}
                  onClick={() => navigate(`/tickets/${ticket.ticket_id}`)}
                  style={isPriority ? { background: '#fffbeb', boxShadow: 'inset 3px 0 0 #f59e0b' } : undefined}
                >
                  <TableCell bold nowrap>
                    <div>{ticket.serial_number}</div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginTop: 2 }}>
                      #{ticket.ticket_id}
                      {ticket.ttspl_id ? ` · ${ticket.ttspl_id}` : ''}
                      {ticket.machine_number ? ` · ${ticket.machine_number}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div style={{ fontWeight: 500 }}>{ticket.brand} {ticket.model}</div>
                  </TableCell>
                  <TableCell small nowrap>{ticket.stage_name}</TableCell>
                  <TableCell small>
                    <div onClick={e => e.stopPropagation()}>
                    {isManager ? (
                      isPriority ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <select
                              style={selectSm}
                              value={ticketPriorityAssign[ticket.ticket_id]?.user_id ?? ''}
                              onChange={(e) => setTicketPriorityAssign(prev => ({
                                ...prev,
                                [ticket.ticket_id]: { ...prev[ticket.ticket_id], user_id: e.target.value }
                              }))}
                            >
                              <option value="">User</option>
                              {users.filter(u => ['team_member', 'floor_manager'].includes(u.role)).map(u => (
                                <option key={u.user_id} value={u.user_id}>{u.name}</option>
                              ))}
                            </select>
                            <select
                              style={selectSm}
                              value={ticketPriorityAssign[ticket.ticket_id]?.stage_id ?? ''}
                              onChange={(e) => setTicketPriorityAssign(prev => ({
                                ...prev,
                                [ticket.ticket_id]: { ...prev[ticket.ticket_id], stage_id: e.target.value }
                              }))}
                            >
                              <option value="">Stage</option>
                              {stages.map(s => (
                                <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handlePriorityAssign(ticket.ticket_id); }}
                            disabled={!ticketPriorityAssign[ticket.ticket_id]?.user_id || !ticketPriorityAssign[ticket.ticket_id]?.stage_id}
                            style={{
                              fontSize: 11, padding: '4px 8px', borderRadius: 8, border: 'none',
                              background: '#d97706', color: '#fff', cursor: 'pointer', fontWeight: 600,
                              opacity: (!ticketPriorityAssign[ticket.ticket_id]?.user_id || !ticketPriorityAssign[ticket.ticket_id]?.stage_id) ? 0.5 : 1
                            }}
                          >
                            Assign & Move
                          </button>
                        </div>
                      ) : (
                        <select
                          style={selectSm}
                          value={ticket.assigned_user_id || ''}
                          onChange={(e) => handleAssign(ticket.ticket_id, e.target.value)}
                        >
                          <option value="">Assign user</option>
                          {users
                            .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                            .filter(u => {
                              if (ticket.stage_name === 'Floor Manager') return true;
                              if (!ticket.assigned_team_id) return false;
                              const userTeamIds = u.team_ids?.length ? u.team_ids : (u.team_id != null ? [u.team_id] : []);
                              return userTeamIds.some(tid => tid == ticket.assigned_team_id);
                            })
                            .map(u => (
                              <option key={u.user_id} value={u.user_id}>{u.name}</option>
                            ))}
                        </select>
                      )
                    ) : (
                      <span style={{ color: !ticket.assigned_user_id ? '#ea580c' : undefined, fontWeight: 500 }}>
                        {ticket.assigned_user_name || 'Unassigned'}
                      </span>
                    )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusTag status={ticket.status} priority={isPriority} />
                  </TableCell>
                  <TableCell align="right">
                    <div onClick={e => e.stopPropagation()}>
                    {canClaim ? (
                      <button
                        type="button"
                        onClick={(e) => handleClaim(ticket.ticket_id, e)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, padding: '4px 10px', borderRadius: 8, border: 'none',
                          background: '#ea580c', color: '#fff', cursor: 'pointer', fontWeight: 600
                        }}
                      >
                        <CheckCircle size={13} /> Pick
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: ACCENT, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        View <ArrowRight size={13} />
                      </span>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </Table>
        {!loading && filteredTickets.length > 0 && (
          <Pagination
            current={safePage}
            total={filteredTickets.length}
            pageSize={pageSize}
            onChange={setPage}
            pageSizeOptions={{
              options: PAGE_SIZE_OPTIONS,
              onChange: setPageSize,
            }}
          />
        )}
      </TableContainer>

      {showBulkModal && (
        <BulkMoveModal
          stages={stages}
          onClose={() => setShowBulkModal(false)}
          onConfirm={handleBulkMove}
        />
      )}
    </PageWrapper>
  );
}
