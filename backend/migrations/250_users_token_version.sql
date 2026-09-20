-- Session revocation for CRM users.
--
-- authMiddleware verified the JWT signature and trusted its claims; there was no
-- DB read, no session store and no blacklist. With a 30-day token lifetime that
-- meant deactivating a user, demoting them, or revoking a permission took up to
-- 30 days to take effect — a fired employee kept working access for a month.
--
-- token_version is bumped whenever access should be cut, and authMiddleware
-- rejects any token carrying an older value. Existing tokens carry no version
-- claim, so starting everyone at 1 invalidates them: every user signs in once.
--
-- Additive and idempotent.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

-- Cheap lookup on the hot auth path (one indexed read per request).
CREATE INDEX IF NOT EXISTS idx_users_token_version ON public.users (user_id, token_version);
