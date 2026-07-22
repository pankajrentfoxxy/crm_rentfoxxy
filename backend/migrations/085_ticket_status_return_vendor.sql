-- ============================================================
-- Migration: 085_ticket_status_return_vendor.sql
-- Fix: tickets_status_check omitted 'qc_failed_return_vendor', but the
-- floor-manager Force Fail flow (markQcFailed) and every pipeline/report
-- query already set and read status='qc_failed_return_vendor' to move the
-- ticket into the vendor-return section. Without this, Force Fail crashes
-- with: new row for relation "tickets" violates check constraint
-- "tickets_status_check".
-- Adds the missing status to the allowed set.
-- ============================================================
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('in_progress', 'completed', 'failed', 'on_hold', 'qc_failed_return_vendor'));
