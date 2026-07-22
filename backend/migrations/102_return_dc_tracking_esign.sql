-- Phase 22: Return DC tracking + technician e-sign.
--
-- 1) Track the originating outbound DC on the return line so we can trace a unit
--    end-to-end: shipped on <original_dc_number> (sales_order_number) and
--    received back on <return_dc / dc_number>. (sales_order_number and pdf_path
--    already exist on delivery_challan_lines.)
ALTER TABLE delivery_challan_lines
    ADD COLUMN IF NOT EXISTS original_dc_number VARCHAR(50);

-- 2) Technician e-signature captured BEFORE pickup (the technician signs the
--    Return DC at the customer site). The warehouse e-sign on receipt already
--    lives on support_ticket_items (warehouse_esign_url).
ALTER TABLE support_ticket_items
    ADD COLUMN IF NOT EXISTS technician_esign_url TEXT,
    ADD COLUMN IF NOT EXISTS technician_esign_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS technician_esign_by INTEGER;
