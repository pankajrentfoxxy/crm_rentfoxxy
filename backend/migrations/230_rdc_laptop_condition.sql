-- 230: Return DC hardware check — ON vs Not ON (dead unit skips the capture script).

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS return_laptop_condition VARCHAR(20);

COMMENT ON COLUMN support_ticket_items.return_laptop_condition IS
  'on | not_on — power state at Return DC hardware check after guard inward';
