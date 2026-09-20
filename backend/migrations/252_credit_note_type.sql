-- Credit note TYPE, so finance can filter and approve/reject per kind.
--
-- There was no type column. `source` records HOW a note was created
-- (invoice_generation / return_pickup) and `reason` is free text — neither is a
-- filterable classification. With repair-window credits arriving alongside
-- permanent-return credits, finance needs to tell them apart before approving:
-- a return credit is contractual, a repair credit is a service-quality decision
-- they may want to reject.
--
--   return  — laptop came back for good; unused prepaid days refunded
--   repair  — laptop was away for repair and came back to the same customer;
--             the warehouse days are credited
--   manual  — raised by hand from the billing screen
--   other   — anything that predates this classification
--
-- Additive and idempotent. Existing rows are backfilled to 'return', which is
-- what every one of them was issued as.
ALTER TABLE public.customer_credit_notes
  ADD COLUMN IF NOT EXISTS credit_note_type VARCHAR(20);

UPDATE public.customer_credit_notes
   SET credit_note_type = CASE
     WHEN reason ILIKE '%repair%' THEN 'repair'
     WHEN reason ILIKE '%return%' OR source = 'return_pickup' THEN 'return'
     WHEN source = 'invoice_generation' THEN 'return'
     ELSE 'other'
   END
 WHERE credit_note_type IS NULL;

ALTER TABLE public.customer_credit_notes
  ALTER COLUMN credit_note_type SET DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.customer_credit_notes'::regclass
       AND conname = 'customer_credit_notes_type_check'
  ) THEN
    ALTER TABLE public.customer_credit_notes
      ADD CONSTRAINT customer_credit_notes_type_check
      CHECK (credit_note_type IN ('return', 'repair', 'manual', 'other'));
  END IF;
END $$;

-- Finance filters by type + status together.
CREATE INDEX IF NOT EXISTS idx_customer_credit_notes_type_status
  ON public.customer_credit_notes (credit_note_type, status);
