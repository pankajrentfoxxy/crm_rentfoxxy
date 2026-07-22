-- 033 Leads migration validation (run on CRM target after module 033)

-- Count parity (compare with source via reconcile-leads-tickets.js)
SELECT 'leads' AS tbl, COUNT(*)::int AS c FROM leads
UNION ALL SELECT 'lead_activities', COUNT(*)::int FROM lead_activities
UNION ALL SELECT 'lead_assignments', COUNT(*)::int FROM lead_assignments
UNION ALL SELECT 'lead_remarks', COUNT(*)::int FROM lead_remarks
UNION ALL SELECT 'lead_company_research', COUNT(*)::int FROM lead_company_research
UNION ALL SELECT 'lead_followup_notifications', COUNT(*)::int FROM lead_followup_notifications;

-- Orphan FK checks
SELECT 'orphan_lead_activities' AS check, COUNT(*)::int AS c
  FROM lead_activities la LEFT JOIN leads l ON l.lead_id = la.lead_id WHERE l.lead_id IS NULL
UNION ALL
SELECT 'orphan_lead_assignments', COUNT(*)::int
  FROM lead_assignments x LEFT JOIN leads l ON l.lead_id = x.lead_id WHERE l.lead_id IS NULL
UNION ALL
SELECT 'orphan_lead_remarks', COUNT(*)::int
  FROM lead_remarks r LEFT JOIN leads l ON l.lead_id = r.lead_id WHERE l.lead_id IS NULL
UNION ALL
SELECT 'orphan_lead_research', COUNT(*)::int
  FROM lead_company_research r LEFT JOIN leads l ON l.lead_id = r.lead_id WHERE l.lead_id IS NULL;

-- Status distribution
SELECT status, COUNT(*)::int AS c FROM leads GROUP BY status ORDER BY c DESC;

-- Assigned user integrity (null OK if source user had no CRM email match)
SELECT COUNT(*)::int AS leads_with_unmapped_assignee
  FROM leads l
  LEFT JOIN users u ON u.user_id = l.assigned_user_id
  WHERE l.assigned_user_id IS NOT NULL AND u.user_id IS NULL;

-- Duplicate natural keys (informational)
SELECT LOWER(TRIM(email)) AS email, TRIM(phone) AS phone, COUNT(*)::int AS c
  FROM leads
  WHERE COALESCE(email, '') <> '' OR COALESCE(phone, '') <> ''
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
  ORDER BY c DESC
  LIMIT 20;
