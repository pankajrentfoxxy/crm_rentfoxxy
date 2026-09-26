-- Lead follow-ups with outcomes (claude/carret-lead.md; user's decision 26 Sep 2026).
-- The lead keeps one "next follow-up" (leads.follow_up_date / follow_up_time);
-- each finished follow-up is kept here with what happened and when the next is.
CREATE TABLE IF NOT EXISTS lead_follow_up_log (
  id             SERIAL PRIMARY KEY,
  lead_id        INTEGER NOT NULL REFERENCES leads (lead_id) ON DELETE CASCADE,
  due_at         TIMESTAMPTZ,
  outcome        VARCHAR(30) NOT NULL
                   CHECK (outcome IN ('spoke', 'no_answer', 'call_back', 'not_interested', 'meeting_done')),
  notes          TEXT,
  next_due_date  DATE,
  next_due_time  TIME,
  done_by        INTEGER REFERENCES users (user_id),
  done_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_follow_up_log_lead ON lead_follow_up_log (lead_id, done_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_follow_up_log_done_by ON lead_follow_up_log (done_by, done_at DESC);
