-- Phase 9: Floor pipeline fixes — parts thresholds, ticket_parts cost tracking

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS min_threshold INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';

ALTER TABLE ticket_parts
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_upgrade BOOLEAN DEFAULT FALSE;

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('support_ticket', 0, 'TKT-')
ON CONFLICT (doc_type) DO NOTHING;
