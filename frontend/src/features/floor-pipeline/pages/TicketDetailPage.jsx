import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, History, Loader2 } from 'lucide-react';
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
import ConfigUpdateModal from '../components/ConfigUpdateModal';
import PartsRequestModal from '../components/PartsRequestModal';
import TtsplHistoryDrawer from '../components/TtsplHistoryDrawer';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'worklog', label: 'Work Log' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'parts', label: 'Parts' },
  { id: 'config', label: 'Config History' },
  { id: 'qc', label: 'QC Checklist' },
  { id: 'history', label: 'TTSPL History' }
];

export default function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [failReason, setFailReason] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [showParts, setShowParts] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configHistory, setConfigHistory] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await fetchTicketDetail(id);
      if (res.success) {
        setData(res);
        if (res.ticket?.ttspl_id) {
          const h = await fetchTtsplHistory(res.ticket.ttspl_id);
          if (h.data.success) setConfigHistory(h.data.configHistory || []);
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
    let tabs = [...TABS];
    if (ticket?.chip_repair_required) tabs.splice(6, 0, { id: 'chip', label: 'Chip Repair' });
    if (ticket?.body_paint_required) tabs.splice(ticket?.chip_repair_required ? 7 : 6, 0, { id: 'body', label: 'Body & Paint' });
    return tabs;
  }, [ticket?.chip_repair_required, ticket?.body_paint_required]);

  const move = async (toStage, reason) => {
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
    if (!failReason.trim()) {
      toast.error('Reason required');
      return;
    }
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

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!ticket) return <p className="text-red-600">Ticket not found</p>;

  const pri = priorityBadge(ticket.priority);

  const stageButtons = [];
  if ((tech || fm) && stage === 'Diagnosis') {
    stageButtons.push(
      { label: 'Move to Assembly & Software', action: () => move('Assembly & Software'), primary: true },
      { label: 'Mark Chip Repair Required', action: () => markChipRepair(id).then(load), warn: true },
      { label: 'Mark Body & Paint Required', action: () => markBodyPaint(id).then(load), pink: true },
      { label: 'Parts Required', action: () => setShowParts(true), muted: true }
    );
  }
  if ((tech || fm) && ['Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint'].includes(stage)) {
    const next = stage === 'Assembly & Software' ? 'Final Testing' : stage === 'Final Testing' ? 'QC1' : 'Assembly & Software';
    stageButtons.push(
      { label: `Move to ${next}`, action: () => move(next), primary: true },
      { label: 'Parts Required', action: () => setShowParts(true), muted: true }
    );
  }
  if ((qc || fm) && stage === 'QC1') {
    stageButtons.push(
      { label: 'QC1 Pass — Move to QC2', action: () => move('QC2'), success: true },
      { label: 'QC1 Fail — Send back', action: () => move('Assembly & Software', failReason), danger: true, needsReason: true }
    );
  }
  if ((qc || fm) && stage === 'QC2') {
    stageButtons.push(
      { label: 'QC2 Pass — Move to Inventory', action: () => move('Inventory'), success: true },
      { label: 'QC2 Fail — Send back to QC1', action: () => move('QC1', failReason), danger: true, needsReason: true }
    );
  }
  if (fm) {
    stageButtons.push({
      label: 'Force QC Fail — Return to Vendor',
      action: forceFail,
      destructive: true,
      needsReason: true
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 pb-10">
      <div className="min-w-0">
        <div className="mb-4">
          <Link to="/floor-pipeline/tickets" className="text-sm text-blue-600 hover:underline">← All tickets</Link>
          <h1 className="text-xl font-bold mt-1">Ticket #{ticket.ticket_id}</h1>
          <StageTimeline currentStage={stage} />
        </div>
        <div className="flex gap-1 overflow-x-auto border-b mb-4 pb-1">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-2 text-sm rounded-t-lg ${tab === t.id ? 'bg-white border border-b-0 font-semibold' : 'text-slate-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3 text-sm">
            <div className="grid sm:grid-cols-2 gap-3">
              <p><span className="text-slate-500">TTSPL:</span> <span className="font-mono font-bold">{ticket.ttspl_id || '—'}</span></p>
              <p><span className="text-slate-500">Type:</span> {ticket.ticket_type || 'grn_qc'}</p>
              <p><span className="text-slate-500">Priority:</span> <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span></p>
              <p><span className="text-slate-500">Status:</span> {ticket.status}</p>
              <p><span className="text-slate-500">Assigned:</span> {ticket.assigned_user_name || 'Unassigned'}</p>
              <p><span className="text-slate-500">Created:</span> {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}</p>
            </div>
            <button type="button" onClick={() => setShowConfig(true)} className="text-sm text-blue-600 font-medium">
              Update config →
            </button>
          </div>
        )}
        {tab === 'worklog' && <WorkLogFeed activities={data.activities} parts={data.parts} />}
        {tab === 'diagnosis' && <DiagnosisForm ticket={ticket} onComplete={load} />}
        {tab === 'parts' && (
          <div className="space-y-4">
            <button type="button" onClick={() => setShowParts(true)} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">
              + Request / Attach Part
            </button>
            <div className="rounded-xl border overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs"><tr>
                  <th className="px-3 py-2 text-left">Part</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Cost</th>
                </tr></thead>
                <tbody>
                  {(data.parts || []).map((p) => (
                    <tr key={p.part_id} className="border-t">
                      <td className="px-3 py-2">{p.part_name}</td>
                      <td className="px-3 py-2 text-center">{p.quantity_used}</td>
                      <td className="px-3 py-2 text-right">₹{p.total_part_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 className="font-medium text-sm">Parts requested</h4>
            <ul className="text-sm space-y-2">
              {(data.part_requests || []).map((pr) => (
                <li key={pr.request_id} className="rounded-lg border p-2">{pr.part_name} — {pr.status || 'pending'}</li>
              ))}
            </ul>
          </div>
        )}
        {tab === 'config' && (
          <div className="rounded-xl border overflow-hidden text-sm">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-xs"><tr>
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th><th className="px-3 py-2">Type</th>
              </tr></thead>
              <tbody>
                {configHistory.map((h) => (
                  <tr key={h.history_id} className="border-t">
                    <td className="px-3 py-2">{new Date(h.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 capitalize">{h.field_name}</td>
                    <td className="px-3 py-2">{h.old_value}</td>
                    <td className="px-3 py-2 font-medium">{h.new_value}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        h.change_type === 'upgrade' ? 'bg-green-100 text-green-800' :
                        h.change_type === 'replacement' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
                      }`}>{h.change_type}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'qc' && <QcChecklistPanel ticket={ticket} stageName={stage} onSubmitted={load} />}
        {tab === 'chip' && (
          <ChipRepairPanel
            ticketId={ticket.ticket_id}
            partRequests={data.part_requests}
            ticketParts={data.parts}
            onUpdated={load}
          />
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
          <p className="font-mono font-bold text-blue-700">{ticket.ttspl_id || '—'}</p>
          <p className="text-slate-600 mt-1">{configSummary(ticket)}</p>
          <p className="text-xs text-slate-500 mt-2">{ticket.initial_condition}</p>
          {ticket.highlighted ? (
            <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {ticket.highlighted_reason}
            </div>
          ) : null}
          <p className="mt-2 text-xs">QC fails: <strong>{ticket.qc_fail_count || 0}</strong></p>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium hover:bg-slate-50"
          >
            <History className="w-4 h-4" /> View TTSPL history
          </button>
          <div className="mt-4 space-y-2">
            {stageButtons.some((b) => b.needsReason) ? (
              <textarea
                className="w-full rounded-lg border text-xs p-2 min-h-[60px]"
                placeholder="Reason (required for fail actions)"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
              />
            ) : null}
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

      <ConfigUpdateModal open={showConfig} onClose={() => setShowConfig(false)} ticket={ticket} onSaved={load} />
      <PartsRequestModal open={showParts} onClose={() => setShowParts(false)} ticketId={ticket.ticket_id} onSuccess={load} />
      <TtsplHistoryDrawer ttsplId={ticket.ttspl_id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
