import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, History, Loader2 } from 'lucide-react';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import DiagnosisForm from '../../../components/DiagnosisForm';
import {
  fetchTicketDetail,
  fetchTtsplHistory,
  floorManagerFail,
  markBodyPaint,
  markChipRepair,
  moveTicketStage
} from '../floorPipelineApi';
import {
  configSummary,
  isFloorManagerRole,
  isQcRole,
  isTechnicianRole,
  priorityBadge
} from '../floorPipelineUi';
import StageTimeline from '../components/StageTimeline';
import WorkLogFeed from '../components/WorkLogFeed';
import QcChecklistPanel from '../components/QcChecklistPanel';
import ChipRepairPanel from '../components/ChipRepairPanel';
import BodyPaintPanel from '../components/BodyPaintPanel';
import PartsConfigPanel from '../components/PartsConfigPanel';
import WorkNotesPanel from '../components/WorkNotesPanel';
import AssignmentModal from '../components/AssignmentModal';
import TtsplHistoryDrawer from '../components/TtsplHistoryDrawer';

const HW_WORK_STAGES = ['Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint'];

export default function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [failReason, setFailReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [configHistory, setConfigHistory] = useState([]);
  const [auditLog, setAuditLog] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await fetchTicketDetail(id);
      if (res.success) {
        setData(res);
        if (res.ticket?.ttspl_id) {
          const h = await fetchTtsplHistory(res.ticket.ttspl_id);
          if (h.data.success) {
            setConfigHistory(h.data.configHistory || []);
            setAuditLog(h.data.auditLog || []);
          }
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const ticket = data?.ticket;
  const stage = ticket?.stage_name;
  const fm = isFloorManagerRole(user?.role);
  const tech = isTechnicianRole(user?.role);
  const qc = isQcRole(user?.role);

  const visibleTabs = useMemo(() => {
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'worklog', label: 'Work Log' },
      { id: 'parts', label: 'Parts & Config' },
      { id: 'history', label: 'TTSPL History' }
    ];
    if (stage === 'Diagnosis') tabs.splice(2, 0, { id: 'diagnosis', label: 'Diagnosis' });
    if (HW_WORK_STAGES.includes(stage)) tabs.splice(stage === 'Diagnosis' ? 3 : 2, 0, { id: 'notes', label: 'Work Notes' });
    if (['QC1', 'QC2'].includes(stage)) tabs.splice(2, 0, { id: 'qc', label: 'QC Checklist' });
    if (ticket?.chip_repair_required) tabs.push({ id: 'chip', label: 'Chip Repair' });
    if (ticket?.body_paint_required) tabs.push({ id: 'body', label: 'Body & Paint' });
    return tabs;
  }, [stage, ticket?.chip_repair_required, ticket?.body_paint_required]);

  const move = async (toStage, reason) => {
    if (reason !== undefined && (!reason || reason.trim().length < 10)) {
      toast.error('Reason required (min 10 characters) for fail actions');
      return;
    }
    try {
      const { data: res } = await moveTicketStage(id, { to_stage_name: toStage, reason, notes: reason });
      if (res.success) {
        toast.success(res.message);
        load();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Move failed');
    }
  };

  const forceFail = async () => {
    if (!failReason.trim() || failReason.trim().length < 10) {
      toast.error('Reason required (min 10 characters)');
      return;
    }
    if (!window.confirm('Force fail and return to vendor? This cannot be undone easily.')) return;
    try {
      const { data: res } = await floorManagerFail(id, { reason: failReason });
      if (res.success) {
        toast.success(res.message);
        load();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    }
  };

  const stageActivities = useMemo(() => {
    return (data?.activities || [])
      .filter((a) => ['stage_changed', 'stage_jumped', 'assigned', 'bulk_move'].includes(a.action))
      .slice(0, 20);
  }, [data?.activities]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!ticket) return <p className="text-red-600">Ticket not found</p>;

  const pri = priorityBadge(ticket.priority);
  const stageButtons = [];

  if (fm && stage === 'Floor Manager') {
    stageButtons.push({ label: 'Assign to Technician', action: () => setAssignOpen(true), primary: true });
  }
  if ((tech || fm) && stage === 'Diagnosis') {
    stageButtons.push(
      { label: 'Move to Assembly & Software', action: () => move('Assembly & Software'), primary: true },
      { label: 'Mark Chip Repair Required', action: () => markChipRepair(id).then(load), warn: true },
      { label: 'Mark Body & Paint Required', action: () => markBodyPaint(id).then(load), pink: true }
    );
  }
  if ((tech || fm) && HW_WORK_STAGES.includes(stage)) {
    const next = stage === 'Assembly & Software' ? 'Final Testing' : stage === 'Final Testing' ? 'QC1' : 'Assembly & Software';
    stageButtons.push({ label: stage === 'Final Testing' ? 'Move to QC1' : `Move to ${next}`, action: () => move(next), primary: true });
  }
  if ((qc || fm) && stage === 'QC1') {
    stageButtons.push(
      { label: 'QC1 PASS — Move to QC2', action: () => move('QC2'), success: true },
      { label: 'QC1 FAIL — Send back', action: () => move('Assembly & Software', failReason), danger: true, needsReason: true }
    );
  }
  if ((qc || fm) && stage === 'QC2') {
    stageButtons.push(
      { label: 'QC2 PASS — Mark Inventory Ready', action: () => move('Inventory'), success: true },
      { label: 'QC2 FAIL — Send back to QC1', action: () => move('QC1', failReason), danger: true, needsReason: true }
    );
  }
  if (fm) {
    stageButtons.push(
      { label: 'Reassign Technician', action: () => setAssignOpen(true), muted: true },
      { label: 'Force Fail — Return to Vendor', action: forceFail, destructive: true, needsReason: true }
    );
  }

  return (
    <div className="pb-10">
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
        <Link to="/floor-pipeline/tickets" className="text-sm text-blue-600 hover:underline">← Back</Link>
        <span className="text-slate-300">|</span>
        <span className="font-mono font-bold">#{ticket.ticket_id}</span>
        <span className="font-mono text-blue-700 font-semibold">{ticket.ttspl_id || '—'}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold">{stage}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span>
        <span className="text-sm text-slate-600 hidden sm:inline">{configSummary(ticket)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0">
          <div className="flex gap-1 overflow-x-auto border-b mb-4 pb-1">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-3 py-2 text-sm rounded-t-lg ${tab === t.id ? 'bg-white border border-b-0 font-semibold text-blue-700' : 'text-slate-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3 text-sm">
                <h3 className="font-semibold">Ticket Details</h3>
                <div className="grid grid-cols-2 gap-2">
                  <p><span className="text-slate-500">Type:</span> {ticket.ticket_type || 'grn_qc'}</p>
                  <p><span className="text-slate-500">Status:</span> {ticket.status}</p>
                  <p><span className="text-slate-500">QC Fails:</span> <span className={ticket.qc_fail_count > 0 ? 'text-red-600 font-bold' : ''}>{ticket.qc_fail_count || 0}</span></p>
                  <p><span className="text-slate-500">Created:</span> {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}</p>
                </div>
                {ticket.highlighted ? (
                  <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {ticket.highlighted_reason || 'Highlighted for attention'}
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border bg-white p-4 shadow-sm text-sm">
                <h3 className="font-semibold mb-3">Stage Timeline</h3>
                <StageTimeline currentStage={stage} />
                <ul className="mt-3 space-y-2 text-xs border-t pt-3">
                  {stageActivities.slice(0, 6).map((a) => (
                    <li key={a.activity_id} className="text-slate-600">
                      <span className="text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                      {' · '}{a.user_name || 'System'} — {a.action.replace(/_/g, ' ')}
                      {a.stage_name ? ` (${a.stage_name})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-2 rounded-xl border bg-white p-4 shadow-sm text-sm">
                <h3 className="font-semibold mb-2">Recent Activity</h3>
                <ul className="space-y-2">
                  {(data.activities || []).slice(0, 5).map((a) => (
                    <li key={a.activity_id} className="text-slate-700">
                      <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                      {' · '}<strong>{a.user_name || 'System'}</strong> — {a.notes || a.action}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setTab('worklog')} className="text-blue-600 text-xs font-medium mt-2 hover:underline">
                  View full work log →
                </button>
              </div>
            </div>
          )}

          {tab === 'worklog' && <WorkLogFeed activities={data.activities} parts={data.parts} auditLog={auditLog} />}
          {tab === 'parts' && (
            <PartsConfigPanel
              ticket={ticket}
              parts={data.parts}
              configHistory={configHistory}
              onUpdated={load}
            />
          )}
          {tab === 'diagnosis' && <DiagnosisForm api={api} ticket={ticket} onComplete={load} />}
          {tab === 'notes' && (
            <WorkNotesPanel
              ticketId={ticket.ticket_id}
              activities={data.activities}
              auditLog={auditLog}
              onLogged={load}
            />
          )}
          {tab === 'qc' && <QcChecklistPanel ticket={ticket} stageName={stage} onSubmitted={load} />}
          {tab === 'chip' && (
            <ChipRepairPanel ticketId={ticket.ticket_id} partRequests={data.part_requests} ticketParts={data.parts} onUpdated={load} />
          )}
          {tab === 'body' && <BodyPaintPanel ticketId={ticket.ticket_id} onUpdated={load} />}
          {tab === 'history' && (
            <button type="button" onClick={() => setHistoryOpen(true)} className="text-blue-600 text-sm font-medium">
              Open full TTSPL history drawer
            </button>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm text-sm sticky top-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">TTSPL Info</h3>
            <p className="font-mono font-bold text-blue-700">{ticket.ttspl_id || '—'}</p>
            <p className="text-slate-600 mt-1">{configSummary(ticket)}</p>
            <p className="text-xs text-slate-500 mt-2">{ticket.initial_condition || '—'}</p>

            <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-2">Current Assignment</h3>
            <p><span className="text-slate-500">Stage:</span> {stage}</p>
            <p><span className="text-slate-500">Team:</span> {ticket.team_name || '—'}</p>
            <p><span className="text-slate-500">Assigned:</span> {ticket.assigned_user_name || 'Unassigned'}</p>

            {(ticket.qc_fail_count || 0) > 0 ? (
              <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-2 text-xs text-red-800">
                QC fail history: {ticket.qc_fail_count} failure(s)
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium hover:bg-slate-50"
            >
              <History className="w-4 h-4" /> View TTSPL history
            </button>

            <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-2">Stage Actions</h3>
            {stageButtons.some((b) => b.needsReason) ? (
              <textarea
                className="w-full rounded-lg border text-xs p-2 min-h-[60px] mb-2"
                placeholder="Reason (required for fail actions) — e.g. RAM mismatch, dead pixel…"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
              />
            ) : null}
            <div className="space-y-2">
              {stageButtons.map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={btn.action}
                  className={`w-full py-2 rounded-lg text-xs font-semibold ${
                    btn.primary ? 'bg-blue-600 text-white' :
                    btn.success ? 'bg-green-600 text-white' :
                    btn.danger || btn.destructive ? 'bg-red-700 text-white' :
                    btn.warn ? 'bg-amber-500 text-white' :
                    btn.pink ? 'bg-pink-500 text-white' :
                    'bg-slate-100 text-slate-800'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <AssignmentModal ticket={ticket} open={assignOpen} onClose={() => setAssignOpen(false)} onAssigned={load} />
      <TtsplHistoryDrawer ttsplId={ticket.ttspl_id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
