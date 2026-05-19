-- Lead substage (reason), activity stage columns, Demo status
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_stage VARCHAR(200);

ALTER TABLE lead_activities ADD COLUMN IF NOT EXISTS stage_from VARCHAR(200);
ALTER TABLE lead_activities ADD COLUMN IF NOT EXISTS stage_to VARCHAR(200);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status IN (
    'Pending',
    'Cold',
    'Warm',
    'Hot',
    'Gone',
    'Hold',
    'Rejected',
    'Call Back',
    'Deal',
    'Demo'
  )
);
