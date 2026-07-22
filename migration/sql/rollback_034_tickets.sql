-- Rollback module 034 — remove tickets imported from refurb source.

BEGIN;

DELETE FROM part_requests
 WHERE ticket_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_tickets');

DELETE FROM ticket_parts
 WHERE ticket_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_tickets');

DELETE FROM work_logs
 WHERE ticket_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_tickets');

DELETE FROM activities
 WHERE ticket_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_tickets');

DELETE FROM tickets
 WHERE ticket_id IN (SELECT crm_id::int FROM erp_id_map WHERE entity = 'refurb_tickets');

DELETE FROM erp_id_map WHERE entity = 'refurb_tickets';
UPDATE migration_runs SET status = 'pending', finished_at = NULL WHERE module_id = '034';

COMMIT;
