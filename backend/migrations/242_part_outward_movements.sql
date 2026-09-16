-- Part Outward request → approval → DC: warehouse snapshot + movement history.
ALTER TABLE physical_part_outwards
  ADD COLUMN IF NOT EXISTS warehouse VARCHAR(200),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER,
  ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(200);

CREATE TABLE IF NOT EXISTS physical_part_movements (
  id SERIAL PRIMARY KEY,
  outward_id INTEGER REFERENCES physical_part_outwards(outward_id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES physical_dead_parts(part_id) ON DELETE SET NULL,
  dp_number VARCHAR(20),
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  remarks TEXT,
  actor_user_id INTEGER,
  actor_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_physical_part_movements_outward
  ON physical_part_movements (outward_id, created_at);

UPDATE physical_part_outwards o
   SET warehouse = sub.warehouse
  FROM (
    SELECT p.outward_id, MIN(p.warehouse) AS warehouse
      FROM physical_dead_parts p
     WHERE p.outward_id IS NOT NULL
     GROUP BY p.outward_id
  ) sub
 WHERE o.outward_id = sub.outward_id
   AND o.warehouse IS NULL;
