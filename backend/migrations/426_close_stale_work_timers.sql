-- 426: close stale floor work timers (user, 15 Oct 2026).
--
-- Start-work timers were never stopped on the old screens, so people showed
-- dozens "running" at once (Today page → Floor team). Closes an open
-- work_logs row when:
--   - its ticket is finished / cancelled (the timer can never stop normally), or
--   - it started more than 3 days ago (the floor board's "stuck" mark) —
--     the person presses Start work again, which is the rule since 15 Oct.
-- end_time = the person's last recorded action on that laptop after the
-- start (activities / floor history), else the start itself — never NOW(),
-- which would credit weeks of time nobody worked. Rows are copied first to
-- work_logs_426_backup. Idempotent.

CREATE TABLE IF NOT EXISTS work_logs_426_backup AS
  SELECT w.*, NOW() AS backed_up_at FROM work_logs w WHERE FALSE;

WITH stale AS (
  SELECT w.log_id
    FROM work_logs w
    JOIN tickets t ON t.ticket_id = w.ticket_id
   WHERE w.end_time IS NULL
     AND (t.status NOT IN ('in_progress', 'on_hold')
          OR w.start_time < NOW() - INTERVAL '3 days')
)
INSERT INTO work_logs_426_backup
SELECT w.*, NOW() FROM work_logs w JOIN stale s ON s.log_id = w.log_id
 WHERE NOT EXISTS (SELECT 1 FROM work_logs_426_backup b WHERE b.log_id = w.log_id);

UPDATE work_logs w
   SET end_time = GREATEST(
         w.start_time,
         COALESCE((SELECT MAX(a.created_at) FROM activities a
                    WHERE a.ticket_id = w.ticket_id AND a.user_id = w.user_id AND a.created_at > w.start_time), w.start_time),
         COALESCE((SELECT MAX(h.created_at) FROM production_ticket_history h
                    WHERE h.ticket_id = w.ticket_id AND h.performed_by = w.user_id AND h.created_at > w.start_time), w.start_time)
       ),
       notes = CONCAT_WS(' | ', NULLIF(w.notes, ''), 'Auto-closed 15 Oct 2026: stale timer (migration 426)')
  FROM tickets t
 WHERE t.ticket_id = w.ticket_id
   AND w.end_time IS NULL
   AND (t.status NOT IN ('in_progress', 'on_hold')
        OR w.start_time < NOW() - INTERVAL '3 days');
