-- ============================================================
-- Migration 218: Ticket site_key + site_pincode used by
--   create-ticket, job detail, and dispatch availability.
-- Idempotent.
-- ============================================================

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS site_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS site_pincode VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_stk2_site_key
  ON support_tickets_v2(site_key)
  WHERE site_key IS NOT NULL;

UPDATE support_tickets_v2
   SET site_pincode = (regexp_match(COALESCE(site_label, ''), '([1-9][0-9]{5})\s*$'))[1]
 WHERE site_label IS NOT NULL
   AND (site_pincode IS NULL OR site_pincode = ''
        OR site_pincode <> (regexp_match(COALESCE(site_label, ''), '([1-9][0-9]{5})\s*$'))[1]);

UPDATE support_tickets_v2
   SET site_key = 'pin:' || COALESCE(site_pincode, '') || ':'
                  || left(lower(regexp_replace(COALESCE(site_label, ''), '\s+', ' ', 'g')), 80)
 WHERE site_key IS NULL
   AND (site_pincode IS NOT NULL OR site_label IS NOT NULL);
