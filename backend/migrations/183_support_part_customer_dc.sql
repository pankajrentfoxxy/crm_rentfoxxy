-- ============================================================
-- Migration 183: Support Part Customer DC (courier to customer)
--   - Send warranty/replacement parts directly to customer site
--   - Part DC (PDC) with SO tag, billing/warranty tracking
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Extend support_part_requests
ALTER TABLE support_part_requests
  ADD COLUMN IF NOT EXISTS fulfillment_mode VARCHAR(30) NOT NULL DEFAULT 'warehouse_handover',
  ADD COLUMN IF NOT EXISTS billing_type VARCHAR(30) NOT NULL DEFAULT 'under_warranty',
  ADD COLUMN IF NOT EXISTS charge_amount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tampered_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_order_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS customer_dc_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS internal_unit_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Relax status check to include courier lifecycle states
ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_status_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_status_check
  CHECK (status IN (
    'pending', 'approved', 'challan_generated', 'issued', 'dispatched', 'delivered',
    'used', 'return_requested', 'returned', 'rejected', 'cancelled'
  ));

ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_fulfillment_mode_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_fulfillment_mode_check
  CHECK (fulfillment_mode IN ('warehouse_handover', 'courier_to_customer'));

ALTER TABLE support_part_requests DROP CONSTRAINT IF EXISTS support_part_requests_billing_type_check;
ALTER TABLE support_part_requests ADD CONSTRAINT support_part_requests_billing_type_check
  CHECK (billing_type IN ('under_warranty', 'charge_customer'));

CREATE INDEX IF NOT EXISTS idx_spr_fulfillment ON support_part_requests(fulfillment_mode);
CREATE INDEX IF NOT EXISTS idx_spr_customer_dc ON support_part_requests(customer_dc_number);

-- 2. Part instances: allow in_transit for courier dispatch
ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock', 'reserved', 'in_transit', 'installed', 'defective',
    'returned', 'discarded', 'sold', 'with_technician'
  ));

-- 3. Document sequence for Part DC (PDC/26-27/NNNN)
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('part_dc_rentfoxxy', 0, 'PDC-')
ON CONFLICT (doc_type) DO NOTHING;

-- 4. Internal costing ledger: part attached to laptop for warranty service
CREATE TABLE IF NOT EXISTS support_part_laptop_costs (
  id                    SERIAL PRIMARY KEY,
  support_part_request_id INT NOT NULL REFERENCES support_part_requests(id),
  support_ticket_id     INT NOT NULL REFERENCES support_tickets(id),
  ttspl_id              VARCHAR(120),
  serial_number         VARCHAR(255),
  sales_order_number    VARCHAR(120),
  part_id               INT NOT NULL REFERENCES parts(part_id),
  part_name             VARCHAR(255),
  prt_id                VARCHAR(30),
  instance_id           INT REFERENCES part_instances(instance_id),
  unit_cost             NUMERIC(10,2) NOT NULL DEFAULT 0,
  billing_type          VARCHAR(30) NOT NULL DEFAULT 'under_warranty',
  charge_amount         NUMERIC(10,2) DEFAULT 0,
  customer_dc_number    VARCHAR(120),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_splc_ticket ON support_part_laptop_costs(support_ticket_id);
CREATE INDEX IF NOT EXISTS idx_splc_ttspl ON support_part_laptop_costs(ttspl_id);
CREATE INDEX IF NOT EXISTS idx_splc_so ON support_part_laptop_costs(sales_order_number);
