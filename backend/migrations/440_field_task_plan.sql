-- 440: Field task plan — a date and time per task (17 Oct 2026).
--
-- The lead plans each technician's tasks on the Task board: the order (seq,
-- migration 439) plus the day and time. A technician starts only today's tasks
-- (anything planned for an earlier day counts as today); tomorrow's and later
-- ones are shown, not opened. No date = the customer's slot date, else today.
-- Additive only.

ALTER TABLE field_task_order ADD COLUMN IF NOT EXISTS planned_date DATE;
ALTER TABLE field_task_order ADD COLUMN IF NOT EXISTS planned_time TIME;
