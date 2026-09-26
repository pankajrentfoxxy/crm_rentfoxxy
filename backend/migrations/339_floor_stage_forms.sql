-- Production: clear stage forms on the floor.
--
-- 1. Diagnosis keeps what the technician answered. Submit used to write only
--    the result, so on QA 986 completed diagnoses hold no answers at all.
--    `answers` holds every answer (OK / fault / not fitted); `outcome` is what
--    the technician decided (assembly, parts, chip, body, floor_manager).
-- 2. Chip-level repair and Body & Paint get a checklist like Assembly and
--    Final Testing already have (editable rows in stage_checklists).
--
-- Additive only: two nullable columns and two new rows. Nothing existing is
-- changed or removed. Safe to run twice.

ALTER TABLE diagnosis_results
  ADD COLUMN IF NOT EXISTS answers JSONB,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(30);

INSERT INTO stage_checklists (stage_id, checklist_items)
SELECT s.stage_id, x.items::jsonb
  FROM (VALUES
    ('Chip Level Repair', '[
      {"key": "fault_found", "label": "Found the faulty component on the board"},
      {"key": "component_replaced", "label": "Replaced / reworked it"},
      {"key": "no_short_after", "label": "No short circuit after the repair"},
      {"key": "powers_on_after", "label": "Laptop powers on and starts"},
      {"key": "no_heating_after", "label": "Ran 15 minutes with no chip heating up"}
    ]'),
    ('Body & Paint', '[
      {"key": "damage_fixed", "label": "Cracks / broken plastic repaired or panel replaced"},
      {"key": "hinges_fixed", "label": "Hinges firm"},
      {"key": "painted", "label": "Painted / finished and fully dry"},
      {"key": "screws_back", "label": "All screws and rubber feet back"},
      {"key": "labels_back", "label": "TTSPL and serial labels back on"}
    ]')
  ) AS x(stage_name, items)
  JOIN stages s ON s.stage_name = x.stage_name
 WHERE NOT EXISTS (SELECT 1 FROM stage_checklists c WHERE c.stage_id = s.stage_id);
