-- 170: Make stage checklists dynamic (editable via DB) and seed the
-- Assembly & Software + Final Testing checklists that were previously hardcoded
-- in the frontend (StageTaskPanel.jsx). Idempotent.

-- Allow one checklist row per stage so we can upsert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stage_checklists_stage_id_key'
  ) THEN
    ALTER TABLE stage_checklists ADD CONSTRAINT stage_checklists_stage_id_key UNIQUE (stage_id);
  END IF;
END $$;

-- Assembly & Software checklist
INSERT INTO stage_checklists (stage_id, checklist_items)
SELECT s.stage_id, $json$[
  {"key": "os_installed",        "label": "OS installed (genuine image)"},
  {"key": "drivers_installed",   "label": "All drivers installed"},
  {"key": "activation",          "label": "Windows / Office activated"},
  {"key": "software_suite",      "label": "Standard software suite installed"},
  {"key": "hardware_reassembled","label": "Hardware reassembled & screws fitted"},
  {"key": "cleaning_done",       "label": "Cleaning / cosmetic finish done"},
  {"key": "boot_ok",             "label": "Boots & runs without errors"}
]$json$::jsonb
FROM stages s
WHERE s.stage_name = 'Assembly & Software'
ON CONFLICT (stage_id) DO UPDATE
  SET checklist_items = EXCLUDED.checklist_items;

-- Final Testing checklist
INSERT INTO stage_checklists (stage_id, checklist_items)
SELECT s.stage_id, $json$[
  {"key": "power_ok",     "label": "Powers on & charges"},
  {"key": "display_ok",   "label": "Display — no dead pixels / lines"},
  {"key": "keyboard_ok",  "label": "Keyboard & touchpad all keys working"},
  {"key": "battery_ok",   "label": "Battery health acceptable"},
  {"key": "ports_ok",     "label": "All ports (USB / Type-C / HDMI) working"},
  {"key": "wifi_bt_ok",   "label": "Wi-Fi & Bluetooth working"},
  {"key": "audio_ok",     "label": "Audio (speaker / mic / jack) working"},
  {"key": "camera_ok",    "label": "Camera working"},
  {"key": "final_grade",  "label": "Final grade assigned & unit clean"}
]$json$::jsonb
FROM stages s
WHERE s.stage_name = 'Final Testing'
ON CONFLICT (stage_id) DO UPDATE
  SET checklist_items = EXCLUDED.checklist_items;
