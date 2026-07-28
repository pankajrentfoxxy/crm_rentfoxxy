-- 177: Laptop condition (On / Not On / Part Missing) across PO -> GRN -> floor ticket.
--
-- Refurbished laptops arrive in mixed states. The PO line declares which
-- conditions the buyer expects; GRN records the condition actually received per
-- unit, plus the missing part categories when applicable. Floor tickets carry
-- the same data so technicians know what to raise part requests for.

-- PO line: which conditions the receiver may pick at GRN time.
ALTER TABLE vendor_product_details
  ADD COLUMN IF NOT EXISTS allowed_conditions JSONB NOT NULL DEFAULT '["on"]'::jsonb;

-- GRN received unit: actual condition + missing part categories.
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS received_condition VARCHAR(20) NOT NULL DEFAULT 'on',
  ADD COLUMN IF NOT EXISTS missing_parts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE vendor_serial_numbers
  DROP CONSTRAINT IF EXISTS vendor_serial_numbers_received_condition_check;
ALTER TABLE vendor_serial_numbers
  ADD CONSTRAINT vendor_serial_numbers_received_condition_check
  CHECK (received_condition IN ('on', 'not_on', 'part_missing'));

-- Floor ticket: mirrored so the technician sees it without extra joins.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS received_condition VARCHAR(20),
  ADD COLUMN IF NOT EXISTS missing_parts JSONB;

-- Production asset (working copy) keeps the same intake facts.
ALTER TABLE production_assets
  ADD COLUMN IF NOT EXISTS received_condition VARCHAR(20),
  ADD COLUMN IF NOT EXISTS missing_parts JSONB;

CREATE INDEX IF NOT EXISTS idx_vsn_received_condition
  ON vendor_serial_numbers (received_condition)
  WHERE received_condition <> 'on';

CREATE INDEX IF NOT EXISTS idx_tickets_received_condition
  ON tickets (received_condition)
  WHERE received_condition IS NOT NULL AND received_condition <> 'on';

-- Everything received before this feature was a powered-on unit.
UPDATE vendor_serial_numbers SET received_condition = 'on' WHERE received_condition IS NULL;
UPDATE vendor_product_details
   SET allowed_conditions = '["on"]'::jsonb
 WHERE allowed_conditions IS NULL
    OR jsonb_typeof(allowed_conditions) <> 'array'
    OR jsonb_array_length(allowed_conditions) = 0;
