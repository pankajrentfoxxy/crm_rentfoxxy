-- ============================================================
-- Migration 214: Support v2 flow fix — site provenance, photo
--   obligations, and assignment-group cleanup (D1, D2).
--   Ticket site is derived from the machine. Desk only sees
--   Remote, Inhouse, and city field groups.
-- Idempotent.
-- ============================================================

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS site_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS site_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS site_dc_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS photos_deferred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_source VARCHAR(20);

ALTER TABLE support_tickets_v2 DROP CONSTRAINT IF EXISTS stk2_site_source_check;
ALTER TABLE support_tickets_v2 ADD CONSTRAINT stk2_site_source_check
  CHECK (site_source IS NULL OR site_source IN ('DERIVED_FROM_ASSET', 'CRM_ADDRESS', 'MANUAL_OVERRIDE'));

ALTER TABLE support_tickets_v2 DROP CONSTRAINT IF EXISTS stk2_contact_source_check;
ALTER TABLE support_tickets_v2 ADD CONSTRAINT stk2_contact_source_check
  CHECK (contact_source IS NULL OR contact_source IN ('CUSTOMER', 'SITE_CONTACT', 'MANUAL'));

ALTER TABLE support_ticket_assets
  ADD COLUMN IF NOT EXISTS photos_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photos_deferred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photo_count INT NOT NULL DEFAULT 0;

UPDATE support_assignment_groups SET is_active = FALSE
 WHERE name IN ('Remote L2', 'Chip-level Repair');

UPDATE support_assignment_groups SET name = 'Remote'
 WHERE name = 'Remote L1'
   AND NOT EXISTS (SELECT 1 FROM support_assignment_groups WHERE name = 'Remote');

INSERT INTO support_assignment_groups (name, group_type, zone_id)
SELECT 'Inhouse', 'WAREHOUSE', z.zone_id FROM support_zones z WHERE z.code = 'NCR'
ON CONFLICT (name) DO UPDATE SET group_type = EXCLUDED.group_type, is_active = TRUE;

ALTER TABLE support_assignment_groups
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;

UPDATE support_assignment_groups
   SET display_name = COALESCE(display_name, REPLACE(name, ' Field', ''))
 WHERE group_type = 'FIELD';

UPDATE support_assignment_groups SET display_name = COALESCE(display_name, name)
 WHERE display_name IS NULL;

UPDATE support_assignment_groups SET sort_order = 10 WHERE group_type = 'REMOTE';
UPDATE support_assignment_groups SET sort_order = 20 WHERE group_type = 'WAREHOUSE';
UPDATE support_assignment_groups SET sort_order = 30 WHERE group_type = 'FIELD';
UPDATE support_assignment_groups SET sort_order = 90 WHERE group_type = 'REPAIR';
