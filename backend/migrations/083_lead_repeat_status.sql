-- Phase 12 Task 4: Re-add Repeat lead status for inline status updates
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status IN (
    'Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected',
    'Call Back', 'Deal', 'Demo', 'Repeat'
  )
);
