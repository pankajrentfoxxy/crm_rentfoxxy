-- 152: Dispatch QC failed flow — ticket goes to Diagnosis (not Assembly & Software).
-- The asset is detached from the SO, marked qc_failed and removed from the
-- Ready to Rent/Sell list; the linked ticket moves to Diagnosis for triage.

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT v.f, v.t, v.c, v.b, v.n FROM (VALUES
  ('Dispatch QC', 'Diagnosis', 'dispatch_qc_failed', true,
   'Dispatch QC failed — asset detached from SO, ticket to Diagnosis'),
  -- Re-seed the 082 rules too: they were found missing on live.
  ('QC1', 'Dispatch QC', 'qc1_passed_so', false,
   'QC1 passed — sales_order_qc goes to Dispatch QC'),
  ('Dispatch QC', 'Inventory', 'dispatch_qc_passed', false,
   'Dispatch QC passed — DC can be generated')
) AS v(f, t, c, b, n)
WHERE NOT EXISTS (
  SELECT 1 FROM stage_transition_rules r
   WHERE r.from_stage_name = v.f AND r.to_stage_name = v.t
);
