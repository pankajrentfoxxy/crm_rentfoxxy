BEGIN;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS quotation_accept_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS quotation_accepted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS quotation_last_sent_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS quotation_last_estimate_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS quotation_last_to_email VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_leads_quotation_accept_token ON leads (quotation_accept_token)
    WHERE quotation_accept_token IS NOT NULL;

COMMIT;
