-- 361: indexes for the Control → Audit log screen (filters by action and actor).
-- permission_audit_logs already has (created_at DESC) and (target_type, target_id)
-- from 040. Idempotent; schema only; no data touched. Not replayed at boot.

CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_action
  ON public.permission_audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_actor
  ON public.permission_audit_logs (actor_user_id, created_at DESC);
