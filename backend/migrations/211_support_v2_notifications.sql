-- Phase 10 — SLA escalation, notifications, CSAT, approval rules
-- Prompt asked for 205_support_v2_notifications.sql; 205 is ticket flow. This is 211.

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS escalation_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_fired JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pause_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS csat_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dashboard_pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS acceptance_alert_fired BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_stk2_breach_reason_values'
  ) THEN
    ALTER TABLE support_tickets_v2
      ADD CONSTRAINT chk_stk2_breach_reason_values CHECK (
        breach_reason IS NULL OR breach_reason IN (
          'PART_UNAVAILABLE','TECHNICIAN_UNAVAILABLE','CUSTOMER_UNAVAILABLE',
          'SITE_ACCESS','VENDOR_DELAY','WRONGLY_PRIORITISED','VOLUME_SPIKE','OTHER'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_breach_reason_on_close'
  ) THEN
    ALTER TABLE support_tickets_v2
      ADD CONSTRAINT chk_breach_reason_on_close CHECK (
        NOT (status = 'CLOSED' AND sla_resolution_breached = true AND breach_reason IS NULL)
      );
  END IF;
END $$;

ALTER TABLE customer_invoice_extra_lines
  DROP CONSTRAINT IF EXISTS customer_invoice_extra_lines_status_check;
ALTER TABLE customer_invoice_extra_lines
  ADD CONSTRAINT customer_invoice_extra_lines_status_check
  CHECK (status IN ('PENDING','APPROVED','REJECTED','WAIVED','BILLED','DISPUTED'));

CREATE TABLE IF NOT EXISTS support_notification_templates (
  template_id SERIAL PRIMARY KEY,
  event_code  VARCHAR(48) NOT NULL,
  channel     VARCHAR(12) NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','PUSH','INAPP')),
  audience    VARCHAR(24) NOT NULL CHECK (audience IN
                ('CUSTOMER','ASSIGNEE','LEAD','MANAGER','OPS_HEAD','WAREHOUSE','ACCOUNTS','BUSINESS_HEAD')),
  subject     VARCHAR(200),
  body        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_notif_tpl
  ON support_notification_templates(event_code, channel, audience);

CREATE TABLE IF NOT EXISTS support_notification_log (
  log_id      BIGSERIAL PRIMARY KEY,
  ticket_id   INT REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  wo_id       INT REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  event_code  VARCHAR(48) NOT NULL,
  channel     VARCHAR(12) NOT NULL,
  audience    VARCHAR(24) NOT NULL,
  recipient   VARCHAR(200) NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_ticket ON support_notification_log(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_csat_tokens (
  token       VARCHAR(64) PRIMARY KEY,
  ticket_id   INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_csat_token_ticket ON support_csat_tokens(ticket_id);

CREATE TABLE IF NOT EXISTS support_approval_rules (
  rule_id        SERIAL PRIMARY KEY,
  approval_type  VARCHAR(40) NOT NULL,
  min_amount     NUMERIC(12,2),
  approver_role  VARCHAR(40) NOT NULL,
  blocks         BOOLEAN NOT NULL DEFAULT TRUE,
  active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS support_settings_v2 (
  setting_key   VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO support_settings_v2 (setting_key, setting_value) VALUES
  ('auto_close_hours', '48'),
  ('reopen_window_days', '7'),
  ('csat_token_days', '14')
ON CONFLICT (setting_key) DO NOTHING;

-- PLAN §17 reconstructed: most-specific (highest min_amount the amount clears) wins.
INSERT INTO support_approval_rules (approval_type, min_amount, approver_role, blocks, active)
SELECT v.approval_type, v.min_amount, v.approver_role, v.blocks, TRUE
  FROM (VALUES
    ('DAMAGE_CHARGE',      10000::numeric, 'support_manager', TRUE),
    ('DAMAGE_CHARGE',      0,              'support_lead',    TRUE),
    ('CHARGEABLE_PART',    10000,          'support_manager', TRUE),
    ('CHARGEABLE_PART',    0,              'support_lead',    TRUE),
    ('PART_VALUE',         40000,          'support_manager', TRUE),
    ('PART_VALUE',         0,              'support_lead',    TRUE),
    ('REPLACEMENT',        40000,          'support_manager', TRUE),
    ('REPLACEMENT',        0,              'support_lead',    TRUE),
    ('EARLY_TERMINATION',  0,              'support_lead',    TRUE),
    ('RATE_CHANGE',        0,              'support_manager', TRUE),
    ('SLA_WAIVER',         0,              'support_manager', TRUE),
    ('PRIORITY_OVERRIDE',  0,              'support_lead',    TRUE)
  ) AS v(approval_type, min_amount, approver_role, blocks)
 WHERE NOT EXISTS (
   SELECT 1 FROM support_approval_rules r
    WHERE r.approval_type = v.approval_type
      AND COALESCE(r.min_amount, 0) = COALESCE(v.min_amount, 0)
      AND r.approver_role = v.approver_role
 );

-- PLAN §18 — operational matrix. Editing a row changes the next send.
INSERT INTO support_notification_templates (event_code, channel, audience, subject, body, active)
SELECT v.event_code, v.channel, v.audience, v.subject, v.body, TRUE
  FROM (VALUES
    ('SLA_ESCALATION_1', 'INAPP', 'ASSIGNEE',
      'SLA 50% — {{ticket_number}}',
      'Ticket {{ticket_number}} for {{customer_name}} is at 50% of the resolution clock. Due {{due_at}}.'),
    ('SLA_ESCALATION_2', 'INAPP', 'ASSIGNEE',
      'SLA 75% — {{ticket_number}}',
      'Ticket {{ticket_number}} is at 75% of the resolution clock. Due {{due_at}}.'),
    ('SLA_ESCALATION_2', 'EMAIL', 'LEAD',
      'SLA 75% — {{ticket_number}}',
      'Ticket {{ticket_number}} ({{customer_name}}) is at 75% of resolution SLA. Assignee: {{assignee_name}}. Due {{due_at}}.'),
    ('SLA_ESCALATION_2', 'PUSH', 'LEAD',
      'SLA 75% — {{ticket_number}}',
      '{{ticket_number}} at 75% of resolution SLA.'),
    ('SLA_ESCALATION_3', 'INAPP', 'LEAD',
      'SLA breached — {{ticket_number}}',
      'Resolution SLA breached for {{ticket_number}} ({{customer_name}}). Over by {{over_by}}.'),
    ('SLA_ESCALATION_3', 'EMAIL', 'MANAGER',
      'SLA breached — {{ticket_number}}',
      'Resolution SLA breached for {{ticket_number}} ({{customer_name}}). Over by {{over_by}}. Reason still needed on close.'),
    ('SLA_ESCALATION_4', 'EMAIL', 'MANAGER',
      'SLA 125% — {{ticket_number}}',
      '{{ticket_number}} is 25% past the resolution due. Customer {{customer_name}}.'),
    ('SLA_ESCALATION_4', 'INAPP', 'OPS_HEAD',
      'SLA 125% — {{ticket_number}}',
      '{{ticket_number}} is 25% past due.'),
    ('SLA_ESCALATION_5', 'EMAIL', 'OPS_HEAD',
      'SLA 150% — {{ticket_number}}',
      '{{ticket_number}} is 50% past due and is pinned on the manager dashboard.'),
    ('SLA_ESCALATION_5', 'EMAIL', 'BUSINESS_HEAD',
      'SLA 150% — {{ticket_number}}',
      '{{ticket_number}} ({{customer_name}}) is 50% past the resolution SLA.'),
    ('SLA_RESPONSE_BREACH', 'INAPP', 'LEAD',
      'Response SLA breached — {{ticket_number}}',
      'First response clock breached for {{ticket_number}}.'),
    ('WO_UNACCEPTED', 'INAPP', 'LEAD',
      'WO not accepted — {{wo_number}}',
      'Work order {{wo_number}} on {{ticket_number}} is not accepted and the slot starts at {{slot_start}}.'),
    ('TECHNICIAN_ASSIGNED', 'EMAIL', 'CUSTOMER',
      'Technician assigned — {{ticket_number}}',
      '{{tech_name}} will visit for ticket {{ticket_number}}. Phone {{tech_phone}}. Window {{eta}}.'),
    ('TECHNICIAN_ASSIGNED', 'WHATSAPP', 'CUSTOMER',
      NULL,
      'Hi {{customer_name}}, {{tech_name}} ({{tech_phone}}) is assigned to {{ticket_number}}. Expected window: {{eta}}.'),
    ('TECHNICIAN_EN_ROUTE', 'WHATSAPP', 'CUSTOMER',
      NULL,
      '{{tech_name}} is on the way for {{ticket_number}}. Live ETA: {{eta}}.'),
    ('TECHNICIAN_EN_ROUTE', 'EMAIL', 'CUSTOMER',
      'Technician en route — {{ticket_number}}',
      '{{tech_name}} is on the way. Live ETA: {{eta}}.'),
    ('TICKET_RESOLVED', 'EMAIL', 'CUSTOMER',
      'Resolved — {{ticket_number}}',
      'We have resolved {{ticket_number}}. {{resolution_summary}} Rate this visit: {{csat_link}}'),
    ('TICKET_RESOLVED', 'WHATSAPP', 'CUSTOMER',
      NULL,
      '{{ticket_number}} is resolved. {{resolution_summary}} Tell us how we did: {{csat_link}}'),
    ('CSAT_LOW', 'INAPP', 'MANAGER',
      'Low CSAT — {{ticket_number}}',
      '{{ticket_number}} scored {{csat_score}}/5. {{csat_comment}}'),
    ('PAUSE_ABUSE', 'INAPP', 'LEAD',
      'Third pause — {{ticket_number}}',
      '{{ticket_number}} has been paused three times in a row. Review the contact attempts.'),
    ('QUALITY_REOPEN', 'INAPP', 'LEAD',
      'Second reopen — {{ticket_number}}',
      '{{ticket_number}} has been reopened twice. It is on the quality report.'),
    ('CHARGE_DISPUTED', 'INAPP', 'ACCOUNTS',
      'Charge disputed — {{ticket_number}}',
      'Customer disputed a charge of ₹{{amount}} on {{ticket_number}}: {{reason}}')
  ) AS v(event_code, channel, audience, subject, body)
 WHERE NOT EXISTS (
   SELECT 1 FROM support_notification_templates t
    WHERE t.event_code = v.event_code AND t.channel = v.channel AND t.audience = v.audience
 );
