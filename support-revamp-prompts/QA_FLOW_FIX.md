# Support V2 flow-fix — manual QA

Walk this on the local prod-copy stack before merge.

## 1. Customer switch
1. New ticket → search customer A → contact fills.
2. Search customer B → confirm dialog if machines were entered; after confirm, contact is B’s and Machines/Classify are empty.
3. Select A, type a custom mobile (Someone else), click A again → typed mobile stays.

## 2. Site from machine
1. Customer with machines at two sites. Search a TTSPL on step 2.
2. Location banner shows address, pincode, DC, and other machines at that site.
3. Tick a machine from the other pincode → block dialog; site_key does not change unless you switch.

## 3. Evidence
1. Classify a chargeable issue. Attach 3 photos. Lightbox arrows work. Delete one.
2. On a second machine, Skip — customer will send. Continue is enabled.
3. Created ticket shows Photos pending strip. Chargeable approval is blocked.

## 4. Assign
1. Step 4 shows Remote / Inhouse / city teams only.
2. Pincode 560034 suggests Bengaluru. No date/time fields.
3. **Create ticket and continue to work order** opens the WO wizard.

## 5. Courier WO
1. Type Repair pickup, method Courier.
2. No slot grid, no technician field. Partner required. Direction = pickup.

## 6. Technician WO
1. Method Technician. 09:30–19:00 grid, 7 days.
2. Select 3 non-contiguous slots. Create. Double-book is rejected.

## 7. Parts + charge
1. Pre-book a chargeable part (Customer damage). Photo required. Price from master.
2. Lead approves. Technician fits. Extra line appears. Bill now vs Add to monthly.

## 8. Field + repair loop (Phase 2)
1. Log in as technician → sidebar has only My jobs and My parts. `/support/queue`, `/support/tickets/new`, `/support/taxonomy`, `/support/returns/receipt` redirect to `/support/bucket`.
2. Open a job → reported issue, TTSPL, model, customer photos and history visible before any step.
3. Run a repair pickup: wrong serial once, correct once, OTP resend once, complete.
4. Three-machine visit → three scans and three photo sets.
5. Courier repair pickup → AWB / packed photo / handover / POD. No GPS or OTP.
6. Warehouse: search/scan from the queue, receive partially, sign. Inventory must not move before the signature.
7. Floor ticket shows CUSTOMER MACHINE banner + reported problem. Completing it drafts a SERVICE_RETURN and notifies the lead.
8. Completing the service return sets `hold_to` and restores the customer inventory state.

## Login (local copy only)
`admin@rentfoxxy.com` / the password already set on `rentfoxxy_prod_copy`.
