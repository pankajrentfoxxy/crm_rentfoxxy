-- ============================================================
-- Migration: 093_return_dc_flow.sql
-- Lets a customer-return pickup ride the SAME delivery machinery as outbound
-- DCs: a Return DC is a delivery_challan_lines row tagged movement_type='return'
-- and linked to its support pickup ticket. Customer-chosen pickup location is
-- stored on the support ticket.
-- ============================================================
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS movement_type     VARCHAR(10) NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS support_ticket_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_challan_lines_movement_type_check'
  ) THEN
    ALTER TABLE delivery_challan_lines
      ADD CONSTRAINT delivery_challan_lines_movement_type_check
      CHECK (movement_type IN ('outbound', 'return'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dcl_movement ON delivery_challan_lines(movement_type);
CREATE INDEX IF NOT EXISTS idx_dcl_support_ticket ON delivery_challan_lines(support_ticket_id);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS pickup_address JSONB;

COMMENT ON COLUMN delivery_challan_lines.movement_type IS 'outbound = delivery to customer; return = pickup from customer (Return DC)';
