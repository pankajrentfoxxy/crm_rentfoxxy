-- Support issue process (claude/carret-support.md, rework step A+B, 26 Sep 2026).
--
-- Tickets raised from now on carry the reported issue as Type > Subtype > Issue
-- from support_issue_catalog (seeded by 303, unused until now). Before the job
-- is finished the technician (or lead, for workshop repairs) records what was
-- actually wrong, why (root cause) and what fixed it (resolution). Existing
-- tickets are NOT touched: their new columns stay NULL, and the rules apply
-- only to laptops that have a reported issue.
BEGIN;

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS reported_type_id    INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS reported_subtype_id INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS reported_issue_id   INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS found_type_id       INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS found_subtype_id    INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS found_issue_id      INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS root_cause_id       INTEGER REFERENCES support_root_causes (cause_id),
  ADD COLUMN IF NOT EXISTS resolution_code_id  INTEGER REFERENCES support_resolution_codes (code_id),
  ADD COLUMN IF NOT EXISTS resolution_notes    TEXT,
  ADD COLUMN IF NOT EXISTS finding_by          INTEGER REFERENCES users (user_id),
  ADD COLUMN IF NOT EXISTS finding_at          TIMESTAMPTZ;

-- A found issue always comes with its root cause and fix.
ALTER TABLE support_ticket_items DROP CONSTRAINT IF EXISTS support_item_finding_complete;
ALTER TABLE support_ticket_items ADD CONSTRAINT support_item_finding_complete CHECK (
  found_issue_id IS NULL
  OR (found_type_id IS NOT NULL AND found_subtype_id IS NOT NULL
      AND root_cause_id IS NOT NULL AND resolution_code_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_support_items_reported_issue ON support_ticket_items (reported_issue_id) WHERE reported_issue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_items_found_issue ON support_ticket_items (found_issue_id) WHERE found_issue_id IS NOT NULL;

-- Customer requests (QR page / portal) say Type > Subtype; the lead picks the
-- issue when converting.
ALTER TABLE support_requests
  ADD COLUMN IF NOT EXISTS reported_type_id    INTEGER REFERENCES support_issue_catalog (catalog_id),
  ADD COLUMN IF NOT EXISTS reported_subtype_id INTEGER REFERENCES support_issue_catalog (catalog_id);

-- The cause the floor needs to hear about: the fault was there when we sent it.
INSERT INTO support_root_causes (code, name, default_liability, sort_order)
VALUES ('RC-REF', 'Missed at refurbishment / QC (floor)', 'COMPANY', 15)
ON CONFLICT (code) DO NOTHING;

COMMIT;
