/**
 * Part 5.4 (findings R4–R8) — one QC failure routine.
 *
 * A QC2 failure had two entry points that behaved differently:
 *
 *   moveToStage  recorded qc2_failed_at, qc2_fail_reason, the highlight and its
 *                reason, and demanded a QC1 technician — but never touched
 *                qc_fail_count, so the rework counter only ever counted QC1.
 *   submitQC     recorded nothing at all. No reason, no assignee, no timestamp,
 *                no count. The same business event, through the other door,
 *                left no trace.
 *
 * So the two doors disagreed about what a QC2 failure even is. This module is
 * the answer to "what does a QC failure record", and both doors ask it.
 *
 * It also bounds the loop (R6). qc_fail_count was incremented and never read,
 * so QC1 <-> Assembly and QC2 <-> QC1 could cycle indefinitely. At the third
 * failure the ticket stops going round and goes to the floor manager instead,
 * with the escalation recorded on the row.
 */

/** Three strikes. The third failure escalates instead of looping. */
const ESCALATE_AT = 3;

/** Where a failure sends the ticket when it is not escalating. */
const REWORK_STAGE = {
  QC1: 'Assembly & Software',
  QC2: 'QC1',
  'Dispatch QC': 'Assembly & Software',
  'Final Testing': 'Assembly & Software',
};

const ESCALATION_STAGE = 'Floor Manager';

function normalizeReason(raw, stage) {
  const reason = String(raw || '').trim();
  return reason || `${stage} checklist failed`;
}

/**
 * Work out everything a QC failure implies, without writing anything.
 *
 * Returns the columns to set (as $1-based fragments for applyStageMove's
 * extraSets/extraParams), the stage the ticket should move to, and whether this
 * failure is the one that escalates.
 *
 * `currentFailCount` is the count BEFORE this failure.
 */
function buildQcFailure({ stage, reason, currentFailCount = 0, assignedUserId = null }) {
  const stageName = String(stage || '').trim();
  const reworkStage = REWORK_STAGE[stageName];
  if (!reworkStage) {
    const err = new Error(`No failure route is defined for stage "${stageName}"`);
    err.status = 400;
    throw err;
  }

  const failReason = normalizeReason(reason, stageName).slice(0, 2000);
  const nextCount = Number(currentFailCount || 0) + 1;
  const escalated = nextCount >= ESCALATE_AT;

  const sets = [];
  const params = [];
  const push = (fragment, value) => {
    sets.push(fragment.replace('?', `$${params.length + 1}`));
    params.push(value);
  };

  push('qc_fail_count = ?', nextCount);

  // The per-stage timestamp and reason. Dispatch QC and Final Testing reuse the
  // QC1 pair rather than growing two more columns for the same fact; the stage
  // is in the event and in the highlight text.
  if (stageName === 'QC2') {
    sets.push('qc2_failed_at = NOW()');
    push('qc2_fail_reason = ?', failReason);
  } else {
    sets.push('qc1_failed_at = NOW()');
    push('qc1_fail_reason = ?', failReason);
  }

  const highlightedReason = escalated
    ? `${stageName} failed ${nextCount} times — escalated: ${failReason}`
    : `${stageName} failed: ${failReason}`;
  sets.push('highlighted = TRUE');
  push('highlighted_reason = ?', highlightedReason.slice(0, 500));

  if (escalated) {
    sets.push('qc_escalated_at = NOW()');
    push('qc_escalation_reason = ?', highlightedReason.slice(0, 2000));
    sets.push(`priority = 'high'`);
  }

  return {
    stage: stageName,
    failReason,
    failCount: nextCount,
    escalated,
    // An escalating ticket goes to the floor manager, not round the loop again,
    // and nobody is pre-assigned to it — the floor manager decides.
    toStageName: escalated ? ESCALATION_STAGE : reworkStage,
    conditionHint: escalated ? 'qc_escalated' : conditionFor(stageName),
    assignedUserId: escalated ? null : assignedUserId,
    highlightedReason,
    sets,
    params,
  };
}

function conditionFor(stageName) {
  switch (stageName) {
    case 'QC1': return 'qc1_failed';
    case 'QC2': return 'qc2_failed';
    case 'Dispatch QC': return 'dispatch_qc_failed';
    case 'Final Testing': return 'final_test_failed';
    default: return null;
  }
}

/** The TTSPL audit event type each stage's failure writes. Unchanged names, so
 *  existing timelines stay readable. */
function auditEventType(stageName) {
  return stageName === 'QC2' ? 'qc2_failed' : 'qc1_failed';
}

module.exports = {
  ESCALATE_AT,
  ESCALATION_STAGE,
  REWORK_STAGE,
  buildQcFailure,
  conditionFor,
  auditEventType,
};
