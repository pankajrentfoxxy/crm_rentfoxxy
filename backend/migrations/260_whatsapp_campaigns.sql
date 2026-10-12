-- 260_whatsapp_campaigns.sql
-- Bulk WhatsApp template campaigns sent through Interakt.
--
-- whatsapp_campaigns           one row per campaign; counters are recomputed from contacts
-- whatsapp_campaign_imports    one row per uploaded file (import history)
-- whatsapp_campaign_contacts   every imported row, valid or not, plus its send state
--
-- Contacts double as the send queue: the worker claims status='QUEUED' rows and moves
-- each one QUEUED -> SENDING -> SENT|FAILED with a compare-and-set UPDATE, so a contact is
-- never sent twice. Invalid and duplicate rows are kept (status SKIPPED) so they can be
-- reviewed and downloaded instead of being dropped.
--
-- Additive and idempotent. Permissions: no role gets these by default; super_admin always
-- has them. Grant from Roles & Permissions.

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  template_name       VARCHAR(120) NOT NULL,
  language_code       VARCHAR(20)  NOT NULL DEFAULT 'en',
  header_media_url    TEXT,
  -- [{ "source": "column", "key": "name" } | { "source": "static", "value": "..." }]
  -- index i is template variable {{i+1}}.
  body_variables      JSONB NOT NULL DEFAULT '[{"source":"column","key":"name"}]'::jsonb,
  -- Template body as approved in Interakt, used only for the in-CRM preview.
  preview_body        TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  total_contacts      INTEGER NOT NULL DEFAULT 0,
  valid_contacts      INTEGER NOT NULL DEFAULT 0,
  invalid_contacts    INTEGER NOT NULL DEFAULT 0,
  duplicate_contacts  INTEGER NOT NULL DEFAULT 0,
  queued_count        INTEGER NOT NULL DEFAULT 0,
  sent_count          INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  delivered_count     INTEGER NOT NULL DEFAULT 0,
  read_count          INTEGER NOT NULL DEFAULT 0,
  skipped_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  created_by          INTEGER REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  paused_at           TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  CONSTRAINT whatsapp_campaigns_status_check CHECK (status IN (
    'DRAFT', 'READY', 'QUEUED', 'PROCESSING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_status
  ON whatsapp_campaigns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_campaign_imports (
  id              SERIAL PRIMARY KEY,
  campaign_id     INTEGER NOT NULL REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
  file_name       VARCHAR(255) NOT NULL,
  file_size       INTEGER,
  total_rows      INTEGER NOT NULL DEFAULT 0,
  valid_rows      INTEGER NOT NULL DEFAULT 0,
  invalid_rows    INTEGER NOT NULL DEFAULT 0,
  duplicate_rows  INTEGER NOT NULL DEFAULT 0,
  empty_rows      INTEGER NOT NULL DEFAULT 0,
  -- Detected columns: [{ "key": "ordernumber", "label": "OrderNumber" }]
  columns         JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by     INTEGER REFERENCES users(user_id),
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_imports_campaign
  ON whatsapp_campaign_imports (campaign_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_campaign_contacts (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         INTEGER NOT NULL REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
  import_id           INTEGER REFERENCES whatsapp_campaign_imports(id) ON DELETE SET NULL,
  row_number          INTEGER,
  name                VARCHAR(200),
  country_code        VARCHAR(8),
  phone_number        VARCHAR(20),
  original_mobile     VARCHAR(100),
  -- Every column of the source row (sanitised), keyed by normalised header.
  variables           JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_status   VARCHAR(20) NOT NULL DEFAULT 'valid',
  validation_error    TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  message_id          VARCHAR(120),
  error_message       TEXT,
  error_code          VARCHAR(60),
  http_status         INTEGER,
  provider_response   JSONB,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ,
  sending_started_at  TIMESTAMPTZ,
  last_attempt_at     TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_campaign_contacts_validation_check CHECK (validation_status IN ('valid', 'invalid', 'duplicate')),
  CONSTRAINT whatsapp_campaign_contacts_status_check CHECK (status IN (
    'PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'
  ))
);

-- One sendable row per number per campaign: the database itself refuses a second copy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_campaign_contacts_phone
  ON whatsapp_campaign_contacts (campaign_id, country_code, phone_number)
  WHERE validation_status = 'valid';

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_contacts_queue
  ON whatsapp_campaign_contacts (campaign_id, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_contacts_sending
  ON whatsapp_campaign_contacts (sending_started_at)
  WHERE status = 'SENDING';

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_contacts_message
  ON whatsapp_campaign_contacts (message_id)
  WHERE message_id IS NOT NULL;

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('whatsapp_campaigns',        'WhatsApp Campaigns — view / create / edit / delete drafts', 180),
  ('whatsapp_campaigns_start',  'WhatsApp Campaigns — start and resume sending (Edit)',      181),
  ('whatsapp_campaigns_pause',  'WhatsApp Campaigns — pause sending (Edit)',                 182),
  ('whatsapp_campaigns_cancel', 'WhatsApp Campaigns — cancel a campaign (Edit)',             183)
ON CONFLICT (section) DO NOTHING;
