// Ticket Details Component
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import WorkTimer from './components/WorkTimer';
import CostSummary from './components/CostSummary';
import DiagnosisForm from '../../components/DiagnosisForm';
import QC1Form from '../../components/QC1Form';
import SoftwareChecklist from '../../components/SoftwareChecklist';
import ChipLevelRepairPanel from '../../components/ChipLevelRepairPanel';
import PartFulfillment from './components/PartFulfillment';
import FinalTestingPanel from './components/FinalTestingPanel';
import { ArrowRight, Clock, CheckCircle } from 'lucide-react';

export default function TicketDetails() {
    const { id } = useParams(); 
    const { user } = useAuth(); // Access user from context
    const [ticket, setTicket] = useState(null);
    const [activities, setActivities] = useState([]);
    const [partRequests, setPartRequests] = useState([]);
    const [ticketParts, setTicketParts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [note, setNote] = useState('');
    const [stages, setStages] = useState([]); // State for stages
    const [workStatus, setWorkStatus] = useState('idle'); // idle, active, completed
    const [users, setUsers] = useState([]);
  
    const handleWorkStatusChange = (status, shouldMove = false) => {
      setWorkStatus(status);
      if (status === 'completed') {
        if (shouldMove) {
          handleNextStage(); // Auto-move
        } else {
          loadTicketDetails();
        }
      }
    };
  
    const loadStages = useCallback(async () => {
      try {
        const { data } = await api.get('/tickets/stages');
        setStages(data.stages);
      } catch (error) {
        console.error("Failed to load stages", error);
      }
    }, []);
  
    const loadTicketDetails = useCallback(async () => {
      try {
        const { data } = await api.get(`/tickets/${id}`);
        setTicket(data.ticket);
        setActivities(data.activities);
        setPartRequests(data.part_requests || []);
        setTicketParts(data.parts || []);
      } catch (error) {
        console.error('Load ticket error:', error);
        alert('Failed to load ticket details');
      } finally {
        setLoading(false);
      }
    }, [id]);
  
    const loadUsers = useCallback(async () => {
      if (['floor_manager', 'admin', 'manager'].includes(user?.role)) {
        try {
          const { data } = await api.get('/auth/users');
          setUsers(data.users || []);
        } catch (e) { console.error(e); }
      }
    }, [user?.role]);
  
    const handleAssign = async (userId) => {
      if (!userId) return;
      try {
        await api.post(`/tickets/${id}/assign`, { user_id: userId });
        alert('Assigned successfully');
        loadTicketDetails();
      } catch (e) {
        alert(e.response?.data?.message || 'Failed to assign');
      }
    };
  
    useEffect(() => {
      loadTicketDetails();
      loadStages(); // Fetch stages on mount
      loadUsers();
    }, [loadTicketDetails, loadStages, loadUsers]);
  
    const handleNextStage = async (checklistData = null, targetStageId = null, notes = null) => {
      const action = targetStageId ? 'jump to the selected' : 'move this ticket to the next';
      if (!window.confirm(`Are you sure you want to ${action} stage?`)) return;
  
      setProcessing(true);
      try {
        await api.post(`/tickets/${id}/next-stage`, {
          checklist_data: checklistData,
          target_stage_id: targetStageId,
          notes: notes
        });
        await loadTicketDetails(); // Reload to get new stage
        alert(`Ticket ${targetStageId ? 'jumped' : 'moved'} successfully`);
      } catch (error) {
        console.error('Next stage error:', error);
        alert('Failed to change stage');
      } finally {
        setProcessing(false);
      }
    };
  
    const handleAddNote = async (e) => {
      e.preventDefault();
      if (!note.trim()) return;
  
      setProcessing(true);
      try {
        await api.post(`/tickets/${id}/notes`, { notes: note });
        setNote('');
        await loadTicketDetails(); // Reload to get new activity
      } catch (error) {
        alert('Failed to add note');
      } finally {
        setProcessing(false);
      }
    };
  
    if (loading) return <div className="text-center py-12">Loading ticket details...</div>;
    if (!ticket) return <div className="text-center py-12">Ticket not found</div>;
  
    return (
      <div className="space-y-4">
        {ticket && <WorkTimer ticketId={ticket.ticket_id} serialNumber={ticket.serial_number} machineNumber={ticket.machine_number} assignedUserId={ticket.assigned_user_id} onStatusChange={handleWorkStatusChange} />}
        <CostSummary ticket={ticket} />
        {/* Header - compact */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              {ticket.ttspl_id && <div className="text-xs font-medium text-gray-500 mb-0.5">TTSPL ID: {ticket.ttspl_id}</div>}
              {ticket.machine_number && <div className="text-xs font-medium text-gray-500 mb-0.5">Machine No: {ticket.machine_number}</div>}
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-500">Ticket #{ticket.ticket_id}</span>
              </div>
              <div className="flex items-center gap-2 mb-0.5">
                <h1 className="text-xl font-bold">{ticket.serial_number}</h1>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                  {ticket.status}
                </span>
              </div>
              <p className="text-sm text-gray-600">{ticket.brand} {ticket.model} • Created {new Date(ticket.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
            </div>
            <div className="flex flex-col items-end gap-3">
              {/* Floor Manager / Admin / Manager Jump Controls */}
              {user && (['admin', 'floor_manager', 'manager'].includes(user.role)) && (
                <div className="flex items-center gap-2 bg-purple-50 p-2 rounded-lg border border-purple-100">
                  <select
                    className="text-sm border-gray-300 rounded-md shadow-sm focus:border-purple-500 focus:ring-purple-500"
                    id="stage-jump-select"
                  >
                    <option value="">Select Stage to Jump...</option>
                    {stages.map(stage => (
                      <option key={stage.stage_id} value={stage.stage_id}>
                        {stage.stage_order}. {stage.stage_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const select = document.getElementById('stage-jump-select');
                      if (select.value) handleNextStage(null, select.value);
                    }}
                    disabled={processing || ticket.status === 'completed'}
                    className="bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50"
                  >
                    Jump
                  </button>
                </div>
              )}
  
              {/* Standard Next Stage Button - Hidden for Team Members (Scan Only) */}
              {((ticket.stage_name !== 'Diagnosis' && ticket.stage_name !== 'Assembly & Software' && ticket.stage_name !== 'Chip Level Repair') || (user && user.role === 'admin')) && user && !['team_member'].includes(user.role) && (
                <button
                  onClick={() => handleNextStage()}
                  disabled={processing || ticket.status === 'completed' || workStatus === 'active'}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {processing ? 'Processing...' : (workStatus === 'active' ? 'Finish Work First' : 'Move to Next Stage')}
                  <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
  
          {/* Progress Bar */}
          <div className="mt-4">
            {(() => {
              const totalStages = stages.length || 13;
              return (
                <>
                  <div className="flex items-center justify-between text-xs font-medium text-gray-600 mb-1">
                    <span>Stage: {ticket.stage_name}</span>
                    <span>Step {ticket.stage_order} of {totalStages}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(ticket.stage_order / totalStages) * 100}%` }}
                    ></div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
  
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <h3 className="text-sm font-bold mb-3">Ticket Information</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-sm">
                {ticket.machine_number && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Machine No</dt>
                    <dd className="mt-0.5 text-gray-900 text-sm font-mono">{ticket.machine_number}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-gray-500">Brand</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.brand}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Model</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.model}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Priority</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm capitalize">{ticket.priority}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Processor</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.processor || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">RAM</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.ram || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Storage</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.storage || '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Current Assignee</dt>
                  {['floor_manager', 'admin', 'manager'].includes(user?.role) ? (
                    <select
                      value={ticket.assigned_user_id || ''}
                      onChange={(e) => handleAssign(e.target.value)}
                      className="mt-0.5 text-sm border border-gray-300 rounded px-2 py-1 w-full max-w-xs"
                    >
                      <option value="">-- Assign User --</option>
                      {users
                        .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                        .filter(u => {
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
                  ) : (
                    <span className="mt-0.5 block text-gray-900 text-sm">{ticket.assigned_user_name || ticket.team_name}</span>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-gray-500">Initial Condition</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm">{ticket.initial_condition}</dd>
                </div>
              </dl>
            </div>
  
  
            {/* Diagnosis Form (Visible in Diagnosis, Assembly, Procurement, Dismantle, Chip Level Repair) */}
            {/* For Diagnosis stage: Only clickable after team member scans machine to START work */}
            {(['Diagnosis', 'Assembly & Software', 'Repair', 'Procurement', 'Dismantle', 'Chip Level Repair', 'Final Testing'].includes(ticket.stage_name)) && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {ticket.stage_name === 'Diagnosis' && user?.role === 'team_member' && workStatus !== 'active' ? (
                  <div className="text-center py-8 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-amber-800 font-medium">Scan machine ({ticket.machine_number || ticket.ttspl_id || ticket.serial_number}) to START working.</p>
                    <p className="text-sm text-amber-700 mt-1">Laptop Diagnosis will become available after you start work.</p>
                  </div>
                ) : (
                  <DiagnosisForm
                    api={api}
                    ticket={ticket}
                    onComplete={loadTicketDetails}
                    readOnly={ticket.stage_name !== 'Diagnosis'}
                  />
                )}
              </div>
            )}
  
            {/* QC1 / QC2 Checklist */}
            {(ticket.stage_name === 'QC1' || ticket.stage_name === 'QC2') && (
              <QC1Form
                ticket={ticket}
                qcStage={ticket.stage_name}
                onComplete={loadTicketDetails}
              />
            )}
  
            {/* Assembly & Software Checklist */}
            {ticket.stage_name === 'Assembly & Software' && (['admin'].includes(user?.role) || user?.team_id === ticket.assigned_team_id) && (
              <SoftwareChecklist
                onSubmit={(checks, notes) => handleNextStage(checks, null, notes)}
                processing={processing}
              />
            )}
  
            {/* Chip Level Repair (L3) */}
            {ticket.stage_name === 'Chip Level Repair' && (
              <ChipLevelRepairPanel
                ticketId={id}
                partRequests={partRequests}
                ticketParts={ticketParts}
                onUpdated={loadTicketDetails}
                processing={processing}
              />
            )}
  
            {/* Procurement (Fulfill Requests) */}
            {(ticket.stage_name === 'Procurement' || (user?.team_name || '').toLowerCase().includes('procurement')) && partRequests.length > 0 && (
              <PartFulfillment
                ticketId={id}
                requests={partRequests}
                onFulfilled={loadTicketDetails}
              />
            )}
  
            {/* Final Testing - Parts Attachment */}
            {ticket.stage_name === 'Final Testing' && (
              <FinalTestingPanel
                ticketId={id}
                ticketParts={ticketParts}
                onUpdated={loadTicketDetails}
                onSubmitNext={handleNextStage}
                processing={processing}
              />
            )}
  
            {/* Activity Timeline - Admin/Manager/Final Testing Team */}
            {user && (user.role === 'admin' || user.role === 'manager' || user.team_id === ticket.assigned_team_id || ticket.stage_name === 'Final Testing') && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold mb-4">Activity Timeline</h3>
                <div className="space-y-6">
                  {activities.map((activity) => (
                    <div key={activity.activity_id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="w-0.5 flex-1 bg-gray-100 my-1"></div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-gray-900">{activity.user_name}</span>
                          <span className="text-xs text-gray-500">{new Date(activity.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                        </div>
                        {(() => {
                          // Parse notes to extract checklist items
                          const notes = activity.notes || '';
                          const checklistMatch = notes.match(/\| Checklist: (.+?)(?:\||$)/);
                          const mainNote = checklistMatch ? notes.split('| Checklist:')[0].trim() : notes;
                          const checklistItems = checklistMatch ? checklistMatch[1].split(',').map(item => item.trim()) : [];
  
                          return (
                            <>
                              <p className="text-sm text-gray-600 mb-1">{mainNote}</p>
                              {checklistItems.length > 0 && (
                                <div className="mt-2 bg-blue-50 rounded-md p-3 border border-blue-100">
                                  <div className="text-xs font-semibold text-blue-800 mb-1">Tasks Completed:</div>
                                  <ul className="text-sm text-blue-900 space-y-1">
                                    {checklistItems.map((item, idx) => (
                                      <li key={idx} className="flex items-start gap-2">
                                        <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <span className="text-xs font-medium px-2 py-0.5 bg-gray-200 rounded text-gray-600 capitalize">
                          {activity.action.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
  
          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold mb-4">Quick Actions</h3>
              <form onSubmit={handleAddNote}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
                  rows="3"
                  placeholder="Add a note..."
                ></textarea>
                <button
                  type="submit"
                  disabled={processing || !note.trim()}
                  className="w-full bg-gray-900 text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  Add Note
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }