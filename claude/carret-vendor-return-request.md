# Carret — Vendor return request (D10): the build spec

Asked 26 Sep 2026. Returning an existing rented laptop to its vendor gets one proper channel:
**return request → vendor mail + PDF → vendor confirms → return challan (VRTDC) with transport →
e-way mail to Accounts at ₹50,000+ → gate → (in-house: technician bucket) → vendor has it.**

## Decisions (user, 26 Sep)
- **D10:** rent stops on a date the user picks on the request — **today or later** (up to 30 days
  ahead), no backdating. "Rent stops from 1 Oct" means 1 Oct is not billed: the last billed day
  (`vendor_serial_numbers.vendor_rent_end_date`, inclusive in `calcVendorLineAmount`) is the day before.
  A date that has passed while the request sat unsent must be re-picked before sending.
- **Cancel after the mail went out:** rent resumes (the end date this request set is cleared) and the
  vendor gets a short cancellation mail with the same CCs. Not possible once a laptop is on a
  challan that has left the gate.
- **One channel:** rented laptops in good condition (`in_stock` / `returned`, rent still running)
  go back only through a request. Direct challans ("To send back") stay for QC-failed and
  rejected-at-door laptops.

## What already existed (kept, extended — no parallel flow)
Return tickets (`vendorReturnTicketService`, `VRT/..`), notify mail (rent stopped *at notify*, no
date choice, no PDF, CC from env), VRTDC create/dispatch/gate/complete (`vendorReturnToVendorService`),
e-way request mail to Accounts (manual button, threshold `> 50,000`), gate block without e-way,
in-house VRTDCs in the technician bucket after the gate scan (`vendorReturnDeliveryFlow`).

## Build
1. **Migration 342** — `vendor_return_tickets`: rent_stop_date, pickup_date, pickup_time, reason_code,
   request_pdf_path, notify_to, notify_cc, cancelled_at, cancel_reason, cancel_mail_sent_at.
   `vendor_return_delivery_challans`: porter_person_name/phone, delivery_person_name/phone,
   eway_auto_mail_at, eway_auto_mail_error.
2. **Request** — create with vendor, laptops, reason (customer returned / surplus / faulty /
   requirement ended / other), rent-stop date, pickup date + time, remarks. Editable until sent.
   Preview endpoint (subject, To, CC, HTML) + request PDF download.
3. **Send to vendor** (one transaction, mail last — a failed mail changes nothing): items
   `rental_stopped`, `vendor_rent_end_date = stop date − 1`, request PDF attached (vendor block, our
   block, stop date, pickup slot + address, laptops with TTSPL, serial, brand/model, processor, RAM,
   storage, PO). To the vendor's email; CC `VENDOR_RETURN_REQUEST_CC`, default
   accounts@truetechservices.in, pankkajyadav@rentfoxxy.com, warehouse@rentfoxxy.com, adminn@rentfoxxy.com.
   Signed "TrueTech Services Pvt. Ltd."
4. **Cancel** — before sending: nothing to undo. After: clear the end date where it is still the one
   this request set and the laptop is still ours, cancellation mail (same rule: mail fails → nothing
   changes).
5. **Direct challan guard** — `createReturnDc` refuses a rented, rent-running, in_stock/returned laptop
   unless called from a request; the "To send back" list marks those rows.
6. **Challan transport (VRTDC only; VRDC's shared validator untouched)**
   - Courier: courier name + tracking ID (AWB) required.
   - Porter: person name, phone, vehicle (bike) number required; booking ID optional.
   - Vendor pickup: name, phone, vehicle number required.
   - In-house: our delivery person (from the delivery technicians list — that is whose bucket it lands
     in), phone, vehicle number required. Shows in the technician bucket once the guard scans it out.
   Declared values pre-filled from the PO line's asset value (still editable, still required).
7. **E-way** — VRTDC threshold becomes **≥ ₹50,000** (VRDC unchanged). On "Send to the gate", if the
   total qualifies, the Accounts mail goes automatically (after commit): brand/model summary with
   count and value, total, transport details, per-laptop table, challan PDF attached. A failed auto
   mail is recorded and the existing "Send for E-way bill" button resends. Gate still blocks until
   Accounts enters the bill.
8. **Screens** — Procure → Vendor returns → Rental returns: "New return request" form, request record
   (mail preview, PDF, send, cancel, make challan). Challan record gets the new transport fields.
9. Tests (`test/vendorReturnRequest.test.js`), migration on QA, build, QA click-through.

## At promotion
Migration 342 on live; set `VENDOR_RETURN_REQUEST_CC` only if the default list should differ.
QA's outbound guard sends vendor mail only when every recipient is internal — test with a vendor
whose email is @rentfoxxy.com.

## Built 26 Sep — status
All of the above is on QA (migration 342 applied, backend restarted, frontend rebuilt). Tests:
`test/vendorReturnRequest.test.js` 14/14; full suite 473 pass, 0 fail.

## QA click-through (qa.rentfoxxy.com → Procure → Vendor returns)
QA only mails internal addresses. The vendor **C PROMPT SOLUTIONS** has an internal email on QA,
so use it. **A send really mails the four CC inboxes** (accounts@truetechservices.in included).
1. Return requests → **New return request** → C PROMPT → pick 1–2 laptops → reason, rent stop
   (try yesterday: refused), pickup date + time → Save and preview.
2. On the record: check the mail preview (To, CC, subject, wording) and **PDF**; **Change** the
   pickup time; **Send to vendor** → rent stop shown, "Waiting for pickup".
3. Take one laptop off (reason required) → vendor gets the "Cancelled" mail; its rent resumes.
4. **Make return challan** → the challan opens with values (enter them; ≥ ₹50,000 in total to see
   the e-way mail) → try each mode's required fields → **Send to the gate** → toast says Accounts was mailed.
5. To send back → "Everything in the warehouse": rented good laptops can't be ticked; they point
   to a return request.
6. Old view: the old return-challan screen's transport form now asks the same fields.
7. In-house: after the guard scans it out, it appears in that delivery person's technician bucket.
