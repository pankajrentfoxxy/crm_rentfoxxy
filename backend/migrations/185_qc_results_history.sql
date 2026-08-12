-- Migration: 185_qc_results_history.sql
-- Append-only snapshots of Production QC checklist submissions.
-- Existing qc_results workflow (one row per ticket+stage) is unchanged;
-- each submit also writes a history row so re-QC never overwrites past reports.

CREATE TABLE IF NOT EXISTS qc_results_history (
  history_id          SERIAL PRIMARY KEY,
  qc_id               INTEGER REFERENCES qc_results(qc_id) ON DELETE SET NULL,
  ticket_id           INTEGER NOT NULL REFERENCES tickets(ticket_id),
  qc_stage            VARCHAR(20) NOT NULL,
  attempt_no          INTEGER NOT NULL DEFAULT 1,

  processor           VARCHAR(100),
  generation          VARCHAR(50),
  storage_type        VARCHAR(50),
  ram_size            VARCHAR(20),

  checklist_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
  parts_replaced      BOOLEAN DEFAULT FALSE,
  replaced_parts      JSONB,

  qc_result           VARCHAR(20),
  failure_reasons     TEXT[],
  remarks             TEXT,
  final_grade         VARCHAR(50),
  grade_notes         TEXT,

  tested_by           INTEGER REFERENCES users(user_id),
  checked_by          INTEGER REFERENCES users(user_id),
  qc_date             DATE,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_qc_results_history_ticket_stage_attempt
    UNIQUE (ticket_id, qc_stage, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_qc_results_history_ticket
  ON qc_results_history (ticket_id);
CREATE INDEX IF NOT EXISTS idx_qc_results_history_stage
  ON qc_results_history (qc_stage);
CREATE INDEX IF NOT EXISTS idx_qc_results_history_result
  ON qc_results_history (qc_result);
CREATE INDEX IF NOT EXISTS idx_qc_results_history_submitted
  ON qc_results_history (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_qc_results_history_tested_by
  ON qc_results_history (tested_by);
CREATE INDEX IF NOT EXISTS idx_qc_results_history_checked_by
  ON qc_results_history (checked_by);

COMMENT ON TABLE qc_results_history IS
  'Append-only Production QC checklist snapshots (one row per submit attempt)';

-- Backfill current submitted QC rows as attempt 1 (idempotent)
INSERT INTO qc_results_history (
  qc_id, ticket_id, qc_stage, attempt_no,
  processor, generation, storage_type, ram_size,
  checklist_data, parts_replaced, replaced_parts,
  qc_result, failure_reasons, remarks, final_grade, grade_notes,
  tested_by, checked_by, qc_date, submitted_at, created_at
)
SELECT
  qr.qc_id,
  qr.ticket_id,
  qr.qc_stage,
  1,
  qr.processor,
  qr.generation,
  qr.storage_type,
  qr.ram_size,
  COALESCE(qr.checklist_data, '{}'::jsonb),
  COALESCE(qr.parts_replaced, FALSE),
  qr.replaced_parts,
  qr.qc_result,
  qr.failure_reasons,
  qr.remarks,
  qr.final_grade,
  qr.grade_notes,
  qr.tested_by,
  qr.checked_by,
  qr.qc_date,
  COALESCE(qr.submitted_at, qr.created_at, NOW()),
  COALESCE(qr.created_at, NOW())
FROM qc_results qr
WHERE qr.submitted_at IS NOT NULL
   OR COALESCE(qr.is_locked, FALSE) = TRUE
   OR qr.qc_result IS NOT NULL
ON CONFLICT (ticket_id, qc_stage, attempt_no) DO NOTHING;
