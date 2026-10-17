-- 439: Field task order and "one task at a time" (17 Oct 2026).
--
-- A support lead sets the order a technician works in. A technician works one
-- task at a time: once they mark "reached", no other task can be started until
-- it is finished with the customer's OTP (visit closed, laptops collected,
-- challan delivered). A stop back at the warehouse / office is recorded too.
-- Additive only.

CREATE TABLE IF NOT EXISTS field_task_order (
  user_id   INT NOT NULL,
  task_key  VARCHAR(140) NOT NULL,
  seq       INT NOT NULL,
  set_by    INT,
  set_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, task_key)
);

ALTER TABLE field_travel_legs DROP CONSTRAINT IF EXISTS field_travel_legs_kind_check;
ALTER TABLE field_travel_legs ADD CONSTRAINT field_travel_legs_kind_check
  CHECK (kind IN ('visit', 'pickup', 'delivery', 'vendor', 'warehouse', 'end'));
