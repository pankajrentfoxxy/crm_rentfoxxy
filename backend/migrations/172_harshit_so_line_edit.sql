-- 172_harshit_so_line_edit.sql
-- Grant harshit@rentfoxxy.com permission to edit sales order line rate + config.

UPDATE users
SET permissions = CASE
  WHEN 'so_line_rate_config_edit' = ANY(COALESCE(permissions, ARRAY[]::text[]))
  THEN permissions
  ELSE array_append(COALESCE(permissions, ARRAY[]::text[]), 'so_line_rate_config_edit')
END,
updated_at = NOW()
WHERE LOWER(email) = 'harshit@rentfoxxy.com';
