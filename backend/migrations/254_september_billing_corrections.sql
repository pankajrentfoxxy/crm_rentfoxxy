-- Per-unit September corrections, from a physical verification of ten units.
--
-- Migration 253 reconciles every watermark that lags its invoice lines, which
-- covers six of these ten. This file handles the four that 253 cannot, because
-- their correct watermark is not derivable from invoice history.
--
-- Each UPDATE is guarded on the value it expects to find, so re-running is a
-- no-op and so a unit someone has already corrected by hand is left alone.

-- TTSPL3128 - ROADEXPRESS TECHNOLOGY, Rs 1,100/mo.
-- Has a watermark of 18 Jul and NOT ONE invoice line, so 253 skips it. Rent
-- starts 1 Aug. Verified as billable from September.
--   NOTE FOR FINANCE: August (1-31 Aug, Rs 1,100) is also genuinely unbilled on
--   this unit. Setting the watermark to 31 Aug bills September and October and
--   writes August off. Set it to '2026-07-31' instead to collect August too.
UPDATE public.vendor_serial_numbers
   SET rent_billed_until = DATE '2026-08-31', updated_at = NOW()
 WHERE inventory_asset_code = 'TTSPL3128'
   AND deleted_at IS NULL
   AND rent_billed_until::date = DATE '2026-07-18';

-- TTSPL5423 - MNR Solutions, Rs 999/mo.
-- Invoiced to 31 Aug, so 253 sets the watermark to 31 Aug. But rent_start_date
-- says 8 Sep while the unit was dispatched 13 Aug and delivered 14 Aug — a
-- rental cannot start 26 days after it was delivered. billStart is
-- max(watermark + 1, rent_start), so the bad rent_start would eat 1-7 Sep.
-- Corrected to the dispatch date per the rule that billing runs from the guard
-- scan. The watermark caps it, so this cannot reach into already-billed August.
UPDATE public.vendor_serial_numbers
   SET rent_start_date = DATE '2026-08-13', updated_at = NOW()
 WHERE inventory_asset_code = 'TTSPL5423'
   AND deleted_at IS NULL
   AND rent_start_date::date = DATE '2026-09-08';

-- TTSPL4053 - RATHAM TECHNOLOGIES, Rs 1,800/mo.
-- Invoiced 1-16 Sep (Rs 960) on INV-1129, which is already sent. It went out for
-- repair, came back 16 Sep and was re-dispatched 19 Sep on SDC/26-27/0006.
-- 253 would set the watermark to 16 Sep, which would then bill 19-30 Sep. Per
-- the verification, September is settled and the next charge is October, so the
-- watermark is pushed to month end. INV-1129 is not touched.
UPDATE public.vendor_serial_numbers
   SET rent_billed_until = DATE '2026-09-30', updated_at = NOW()
 WHERE inventory_asset_code = 'TTSPL4053'
   AND deleted_at IS NULL
   AND (rent_billed_until IS NULL OR rent_billed_until::date <= DATE '2026-09-30');

-- CN-0269 - Rs 2,220, pending, unapplied.
-- Both of its line items credit days that were never invoiced:
--   TTSPL4053  credits 17-30 Sep (Rs 840)   - billed only to 16 Sep
--   TTSPL3450  credits  8-30 Sep (Rs 1,380) - billed only to  7 Sep
-- Each unit's September invoice line was already pro-rated to its return date,
-- and then this note credited the remainder of the month on top. Approving it
-- would hand back Rs 2,220 that was never charged. Cancelled rather than deleted
-- so the note stays auditable — 'cancelled' is the existing terminal status for a
-- note that will not be honoured (31 already carry it), and the status CHECK
-- allows only pending/approved/applied/cancelled. Only 'approved' notes are ever
-- applied to an invoice, so it has not affected any bill.
UPDATE public.customer_credit_notes
   SET status = 'cancelled',
       description = COALESCE(description, '') ||
         ' [Cancelled 20 Sep 2026: both lines credit days that were never invoiced. '
         || 'TTSPL4053 was billed to 16 Sep and this credits 17-30 Sep; '
         || 'TTSPL3450 was billed to 7 Sep and this credits 8-30 Sep. '
         || 'The invoice lines were already pro-rated to the return dates.]',
       updated_at = NOW()
 WHERE credit_note_number = 'CN-0269'
   AND status = 'pending'
   AND applied_in_invoice_id IS NULL;
