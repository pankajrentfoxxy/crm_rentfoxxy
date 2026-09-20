-- Parts stock must never go negative.
--
-- `parts` had no CHECK, no unique constraint beyond its primary key, and nothing
-- stopping a decrement taking the counter below zero. One issue path subtracted
-- with no stock guard at all; several others use GREATEST(0, quantity - n),
-- which cannot go negative but silently swallows an over-issue — issuing from
-- empty stock "succeeds" and leaves the counter at 0, so the consumption is
-- simply lost rather than flagged.
--
-- With this constraint an over-issue becomes a loud 23514 error instead of
-- silent corruption. Verified 0 rows are currently negative, so it applies
-- cleanly. Additive and idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.parts'::regclass
       AND conname = 'parts_quantity_non_negative'
  ) THEN
    ALTER TABLE public.parts
      ADD CONSTRAINT parts_quantity_non_negative CHECK (quantity >= 0);
  END IF;
END $$;
