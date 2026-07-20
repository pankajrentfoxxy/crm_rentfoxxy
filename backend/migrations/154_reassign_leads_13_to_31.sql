-- Reassign all leads previously assigned to user 13 (Anikesh) → 31 (Harshit).

UPDATE leads
SET assigned_user_id = 31,
    updated_at = NOW()
WHERE assigned_user_id = 13;

UPDATE lead_assignments
SET assigned_to = 31
WHERE assigned_to = 13;

-- assigned_by on leads/assignments only if it was 13 (who performed the assignment)
UPDATE leads
SET assigned_by = 31
WHERE assigned_by = 13;

UPDATE lead_assignments
SET assigned_by = 31
WHERE assigned_by = 13;
