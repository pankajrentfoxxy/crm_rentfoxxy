-- Daily present / absent for support technicians.
-- Idempotent.

CREATE TABLE IF NOT EXISTS support_technician_attendance (
  attendance_id  SERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  work_date      DATE NOT NULL,
  status         VARCHAR(10) NOT NULL CHECK (status IN ('PRESENT', 'ABSENT')),
  reason         VARCHAR(200),
  marked_by      INT REFERENCES users(user_id),
  marked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_sup_attendance_date
  ON support_technician_attendance (work_date, status);
