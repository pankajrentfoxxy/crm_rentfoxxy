-- Public support form: complaint vs pickup metadata on QR intake rows.

ALTER TABLE support_requests
  ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) NOT NULL DEFAULT 'complaint';

ALTER TABLE support_requests
  DROP CONSTRAINT IF EXISTS support_requests_request_type_check;

ALTER TABLE support_requests
  ADD CONSTRAINT support_requests_request_type_check
  CHECK (request_type IN ('complaint', 'pickup'));

ALTER TABLE support_requests
  ADD COLUMN IF NOT EXISTS extra JSONB;

CREATE INDEX IF NOT EXISTS idx_support_requests_type
  ON support_requests (request_type, status);
