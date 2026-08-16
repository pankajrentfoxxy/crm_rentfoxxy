# Support user guide

The live module is `/support`. `/support-legacy` is read-only for admins for 30 days.

## Agent

1. **Raise a ticket** — Support → New ticket. Pick the customer, add every machine, classify type / subtype / issue (15+ character description).
2. **Classify** — if a line is still Unspecified, open the ticket and classify before releasing work.
3. **Link a duplicate** — on the ticket, Link, then the surviving ticket number.
4. **Resolve remotely** — complete a Remote fix work order, or resolve the line with resolution + root cause + action codes.
5. **Pause correctly** — Pause needs a reason. `PENDING_CUSTOMER` also needs a contact method and a reference (call / email / WhatsApp).

## Lead

1. **Triage** — Command centre, then the ticket. Confirm priority or override with a reason.
2. **Assign** — queue bulk-assign, or assign the ticket / work order to a group or person.
3. **Dispatch board** — auto-assign or drag to a technician. Watch capacity (default 6 jobs / day).
4. **Override priority** — ticket → priority override. It writes an approval event.
5. **Handle a breach** — SLA & breaches. A breached ticket cannot close without a reason.

## Technician

1. **Accept** — My bucket → Accept (within the accept window).
2. **Navigate** — En route, then On site. Customer gets the ETA WhatsApp when the template is on.
3. **Execute the checklist** — GPS, scan, photos, OTP, signature. Mandatory steps block complete.
4. **Request a part** — from the job. Warehouse approves; you fit it and photograph it.
5. **Complete** — found issue, action codes, 20+ character notes, outcome.

## Warehouse

1. **Approve parts** — Parts queue. Lead threshold and manager threshold live in Settings.
2. **Receive returns** — Warehouse receipt. Scan, grade condition, photos.
3. **Grade condition** — required on return / repair pickup before the floor ticket opens.

## Manager

1. **Approvals** — Approvals inbox. Chargeable / replacement / SLA waiver.
2. **Breach register** — SLA & breaches. Missing reason shows “Not yet given”.
3. **Monthly reports** — Reports (S20): volume, SLA, quality (FCR, CSAT, accuracy), field, assets (failure rate by model), parts, commercial recovery.
4. **Settings** — change auto-close hours, free repair days, and approval thresholds without a deploy.
