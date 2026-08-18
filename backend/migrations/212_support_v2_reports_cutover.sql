-- ============================================================
-- Migration 212: Support revamp Phase 11 — settings, report views, cutover.
--   Prompt said 206; 206 is WO engine. Next free number is 212.
-- Idempotent. Does NOT rename or drop legacy support tables.
-- ============================================================

ALTER TABLE support_settings_v2
  ADD COLUMN IF NOT EXISTS value JSONB,
  ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(user_id);

UPDATE support_settings_v2
   SET value = to_jsonb(setting_value)
 WHERE value IS NULL;

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS on_site_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS support_dual_run_snapshots (
  snapshot_id   SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  legacy_open   INT NOT NULL DEFAULT 0,
  v2_open       INT NOT NULL DEFAULT 0,
  legacy_by_status JSONB NOT NULL DEFAULT '{}',
  v2_by_status     JSONB NOT NULL DEFAULT '{}',
  disagreements JSONB NOT NULL DEFAULT '[]',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO support_settings_v2 (setting_key, setting_value, value) VALUES
  ('auto_close_hours', '48', '48'::jsonb),
  ('reopen_window_days', '7', '7'::jsonb),
  ('csat_token_days', '14', '14'::jsonb),
  ('escalation_thresholds', '[50,75,100,125,150]', '[50,75,100,125,150]'::jsonb),
  ('free_repair_days', '3', '3'::jsonb),
  ('max_repair_days', '7', '7'::jsonb),
  ('max_jobs_per_day', '6', '6'::jsonb),
  ('accept_window_minutes', '30', '30'::jsonb),
  ('photo_min_count', '4', '4'::jsonb),
  ('parts_lead_threshold', '5000', '5000'::jsonb),
  ('parts_manager_threshold', '10000', '10000'::jsonb),
  ('field_visit_cost', '0', '0'::jsonb),
  ('notifications', '{}', '{}'::jsonb),
  ('portal', '{"can_create":true,"can_reopen":true,"can_approve_charge":true}',
   '{"can_create":true,"can_reopen":true,"can_approve_charge":true}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

UPDATE support_settings_v2
   SET value = COALESCE(value, to_jsonb(setting_value))
 WHERE value IS NULL;

-- FCR = resolved with exactly one work order AND no reopen within 7 days
CREATE OR REPLACE VIEW support_v2_rpt_quality AS
SELECT
  t.ticket_id,
  t.ticket_number,
  t.status,
  t.assigned_to,
  t.csat_score,
  t.created_at,
  t.resolved_at,
  t.closed_at,
  t.reopen_count,
  (SELECT COUNT(*) FROM support_work_orders w
    WHERE w.ticket_id = t.ticket_id AND w.status <> 'CANCELLED') AS wo_count,
  (
    t.status IN ('RESOLVED','CLOSED')
    AND (SELECT COUNT(*) FROM support_work_orders w
          WHERE w.ticket_id = t.ticket_id AND w.status <> 'CANCELLED') = 1
    AND COALESCE(t.reopen_count, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM support_ticket_events e
       WHERE e.ticket_id = t.ticket_id
         AND e.event_type IN ('TICKET_REOPENED','REOPENED')
         AND e.created_at <= COALESCE(t.resolved_at, t.closed_at, t.created_at) + INTERVAL '7 days'
    )
  ) AS is_fcr,
  (
    SELECT COUNT(*) FILTER (
      WHERE a.reported_subtype_id IS NOT NULL
        AND a.found_subtype_id IS NOT NULL
        AND a.reported_subtype_id = a.found_subtype_id
    )::numeric
    / NULLIF(COUNT(*) FILTER (
        WHERE a.reported_subtype_id IS NOT NULL AND a.found_subtype_id IS NOT NULL
      ), 0)
    FROM support_ticket_assets a
    WHERE a.ticket_id = t.ticket_id
  ) AS accuracy
FROM support_tickets_v2 t;

-- On-time arrival = on_site_at <= slot_end
CREATE OR REPLACE VIEW support_v2_rpt_field AS
SELECT
  w.wo_id,
  w.wo_number,
  w.wo_type,
  w.status,
  w.assigned_to,
  w.slot_start,
  w.slot_end,
  w.on_site_at,
  w.completed_at,
  w.time_spent_minutes,
  w.failure_reason,
  (w.on_site_at IS NOT NULL AND w.slot_end IS NOT NULL AND w.on_site_at <= w.slot_end) AS on_time_arrival,
  (
    SELECT COUNT(*) FILTER (WHERE s.status = 'DONE')::numeric
           / NULLIF(COUNT(*) FILTER (WHERE s.is_mandatory AND s.step_kind = 'PHOTO'), 0)
      FROM support_work_order_steps s
     WHERE s.wo_id = w.wo_id AND s.step_kind = 'PHOTO'
  ) AS photo_compliance
FROM support_work_orders w;

CREATE OR REPLACE VIEW support_v2_rpt_volume AS
SELECT
  t.ticket_id,
  t.ticket_number,
  t.channel,
  t.ticket_class,
  t.status,
  t.priority,
  t.customer_id,
  COALESCE(c.company_name, c.name) AS customer_name,
  COALESCE(c.billing_city, t.site_label) AS city,
  t.created_at,
  a.line_id,
  rt.code AS type_code,
  rs.code AS subtype_code,
  ri.code AS issue_code,
  ri.name AS issue_label
FROM support_tickets_v2 t
LEFT JOIN customers c ON c.customer_id = t.customer_id
LEFT JOIN support_ticket_assets a ON a.ticket_id = t.ticket_id
LEFT JOIN support_issue_catalog rt ON rt.catalog_id = a.reported_type_id
LEFT JOIN support_issue_catalog rs ON rs.catalog_id = a.reported_subtype_id
LEFT JOIN support_issue_catalog ri ON ri.catalog_id = a.reported_issue_id;

CREATE OR REPLACE VIEW support_v2_rpt_sla AS
SELECT
  t.ticket_id,
  t.ticket_number,
  t.priority,
  t.status,
  t.sla_paused,
  t.sla_paused_minutes,
  t.sla_response_due_at,
  t.sla_resolution_due_at,
  t.sla_started_at,
  t.resolved_at,
  t.closed_at,
  t.breach_reason,
  t.sla_breached,
  t.sla_resolution_breached,
  CASE
    WHEN t.sla_response_due_at IS NULL THEN NULL
    WHEN t.resolved_at IS NOT NULL AND t.resolved_at <= t.sla_response_due_at THEN TRUE
    WHEN t.sla_started_at IS NOT NULL AND t.sla_response_due_at >= t.sla_started_at
         AND COALESCE(t.resolved_at, NOW()) <= t.sla_response_due_at THEN TRUE
    ELSE FALSE
  END AS response_met,
  CASE
    WHEN t.sla_resolution_due_at IS NULL THEN NULL
    WHEN COALESCE(t.resolved_at, t.closed_at) IS NOT NULL
         AND COALESCE(t.resolved_at, t.closed_at) <= t.sla_resolution_due_at THEN TRUE
    WHEN t.status NOT IN ('RESOLVED','CLOSED','CANCELLED')
         AND NOW() <= t.sla_resolution_due_at THEN TRUE
    ELSE FALSE
  END AS resolution_met
FROM support_tickets_v2 t;

-- MTBF by model = complaints per unit per year over fleet-days deployed
-- TCO per TTSPL = parts + field visit cost + rent waived
CREATE OR REPLACE VIEW support_v2_rpt_assets AS
SELECT
  a.line_id,
  a.ticket_id,
  a.serial_id,
  a.ttspl_id,
  COALESCE(vsn.extra->>'brand', '') AS brand,
  COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
  a.reported_subtype_id,
  a.is_repeat,
  a.line_status,
  t.created_at AS complaint_at
FROM support_ticket_assets a
JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = a.serial_id;

CREATE OR REPLACE VIEW support_v2_rpt_parts AS
SELECT
  pr.request_id,
  pr.support_ticket_id AS ticket_id,
  t.customer_id,
  pr.status_v2,
  pr.part_name,
  pr.quantity,
  pr.charge_amount,
  pr.created_at,
  pr.approved_at,
  EXTRACT(EPOCH FROM (pr.approved_at - pr.created_at)) / 60 AS approval_minutes,
  (pr.status_v2 = 'RETURNED_UNUSED') AS unused_return
FROM part_requests pr
LEFT JOIN support_tickets_v2 t ON t.ticket_id = pr.support_ticket_id
WHERE pr.support_ticket_id IS NOT NULL OR pr.context = 'SUPPORT';

CREATE OR REPLACE VIEW support_v2_rpt_commercial AS
SELECT
  e.extra_line_id,
  e.ticket_id,
  e.customer_id,
  e.charge_type,
  e.amount,
  e.status,
  e.billed_in_invoice_id,
  e.created_at,
  NULL::numeric AS vendor_claim_amount,
  NULL::int AS hold_id,
  NULL::numeric AS rent_waived_days
FROM customer_invoice_extra_lines e
UNION ALL
SELECT
  NULL, v.ticket_id, NULL, 'VENDOR_CLAIM', v.amount, v.status, NULL, v.created_at,
  v.amount, NULL, NULL
FROM vendor_warranty_claims v
UNION ALL
SELECT
  NULL, h.ticket_id, h.customer_id, 'RENT_WAIVE', NULL, CASE WHEN h.waive_rent THEN 'WAIVED' ELSE 'OPEN' END,
  NULL, h.created_at, NULL, h.hold_id,
  CASE WHEN h.waive_rent AND h.hold_to IS NOT NULL
       THEN GREATEST(0, (h.hold_to - h.hold_from) - COALESCE((
         SELECT NULLIF(TRIM(BOTH '"' FROM value::text), '')::int
           FROM support_settings_v2 WHERE setting_key = 'free_repair_days'
       ), 3))
       ELSE 0 END
FROM asset_billing_holds h;
