-- 034 Tickets migration validation (run on CRM target after module 034)

SELECT 'tickets' AS tbl, COUNT(*)::int AS c FROM tickets
UNION ALL SELECT 'activities', COUNT(*)::int FROM activities
UNION ALL SELECT 'work_logs', COUNT(*)::int FROM work_logs
UNION ALL SELECT 'ticket_parts', COUNT(*)::int FROM ticket_parts
UNION ALL SELECT 'part_requests', COUNT(*)::int FROM part_requests;

SELECT 'orphan_activities' AS check, COUNT(*)::int AS c
  FROM activities a LEFT JOIN tickets t ON t.ticket_id = a.ticket_id WHERE t.ticket_id IS NULL
UNION ALL
SELECT 'orphan_work_logs', COUNT(*)::int
  FROM work_logs w LEFT JOIN tickets t ON t.ticket_id = w.ticket_id WHERE t.ticket_id IS NULL;

SELECT status, COUNT(*)::int AS c FROM tickets GROUP BY status ORDER BY c DESC;

SELECT s.stage_name, COUNT(*)::int AS c
  FROM tickets t
  LEFT JOIN stages s ON s.stage_id = t.current_stage_id
  GROUP BY s.stage_name
  ORDER BY c DESC;

-- Tickets with invalid stage reference
SELECT COUNT(*)::int AS tickets_bad_stage
  FROM tickets t
  LEFT JOIN stages s ON s.stage_id = t.current_stage_id
  WHERE t.current_stage_id IS NOT NULL AND s.stage_id IS NULL;
