-- 430: Charger with / without, per laptop, on every laptop challan (16 Oct 2026).
--
-- One row per challan + laptop + stage:
--   dispatch  — DC, Replacement DC, Service DC, Repair DC (VRDC): did a charger go with it
--   collected — Return DC pickup: did the customer hand the charger back
--   warehouse — Return DC warehouse receive: charger scanned in, or none
-- sent_* keeps the PRT IDs we had sent with the laptop at the time, so an old
-- challan still shows the right charger after the laptop goes out again.
-- Additive only.

CREATE TABLE IF NOT EXISTS challan_charger_marks (
  mark_id       SERIAL PRIMARY KEY,
  doc_kind      VARCHAR(10) NOT NULL CHECK (doc_kind IN ('dc', 'sdc', 'rdc', 'vrdc')),
  dc_number     VARCHAR(80) NOT NULL,
  asset_code    VARCHAR(120) NOT NULL,
  stage         VARCHAR(12) NOT NULL CHECK (stage IN ('dispatch', 'collected', 'warehouse')),
  charger       VARCHAR(8) NOT NULL CHECK (charger IN ('with', 'without')),
  adapter_code  VARCHAR(128),
  cable_code    VARCHAR(128),
  sent_adapter  VARCHAR(128),
  sent_cable    VARCHAR(128),
  matched       BOOLEAN,
  note          TEXT,
  source        VARCHAR(40),
  recorded_by   INT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dc_number, asset_code, stage)
);

CREATE INDEX IF NOT EXISTS idx_ccm_asset ON challan_charger_marks (asset_code);
