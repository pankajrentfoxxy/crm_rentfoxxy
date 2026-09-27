-- 353: laptop scrap = request → manager approval → Scrap Challan to a buyer
-- with a sale value (claude/carret-stock.md, ST-D2).
--
-- Laptops had no scrap document at all: Asset Movement "dead" set scrapped
-- with no approval and no record of who or why (121 of 129 on QA), and the
-- Scrap Challan carried spare parts only.

CREATE TABLE IF NOT EXISTS laptop_scrap_requests (
  id              SERIAL PRIMARY KEY,
  serial_id       INTEGER NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  asset_code      VARCHAR(100),
  from_status     VARCHAR(40),
  reason          TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by    INTEGER,
  decided_by      INTEGER,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_laptop_scrap_requests_status ON laptop_scrap_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_laptop_scrap_request_open
  ON laptop_scrap_requests(serial_id) WHERE status = 'pending';

-- A scrap challan line is a part OR a laptop, with what the buyer pays for it.
ALTER TABLE scrap_challan_items ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE scrap_challan_items
  ADD COLUMN IF NOT EXISTS serial_id INTEGER REFERENCES vendor_serial_numbers(serial_id),
  ADD COLUMN IF NOT EXISTS item_kind VARCHAR(10) NOT NULL DEFAULT 'part',
  ADD COLUMN IF NOT EXISTS sale_value NUMERIC(12,2);
ALTER TABLE scrap_challan_items DROP CONSTRAINT IF EXISTS scrap_challan_items_kind_check;
ALTER TABLE scrap_challan_items ADD CONSTRAINT scrap_challan_items_kind_check
  CHECK ((item_kind = 'part' AND instance_id IS NOT NULL) OR (item_kind = 'laptop' AND serial_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_scrap_items_laptop
  ON scrap_challan_items(challan_number, serial_id) WHERE serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scrap_items_serial ON scrap_challan_items(serial_id);

ALTER TABLE scrap_challans
  ADD COLUMN IF NOT EXISTS sale_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INTEGER,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS scrap_challan_number VARCHAR(64);

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('scrap_approval', 'Stock — approve laptop scrap', 262)
ON CONFLICT (section) DO NOTHING;

-- Never overwrite an existing grant (RBAC is live data).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('super_admin', 'scrap_approval', true, true, true, false),
  ('admin',       'scrap_approval', true, true, true, false),
  ('manager',     'scrap_approval', true, true, true, false)
ON CONFLICT (role, section) DO NOTHING;
