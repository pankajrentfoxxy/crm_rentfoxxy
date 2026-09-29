# Money / Finance in the new UI (28 Sep 2026)

Pending item 8. Survey done 28 Sep; decisions M1–M12 below await the user.

## Found (28 Sep, QA)
- **Dead menu links**: 7 Finance entries in `frontend/src/config/navigation.js:196-216` (invoices, credit notes,
  security deposits, vendor bills, debit notes, payments, e-way bills) open a blank page. DC / Sale invoice
  queues are gated on `customer_billing` but the API needs `einvoice_ewb`.
- **Customer invoices**: the CGST/SGST vs IGST split, due date and "generated" event are applied only by the
  single Generate button — bulk generate, cron, invoice-on-delivery and postpaid skip them. Invoices auto-sent on
  delivery have no due date → never overdue, in no ageing bucket. Cancel has no lock / status guard and does not
  release applied credit notes / security lines. No customer-scope check on `/api/customer-billing`.
- **Payments** (`paymentLedgerService.js`): no row lock, no overpayment cap, a cancelled / draft invoice can be
  paid, double-click posts twice, two "mark paid" clicks post two full payments. The new UI has no Record
  payment button (hook exists, unused). SO payments of type security_deposit never create a deposit row.
- **Credit notes**: manual numbering outside the transaction and in a different format (`CN0001`) from the
  scheduler's (`CN/26-27/000123`) in the same series; amount can be 0 / negative; invoice not checked against
  customer; no maker-checker. Nothing in the new UI.
- **Security deposits**: the standalone Refund route still exists (contradicts SD1) and can double-refund
  (no lock); closure marks a Rs 0 refund as partially_refunded; amount kept against dues is not posted to invoices.
- **Vendor bills**: GST hardcoded `subtotal * 0.18`, no CGST/SGST/IGST split stored; debit notes created after
  the bill month are marked "adjusted" without being deducted (credit lost); maker-checker never works
  (generated_by not written); **Cancel always fails** — the status CHECK has no 'cancelled' (verified on QA).
  Second legacy `vendor_billing` table / screen alongside. QA: 23 bills, all 'generated'.
  Blockers: ~1,025 laptops rent-start 2027-02-07 on live; vendor rates to confirm (pending C13/C14).
- **Debit notes**: return / repair drafts are created at Rs 0 with "set the amount and approve", but there is no
  way to set the amount or cancel — approving approves Rs 0 (6 such drafts on QA). Numbering outside the transaction.
- **DC invoice queue / Sale invoice queue**: work on old screens; queue amount is an estimate; attached
  e-invoice / sale-invoice numbers can be silently overwritten, no duplicate check.
- **E-invoice via Zoho GSP (IRN)**: no screen calls it; hard 9+9 GST, always intra-state, DC number used as
  invoice number, e-way payload not NIC format. Legacy `/api/sales/orders/:id/generate-invoice|generate-eway`
  make up fake INV-/EWB- numbers.
- **E-way bills**: handled per document (outbound DC, demo DC, VRDC, VRTDC) — no single list.
- Service billing (gorefurbo, 350/352) is the good pattern: computeGstBreakdown + FY number in the transaction.

## Decisions (to be answered)
See the chat of 28 Sep; answers recorded here once given.
