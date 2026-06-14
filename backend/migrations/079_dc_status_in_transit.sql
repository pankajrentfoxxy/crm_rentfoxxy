-- ============================================================
-- Migration: 079_dc_status_in_transit.sql
-- Fix: delivery_challan_lines status CHECK omitted 'in_transit',
-- but storeDeliveryChallan (and the dispatch/delivery flow) set and
-- read status='in_transit'. Without this, creating a DC crashes.
-- Adds 'in_transit' to the allowed set and aligns seeded DCs.
-- ============================================================
ALTER TABLE delivery_challan_lines DROP CONSTRAINT IF EXISTS delivery_challan_lines_status_check;
ALTER TABLE delivery_challan_lines ADD CONSTRAINT delivery_challan_lines_status_check
  CHECK (status IN ('pending','shipped','processing','in_transit','delivered','rejected','cancelled'));

-- Align seeded dispatched DC to the canonical dispatched status the app uses
UPDATE delivery_challan_lines SET status = 'in_transit' WHERE status = 'shipped';
