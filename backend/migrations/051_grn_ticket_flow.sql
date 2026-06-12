-- Link repair tickets created from GRN receive to vendor_serial_numbers.
-- When such a ticket completes (Inventory stage), vendor QC is auto-marked passed.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS vendor_serial_id INT REFERENCES vendor_serial_numbers (serial_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_vendor_serial_id ON tickets (vendor_serial_id) WHERE vendor_serial_id IS NOT NULL;
