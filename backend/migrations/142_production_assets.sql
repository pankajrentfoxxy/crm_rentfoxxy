-- Production Asset (mutable working copy) + Pending Inventory stage.
-- Additive / idempotent — does not alter GRN tables.

CREATE TABLE IF NOT EXISTS production_assets (
  production_asset_id  SERIAL PRIMARY KEY,
  ticket_id            INT,
  grn_id               INT,
  grn_line_id          INT,
  po_id                INT,
  serial_number        VARCHAR(120),
  ttspl_id             VARCHAR(60),
  vendor_serial_id     INT,
  brand                VARCHAR(120),
  model                VARCHAR(160),
  processor            VARCHAR(160),
  generation           VARCHAR(80),
  ram                  VARCHAR(80),
  ssd                  VARCHAR(80),
  gpu                  VARCHAR(120),
  screen_size          VARCHAR(60),
  grn_config           JSONB,
  status               VARCHAR(40) NOT NULL DEFAULT 'in_production',
  qc1_checklist        JSONB,
  qc2_verification     JSONB,
  qc2_completed_by     INT,
  qc2_completed_at     TIMESTAMPTZ,
  received_by          INT,
  received_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_asset_grn ON production_assets(grn_id);
CREATE INDEX IF NOT EXISTS idx_prod_asset_serial ON production_assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_prod_asset_ttspl ON production_assets(ttspl_id);
CREATE INDEX IF NOT EXISTS idx_prod_asset_ticket ON production_assets(ticket_id);
CREATE INDEX IF NOT EXISTS idx_prod_asset_vendor_serial ON production_assets(vendor_serial_id);
CREATE INDEX IF NOT EXISTS idx_prod_asset_status ON production_assets(status);

CREATE TABLE IF NOT EXISTS production_asset_changes (
  change_id           SERIAL PRIMARY KEY,
  production_asset_id INT NOT NULL REFERENCES production_assets(production_asset_id) ON DELETE CASCADE,
  field               VARCHAR(40) NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  changed_by          INT,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_name          VARCHAR(80)
);

CREATE INDEX IF NOT EXISTS idx_prod_asset_changes_asset
  ON production_asset_changes(production_asset_id);

-- Pending Inventory stage (between QC2 and Inventory)
DO $$
DECLARE
  qc2_order INT;
  inv_team INT;
BEGIN
  SELECT stage_order INTO qc2_order FROM stages WHERE stage_name = 'QC2' ORDER BY stage_order LIMIT 1;
  SELECT team_id INTO inv_team FROM stages WHERE stage_name = 'Inventory' ORDER BY stage_order LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Pending Inventory') THEN
    INSERT INTO stages (stage_name, stage_order, team_id, stage_category, description)
    VALUES (
      'Pending Inventory',
      COALESCE(qc2_order, 10) + 1,
      inv_team,
      'QC Team',
      'QC2 passed — awaiting serial-verified receive into inventory'
    );
    -- Shift Inventory (and later) down if needed so order stays coherent
    UPDATE stages
       SET stage_order = stage_order + 1
     WHERE stage_name = 'Inventory'
       AND stage_order <= COALESCE(qc2_order, 10) + 1;
  END IF;
END $$;

-- Transition rules: QC2 → Pending Inventory
INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT 'QC2', 'Pending Inventory', 'qc2_passed', FALSE, 'QC2 passed — pending inventory receive'
WHERE NOT EXISTS (
  SELECT 1 FROM stage_transition_rules
   WHERE from_stage_name = 'QC2' AND to_stage_name = 'Pending Inventory'
);

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT 'Pending Inventory', 'Inventory', 'inventory_received', FALSE, 'Serial-verified receive into inventory'
WHERE NOT EXISTS (
  SELECT 1 FROM stage_transition_rules
   WHERE from_stage_name = 'Pending Inventory' AND to_stage_name = 'Inventory'
);

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT 'Pending Inventory', 'QC2', 'receive_rejected', TRUE, 'Receive blocked — return to QC2'
WHERE NOT EXISTS (
  SELECT 1 FROM stage_transition_rules
   WHERE from_stage_name = 'Pending Inventory' AND to_stage_name = 'QC2'
);
