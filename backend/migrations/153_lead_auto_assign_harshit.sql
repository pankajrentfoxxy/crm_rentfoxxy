-- Route all auto-assigned leads (email, CSV import, manual create) to Harshit.
-- Uses email lookup so it works across environments without hard-coded user_id.

DO $$
DECLARE
  harshit_id INT;
BEGIN
  SELECT user_id INTO harshit_id
  FROM users
  WHERE LOWER(email) = 'harshit@rentfoxxy.com'
    AND role = 'sales'
  ORDER BY user_id
  LIMIT 1;

  IF harshit_id IS NULL THEN
    RAISE NOTICE '153_lead_auto_assign_harshit: harshit@rentfoxxy.com (sales) not found — skipped';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM lead_auto_assign_config LIMIT 1) THEN
    UPDATE lead_auto_assign_config
    SET user_ids = ARRAY[harshit_id],
        round_robin_index = 0,
        updated_at = NOW()
    WHERE id = (SELECT id FROM lead_auto_assign_config ORDER BY id LIMIT 1);
  ELSE
    INSERT INTO lead_auto_assign_config (user_ids, round_robin_index)
    VALUES (ARRAY[harshit_id], 0);
  END IF;

  RAISE NOTICE '153_lead_auto_assign_harshit: auto-assign set to user_id % (harshit@rentfoxxy.com)', harshit_id;
END $$;
