-- ============================================================
-- Migration 208: Support revamp — replacement pairing
--   Prompt said 202; 202 is groups. Next free number is 208.
-- Idempotent. Does not rewrite the WO engine.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_replacements (
  replacement_id      SERIAL PRIMARY KEY,
  replacement_group_id VARCHAR(40) NOT NULL,
  ticket_id           INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_id             INT NOT NULL REFERENCES support_ticket_assets(line_id) ON DELETE CASCADE,
  reason              VARCHAR(30) NOT NULL
                        CHECK (reason IN ('FAULTY_IRREPARABLE','REPAIR_TOO_LONG','UPGRADE_DOWNGRADE',
                                          'WRONG_UNIT_DELIVERED','RESEND_AFTER_RETURN')),
  old_serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  new_serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  old_rate            NUMERIC(12,2),
  new_rate            NUMERIC(12,2),
  rate_change         BOOLEAN NOT NULL DEFAULT FALSE,
  config_match_score  SMALLINT,
  source              VARCHAR(20) NOT NULL DEFAULT 'FREE_STOCK'
                        CHECK (source IN ('FREE_STOCK','BUFFER_ON_SITE','NEW_PROCUREMENT')),
  sales_order_line_id INT,
  delivery_wo_id      INT REFERENCES support_work_orders(wo_id),
  collect_wo_id       INT REFERENCES support_work_orders(wo_id),
  collect_waived      BOOLEAN NOT NULL DEFAULT FALSE,
  collect_waived_reason VARCHAR(200),
  data_transfer       VARCHAR(24)
                        CHECK (data_transfer IS NULL OR data_transfer IN
                          ('NOT_REQUIRED','DONE_ON_SITE','CUSTOMER_WILL_DO','BACKUP_TAKEN')),
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                        CHECK (status IN ('PENDING_APPROVAL','APPROVED','SCHEDULED','DELIVERED',
                                          'COMPLETED','CANCELLED')),
  created_by          INT REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repl_group  ON support_replacements(replacement_group_id);
CREATE INDEX IF NOT EXISTS idx_repl_ticket ON support_replacements(ticket_id);

INSERT INTO support_work_order_type_config
  (wo_type, step_code, step_label, step_kind, is_mandatory, min_count, sort_order)
VALUES
  ('REPLACEMENT_DELIVERY','DATA_TRANSFER','Data transfer','FORM', true, 1, 45)
ON CONFLICT (wo_type, step_code) DO UPDATE
  SET step_label = EXCLUDED.step_label, step_kind = EXCLUDED.step_kind,
      is_mandatory = EXCLUDED.is_mandatory, min_count = EXCLUDED.min_count,
      sort_order = EXCLUDED.sort_order;
