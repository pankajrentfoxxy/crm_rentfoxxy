-- ============================================================
-- Migration 207: Support revamp — return pickup
--   Prompt said 201; 201 is core. Next free number is 207.
-- Idempotent. Does not rewrite the WO engine.
-- ============================================================

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS site_id INT,
  ADD COLUMN IF NOT EXISTS requires_eway_bill BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_stop_date DATE;

-- bulk_group_id already exists as VARCHAR(40) on support_work_orders (201).
-- Keep it. Do not change the type. UUID strings fit in VARCHAR(40).
CREATE INDEX IF NOT EXISTS idx_wo_bulk ON support_work_orders(bulk_group_id)
  WHERE bulk_group_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_wo_site_customer_address'
  ) THEN
    ALTER TABLE support_work_orders
      ADD CONSTRAINT fk_wo_site_customer_address
      FOREIGN KEY (site_id) REFERENCES customer_addresses(customer_address_id);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS support_asset_condition (
  condition_id     SERIAL PRIMARY KEY,
  wo_id            INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  line_id          INT REFERENCES support_ticket_assets(line_id),
  serial_id        INT NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  grade            CHAR(1) NOT NULL CHECK (grade IN ('A','B','C','D')),
  damage_items     JSONB NOT NULL DEFAULT '[]',
  accessories      JSONB NOT NULL DEFAULT '{}',
  missing_items    JSONB NOT NULL DEFAULT '[]',
  chargeable_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  assessed_by      INT REFERENCES users(user_id),
  assessed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes            TEXT,
  photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  UNIQUE (wo_id, serial_id)
);

CREATE TABLE IF NOT EXISTS support_accessory_catalog (
  accessory_id SERIAL PRIMARY KEY,
  code    VARCHAR(24) NOT NULL UNIQUE,
  name    VARCHAR(80) NOT NULL,
  charge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO support_accessory_catalog (code, name, charge_amount) VALUES
  ('ADAPTER','Power adapter',2400), ('BAG','Laptop bag',900),
  ('MOUSE','Mouse',450), ('KEYBOARD','External keyboard',1200),
  ('DOCK','Docking station',6500), ('SLEEVE','Sleeve',400)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_damage_catalog (
  damage_id SERIAL PRIMARY KEY,
  code    VARCHAR(40) NOT NULL UNIQUE,
  name    VARCHAR(80) NOT NULL,
  charge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO support_damage_catalog (code, name, charge_amount) VALUES
  ('CRACKED_SCREEN','Cracked screen',8500),
  ('BROKEN_HINGE','Broken hinge',3200),
  ('DENT','Dent',800),
  ('DEEP_SCRATCH','Deep scratch',400),
  ('WORN_KEYS','Worn keys',1500),
  ('LIQUID','Liquid damage',6000),
  ('MISSING_KEY','Missing key',200),
  ('NON_FUNCTIONAL','Non-functional',0)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE customer_credit_notes
  ADD COLUMN IF NOT EXISTS wo_id INT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_serial_wo
  ON customer_credit_notes(serial_id, wo_id)
  WHERE serial_id IS NOT NULL AND wo_id IS NOT NULL;

ALTER TABLE customer_invoice_extra_lines
  ADD COLUMN IF NOT EXISTS wo_id INT,
  ADD COLUMN IF NOT EXISTS serial_id INT,
  ADD COLUMN IF NOT EXISTS approval_id INT;
