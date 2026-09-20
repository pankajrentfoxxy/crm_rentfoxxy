-- Reconcile rent_billed_until with what was actually invoiced.
--
-- rent_billed_until is the watermark the billing scheduler resumes from. It is
-- advanced at the bottom of the per-serial loop, but several paths write invoice
-- lines without advancing it, and the ERP import set it from a rental start date
-- rather than from billing history. The result is a watermark that lags the real
-- invoiced-through date — TTSPL4317 says 20 Aug while it has been invoiced to
-- 30 Sep, and 39 other units are in the same state.
--
-- Today this is mostly harmless, because the scheduler's catch-up guard snaps
-- billStart forward to the 1st of the month being billed whenever a unit has no
-- marked delivery in the previous month. That guard is being removed for units
-- that DO have a watermark (so September stops being silently dropped). The
-- moment it is removed, a lagging watermark stops being cosmetic and becomes a
-- re-bill: a unit whose watermark says 18 Jul but which is invoiced to 31 Aug
-- would be billed 19 Jul - 31 Oct, charging the customer twice for six weeks
-- they have already paid for. Across the 40 affected units that is Rs 95,252.
--
-- So this must be applied BEFORE the scheduler change, not after.
--
-- The rule: where a unit has invoice lines and its watermark is NULL or older
-- than the newest rent_end on those lines, set the watermark to that rent_end.
-- Never move a watermark backwards — a watermark ahead of the invoice lines can
-- be a Zoho-acknowledged bill or a manual correction, and pulling it back would
-- re-bill. There are none in that state right now; the guard is here so a later
-- replay cannot introduce one.
--
-- Units with a watermark but no invoice lines are deliberately left alone. There
-- are 6, and clearing the watermark would bill them from rent_start_date, which
-- for an ERP-imported unit can be years ago.
--
-- Idempotent: re-running changes nothing once the watermarks agree.

UPDATE public.vendor_serial_numbers v
   SET rent_billed_until = inv.maxend,
       updated_at = NOW()
  FROM (
    SELECT serial_id, MAX(rent_end)::date AS maxend
      FROM public.customer_invoice_lines
     WHERE rent_end IS NOT NULL
     GROUP BY serial_id
  ) inv
 WHERE inv.serial_id = v.serial_id
   AND v.deleted_at IS NULL
   AND v.current_customer_id IS NOT NULL
   AND COALESCE(v.inventory_status, '') NOT IN ('sold', 'scrapped')
   AND (v.rent_billed_until IS NULL OR v.rent_billed_until::date < inv.maxend);
