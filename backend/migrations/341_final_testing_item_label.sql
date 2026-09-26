-- Production: Final Testing asked the technician "Final grade assigned & unit
-- clean", but the grade is given at QC by the inspector (PD2), not by the
-- technician. Same key (saved checklists still read), clearer words. Changes
-- only that one label, and only if it still has its original wording.
UPDATE stage_checklists c
   SET checklist_items = (
         SELECT jsonb_agg(CASE WHEN e->>'key' = 'final_grade' AND e->>'label' = 'Final grade assigned & unit clean'
                               THEN jsonb_build_object('key', 'final_grade', 'label', 'Laptop cleaned and ready for QC (QC gives the grade)')
                               ELSE e END ORDER BY ord)
           FROM jsonb_array_elements(c.checklist_items) WITH ORDINALITY AS x(e, ord))
  FROM stages s
 WHERE s.stage_id = c.stage_id AND s.stage_name = 'Final Testing'
   AND c.checklist_items @> '[{"key": "final_grade", "label": "Final grade assigned & unit clean"}]'::jsonb;
