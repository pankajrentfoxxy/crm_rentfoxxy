# Support V2 backlog

Captured from WP-14 so these are not rediscovered. P0 items 1–4 shipped in the field/repair-loop phase.

## P1

| # | Gap | Acceptance |
|---|---|---|
| 5 | No standby unit while under repair | At repair-pickup, offer a `customer_buffer_stock` unit; ship it with the pickup visit. |
| 6 | Part arrives after the visit | When a `PENDING_PART` line's part is issued, draft a second-visit WO automatically. |
| 7 | Failed visit does not pause SLA | Fail-visit sets `PENDING` / `PENDING_CUSTOMER` and notifies the customer. |
| 8 | e-Way bill number never captured | WO wizard shows `eway_bill_number` when `requires_eway_bill` is true. |
| 9 | No customer-facing status trail | Portal + WhatsApp events at picked up, received, under repair, ready, dispatched, delivered. |
| 10 | Attendance does not gate work | Block `Start work` unless checked in; lead can override. |
| 11 | Reassignment loses attribution | Job runner shows `completed_by` per step (already stored). |

## P2

| # | Gap | Acceptance |
|---|---|---|
| 12 | Lost in transit | Approval type + inventory write-off + insurance/claim record. |
| 13 | Repeat-failure escalation | Auto-raise a replacement recommendation at 3 complaints in 90 days. |
| 14 | No technician performance view | First-time-fix, average job time, failed-visit rate, parts-per-job. |

## Deliberately deferred from this phase

- Standalone GRN PDF download (receipt number is stored; PDF stamp on Return DC not yet drawn).
- Lead OTP reveal panel on TicketDetail / dispatch board (API `POST .../otp/reveal` exists).
- `heic2any` conversion.
- Immediate-invoice PDF for "Bill now".
