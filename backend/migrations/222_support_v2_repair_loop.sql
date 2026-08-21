-- ============================================================
-- Migration 222: Floor ticket support context + repair TAT (D14–D16).
-- Idempotent.
-- ============================================================

ALTER TABLE support_notification_templates DROP CONSTRAINT IF EXISTS support_notification_templates_channel_check;
ALTER TABLE support_notification_templates ADD CONSTRAINT support_notification_templates_channel_check
  CHECK (channel IN ('EMAIL','WHATSAPP','PUSH','INAPP','SMS'));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS support_ticket_id INT,
  ADD COLUMN IF NOT EXISTS support_wo_id INT,
  ADD COLUMN IF NOT EXISTS support_line_id INT,
  ADD COLUMN IF NOT EXISTS support_origin VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_owned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS support_customer_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS support_reported_issue TEXT,
  ADD COLUMN IF NOT EXISTS support_field_diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS support_photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS support_target_tat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS support_notified_ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_support_ticket ON tickets(support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_customer_owned ON tickets(customer_owned)
  WHERE customer_owned = TRUE;

ALTER TABLE support_tickets_v2 DROP CONSTRAINT IF EXISTS support_tickets_v2_pending_reason_check;
ALTER TABLE support_tickets_v2 ADD CONSTRAINT support_tickets_v2_pending_reason_check
  CHECK (pending_reason IS NULL OR pending_reason IN (
    'PENDING_CUSTOMER','PENDING_PART','PENDING_APPROVAL','PENDING_VENDOR',
    'AT_REPAIR_CENTRE','IN_TRANSIT','PENDING_SCHEDULE'));

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS repair_tat_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_tat_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_tat_ended_at TIMESTAMPTZ;

INSERT INTO support_notification_templates (event_code, channel, audience, subject, body, active)
SELECT v.event_code, v.channel, v.audience, v.subject, v.body, v.active
  FROM (VALUES
  ('OTP_SENT_CUSTOMER','WHATSAPP','CUSTOMER',
    'Rentfoxxy handover code',
    'Your Rentfoxxy handover code is {{otp}}. Share it with our engineer {{assignee_name}} only after you have handed over / received the laptop. Valid 15 minutes.', TRUE),
  ('OTP_BYPASS_REQUESTED','INAPP','LEAD',
    'OTP bypass requested — {{wo_number}}',
    '{{assignee_name}} cannot get the OTP for {{wo_number}} ({{customer_name}}). Reason: {{reason}}.', TRUE),
  ('WAREHOUSE_RECEIVED','INAPP','LEAD',
    'Received at warehouse — {{ticket_number}}',
    '{{ttspl_id}} received against {{wo_number}}. Floor ticket {{floor_ticket_id}} created.', TRUE),
  ('REPAIR_READY_FOR_DISPATCH','INAPP','LEAD',
    'Ready for dispatch — {{ttspl_id}}',
    '{{ttspl_id}} ({{customer_name}}, ticket {{ticket_number}}) has cleared the floor and is ready to go back. A draft service return is waiting.', TRUE),
  ('REPAIR_READY_FOR_DISPATCH','EMAIL','LEAD',
    'Ready for dispatch — {{ttspl_id}}',
    '{{ttspl_id}} for {{customer_name}} is repaired and QC-passed. Support ticket {{ticket_number}}. Draft work order {{wo_number}} is ready to schedule.', TRUE),
  ('CUSTODY_AGEING','INAPP','LEAD',
    'Machine still with technician — {{wo_number}}',
    '{{ttspl_id}} was picked up {{days}} day(s) ago by {{assignee_name}} and has not reached the warehouse.', TRUE),
  ('ASSET_BER','INAPP','LEAD',
    'Beyond economic repair — {{ttspl_id}}',
    'The floor has marked {{ttspl_id}} BER. {{customer_name}} needs a replacement, not a return.', TRUE)
) AS v(event_code, channel, audience, subject, body, active)
WHERE NOT EXISTS (
  SELECT 1 FROM support_notification_templates t
   WHERE t.event_code = v.event_code AND t.channel = v.channel AND t.audience = v.audience);
