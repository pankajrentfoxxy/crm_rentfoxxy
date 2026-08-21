-- ============================================================
-- Migration 220: Per-asset steps, courier step sets, OTP lifecycle (D10–D12).
-- Idempotent.
-- ============================================================

ALTER TABLE support_work_order_steps
  ADD COLUMN IF NOT EXISTS line_id INT REFERENCES support_ticket_assets(line_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS serial_id INT,
  ADD COLUMN IF NOT EXISTS asset_seq INT NOT NULL DEFAULT 0;

ALTER TABLE support_work_order_type_config
  ADD COLUMN IF NOT EXISTS per_asset BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS method_scope VARCHAR(20),
  ADD COLUMN IF NOT EXISTS help_text TEXT,
  ADD COLUMN IF NOT EXISTS offline_safe BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE support_work_order_type_config SET per_asset = TRUE
 WHERE step_code IN ('SERIAL_SCAN','PHOTO_CONDITION','ACCESSORIES','GRADE','PART_SCAN','DIAGNOSIS');
UPDATE support_work_order_type_config SET offline_safe = FALSE
 WHERE step_code IN ('CUSTOMER_OTP','WH_RECEIPT');

ALTER TABLE support_work_order_steps DROP CONSTRAINT IF EXISTS support_work_order_steps_wo_id_step_code_key;
DROP INDEX IF EXISTS support_work_order_steps_wo_id_step_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_step_asset
  ON support_work_order_steps (wo_id, step_code, (COALESCE(line_id, 0)));

INSERT INTO support_work_order_type_config
  (wo_type, step_code, step_label, step_kind, is_mandatory, min_count, sort_order, per_asset, method_scope, help_text)
VALUES
  ('REPAIR_PICKUP','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER','Enter the AWB after booking the pickup.'),
  ('REPAIR_PICKUP','PACKED_PHOTO','Packed-parcel photos','PHOTO',true,2,25,true,'COURIER','Photograph the packed box and the label.'),
  ('REPAIR_PICKUP','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,35,false,'COURIER',NULL),
  ('REPAIR_PICKUP','POD_UPLOAD','Proof of delivery','PHOTO',true,1,85,false,'COURIER','Upload the courier POD or delivery screenshot.'),
  ('RETURN_PICKUP','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('RETURN_PICKUP','PACKED_PHOTO','Packed-parcel photos','PHOTO',true,2,25,true,'COURIER',NULL),
  ('RETURN_PICKUP','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,35,false,'COURIER',NULL),
  ('RETURN_PICKUP','POD_UPLOAD','Proof of delivery','PHOTO',true,1,85,false,'COURIER',NULL),
  ('SERVICE_RETURN','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('SERVICE_RETURN','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,25,false,'COURIER',NULL),
  ('SERVICE_RETURN','POD_UPLOAD','Proof of delivery','PHOTO',true,1,60,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,15,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','COURIER_HANDOVER','Handed to courier','CONFIRM',true,1,25,false,'COURIER',NULL),
  ('REPLACEMENT_DELIVERY','POD_UPLOAD','Proof of delivery','PHOTO',true,1,70,false,'COURIER',NULL),
  ('PART_DELIVERY','AWB_BOOKED','Courier booked — AWB captured','FORM',true,1,5,false,'COURIER',NULL),
  ('PART_DELIVERY','POD_UPLOAD','Proof of delivery','PHOTO',true,1,50,false,'COURIER',NULL)
ON CONFLICT (wo_type, step_code) DO UPDATE
  SET step_label = EXCLUDED.step_label, step_kind = EXCLUDED.step_kind,
      is_mandatory = EXCLUDED.is_mandatory, min_count = EXCLUDED.min_count,
      sort_order = EXCLUDED.sort_order, per_asset = EXCLUDED.per_asset,
      method_scope = EXCLUDED.method_scope, help_text = EXCLUDED.help_text;

UPDATE support_work_order_type_config SET method_scope = 'TECHNICIAN'
 WHERE step_code IN ('ON_SITE_GPS','CUSTOMER_OTP','TECH_ESIGN','ACCESSORIES');

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_sent_to VARCHAR(20),
  ADD COLUMN IF NOT EXISTS otp_send_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_bypassed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otp_bypass_approval_id INT REFERENCES support_approvals(approval_id),
  ADD COLUMN IF NOT EXISTS custody_user_id INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS custody_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_number VARCHAR(30);

CREATE TABLE IF NOT EXISTS support_otp_audit (
  audit_id    SERIAL PRIMARY KEY,
  wo_id       INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL CHECK (action IN ('SENT','RESENT','REVEALED','BYPASS_REQUESTED','BYPASS_APPROVED','VERIFIED','FAILED')),
  actor_id    INT REFERENCES users(user_id),
  channel     VARCHAR(12),
  recipient   VARCHAR(120),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_audit_wo ON support_otp_audit(wo_id);

ALTER TABLE support_approvals DROP CONSTRAINT IF EXISTS support_approvals_approval_type_check;
ALTER TABLE support_approvals ADD CONSTRAINT support_approvals_approval_type_check
  CHECK (approval_type IN (
    'REPLACEMENT','DAMAGE_CHARGE','CHARGEABLE_PART','PART_VALUE','EARLY_TERMINATION',
    'RATE_CHANGE','SLA_WAIVER','PRIORITY_OVERRIDE','OTP_BYPASS','SITE_OVERRIDE','BER_WRITE_OFF'));
