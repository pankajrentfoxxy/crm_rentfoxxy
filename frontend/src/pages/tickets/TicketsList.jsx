import React, { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext, useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, Search, Plus, ArrowRight, CheckCircle } from 'lucide-react';
import api from '../../utils/api';
import BulkMoveModal from './components/BulkMoveModal';


export default function TicketsList() {
    const { user } = useAuth(); // Access user from context
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [stageFilter, setStageFilter] = useState('');
    const [stages, setStages] = useState([]);
    const [users, setUsers] = useState([]);
    const [viewStatus, setViewStatus] = useState('in_progress'); // 'in_progress' or 'completed'
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [ticketPriorityAssign, setTicketPriorityAssign] = useState({}); // { ticketId: { user_id, stage_id } }
    const navigate = useNavigate();
  
    const loadStages = useCallback(async () => {
      try {
        const { data } = await api.get('/tickets/stages');
        setStages(data.stages);
      } catch (e) { console.error(e); }
    }, []);
  
    const loadUsers = useCallback(async () => {
      // Only for managers/admins
      if (['floor_manager', 'admin', 'manager'].includes(user?.role)) {
        try {
          const { data } = await api.get('/auth/users');
          setUsers(data.users);
        } catch (e) { console.error(e); }
      }
    }, [user]);
  
    const loadTickets = useCallback(async () => {
      setLoading(true);
      try {
        // Use general search endpoint which handles roles; view=completed includes tickets user moved
        let url = `/tickets?search=${search}&view=${viewStatus}`;
        if (stageFilter) url += `&stage_id=${stageFilter}`;
  
        const { data } = await api.get(url);
        setTickets(data.tickets);
      } catch (error) {
        console.error('Load tickets error:', error);
      } finally {
        setLoading(false);
      }
    }, [search, stageFilter, viewStatus]);
  
    useEffect(() => {
      loadStages();
    }, [loadStages]);
  
    useEffect(() => {
      loadUsers();
    }, [loadUsers]);
  
    useEffect(() => {
      loadTickets();
    }, [loadTickets]);
  
    const handleAssign = async (ticketId, userId) => {
      try {
        if (!userId) return;
        await api.post(`/tickets/${ticketId}/assign`, { user_id: userId });
        alert('Assigned successfully');
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
        await api.post(`/tickets/${ticketId}/assign`, { user_id: sel.user_id, target_stage_id: parseInt(sel.stage_id, 10) });
        alert('Assigned and moved successfully');
        setTicketPriorityAssign(prev => ({ ...prev, [ticketId]: {} }));
        loadTickets();
      } catch (error) {
        console.error(error);
        alert('Failed to assign');
      }
    };
  
    const handleClaim = async (ticketId) => {
      try {
        await api.post(`/tickets/${ticketId}/claim`);
        alert('Ticket claimed successfully!');
        // Reload to reflect changes
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
  
    const filteredTickets = tickets.filter(t => {
      // Backend returns correct set per view; only apply search filter client-side
      const matchesSearch =
        t.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
        t.brand?.toLowerCase().includes(search.toLowerCase()) ||
        t.model?.toLowerCase().includes(search.toLowerCase()) ||
        (t.ttspl_id && t.ttspl_id.toLowerCase().includes(search.toLowerCase()));
  
      return matchesSearch;
    });
  
    const getStatusColor = (status) => {
      const colors = {
        in_progress: 'bg-blue-100 text-blue-700',
        completed: 'bg-green-100 text-green-700',
        failed: 'bg-red-100 text-red-700',
        on_hold: 'bg-yellow-100 text-yellow-700'
      };
      return colors[status] || 'bg-gray-100 text-gray-700';
    };
  
    if (loading) {
      return <div className="text-center py-12">Loading tickets...</div>;
    }
  
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold mb-1">Tickets</h2>
              <p className="text-gray-600">Manage refurbishment tickets</p>
            </div>
  
            <div className="flex items-center gap-4">
              {/* View Status Tabs */}
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => setViewStatus('in_progress')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewStatus === 'in_progress'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  In Progress
                </button>
                <button
                  onClick={() => setViewStatus('completed')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewStatus === 'completed'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Completed
                </button>
              </div>
  
              {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
                <Link
                  to="/tickets/create"
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  <span className="hidden sm:inline">Create Ticket</span>
                </Link>
              )}
  
              {/* Bulk Action Button */}
              {['floor_manager', 'manager', 'admin'].includes(user?.role) && (
                <button
                  onClick={() => setShowBulkModal(true)}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm font-medium"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span className="hidden sm:inline">Bulk Actions</span>
                </button>
              )}
            </div>
          </div>
        </div>
  
        {/* Search & Filter */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadTickets()}
              placeholder="Search by serial number, brand, or model..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
  
          {/* Stage Filter (Manager only) */}
          {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
            <div className="w-full md:w-64">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="w-full h-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Stages</option>
                {stages.map(s => (
                  <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
  
        {/* Tickets Grid */}
        {filteredTickets.length === 0 && !loading ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500">No {viewStatus.replace('_', ' ')} tickets found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTickets.map((ticket) => {
              const isPriority = ticket.stage_name === 'Floor Manager' && ['high', 'urgent'].includes(ticket.priority);
              return (
              <div
                key={ticket.ticket_id}
                onClick={() => navigate(`/tickets/${ticket.ticket_id}`)}
                className={`rounded-xl shadow-sm p-6 cursor-pointer hover:shadow-md transition-shadow relative ${
                  isPriority
                    ? 'bg-slate-800 border-2 border-amber-500 text-white [&_.text-gray-600]:text-slate-300 [&_.text-gray-500]:text-slate-400'
                    : 'bg-white border border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">#{ticket.ticket_id}{ticket.ttspl_id ? ` • ${ticket.ttspl_id}` : ''}{ticket.machine_number ? ` • ${ticket.machine_number}` : ''}</p>
                    <h3 className="font-bold text-lg">{ticket.serial_number}</h3>
                    <p className="text-sm text-gray-600">{ticket.brand} {ticket.model}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${isPriority ? 'bg-amber-500/30 text-amber-100' : getStatusColor(ticket.status)}`}>
                    {isPriority ? 'Priority' : ticket.status}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Stage:</span>
                    <span className="font-medium">{ticket.stage_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Assignee:</span>
                    <span className={`font-medium ${!ticket.assigned_user_id ? 'text-orange-600' : ''}`}>
                      {ticket.assigned_user_name || 'Unassigned'}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t flex flex-col gap-2">
                  {/* Manager Assignment */}
                  {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
                    <div className="flex flex-col gap-2 mb-2" onClick={e => e.stopPropagation()}>
                      {isPriority ? (
                        <>
                          <div className="flex gap-2 min-w-0">
                            <select
                              className="text-xs bg-slate-700 border border-amber-500/50 text-slate-100 rounded p-1.5 flex-1 min-w-0 focus:ring-1 focus:ring-amber-500/50 [&>option]:bg-slate-800 [&>option]:text-slate-100"
                              value={ticketPriorityAssign[ticket.ticket_id]?.user_id ?? ''}
                              onChange={(e) => setTicketPriorityAssign(prev => ({ ...prev, [ticket.ticket_id]: { ...prev[ticket.ticket_id], user_id: e.target.value } }))}
                            >
                              <option value="">-- Name --</option>
                              {users
                                .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                                .map(u => (
                                  <option key={u.user_id} value={u.user_id} title={`${u.name} (${u.team_name || '-'})`}>
                                    {u.name} ({u.team_name || '-'})
                                  </option>
                                ))}
                            </select>
                            <select
                              className="text-xs bg-slate-700 border border-amber-500/50 text-slate-100 rounded p-1.5 flex-1 min-w-0 focus:ring-1 focus:ring-amber-500/50 [&>option]:bg-slate-800 [&>option]:text-slate-100"
                              value={ticketPriorityAssign[ticket.ticket_id]?.stage_id ?? ''}
                              onChange={(e) => setTicketPriorityAssign(prev => ({ ...prev, [ticket.ticket_id]: { ...prev[ticket.ticket_id], stage_id: e.target.value } }))}
                            >
                              <option value="">-- Stage --</option>
                              {stages.map(s => (
                                <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
                              ))}
                            </select>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePriorityAssign(ticket.ticket_id); }}
                            disabled={!ticketPriorityAssign[ticket.ticket_id]?.user_id || !ticketPriorityAssign[ticket.ticket_id]?.stage_id}
                            className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded disabled:opacity-50 w-full"
                          >
                            Assign & Move
                          </button>
                        </>
                      ) : (
                        <select
                          className="text-xs border border-gray-300 rounded p-1 w-full"
                          value={ticket.assigned_user_id || ''}
                          onChange={(e) => handleAssign(ticket.ticket_id, e.target.value)}
                        >
                          <option value="">-- Assign User --</option>
                          {users
                            .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                            .filter(u => {
                              if (ticket.stage_name === 'Floor Manager') return true;
                              if (!ticket.assigned_team_id) return false;
                              const userTeamIds = u.team_ids?.length ? u.team_ids : (u.team_id != null ? [u.team_id] : []);
                              return userTeamIds.some(tid => tid == ticket.assigned_team_id);
                            })
                            .map(u => (
                              <option key={u.user_id} value={u.user_id}>
                                {u.name} ({u.team_name})
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  )}
  
                  <div className="flex items-center justify-end">
                    {!ticket.assigned_user_id &&
                      !['floor_manager', 'admin', 'manager'].includes(user?.role) &&
                      ticket.assigned_team_id === user?.team_id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClaim(ticket.ticket_id);
                        }}
                        className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-orange-700 flex items-center gap-1 shadow-sm z-10"
                      >
                        <CheckCircle className="w-4 h-4" /> Pick Ticket
                      </button>
                    ) : (
                      <div className="flex items-center text-blue-600 font-medium text-sm">
                        View Details <ArrowRight className="w-4 h-4 ml-1" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
  
        {/* Bulk Move Modal */}
        {showBulkModal && (
          <BulkMoveModal
            stages={stages}
            onClose={() => setShowBulkModal(false)}
            onConfirm={handleBulkMove}
          />
        )}
      </div>
    );
  }