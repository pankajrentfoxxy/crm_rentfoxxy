-- Service Delivery Challan (SDC) — return repaired unit to customer without new SO
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS service_dc_number VARCHAR(64);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS service_dc_number VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_sti_service_dc ON support_ticket_items (service_dc_number);

INSERT INTO sm_document_sequences (doc_type, prefix, last_value)
VALUES ('service_dc', 'SDC', 0)
ON CONFLICT (doc_type) DO NOTHING;
