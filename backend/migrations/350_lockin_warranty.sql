-- 350: per-laptop lock-in and warranty dates, early-return requests, and
-- out-of-warranty service charges (claude/carret-lockin-warranty.md).
--
-- Lock-in and warranty were only months on the SO line, so nothing knew when a
-- laptop's lock-in ended, a replacement started a fresh one, and a sold laptop
-- was never out of warranty. The dates now live on the laptop; a replacement
-- carries the old laptop's dates instead of starting new ones.

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS lock_in_start_date DATE,
  ADD COLUMN IF NOT EXISTS lock_in_end_date DATE,
  ADD COLUMN IF NOT EXISTS warranty_start_date DATE,
  ADD COLUMN IF NOT EXISTS warranty_end_date DATE,
  ADD COLUMN IF NOT EXISTS battery_warranty_end_date DATE;

ALTER TABLE support_replacement_orders
  ADD COLUMN IF NOT EXISTS old_lock_in_end_date DATE,
  ADD COLUMN IF NOT EXISTS old_warranty_end_date DATE,
  ADD COLUMN IF NOT EXISTS old_battery_warranty_end_date DATE;

-- in | out | battery_only, stamped on a sold laptop's ticket line.
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS warranty_status VARCHAR(20);

-- Early return before lock-in ends: Support raises, Sales proposes, Accounts decides.
CREATE TABLE IF NOT EXISTS lock_in_break_requests (
  id                  SERIAL PRIMARY KEY,
  serial_id           INTEGER NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  customer_id         INTEGER NOT NULL,
  support_ticket_id   INTEGER,
  support_request_id  INTEGER,
  asset_code          VARCHAR(100),
  lock_in_end_date    DATE NOT NULL,
  planned_return_date DATE NOT NULL,
  remaining_days      INTEGER NOT NULL,
  monthly_rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
  full_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason              TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending_sales'
                        CHECK (status IN ('pending_sales','pending_accounts','approved','rejected','cancelled','used')),
  proposal            VARCHAR(20) CHECK (proposal IN ('full','negotiated','waive')),
  proposed_amount     NUMERIC(12,2),
  sales_note          TEXT,
  proposed_by         INTEGER,
  proposed_at         TIMESTAMPTZ,
  approved_amount     NUMERIC(12,2),
  accounts_note       TEXT,
  decided_by          INTEGER,
  decided_at          TIMESTAMPTZ,
  charge_line_id      INTEGER,
  used_at             TIMESTAMPTZ,
  used_on_dc_number   VARCHAR(50),
  requested_by        INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lock_in_break_serial ON lock_in_break_requests(serial_id, status);
CREATE INDEX IF NOT EXISTS idx_lock_in_break_status ON lock_in_break_requests(status);
-- One live request per laptop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lock_in_break_open
  ON lock_in_break_requests(serial_id)
  WHERE status IN ('pending_sales','pending_accounts','approved');

-- Out-of-warranty service on a sold (gorefurbo) laptop: charges collect on the
-- ticket, Accounts approve, and approved ones are billed on a service SO.
CREATE TABLE IF NOT EXISTS support_service_charges (
  id                  SERIAL PRIMARY KEY,
  ticket_id           INTEGER NOT NULL,
  ticket_item_id      INTEGER,
  serial_id           INTEGER,
  customer_id         INTEGER NOT NULL,
  charge_kind         VARCHAR(20) NOT NULL DEFAULT 'service'
                        CHECK (charge_kind IN ('service','part','delivery')),
  source_part_request_id INTEGER,
  description         TEXT NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  unit_price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_rate            NUMERIC(5,2) NOT NULL DEFAULT 18,
  hsn_code            VARCHAR(20),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','billed')),
  added_by            INTEGER,
  decided_by          INTEGER,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT,
  sales_order_number  VARCHAR(50),
  billed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_service_charges_ticket ON support_service_charges(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_service_charges_status ON support_service_charges(status, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_service_charges_part
  ON support_service_charges(source_part_request_id) WHERE source_part_request_id IS NOT NULL;
