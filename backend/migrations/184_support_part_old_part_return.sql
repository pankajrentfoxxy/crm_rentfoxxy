-- ============================================================
-- Migration 184: Old/damaged part collection + Return Part DC (RPDC)
--   When sending replacement parts to customer, track collection of
--   the removed part via tech handover or courier pickup → RPDC → warehouse.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE support_part_requests
  ADD COLUMN IF NOT EXISTS collect_old_part BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS old_part_collection_method VARCHAR(30),
  ADD COLUMN IF NOT EXISTS old_part_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS old_part_condition VARCHAR(20),
  ADD COLUMN IF NOT EXISTS old_part_notes TEXT,
  ADD COLUMN IF NOT EXISTS old_part_serial VARCHAR(120),
  ADD COLUMN IF NOT EXISTS old_part_instance_id INT REFERENCES part_instances(instance_id),
  ADD COLUMN IF NOT EXISTS return_part_dc_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS old_part_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS old_part_received_at TIMESTAMPTZ;

ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_old_part_collection_method_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_old_part_collection_method_check
  CHECK (old_part_collection_method IS NULL OR old_part_collection_method IN ('tech_collection', 'courier_pickup'));

ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_old_part_status_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_old_part_status_check
  CHECK (old_part_status IN (
    'not_applicable', 'pending', 'with_tech', 'courier_requested',
    'courier_in_transit', 'rpdc_submitted', 'received_wh'
  ));

ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_old_part_condition_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_old_part_condition_check
  CHECK (old_part_condition IS NULL OR old_part_condition IN ('good', 'defective', 'worn'));

CREATE INDEX IF NOT EXISTS idx_spr_old_part_status ON support_part_requests(old_part_status);
CREATE INDEX IF NOT EXISTS idx_spr_return_part_dc ON support_part_requests(return_part_dc_number);

-- Return Part DC sequence (RPDC/26-27/NNNN)
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('part_rpdc_rentfoxxy', 0, 'RPDC-')
ON CONFLICT (doc_type) DO NOTHING;

-- Link old part instances back to support part request
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS origin_support_part_request_id INT REFERENCES support_part_requests(id);

CREATE INDEX IF NOT EXISTS idx_pi_origin_spr ON part_instances(origin_support_part_request_id);
