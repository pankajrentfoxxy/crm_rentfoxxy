-- 434: Customer upgrades on a support ticket (16 Oct 2026).
--
-- support_upgrades — one per request:
--   kind 'laptop' — a better laptop: replacement order at the new rent, the old
--                   one comes back on a return pickup (replacement flow)
--   kind 'parts'  — RAM and/or SSD sent to the customer and fitted; nothing
--                   comes back. Applying it updates the laptop's configuration
--                   and rent.
-- rent_rate_changes — a dated monthly-rent change per laptop. The new rent
--   applies from the next billing period (no proration; user decision 16 Oct).
--   Postpaid billing reads it ahead of the last invoiced rate; prepaid reads
--   vendor_serial_numbers.rent_monthly_rate, which applying also updates.
-- Additive only.

CREATE TABLE IF NOT EXISTS support_upgrades (
  upgrade_id            SERIAL PRIMARY KEY,
  ticket_id             INT NOT NULL,
  item_id               INT NOT NULL,
  serial_id             INT,
  customer_id           INT,
  kind                  VARCHAR(10) NOT NULL CHECK (kind IN ('laptop', 'parts')),
  old_config            JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_config            JSONB NOT NULL DEFAULT '{}'::jsonb,
  old_rate              NUMERIC(12,2),
  new_rate              NUMERIC(12,2) NOT NULL,
  status                VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'ordered', 'cancelled')),
  effective_from        DATE,
  replacement_order_id  INT,
  notes                 TEXT,
  created_by            INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by            INT,
  applied_at            TIMESTAMPTZ,
  cancelled_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_upgrades_ticket ON support_upgrades (ticket_id);

CREATE TABLE IF NOT EXISTS rent_rate_changes (
  change_id       SERIAL PRIMARY KEY,
  serial_id       INT NOT NULL,
  customer_id     INT NOT NULL,
  old_rate        NUMERIC(12,2),
  new_rate        NUMERIC(12,2) NOT NULL,
  effective_from  DATE NOT NULL,
  reason          TEXT,
  source          VARCHAR(30),
  upgrade_id      INT,
  created_by      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rent_rate_changes_serial ON rent_rate_changes (serial_id, effective_from DESC);
