BILLING DATE AUDIT — Staging CRM
Generated: 2026-08-03T14:31:26.305Z

============================================================
WHY invoices miss units (rent_start_date IS NULL)
============================================================
Invoice generate requires:
  - current_customer_id set
  - inventory_status in (rented, returned)
  - rent_start_date IS NOT NULL
  - rent_start_date <= billing month start
  - rent_billed_until null or before month end

If rent_start_date is NULL, the laptop is completely skipped.
rent_billed_until stays NULL because it is only updated when a
unit is successfully billed.

Null rent_start categories found:
  - DELIVERY_EXISTS_BUT_RENT_START_NOT_ACTIVATED: 30
  - NEVER_ACTIVATED_NO_DC_NO_DELIVERY_DATE: 21

Common reasons rent_start stays null:
1) Unit put on customer / marked rented without going through
   finalizeDeliveryInventory (manual status, replacement, import, script).
2) Replacement units where new serial never got rent_start activated
   (example: TTSPL3172 / FVFG6CSRQ05D).
3) Delivery challan exists and is delivered, but serial fields were
   never synced (current_dc_number / rent_start_date left null).
4) Demo keep / conversion path did not set rent_start.
5) inventory_asset_code null + incomplete activation.

============================================================
WHY rent_start can be 28 Jul when DC delivered is 16 Jul
============================================================
Example: TTSPL4371 / GJY1HXFFQ0 (RHOPHI)
  - Return RDC001652: 11-13 Jul
  - Re-dispatch DC/26-27/0880: dispatched 13 Jul, DC delivered_at 16 Jul
  - CRM rent_start was 28 Jul (wrong for billing catch-up)

How CRM computes rent_start (inventoryStateMachine.computeRentStart):
  - inhouse / porter: rent_start = deliveredAt
  - courier (default): rent_start = MIN(deliveredAt, dispatchDate + 3 days)

Critical: when DC is marked delivered in CRM, finalizeDeliveryInventory
sets deliveredAt = NOW() (system click time), NOT the physical delivery
date typed on the challan.

So if ops marks "delivered" in the system on 28 Jul, rent_start can
become 28 Jul (especially inhouse/porter, or if dispatched_at was
missing at that moment).

If someone later corrects DC delivered_at to 16 Jul but does not use
the delivery-date correction API that recomputes rent_start, the DC
shows 16 Jul while rent_start stays 28 Jul. Invoice catch-up then
starts from 28 Jul and underbills 12 days.

============================================================
FILES
============================================================
01_rent_start_null.csv  (51 rows) — Rented/returned units with customer where rent_start_date IS NULL (invoice generate skips them)
02_rent_start_vs_dc_delivery_mismatch.csv  (66 rows) — rent_start_date != current DC delivered_at (TTSPL4371-type issue)
03_rent_start_vs_serial_delivered_mismatch.csv  (116 rows) — rent_start_date != serial.delivered_at (and not already in file 02)
04_all_issues_combined.csv  (233 rows) — All of the above in one file
README_why_these_issues.txt  ( rows) — Explanation of root causes

Category counts (combined):
  116	RENT_START_NE_SERIAL_DELIVERED_AT
  55	RENT_START_NE_DC_DELIVERED
  30	DELIVERY_EXISTS_BUT_RENT_START_NOT_ACTIVATED
  21	NEVER_ACTIVATED_NO_DC_NO_DELIVERY_DATE
  11	DC_DATE_CORRECTED_BUT_RENT_START_NOT_UPDATED

Path: /var/www/crm_rentfoxxy_staging/tmp/billing_audit
