# Pre-Migration Review

> Generated: 2026-06-23T17:26:39.533Z
> **Status: REVIEW REQUIRED — migration scripts are NOT generated until sign-off on this document.**

## 1. Totals

| Metric | Count |
| --- | --- |
| ERP tables | 142 |
| CRM public tables | 117 |
| CRM auth tables | 21 |

## 2. Mapping Breakdown

| Category | Count |
| --- | --- |
| Direct mappings | 3 |
| Transform / Partial mappings | 55 |
| Skip / Gap / No CRM target | 79 |

## 3. High-Risk Areas

- **`assigned_assets`** (Transform) → `customer_inventory`: 
- **`billing_manager`** (Transform) → `customer_invoices + users`: Billing cycles → CRM billing engine tables
- **`complaints_ticket`** (Transform) → `support_tickets + support_ticket_items + tickets`: ERP complaints → CRM support v3 model
- **`credit_and_debit_note`** (Transform) → `vendor_debit_notes + customer_credit_notes`: 
- **`customers`** (Transform) → `customers + customer_addresses + customer_documents`: Wide ERP row → normalized CRM; portal passwords → customer_portal_sessions
- **`customer_credit_note`** (Transform) → `customer_credit_notes`: Financial amounts must reconcile
- **`customer_rent_devices`** (Transform) → `customer_inventory + rent_devices`: Active rental assignments
- **`customer_wallets`** (Partial) → `customer_security_deposits`: Wallet vs security deposit model differs
- **`damage_parts_amount`** (Transform) → `diagnosis_parts_required + ticket_parts`: 
- **`delivery_challans`** (Transform) → `delivery_challan_lines + demo_agreements`: DC lines; OTP/esign fields in CRM migrations 086/102
- **`goods_received_notes`** (Transform) → `vendor_goods_received_notes + grn_*`: GRN headers + access numbers + serial capture tokens
- **`goods_received_notes_parts`** (Transform) → `vendor_goods_received_notes (parts lines)`: 
- **`inventory`** (Transform) → `inventory`: Status enum mapping; JSON extra_details; serial linkage
- **`invoices`** (Transform) → `customer_invoices + einvoice_records`: 
- **`orders`** (Partial) → `orders + order_items`: ERP e-commerce orders; may overlap sales_orders
- **`pod_submissions`** (Transform) → `delivery_challan_lines (pod fields)`: Proof of delivery
- **`product_details`** (Transform) → `vendor_product_details + inventory`: PO line / GRN product specs
- **`purchase_orders`** (Transform) → `vendor_purchase_orders`: PO header; status workflow mapping
- **`qc`** (Transform) → `qc_results + qc_photos`: Historical QC only — CRM stages/stage_checklists PRESERVED
- **`qc_truetech_delivery_challans`** (Transform) → `dc_qc_tickets`: 
- **`quotations`** (Transform) → `sales_quotations`: Quote lines embedded in ERP → normalized lines
- **`rent_devices`** (Transform) → `rent_devices`: Device master catalog
- **`sales_orders`** (Transform) → `sales_order_lines + sales_order_serials + sales_order_payments + orders`: ERP sales_orders is monolithic; CRM splits across SO module + legacy orders
- **`sellers`** (Transform) → `vendors + vendor_shops`: ERP sellers = CRM vendors; shop details separate
- **`serial_numbers`** (Transform) → `vendor_serial_numbers`: Serial uniqueness; TTSPL vs rental flags
- **`serial_number_parts`** (Transform) → `part_instances + vendor_serial_numbers`: 
- **`spare_parts_po`** (Transform) → `vendor_spare_parts_purchase_orders`: 
- **`split_rent_billing`** (Transform) → `customer_invoices (billing engine)`: 

## 4. Required Manual Decisions

1. **ID strategy:** Preserve ERP IDs in `erp_id_map` vs offset CRM sequences?
2. **Existing CRM data:** **Additive merge only** — never truncate auth, RBAC, or config tables (see AUTH_TABLES.md, SYSTEM_TABLES.md).
3. **ERP admins:** Match by email to existing CRM users; insert only if missing; **never reset roles/permissions**.
4. **sales_orders vs orders:** ERP has both — confirm which CRM tables receive which rows.
5. **File attachments:** ERP `storage/app/public` paths — copy files to CRM upload dir?
6. **Document numbers:** `last_unique_number` → bump `sm_document_sequences` to MAX(crm, erp); never lower.
7. **Leads:** CRM leads preserved — ERP `contacts` import disabled by default.
8. **QC stage mapping:** ERP `qc` history maps to existing CRM `stages` IDs — stage definitions not replaced.

## 4a. Data Preservation (mandatory)

- **Protected auth/RBAC:** users (no overwrite), roles, role_permissions, user_permissions, teams, user_teams, permission_sections, auth.*
- **Protected system:** schema_migrations, stages, asset_config_*, support_settings, companies, lead_auto_assign_config
- **Business data only:** customers, vendors, inventory, serials, POs, GRNs, SOs, DCs, tickets, QC results, billing

## 5. Estimated Data Volume (ERP top tables)

| Table | Est. Rows |
| --- | --- |
| delivery_challans | 130 |
| sales_orders | 100 |
| inward_outward | 73 |
| customer_rent_devices | 44 |
| customer_audit_logs | 40 |
| allocation_logs | 26 |
| product_details | 24 |
| serial_numbers | 19 |
| complaints_ticket | 16 |
| pod_submissions | 15 |
| inventory | 11 |
| serial_numberOnly | 8 |
| serial_number_parts | 7 |
| customers | 6 |
| customers_backup | 6 |

## 6. Sign-off Checklist

- [ ] Manual decisions resolved
- [ ] CRM backup taken
- [ ] ERP MySQL read replica or dump import available for migration runner
- [ ] File storage migration plan approved
- [ ] Validation thresholds agreed
- [ ] Rollback window scheduled

## 7. Next Step

After sign-off, generate `migration/scripts/*.js` and `migration/migrate-all.js` per MIGRATION_ORDER.md.
