-- Rollback module 033 — remove leads imported from refurb source.
-- Restores pre-migration lead rows that were backed up in leads_refurb_backup_033.

BEGIN;

-- Remove child rows for migrated leads
DELETE FROM lead_followup_notifications
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

DELETE FROM lead_company_research
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

DELETE FROM lead_remarks
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

DELETE FROM lead_assignments
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

DELETE FROM lead_activities
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

-- Delete migrated leads (run restore script first if you need backed-up CRM rows back)
DELETE FROM leads
 WHERE lead_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_leads');

DELETE FROM erp_id_map WHERE entity = 'refurb_leads';
UPDATE migration_runs SET status = 'pending', finished_at = NULL WHERE module_id = '033';

COMMIT;

-- To restore CRM rows that existed before upsert:
--   node migration/tools/restore-refurb-backup.js --module=033
