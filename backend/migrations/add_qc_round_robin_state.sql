-- Stores last round-robin assignee per team for QC1 / QC2 (and similar) handoffs.
CREATE TABLE IF NOT EXISTS qc_round_robin_state (
    team_id INTEGER PRIMARY KEY,
    last_assigned_user_id INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qc_rr_state_updated ON qc_round_robin_state (updated_at);
