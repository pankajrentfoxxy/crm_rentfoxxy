-- Sales in-app follow-up reminders (dedupe / dismiss / snooze).
-- Unique on (lead_id, user_id, follow_up_at) so a reschedule creates a new reminder.

CREATE TABLE IF NOT EXISTS lead_followup_in_app_reminders (
  id              SERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  follow_up_at    TIMESTAMPTZ NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'shown',
  snooze_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_followup_in_app_reminders_unique
    UNIQUE (lead_id, user_id, follow_up_at)
);

CREATE INDEX IF NOT EXISTS idx_lead_followup_in_app_user
  ON lead_followup_in_app_reminders (user_id, status);
