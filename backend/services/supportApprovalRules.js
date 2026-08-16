'use strict';

const FALLBACK_MANAGER_THRESHOLD = 10000;

async function resolveApproverRole(db, approvalType, amount) {
  try {
    const r = await db.query(
      `SELECT approver_role, blocks
         FROM support_approval_rules
        WHERE active = TRUE
          AND approval_type = $1
          AND COALESCE(min_amount, 0) <= $2
        ORDER BY COALESCE(min_amount, 0) DESC
        LIMIT 1`,
      [approvalType, Number(amount) || 0]
    );
    if (r.rows[0]) return r.rows[0];
  } catch (e) {
    if (!/does not exist/i.test(e.message || '')) throw e;
  }
  const fallback = Number(amount) > FALLBACK_MANAGER_THRESHOLD ? 'support_manager' : 'support_lead';
  return { approver_role: fallback, blocks: true };
}

async function pickApproverForType(db, approvalType, amount) {
  const rule = await resolveApproverRole(db, approvalType, amount);
  const r = await db.query(
    `SELECT user_id FROM users WHERE role = $1 ORDER BY user_id LIMIT 1`,
    [rule.approver_role]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

function waitHours(createdAt, now = new Date()) {
  return (new Date(now).getTime() - new Date(createdAt).getTime()) / 3600000;
}

function approvalOverdue(row, now = new Date()) {
  if (!row || String(row.status) !== 'PENDING') return false;
  const hours = waitHours(row.created_at, now);
  if (Number(row.priority) === 1) return hours >= 4;
  return hours >= 8;
}

module.exports = {
  resolveApproverRole,
  pickApproverForType,
  waitHours,
  approvalOverdue,
};
