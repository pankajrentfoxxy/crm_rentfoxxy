-- Wrapper: clear conflicting 914-922 data, then import leads_914_922.sql contents
BEGIN;
SET session_replication_role = replica;

-- Remove child records for leads 914-922 only (required for PK conflict resolution)
DELETE FROM lead_remarks WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_activities WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_assignments WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_company_research WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_followup_notifications WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_orders WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM lead_addresses WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM email_lead_ingestion_log WHERE lead_id BETWEEN 914 AND 922;

-- Unlink and remove lead-linked customers in import scope
UPDATE leads SET customer_id = NULL WHERE lead_id BETWEEN 914 AND 922;
DELETE FROM customer_addresses WHERE customer_id IN (
  SELECT customer_id FROM customers WHERE source_lead_id BETWEEN 914 AND 922
);
DELETE FROM customers WHERE source_lead_id BETWEEN 914 AND 922;

-- Replace lead rows so import data takes effect
DELETE FROM leads WHERE lead_id BETWEEN 914 AND 922;
