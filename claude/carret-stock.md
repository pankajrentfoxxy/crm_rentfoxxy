# Stock in the new UI (27 Sep 2026)

## Decisions (user, 27 Sep)
- **ST-D1 NPA = "Not earning"**: any laptop not earning rent or sold for more than 30 days —
  in stock, in repair, returned awaiting QC, at a vendor, or "rented" with no customer / no
  rate / not billed. Shows age, where it is, and the money tied up.
- **ST-D2 Scrap**: request (reason) → manager approves → laptop scrapped → leaves on a Scrap
  Challan to a buyer with a sale value (same challan as scrapped parts). Asset Movement can no
  longer scrap. Dismantle (PD14, floor lead) stays as it is and is recorded.
- **ST-D3 Ready stock**: only QC-passed laptops are ready. Every ready laptop has a tag (Rent /
  Sell / Both) and a carret slot. Warehouse can re-tag or move with a reason (logged). The
  unused "Take Action" dropdown goes.
- **ST-D4 Data**: one CSV per problem with the proposed fix → reviewed → a script applies it
  on QA with a backup (live at promotion).

## What exists (found 27 Sep)
| Menu item | Today |
|---|---|
| Assets | Old: one search box + super-admin status fix. New list: cannot load (calls `/lists` which does not exist; "rented" not a segment; status filter ignored). New record: read-only. |
| Ready to Rent or Sell | Old list of QC-passed + available. Tag super-admin only; 416/463 in-stock untagged; 421 no slot; "Take Action" writes a value nothing reads. Menu guard ≠ route guard. |
| Asset Movements | Bulk bucket moves with allowOverride, not transactional; `dead` scraps with no approval; `missing` is not a canonical status; `qc_process` sets in_stock (other path sets in_repair); slots not vacated. |
| Scrapped | Opens the PARTS scrap challan. No laptop challan, buyer, sale value. Cancel hard-deletes; MAX+1 numbering; hardcoded roles. 121/129 scrapped laptops have no history. |
| NPA Assets | Placeholder; count hard-coded 0. |
| Customer Inventory | Redirect to customer list. Real fleet view (`/inventory-management/customer-assets`) not in the new menu. 96 rented laptops lost their customer (canonicalisation 21 Sep). |
| Master Data | Working reports; exclude-from-vendor-PO PATCH needs only view. |
| Asset Configuration | Working master lists; no UI permission gating; duplicates (models, processors); dead mapping rows. |

## Build
1. **Safety fixes (backend)**
   - Asset movement: one transaction; targets = qc_pending / qc_process (→ in_repair) / passed
     (needs tag + slot); `dead` and `missing` removed (dead → scrap request); slot vacated
     when a laptop leaves passed.
   - Location: only ready (QC-passed, available) laptops; clear allowed; clash → 409.
   - Tag: warehouse (ready_to_rent_location edit) with a reason, bulk endpoint, logged.
   - Ready-to-rent "Take Action" endpoint needs edit (UI removed).
   - Master data exclude-from-PO needs edit. Scrap challan: cancel keeps the record
     (status cancelled), numbering locked, permission = role set OR scrap_challans grant.
   - QC `require_for_parts`: status + qc in one transaction.
2. **Laptop scrap** (migration): `laptop_scrap_requests`; section `scrap_approval`
   (admin, manager, super_admin); approval → transitionAsset(scrapped) + slot vacated +
   customer/DC cleared; scrap challan items can be laptops, with a sale value per item and a
   buyer; challan sale total.
3. **Not earning** endpoint + page.
4. **Stock API for the new UI**: assets list (all laptops, filters: status, tag, slot, customer,
   search incl. PO; paginated), ready stock summary, fleet with customers.
5. **Screens** (Stock menu): Assets (fixed) + record actions (re-tag, move slot, scrap
   request, super-admin status fix, vendor/PO), Ready stock, Stock moves, Scrap (requests /
   to challan / challans), Not earning, With customers. Master Data + Asset Configuration stay
   on the old screens (reports / admin), bugs fixed.
6. **Clean-up CSVs** (ST-D4) in `claude/reports/stock-cleanup-*.csv` + apply script (after review).
7. **After review**: `asset_available` = QC-passed only (today 286 un-QC'd laptops are
   attachable; D5 had left qc_status out because it was unreliable — the clean-up fixes that).
