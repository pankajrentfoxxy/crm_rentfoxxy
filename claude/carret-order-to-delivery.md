# Carret — Order to delivery: the working map

Written 25 Sep 2026 from three code surveys of `new_stagging_crm`. This is the build
reference for completing the Order-to-delivery process in Carret (the user's first
"complete one process end to end" target). All new screens call the endpoints below —
no parallel API (master doc rules 2 and 3). Old screens stay reachable until sign-off.

API base unless noted: `/api/sales-management` (FE: `features/sales-pipeline/salesPipelineApi.js`).

## The flow

1. **Quotation** — `POST /quotations` (sales_quotations/create). Lines are parallel arrays
   (`lineItemsToPayload`). Number EST-/GEST- allocated on save. Status:
   pending(draft) → sent (email, `POST /quotations/:n/send {email,cc}`) → approved (internal)
   → accepted (customer link, or staff `PATCH /quotations/:n/status {status:'accepted'}`)
   | rejected (closed). Rules in `canTransitionQuotation` (salesManagementService).
   PDF: `pdf_path`, else `POST /quotations/:n/pdf`.
2. **Sales order** — `POST /sales-orders` (any SO section/create). Needs an ACCEPTED
   quotation or none ('N/A'). Customer, type (sale|rental|demo), lines (processor, gen,
   RAM, storage required; rate > 0), security none|one_month_rental, shipping, WFH, shipping
   address. SO/yy-yy/NNNN. Detail: `GET /sales-orders/:n/full`. Edit `PATCH /sales-orders/:n`
   (no DC yet). Cancel `PATCH /sales-orders/:n/cancel`. Payments `POST /sales-orders/:n/payments`.
3. **Attach laptops** — `GET /sales-orders/:n/serials` (lines + allocations + summary),
   `GET /inventory/available-serials?processor&generation&ram&storage`,
   `POST /sales-orders/:n/serials {serial_id|ttspl_id|serial_number, line_id}` → reserves the
   unit and opens a Dispatch QC ticket (then assign via `/tickets/:id/assign`).
   Detach `DELETE /sales-orders/:n/serials/:allocId`. Per-unit delivery addresses:
   `PATCH /so-serials/:id/address`, `/so-lines/:id/address`, `/sales-orders/:n/serial-addresses`.
4. **Dispatch QC** — happens on the floor ticket per laptop (stage "Dispatch QC"), BEFORE
   the DC. Pass → `sales_order_serials.qc_status='passed'`. Only passed units can go on a DC.
5. **Delivery challan** — `GET /delivery-challans/meta/add?sales_order_number=` then
   `POST /create-dcs-by-address {sales_order_number, ship_by, dc_groups:[{delivery_address,
   allocation_ids, courier_name, awb_number, porter_*, delivery_person_id, vehicle_number,
   laptop_shipments[]}]}` → one DC per address, status **dispatch_ready**. BlueDart AWB:
   `POST /bluedart/generate-waybill`. Detail `GET /delivery-challans/:dc`,
   `GET /delivery-challans/:dc/qc-status`. Change mode/assignee `PATCH /delivery-challans/:dc/assignment`.
   PDF `POST /delivery-challans/:dc/pdf` (locked by e-way / e-invoice). Cancel (super_admin)
   `PATCH /delivery-challans/:dc/cancel`.
6. **E-way bill** — asset value (processor+gen matrix) ≥ ₹50,000 → `eway_required`. Notify
   Accounts `POST /delivery-challans/:dc/request-demo-eway`; upload (dc_eway_bill) multipart
   `POST /delivery-challans/:dc/demo-eway {eway_bill_number, eway_bill_date, eway_bill_pdf,
   vehicle_number}`. Sale / first DC also needs e-invoice: `POST /:dc/sale-compliance`.
7. **Guard gate outward** — `/api/guard-gate`: `GET /preflight/:dc`, `POST /resolve
   {direction, scan}`, `POST /sessions/:id/scan {scan}`, `POST /sessions/:id/confirm`.
   Confirm re-runs the pre-flight (DC ready, Dispatch QC, e-way, AWB) and moves DC + units
   `dispatch_ready → in_transit`, raises the first rental invoice. There is NO outward
   at_gate (decision 21 Sep 2026).
8. **Delivery** — one routine, `deliveryCompletionService.completeDelivery`:
   - by hand: `PATCH /:dc/reached`, `POST /:dc/verify-serial` (issues OTP), `POST /:dc/deliver`
     multipart {otp, pod_type photo|esign, pod_photo, esign_data, notes} — tech_bucket edit
   - admin/courier manual: `PATCH /:dc/admin-deliver` multipart {pod_photo*, reason, notes}
   - courier auto: BlueDart sweep (every 20 min)
   Rejection: `PATCH /:dc/rejected {rejection_reason, rejection_remarks}` or
   `/customer-rejected`; units → at_gate; guard INWARD scan; then warehouse receive
   `GET /:dc/warehouse-return-units` + `POST /:dc/warehouse-receive-back {esign_data,
   signer_name, remarks, units[]}` → QC re-entry, SO allocation back to attached.
   Lists: `GET /delivery-flow?status=`, `GET /my-deliveries`.

## Known bugs on this path (fix as each step is built)

- [x] Quotation form burned a number per open (peek now) — 25 Sep
- [x] accepted_at not set by staff accept; rejected quote re-openable via email link — 25 Sep
- [x] SO form listed `approved` quotes but backend needs `accepted` — Carret form lists accepted (old form unchanged)
- [x] Quotation validity/terms/remarks persisted (migration 327, applied to QA 26 Sep), printed on the PDF; header remark travels as `quotation_remarks` (`remarks` is the line array)
- [ ] SO advance_* still not persisted (no columns) — Carret SO form does not offer them
- [x] `attachSerial` early returns after BEGIN with no ROLLBACK — fixed + test 25 Sep
- [x] Carret `useChallans` read the wrong keys — fixed; returns read /return-dc
- [x] Porter DCs refused at gate with AWB_MISSING — porter_tracking_id accepted, test 25 Sep
- [x] Gate confirm refusal: event re-recorded after ROLLBACK, 409 with failures — 25 Sep
- [x] ProofRejected now answers 400 with what is missing; Carret never calls PATCH /delivered without proof
- [x] Hardened OTP wired into all six issue/verify sites; plaintext no longer stored — 26 Sep
- [ ] Warehouse-return OTP is still plaintext (now CSPRNG); hashing it needs columns
- [x] Register POD upload goes through completeDelivery / the rejection service; mixed POD refused (409) — 26 Sep
- [x] BlueDart auto-delivery now sends the delivered WhatsApp (no PDF regen yet)
- [ ] Technician portal dashboard filters legacy status='pending'
- [x] Accept via PATCH status 500'd (`inconsistent types deduced for parameter $1`) — cast, DB test, 25 Sep
- [x] Challan PDF e-way lock answered 500 — now 403 with the reason

## Carret screens (built 25 Sep 2026)

/carret/sell/quotations (+/new, /:qn) · /carret/sell/sales-orders (+/new, /:so, /:so/edit) ·
/carret/move/challans (+/new?so=, /:dc) · /carret/move/gate (?dc=) · /carret/move/deliveries ·
/carret/move/my-deliveries · /carret/move/tracking. Old screens under "Old view" in the menu.
