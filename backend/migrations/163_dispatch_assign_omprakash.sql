-- Route all new sales order dispatch assignments to Omprakash (dispatch).

ALTER TABLE dispatch_workflow_config
  ADD COLUMN IF NOT EXISTS fixed_assignee_user_id INT REFERENCES users(user_id) ON DELETE SET NULL;

DO $$
DECLARE
  omprakash_id INT;
BEGIN
  SELECT user_id INTO omprakash_id
  FROM users
  WHERE LOWER(email) = 'dispatch_1@rentfoxxy.com'
    AND role = 'dispatch'
  ORDER BY user_id
  LIMIT 1;

  IF omprakash_id IS NULL THEN
    SELECT user_id INTO omprakash_id
    FROM users
    WHERE LOWER(name) = 'omprakash'
      AND role = 'dispatch'
    ORDER BY user_id
    LIMIT 1;
  END IF;

  IF omprakash_id IS NULL THEN
    RAISE NOTICE '163_dispatch_assign_omprakash: Omprakash (dispatch) not found — skipped';
    RETURN;
  END IF;

  UPDATE dispatch_workflow_config
  SET fixed_assignee_user_id = omprakash_id,
      updated_at = NOW()
  WHERE id = 1;

  UPDATE dispatch_round_robin_state
  SET last_assigned_user_id = omprakash_id,
      updated_at = NOW()
  WHERE id = 1;

  RAISE NOTICE '163_dispatch_assign_omprakash: fixed assignee set to user_id % (Omprakash)', omprakash_id;
END $$;
