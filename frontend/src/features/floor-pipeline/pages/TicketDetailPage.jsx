import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, History, Loader2 } from 'lucide-react';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import DiagnosisForm from '../../../components/DiagnosisForm';
import {
  fetchTicketDetail,
  fetchTtsplHistory,
  floorManagerFail,
  getNextAssignee,
  getActiveWorkLog,
  getTeamMembers,
  markBodyPaint,
  markChipRepair,
  moveTicketStage,
  markTicketDiagnosisFailed,
  startWork
} from '../floorPipelineApi';
import {
  configBadges,
  isQcRole,
  canActAsDispatchQc,
  isTechnicianRole,
  priorityBadge,
  resolveTicketTtspl,
  resolveTicketSerial,
  ticketStatusLabel,
  ticketStatusBadgeClass,
} from '../floorPipelineUi';
import {
  canManageFloorTickets,
  canMoveDiagnosisToAssemblyForUser,
  canRunFloorStageRouting,
  isFloorTicketPrivileged,
} from '../floorPipelineAccess';
import StageTimeline from '../components/StageTimeline';
import WorkLogFeed from '../components/WorkLogFeed';
import QcChecklistPanel from '../components/QcChecklistPanel';
import ChipRepairPanel from '../components/ChipRepairPanel';
import BodyPaintPanel from '../components/BodyPaintPanel';
import PartsConfigPanel from '../components/PartsConfigPanel';
import WorkNotesPanel from '../components/WorkNotesPanel';
import StageTaskPanel from '../components/StageTaskPanel';
import AssignmentModal from '../components/AssignmentModal';
import Qc1ReworkAssignModal from '../components/Qc1ReworkAssignModal';
import HwReworkAssignModal from '../components/HwReworkAssignModal';
import Qc2InventoryTagModal from '../components/Qc2InventoryTagModal';
import TtsplHistoryDrawer from '../components/TtsplHistoryDrawer';
import useAutoRefresh from '../hooks/useAutoRefresh';

const HW_WORK_STAGES = ['Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint'];
const HW_SW_DIAGNOSIS_STAGES = ['Diagnosis', ...HW_WORK_STAGES];
// Stages where the assignee must scan/confirm the machine and run a work timer.
const TIMED_WORK_STAGES = ['Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint', 'QC1', 'QC2', 'Dispatch QC', 'Pending Inventory'];
const STAGE_TASK_STAGES = ['Assembly & Software', 'Final Testing'];

function fmtElapsed(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const listPath = '/floor-pipeline/tickets';
  const cameFromElsewhere = Boolean(location.state?.from);
  const { user, isAssignedDataOnly } = useAuth();
  const { canEdit } = usePermission();
  const canManageTickets = canManageFloorTickets(canEdit, isAssignedDataOnly);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [failReason, setFailReason] = useState('');
  const [repairReason, setRepairReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [configHistory, setConfigHistory] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [nextAssignee, setNextAssignee] = useState(null);
  const [nextAssigneeWarning, setNextAssigneeWarning] = useState(false);
  const [activeLog, setActiveLog] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [verifyInput, setVerifyInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [qcPickerOpen, setQcPickerOpen] = useState(false);
  const [qc2FailPickerOpen, setQc2FailPickerOpen] = useState(false);
  const [qc2FailConfirming, setQc2FailConfirming] = useState(false);
  const [qc1FailPickerOpen, setQc1FailPickerOpen] = useState(false);
  const [qc1FailConfirming, setQc1FailConfirming] = useState(false);
  const [qc2PassTagOpen, setQc2PassTagOpen] = useState(false);
  const [qcMembers, setQcMembers] = useState([]);
  const [chosenAssignee, setChosenAssignee] = useState('');

  const loadActiveLog = useCallback(async () => {
    try {
      const r = await getActiveWorkLog(id);
      setActiveLog(r.data?.active ? r.data.log : null);
    } catch {
      setActiveLog(null);
    }
  }, [id]);

  useEffect(() => { loadActiveLog(); }, [loadActiveLog]);

  // tick the on-screen timer once a second while a segment is open
  useEffect(() => {
    if (!activeLog) return undefined;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeLog]);

  const load = useCallback(async (opts = {}) => {
    const soft = opts === true || opts?.soft === true;
    if (!soft) setLoading(true);
    try {
      const { data: res } = await fetchTicketDetail(id);
      if (res.success) {
        setData(res);
        const ttspl = resolveTicketTtspl(res.ticket);
        if (ttspl) {
          try {
            const h = await fetchTtsplHistory(ttspl);
            if (h.data.success) {
              setConfigHistory(h.data.configHistory || []);
              setAuditLog(h.data.auditLog || []);
            }
          } catch {
            // History is optional on the detail page — do not block the ticket view.
          }
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load ticket');
    } finally {
      if (!soft) setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    // Soft refresh: do not flip loading / unmount tabs (file picker focus would wipe Parts form).
    load({ soft: true });
    loadActiveLog();
  }, [load, loadActiveLog]);
  useAutoRefresh(refresh);

  const privileged = isFloorTicketPrivileged(user, canEdit, isAssignedDataOnly);

  const reloadTicketHistory = useCallback(async (ttsplId) => {
    if (!ttsplId) return;
    const h = await fetchTtsplHistory(ttsplId);
    if (h.data.success) {
      setConfigHistory(h.data.configHistory || []);
      setAuditLog(h.data.auditLog || []);
    }
  }, []);

  const stage = data?.ticket?.stage_name;

  /** After QC submit / stage move: reload if user still has access, else return to list. */
  const handleWorkflowComplete = useCallback(async (meta = {}) => {
    const { nextStage } = meta;
    const prevStage = stage;
    const prevAssignedUserId = data?.ticket?.assigned_user_id;

    try {
      setLoading(true);
      const { data: res } = await fetchTicketDetail(id);
      if (!res.success) return;

      const stillMine = privileged
        || Number(res.ticket?.assigned_user_id) === Number(user?.user_id);
      const moved = prevStage && res.ticket?.stage_name !== prevStage;
      const sameUserContinuity = moved
        && Number(prevAssignedUserId) > 0
        && Number(prevAssignedUserId) === Number(res.ticket?.assigned_user_id)
        && Number(res.ticket?.assigned_user_id) === Number(user?.user_id);

      // Keep the user on this page when the next stage is still assigned to them.
      // Redirect only when ownership changed (or access is denied).
      if (!privileged && !stillMine) {
        toast.success(`Ticket moved to ${res.ticket?.stage_name || nextStage || 'next stage'}`);
        navigate('/floor-pipeline/tickets');
        return;
      }

      if (moved) {
        const assignMsg = meta.assignedUserName ? ` — assigned to ${meta.assignedUserName}` : '';
        toast.success(`Moved to ${res.ticket?.stage_name}${assignMsg}`);
      }

      setData(res);
      await reloadTicketHistory(resolveTicketTtspl(res.ticket));

      // Continuity safeguard:
      // if stage moved to another timed stage for the SAME user and the timer is not
      // running (rare race / backend miss), auto-start it to avoid verify blocking.
      if (sameUserContinuity && TIMED_WORK_STAGES.includes(res.ticket?.stage_name)) {
        try {
          const activeRes = await getActiveWorkLog(id);
          if (!activeRes.data?.active) {
            const verifyValue = resolveTicketTtspl(res.ticket) || res.ticket?.serial_number;
            if (verifyValue) {
              await startWork(id, String(verifyValue));
            }
          }
        } catch {
          // Non-fatal: if auto-start fails, user can still verify manually.
        }
      }

      await loadActiveLog();
    } catch (e) {
      if (e.response?.status === 403) {
        toast.success(nextStage ? `Ticket moved to ${nextStage}` : 'Ticket updated');
        navigate('/floor-pipeline/tickets');
        return;
      }
      toast.error(e.response?.data?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [id, stage, data?.ticket?.assigned_user_id, user?.user_id, privileged, navigate, reloadTicketHistory, loadActiveLog]);

  const ticket = data?.ticket;

  useEffect(() => {
    if (!ticket?.ticket_id) return;
    const currentStage = ticket.stage_name;
    if (currentStage === 'QC1') {
      const nextStage = ticket.ticket_type === 'sales_order_qc' ? 'Dispatch QC' : 'QC2';
      getNextAssignee(ticket.ticket_id, nextStage)
        .then((r) => {
          setNextAssignee(r.data?.assignee || null);
          setNextAssigneeWarning(!!r.data?.team_has_no_members);
        })
        .catch(() => {
          setNextAssignee(null);
          setNextAssigneeWarning(false);
        });
    } else if (currentStage === 'Final Testing') {
      getNextAssignee(ticket.ticket_id, 'QC1')
        .then((r) => {
          setNextAssignee(r.data?.assignee || null);
          setNextAssigneeWarning(!!r.data?.team_has_no_members);
        })
        .catch(() => {
          setNextAssignee(null);
          setNextAssigneeWarning(false);
        });
    } else {
      setNextAssignee(null);
      setNextAssigneeWarning(false);
    }
  }, [ticket?.ticket_id, ticket?.stage_name, ticket?.ticket_type]);
  const stageRouting = canRunFloorStageRouting(user, canEdit, isAssignedDataOnly);
  const canDiagnosisToAssembly = canMoveDiagnosisToAssemblyForUser(user, canEdit, isAssignedDataOnly);
  const tech = isTechnicianRole(user?.role);
  const qc = isQcRole(user?.role);
  const dqc = canActAsDispatchQc(user, canEdit);
  const isSuperAdmin = user?.role === 'super_admin';
  const canSeeStageRouting = canDiagnosisToAssembly || stageRouting;

  // The CURRENT stage's task is always the first tab so the assignee sees their
  // work first, then Overview / Work Log etc.
  const visibleTabs = useMemo(() => {
    const base = [
      { id: 'overview', label: 'Overview' },
      { id: 'worklog', label: 'Work Log' },
      { id: 'parts', label: 'Parts & Config' },
      { id: 'history', label: 'TTSPL History' }
    ];
    let taskTab = null;
    if (stage === 'Diagnosis') taskTab = { id: 'diagnosis', label: 'Diagnosis' };
    else if (STAGE_TASK_STAGES.includes(stage)) taskTab = { id: 'task', label: `${stage} Task` };
    else if (['QC1', 'QC2', 'Dispatch QC'].includes(stage)) taskTab = { id: 'qc', label: 'QC Checklist' };
    const tabs = taskTab ? [taskTab, ...base] : base;
    if (['Chip Level Repair', 'Body & Paint'].includes(stage)) tabs.push({ id: 'notes', label: 'Work Notes' });
    if (ticket?.chip_repair_required) tabs.push({ id: 'chip', label: 'Chip Repair' });
    if (ticket?.body_paint_required) tabs.push({ id: 'body', label: 'Body & Paint' });
    return tabs;
  }, [stage, ticket?.chip_repair_required, ticket?.body_paint_required]);

  const isAssignee = !!(ticket?.assigned_user_id && user?.user_id
    && Number(ticket.assigned_user_id) === Number(user.user_id));
  const needsStart = TIMED_WORK_STAGES.includes(stage) && isAssignee && !activeLog;
  const workTabsLocked = needsStart;
  const techCanSeeDiagnosisRepair = tech && isAssignee && HW_SW_DIAGNOSIS_STAGES.includes(stage);
  const canDiagnosisRepairMark = stageRouting || techCanSeeDiagnosisRepair;
  const repairReasonBody = () => {
    const trimmed = repairReason.trim();
    return trimmed ? { reason: trimmed, notes: trimmed } : {};
  };
  const runMarkChipRepair = () => markChipRepair(id, repairReasonBody())
    .then(() => handleWorkflowComplete({ nextStage: 'Chip Level Repair', fromStageMove: true }));
  const runMarkBodyPaint = () => markBodyPaint(id, repairReasonBody())
    .then(() => handleWorkflowComplete({ nextStage: 'Body & Paint', fromStageMove: true }));

  // Default to the stage's task tab whenever the stage changes (after verification).
  useEffect(() => {
    const s = ticket?.stage_name;
    if (!s || workTabsLocked) return;
    if (s === 'Diagnosis') setTab('diagnosis');
    else if (STAGE_TASK_STAGES.includes(s)) setTab('task');
    else if (['QC1', 'QC2', 'Dispatch QC'].includes(s)) setTab('qc');
    else setTab('overview');
  }, [ticket?.stage_name, workTabsLocked]);

  // For Hardware & Software stages the timer is one ongoing total across all
  // those stages (session_start_epoch), so it doesn't reset on each stage move.
  // Other stages fall back to the current segment's start time.
  const elapsedMs = activeLog?.session_start_epoch != null
    ? nowTs - Number(activeLog.session_start_epoch)
    : (activeLog?.start_time ? nowTs - new Date(activeLog.start_time).getTime() : 0);

  const handleStartWork = async () => {
    if (!verifyInput.trim()) { toast.error('Enter the TTSPL ID or Serial number'); return; }
    setStarting(true);
    try {
      const { data: res } = await startWork(id, verifyInput.trim());
      if (res.success) { toast.success(res.message); setVerifyInput(''); loadActiveLog(); }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not start work');
    } finally {
      setStarting(false);
    }
  };

  const openQcPicker = async () => {
    setChosenAssignee(nextAssignee?.user_id ? String(nextAssignee.user_id) : '');
    try {
      const r = await getTeamMembers('QC1 Team');
      setQcMembers(r.data?.members || r.data?.users || []);
    } catch {
      setQcMembers([]);
    }
    setQcPickerOpen(true);
  };

  const openQc2FailPicker = () => {
    if (!failReason.trim() || failReason.trim().length < 10) {
      toast.error('Reason required (min 10 characters) for fail actions');
      return;
    }
    setQc2FailPickerOpen(true);
  };

  const openQc1FailPicker = () => {
    if (!failReason.trim() || failReason.trim().length < 10) {
      toast.error('Reason required (min 10 characters) for fail actions');
      return;
    }
    setQc1FailPickerOpen(true);
  };

  const confirmQc2FailToQc1 = async (userId) => {
    setQc2FailConfirming(true);
    try {
      await move('QC1', failReason, userId);
    } finally {
      setQc2FailConfirming(false);
    }
  };

  const confirmQc1FailToAssembly = async (userId) => {
    setQc1FailConfirming(true);
    try {
      await move('Assembly & Software', failReason, userId);
    } finally {
      setQc1FailConfirming(false);
    }
  };

  const movingRef = useRef(false);
  const move = async (toStage, reason, assignedUserId, { minReasonLen = 10, bypassTransition = false, inventoryTag = null } = {}) => {
    if (reason !== undefined && (!reason || reason.trim().length < minReasonLen)) {
      toast.error(`Reason required (min ${minReasonLen} characters) for fail actions`);
      return;
    }
    // Guard against duplicate submissions (double-click / re-render): only one
    // move request in flight at a time.
    if (movingRef.current) return;
    movingRef.current = true;
    try {
      const payload = {
        to_stage_name: toStage, reason, notes: reason, assigned_user_id: assignedUserId,
      };
      if (inventoryTag) payload.inventory_tag = inventoryTag;
      if (bypassTransition) payload.bypass_transition = true;
      const { data: res } = await moveTicketStage(id, payload);
      if (res.success) {
        setQcPickerOpen(false);
        setQc2FailPickerOpen(false);
        setQc1FailPickerOpen(false);
        await handleWorkflowComplete({
          nextStage: toStage,
          fromStageMove: true,
          assignedUserName: res.assigned_user_name || null
        });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Move failed');
    } finally {
      movingRef.current = false;
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
        handleWorkflowComplete({ fromStageMove: true });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    }
  };

  const markDiagnosisFailed = async () => {
    const reason = repairReason.trim() || failReason.trim();
    if (!reason || reason.length < 5) {
      toast.error('Failure reason required (min 5 characters)');
      return;
    }
    if (!window.confirm('Mark as Diagnosis Failed? The ticket will be unassigned and sent to warehouse for vendor repair.')) return;
    try {
      const { data: res } = await markTicketDiagnosisFailed(id, { reason });
      if (res.success) {
        toast.success(res.message || 'Marked as Diagnosis Failed');
        navigate('/floor-pipeline/diagnosis-failed');
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

  if (loading && !data) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!ticket) return <p className="text-red-600">Ticket not found or you do not have access to view it.</p>;

  const pri = priorityBadge(ticket.priority);
  const stageButtons = [];

  if (canManageTickets && stage === 'Floor Manager') {
    stageButtons.push({ label: 'Assign to Technician', action: () => setAssignOpen(true), primary: true });
  }
  if (stage === 'Diagnosis') {
    if (canDiagnosisToAssembly) {
      stageButtons.push(
        { label: 'Move to Assembly & Software', action: () => move('Assembly & Software'), primary: true }
      );
    }
    if (canDiagnosisRepairMark) {
      stageButtons.push(
        {
          label: 'Mark Chip Repair Required',
          action: runMarkChipRepair,
          warn: true,
          disabled: needsStart
        },
        {
          label: 'Mark Body & Paint Required',
          action: runMarkBodyPaint,
          pink: true,
          disabled: needsStart
        },
        {
          label: 'Mark Diagnosis Failed',
          action: markDiagnosisFailed,
          danger: true,
          disabled: needsStart || ticket.status === 'diagnosis_failed'
        }
      );
    }
  }
  if (canDiagnosisRepairMark && HW_SW_DIAGNOSIS_STAGES.includes(stage) && stage !== 'Diagnosis') {
    stageButtons.push({
      label: 'Mark Diagnosis Failed',
      action: markDiagnosisFailed,
      danger: true,
      disabled: needsStart || ticket.status === 'diagnosis_failed' || ticket.status === 'out_for_repair',
    });
  }
  if (stageRouting && HW_WORK_STAGES.includes(stage)) {
    if (stage === 'Final Testing') {
      stageButtons.push({ label: 'Submit to QC1', action: openQcPicker, primary: true });
    } else {
      const next = stage === 'Assembly & Software' ? 'Final Testing' : 'Assembly & Software';
      stageButtons.push({ label: `Move to ${next}`, action: () => move(next), primary: true });
    }
  }
  if ((qc || canManageTickets) && stage === 'QC1') {
    const nextQcStage = ticket.ticket_type === 'sales_order_qc' ? 'Dispatch QC' : 'QC2';
    const nextLabel = ticket.ticket_type === 'sales_order_qc'
      ? 'QC1 PASS — Move to Dispatch QC'
      : 'QC1 PASS — Move to QC2';
    stageButtons.push(
      { label: nextLabel, action: () => move(nextQcStage), success: true },
      { label: 'QC1 FAIL — Send back', action: openQc1FailPicker, danger: true, needsReason: true }
    );
  }
  if ((qc || canManageTickets || dqc) && stage === 'Dispatch QC') {
    stageButtons.push(
      { label: 'DISPATCH QC PASS — Laptop Ready for DC', action: () => move('Inventory'), success: true },
      {
        label: 'DISPATCH QC FAIL — Remove from SO & send to Diagnosis',
        action: () => move('Diagnosis', failReason, undefined, { minReasonLen: 5 }),
        danger: true,
        needsReason: true
      }
    );
  }
  if (isSuperAdmin && stage === 'Dispatch QC') {
    stageButtons.push({
      label: 'Bypass — Mark Ready for DC',
      action: () => {
        if (!window.confirm('Bypass Dispatch QC transition rules and mark this laptop ready for DC?')) return;
        move('Inventory', undefined, undefined, { bypassTransition: true });
      },
      warn: true,
    });
  }
  if ((qc || canManageTickets) && stage === 'QC2') {
    stageButtons.push(
      { label: 'QC2 PASS — Move to Pending Inventory', action: () => setQc2PassTagOpen(true), success: true },
      { label: 'QC2 FAIL — Send back to QC1', action: openQc2FailPicker, danger: true, needsReason: true }
    );
  }
  if (canManageTickets) {
    stageButtons.push(
      { label: 'Reassign Technician', action: () => setAssignOpen(true), muted: true },
      { label: 'Force Fail — Return to Vendor', action: forceFail, destructive: true, needsReason: true }
    );
  }

  // Phase 16: when the ticket has open part requests, block stage progression.
  // Stage buttons are hidden entirely (not just disabled). Only reassign stays.
  const partsBlocked = (ticket.open_part_requests || 0) > 0;
  if (partsBlocked) {
    stageButtons.length = 0;
    if (canManageTickets) {
      stageButtons.push({ label: 'Reassign Technician', action: () => setAssignOpen(true), muted: true });
    }
  }

  const showVerifyBlock = needsStart;
  const showDiagnosisRepairMarks = stage === 'Diagnosis' && canDiagnosisRepairMark;
  const showOtherRouting = (canSeeStageRouting || qc || dqc)
    && (!needsStart || canSeeStageRouting)
    && stageButtons.some((b) => !b.label.startsWith('Mark '));
  const showRoutingButtons = showDiagnosisRepairMarks || showOtherRouting;
  const showStageActionsSection = showVerifyBlock || showRoutingButtons;
  const visibleStageButtons = stageButtons.filter((btn) => {
    const isMark = btn.label.startsWith('Mark ');
    if (isMark) return showDiagnosisRepairMarks;
    return showOtherRouting;
  });
  const showRepairReasonInput = showDiagnosisRepairMarks && techCanSeeDiagnosisRepair;

  return (
    <div className="pb-10">
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => (cameFromElsewhere ? navigate(-1) : navigate(listPath))}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back
          </button>
          <span className="text-slate-300">|</span>
          <span className="font-mono font-bold">#{ticket.ticket_id}</span>
          <span className="inline-flex items-baseline gap-1.5 font-mono">
            <span className="text-blue-700 font-semibold">{resolveTicketTtspl(ticket) || '—'}</span>
            {resolveTicketSerial(ticket) ? (
              <span className="text-slate-500 text-sm font-normal">({resolveTicketSerial(ticket)})</span>
            ) : null}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold">{stage}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pri.className}`}>{pri.label}</span>
          {ticket.ticket_type === 'sales_order_qc' ? (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
              Sales Order
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {configBadges(ticket).map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs"
            >
              <span className="text-slate-400 text-[10px] uppercase tracking-wide">{b.label}:</span>
              <span className="font-medium">{b.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0">
          {workTabsLocked ? (
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-8 text-center">
              <h3 className="font-semibold text-blue-900">Verify machine to unlock work tabs</h3>
              <p className="text-sm text-blue-800 mt-2 max-w-md mx-auto">
                Enter the TTSPL ID or Serial number in Stage Actions on the right, then click Start.
                Diagnosis, QC, and other work tabs will appear after verification.
              </p>
            </div>
          ) : (
          <>
          {partsBlocked && (
            <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <span className="text-lg">⛔</span>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Ticket blocked — {ticket.open_part_requests} part request(s) pending
                </p>
                <p className="text-xs text-amber-700">
                  Parts must be attached before moving to next stage.
                  <button type="button" onClick={() => setTab('parts')} className="ml-1 underline">View requests</button>
                </p>
              </div>
            </div>
          )}
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
                  <p><span className="text-slate-500">Status:</span>{' '}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ticketStatusBadgeClass(ticket.status)}`}>
                      {ticketStatusLabel(ticket.status)}
                    </span>
                  </p>
                  {ticket.current_location ? (
                    <p><span className="text-slate-500">Location:</span> {ticket.current_location}</p>
                  ) : null}
                  {ticket.vendor_repair_dc_number ? (
                    <p>
                      <span className="text-slate-500">Vendor DC:</span>{' '}
                      <Link to={`/floor-pipeline/vendor-repair-dc/${encodeURIComponent(ticket.vendor_repair_dc_number)}`} className="text-blue-600">
                        {ticket.vendor_repair_dc_number}
                      </Link>
                    </p>
                  ) : null}
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
                <StageTimeline currentStage={stage} ticket={ticket} />
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
              partRequests={data.part_requests}
              onUpdated={() => load({ soft: true })}
            />
          )}
          {tab === 'diagnosis' && (
            <DiagnosisForm
              api={api}
              ticket={ticket}
              onComplete={handleWorkflowComplete}
              showRepairRouting={canDiagnosisRepairMark && HW_SW_DIAGNOSIS_STAGES.includes(stage)}
              repairRoutingDisabled={needsStart}
              repairReason={repairReason}
              onRepairReasonChange={setRepairReason}
              onMarkChipRepair={runMarkChipRepair}
              onMarkBodyPaint={runMarkBodyPaint}
              onMarkDiagnosisFailed={canDiagnosisRepairMark ? markDiagnosisFailed : undefined}
              diagnosisFailedDisabled={needsStart || ticket.status === 'diagnosis_failed' || ticket.status === 'out_for_repair'}
            />
          )}
          {tab === 'task' && (
            <StageTaskPanel
              ticket={ticket}
              stageName={stage}
              onSubmitted={(meta) => {
                if (meta?.requestAssigneePicker) {
                  openQcPicker();
                  return;
                }
                handleWorkflowComplete(meta);
              }}
            />
          )}
          {tab === 'notes' && (
            <WorkNotesPanel
              ticketId={ticket.ticket_id}
              activities={data.activities}
              auditLog={auditLog}
              onLogged={load}
            />
          )}
          {tab === 'qc' && <QcChecklistPanel ticket={ticket} stageName={stage} onSubmitted={handleWorkflowComplete} />}
          {tab === 'chip' && (
            <ChipRepairPanel ticketId={ticket.ticket_id} partRequests={data.part_requests} ticketParts={data.parts} onUpdated={load} />
          )}
          {tab === 'body' && <BodyPaintPanel ticketId={ticket.ticket_id} onUpdated={load} />}
          {tab === 'history' && (
            <button type="button" onClick={() => setHistoryOpen(true)} className="text-blue-600 text-sm font-medium">
              Open full TTSPL history drawer
            </button>
          )}
          </>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm text-sm sticky top-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">TTSPL Info</h3>
            <div className="flex flex-col gap-1.5">
              <p className="font-mono font-bold text-blue-700 text-sm">{resolveTicketTtspl(ticket) || '—'}</p>
              <p className="text-xs text-slate-600">
                <span className="text-slate-400 uppercase tracking-wide text-[10px]">Serial:</span>{' '}
                <span className="font-mono font-semibold text-slate-800">{resolveTicketSerial(ticket) || '—'}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {configBadges(ticket).map((b, i) => (
                  <React.Fragment key={b.label}>
                    {i > 0 ? <span className="text-slate-300">·</span> : null}
                    <span className="text-xs text-slate-600">
                      <span className="text-slate-400">{b.label}:</span> {b.value}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">{ticket.initial_condition || ticket.condition || '—'}</p>

            <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-2">Current Assignment</h3>
            <p><span className="text-slate-500">Stage:</span> {stage}</p>
            <p><span className="text-slate-500">Team:</span> {ticket.team_name || '—'}</p>
            <p><span className="text-slate-500">Assigned:</span> {ticket.assigned_user_name || 'Unassigned'}</p>

            {activeLog ? (
              <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold">Work timer running</p>
                <p className="font-mono text-lg font-bold text-emerald-800">{fmtElapsed(elapsedMs)}</p>
              </div>
            ) : null}

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

            {showStageActionsSection ? (
              <>
                <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-2">Stage Actions</h3>
                {showVerifyBlock ? (
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 mb-3">
                    <h3 className="font-semibold text-blue-900 text-sm">Verify machine first</h3>
                    <p className="text-xs text-blue-800 mt-1">
                      Enter the TTSPL ID or Serial number to start your work timer.
                      Your work tabs will unlock after verification.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <input
                        value={verifyInput}
                        onChange={(e) => setVerifyInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleStartWork(); }}
                        placeholder="TTSPL ID or Serial number"
                        className="flex-1 border rounded-lg px-2 py-1.5 text-xs"
                        autoFocus
                      />
                      <button
                        type="button"
                        disabled={starting}
                        onClick={handleStartWork}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Start
                      </button>
                    </div>
                  </div>
                ) : null}
                {showRoutingButtons ? (
                  <>
                    {partsBlocked && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-amber-600 text-lg">⛔</span>
                          <p className="font-semibold text-amber-900 text-sm">
                            {ticket.open_part_requests} Part Request{ticket.open_part_requests !== 1 ? 's' : ''} Pending
                          </p>
                        </div>
                        <p className="text-xs text-amber-700">
                          Attach all requested parts before moving to the next stage.
                        </p>
                        <button
                          type="button"
                          onClick={() => setTab('parts')}
                          className="mt-2 w-full py-1.5 text-xs text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100"
                        >
                          View Part Requests →
                        </button>
                      </div>
                    )}
                    {showRepairReasonInput ? (
                      <textarea
                        className="w-full rounded-lg border text-xs p-2 min-h-[60px] mb-2"
                        placeholder="Reason for repair routing — e.g. GPU dead, lid damage…"
                        value={repairReason}
                        onChange={(e) => setRepairReason(e.target.value)}
                      />
                    ) : null}
                    {visibleStageButtons.some((b) => b.needsReason) ? (
                      <textarea
                        className="w-full rounded-lg border text-xs p-2 min-h-[60px] mb-2"
                        placeholder="Reason (required for fail actions) — e.g. RAM mismatch, dead pixel…"
                        value={failReason}
                        onChange={(e) => setFailReason(e.target.value)}
                      />
                    ) : null}
                    <div className="space-y-2">
                      {visibleStageButtons.map((btn) => (
                        <div key={btn.label}>
                          <button
                            type="button"
                            disabled={btn.disabled}
                            onClick={btn.action}
                            className={`w-full py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                              btn.blocked ? 'bg-amber-100 text-amber-800 border border-amber-300' :
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
                          {stage === 'QC1' && btn.label.includes('QC1 PASS') && nextAssignee ? (
                            <p className="text-xs text-slate-500 mt-1 text-center">
                              Will assign to:{' '}
                              <span className="font-medium text-slate-700">{nextAssignee.name}</span>
                            </p>
                          ) : null}
                          {stage === 'QC1' && btn.label.includes('QC1 PASS') && !nextAssignee && nextAssigneeWarning ? (
                            <p className="text-xs text-amber-600 mt-1 text-center">
                              {ticket.ticket_type === 'sales_order_qc' ? 'Dispatch QC' : 'QC2'} team has no members — ticket will be unassigned
                            </p>
                          ) : null}
                          {stage === 'Final Testing' && btn.label.includes('Move to QC1') && nextAssignee ? (
                            <p className="text-xs text-slate-500 mt-1 text-center">
                              Will assign to:{' '}
                              <span className="font-medium text-slate-700">{nextAssignee.name}</span>
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {STAGE_TASK_STAGES.includes(stage) ? (
                      <p className="text-xs text-slate-400 mt-2 text-center">
                        Complete the task checklist above, then click the move button to advance.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <AssignmentModal ticket={ticket} open={assignOpen} onClose={() => setAssignOpen(false)} onAssigned={load} />
      <Qc1ReworkAssignModal
        ticket={ticket}
        open={qc2FailPickerOpen}
        onClose={() => setQc2FailPickerOpen(false)}
        onConfirm={confirmQc2FailToQc1}
        confirming={qc2FailConfirming}
      />
      <HwReworkAssignModal
        ticket={ticket}
        open={qc1FailPickerOpen}
        onClose={() => setQc1FailPickerOpen(false)}
        onConfirm={confirmQc1FailToAssembly}
        confirming={qc1FailConfirming}
      />
      <Qc2InventoryTagModal
        open={qc2PassTagOpen}
        onClose={() => setQc2PassTagOpen(false)}
        onConfirm={(tag) => {
          setQc2PassTagOpen(false);
          move('Pending Inventory', undefined, undefined, { inventoryTag: tag });
        }}
        purchaseOrderType={ticket?.purchase_order_type}
        title="QC2 Pass — Inventory Tag"
      />
      <TtsplHistoryDrawer ttsplId={resolveTicketTtspl(ticket)} open={historyOpen} onClose={() => setHistoryOpen(false)} />

      {qcPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setQcPickerOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-sm w-full p-5 space-y-3">
            <h3 className="font-semibold text-slate-900">Submit to QC1 — assign to</h3>
            <p className="text-xs text-slate-500">Pick the QC1 inspector. The round-robin suggestion is pre-selected; change it if needed.</p>
            <select
              value={chosenAssignee}
              onChange={(e) => setChosenAssignee(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">(Auto — round-robin)</option>
              {qcMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}{nextAssignee && Number(nextAssignee.user_id) === Number(m.user_id) ? ' — suggested' : ''}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setQcPickerOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button
                type="button"
                onClick={() => move('QC1', undefined, chosenAssignee || undefined)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
              >
                Assign &amp; Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
