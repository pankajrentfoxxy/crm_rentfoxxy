# ERP → CRM Schema Mapping

> Generated: 2026-06-23T17:26:39.533Z

## Mapping Summary

| Mapping Type | Count |
| --- | --- |
| Skip | 74 |
| Transform | 37 |
| Partial | 18 |
| Additive | 4 |
| Gap | 4 |
| Direct | 3 |
| MonotonicBump | 1 |
| Archive | 1 |

## Complete ERP Table Mapping

| ERP Table | CRM Target | Type | Risk | Est. ERP Rows |
| --- | --- | --- | --- | --- |
| about_sliders | — | Skip | None | ? |
| admin_roles | — | Skip | None | 1 |
| admin_wallet_histories | — | Skip | Low | ? |
| admin_wallets | — | Skip | Low | ? |
| admins | users | Additive | Medium | 1 |
| allocation_logs | allocation_logs | Direct | Medium | 26 |
| assigned_assets | customer_inventory | Transform | High | ? |
| attributes | asset_config_* | Additive | Low | 1 |
| banners | — | Skip | None | ? |
| billing_addresses | customer_addresses | Transform | Medium | ? |
| billing_manager | customer_invoices + users | Transform | High | ? |
| blog_posts | — | Skip | None | ? |
| brands | asset_config_brands + laptop_catalog | Additive | Low | 1 |
| bundle_management | laptop_catalog | Additive | Low | 2 |
| business_settings | — | Skip | Low | 1 |
| cache | — | Skip | None | 1 |
| cart_shippings | — | Skip | None | ? |
| carts | — | Skip | None | ? |
| categories | — | Skip | None | ? |
| category_shipping_costs | — | Skip | None | ? |
| chattings | — | Skip | None | ? |
| colors | — | Skip | None | ? |
| complaints_ticket | support_tickets + support_ticket_items + tickets | Transform | Critical | 16 |
| contacts | leads | Partial | Medium | ? |
| coupons | — | Skip | None | ? |
| courier_details | sm_courier_details | Direct | Low | ? |
| credit_and_debit_note | vendor_debit_notes + customer_credit_notes | Transform | Critical | ? |
| currencies | — | Skip | Low | 1 |
| customer_audit_logs | ttspl_audit_log / permission_audit_logs | Partial | Medium | 40 |
| customer_credit_note | customer_credit_notes | Transform | High | ? |
| customer_rent_devices | customer_inventory + rent_devices | Transform | High | 44 |
| customer_wallet_histories | — | Gap | Medium | ? |
| customer_wallets | customer_security_deposits | Partial | High | ? |
| customers | customers + customer_addresses + customer_documents | Transform | High | 6 |
| customers_backup | — | Skip | Low | 6 |
| customers_update | — | Skip | Low | 6 |
| damage_parts_amount | diagnosis_parts_required + ticket_parts | Transform | High | 1 |
| data_table | — | Skip | None | ? |
| deal_of_the_days | — | Skip | None | ? |
| delivery_challans | delivery_challan_lines + demo_agreements | Transform | Critical | 130 |
| delivery_country_codes | — | Skip | None | ? |
| delivery_histories | activities / work_logs | Partial | Medium | ? |
| delivery_man_transactions | — | Skip | None | ? |
| delivery_men | delivery_technicians | Transform | Medium | 1 |
| delivery_zip_codes | — | Skip | None | ? |
| deliveryman_notifications | — | Skip | None | ? |
| deliveryman_wallets | — | Skip | None | ? |
| emergency_contacts | — | Skip | Low | ? |
| failed_jobs | — | Skip | None | ? |
| feature_deals | — | Skip | None | ? |
| flash_deal_products | — | Skip | None | ? |
| flash_deals | — | Skip | None | ? |
| goods_received_notes | vendor_goods_received_notes + grn_* | Transform | Critical | 1 |
| goods_received_notes_parts | vendor_goods_received_notes (parts lines) | Transform | High | 4 |
| help_topics | — | Skip | None | ? |
| insert_allocation_log_old_new | — | Skip | Low | 1 |
| inventory | inventory | Transform | Critical | 11 |
| invoices | customer_invoices + einvoice_records | Transform | Critical | ? |
| inward_outward | inward_outward | Direct | Medium | 73 |
| issue_types | support_issue_categories | Transform | Low | 1 |
| items | — | Skip | Low | ? |
| jobs | — | Skip | None | 1 |
| last_unique_number | sm_document_sequences | MonotonicBump | Medium | 1 |
| loyalty_point_transactions | — | Skip | None | ? |
| migrations | schema_migrations | Skip | None | 1 |
| new_modules | — | Skip | None | 1 |
| new_user_permissions | — | Skip | None | 2 |
| notifications | email_queue | Partial | Low | ? |
| npa_assets | inventory (disposition=npa) | Transform | Medium | ? |
| oauth_access_tokens | — | Skip | None | ? |
| oauth_auth_codes | — | Skip | None | ? |
| oauth_clients | — | Skip | None | ? |
| oauth_personal_access_clients | — | Skip | None | ? |
| oauth_refresh_tokens | — | Skip | None | ? |
| old_product_details | — | Archive | Low | 1 |
| order_details | order_items | Transform | Medium | ? |
| order_expected_delivery_histories | activities | Partial | Low | ? |
| order_status_histories | activities | Partial | Low | ? |
| order_transactions | sales_order_payments | Partial | Medium | ? |
| orders | orders + order_items | Partial | High | ? |
| password_resets | — | Skip | None | 1 |
| paytabs_invoices | customer_invoices | Partial | Medium | ? |
| personal_access_tokens | — | Skip | None | 1 |
| phone_or_email_verifications | — | Skip | None | ? |
| pod_submissions | delivery_challan_lines (pod fields) | Transform | High | 15 |
| product_details | vendor_product_details + inventory | Transform | Critical | 24 |
| product_stocks | vendor_product_inventory | Partial | Medium | ? |
| product_tag | — | Skip | None | ? |
| products | vendor_product_inventory | Partial | Medium | ? |
| purchase_orders | vendor_purchase_orders | Transform | Critical | 3 |
| qc | qc_results + qc_photos | Transform | High | ? |
| qc_logs | qc_results / repair_logs | Partial | Medium | ? |
| qc_truetech_delivery_challans | dc_qc_tickets | Transform | High | 1 |
| quotations | sales_quotations | Transform | High | ? |
| refund_requests | — | Skip | Low | ? |
| refund_statuses | — | Skip | None | ? |
| refund_transactions | — | Skip | None | ? |
| rent_devices | rent_devices | Transform | High | 5 |
| rent_reports | — | Gap | Medium | 1 |
| rent_reports_customer | — | Gap | Medium | 1 |
| repair_logs | repair_logs + chip_level_repairs | Transform | Medium | 1 |
| review_sets | — | Skip | None | ? |
| reviews | — | Skip | None | ? |
| role_permissions | — | Skip | None | 1 |
| roles | — | Skip | None | 1 |
| roles_modules | — | Skip | None | 1 |
| sales_orders | sales_order_lines + sales_order_serials + sales_order_payments + orders | Transform | Critical | 100 |
| search_functions | — | Skip | None | ? |
| seller_wallet_histories | — | Gap | Medium | ? |
| seller_wallets | vendor_wallets | Partial | Medium | 1 |
| sellers | vendors + vendor_shops | Transform | High | 2 |
| serial_numberOnly | vendor_serial_numbers | Partial | Medium | 8 |
| serial_number_parts | part_instances + vendor_serial_numbers | Transform | High | 7 |
| serial_number_update_logs | vendor_serial_number_audit | Transform | Medium | 1 |
| serial_numbers | vendor_serial_numbers | Transform | Critical | 19 |
| sessions | — | Skip | None | 2 |
| shipping_addresses | customer_addresses | Transform | Medium | ? |
| shipping_methods | — | Skip | None | ? |
| shipping_types | — | Skip | None | ? |
| shops | vendor_shops | Partial | Low | 1 |
| social_medias | — | Skip | None | ? |
| soft_credentials | — | Skip | None | ? |
| spare_parts | spare_parts + vendor_spare_parts_catalog | Transform | Medium | 1 |
| spare_parts_po | vendor_spare_parts_purchase_orders | Transform | High | 4 |
| split_rent_billing | customer_invoices (billing engine) | Transform | High | ? |
| stock_products | — | Skip | Low | ? |
| sub_modules | permission_sections | Partial | Low | ? |
| subscriptions | — | Skip | None | ? |
| support_ticket_convs | support_ticket_item_comments | Transform | Medium | ? |
| support_tickets | support_tickets | Partial | Medium | ? |
| tags | — | Skip | None | ? |
| team_members | — | Skip | None | ? |
| transactions | — | Skip | Low | ? |
| translations | — | Skip | None | ? |
| users | — | Skip | Low | ? |
| video | — | Skip | None | ? |
| videos | — | Skip | None | ? |
| wallet_transactions | — | Skip | Low | ? |
| warehouse | teams (warehouse team) | Transform | Low | ? |
| wishlists | — | Skip | None | ? |
| withdraw_requests | — | Skip | None | ? |
| withdrawal_methods | — | Skip | None | ? |

## Detailed Mapping Notes

### `about_sliders` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CMS
- **ERP columns (5):** id, image, status, created_at, updated_at

### `admin_roles` → `SKIP` (Skip)

- **Risk:** None
- **Note:** PRESERVE CRM roles — see AUTH_TABLES.md
- **ERP columns (6):** id, name, module_access, status, created_at, updated_at

### `admin_wallet_histories` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** 
- **ERP columns (8):** id, admin_id, amount, order_id, product_id, payment, created_at, updated_at

### `admin_wallets` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** 
- **ERP columns (10):** id, admin_id, inhouse_earning, withdrawn, created_at, updated_at, commission_earned, delivery_charge_earned, pending_amount, total_tax_collected

### `admins` → `users` (Additive)

- **Risk:** Medium
- **Note:** Match by email; insert only if missing; never overwrite role/password
- **ERP columns (16):** id, admin_type, name, phone, admin_role_id, image, email, email_verified_at, password, remember_token, see_price_permission, created_at, updated_at, is_superadmin, status, role_id

### `allocation_logs` → `allocation_logs` (Direct)

- **Risk:** Medium
- **Note:** Column names differ slightly; FK ids remapped
- **ERP columns (32):** id, user_id, vendor_name, vendor_id, customer_id, customer_name, challan_id, product_id, model_name, serial_number, old_serial_number, unique_id, action_taken, remarks, po_type, purchase_type, qc_status, locking_period, added_date, failure_reason, checked_by, assigned_to, warranty_status, rental_status, in_ward, out_ward, require_parts, file_path, logType, created_at, updated_at, extra_details

### `assigned_assets` → `customer_inventory` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (19):** id, product_detail_id, member_id, type, serial_number, serial_unique_id, serial_number_parts, serial_number_mobile, parts_unique_id, serial_details, parts_details, returned_serial_details, returned_parts_details, returned_mobile_details, date, assigned_by, status, created_at, updated_at

### `attributes` → `asset_config_*` (Additive)

- **Risk:** Low
- **Note:** Insert missing attribute values only
- **ERP columns (6):** id, name, created_at, updated_at, attributes, status

### `banners` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CMS
- **ERP columns (9):** id, photo, banner_type, published, created_at, updated_at, url, resource_type, resource_id

### `billing_addresses` → `customer_addresses` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (14):** id, customer_id, contact_person_name, address_type, address, city, zip, phone, state, country, latitude, longitude, created_at, updated_at

### `billing_manager` → `customer_invoices + users` (Transform)

- **Risk:** High
- **Note:** Billing cycles → CRM billing engine tables
- **ERP columns (26):** id, name, f_name, l_name, address, country_code, phone, email, identity_number, identity_type, identity_image, image, password, remember_pass, bank_name, branch, account_no, holder_name, is_active, is_online, created_at, updated_at, auth_token, fcm_token, remember_token, role_id

### `blog_posts` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CMS
- **ERP columns (12):** id, title, subTitle, slug, image, shortdescription, description, type, date, status, created_at, updated_at

### `brands` → `asset_config_brands + laptop_catalog` (Additive)

- **Risk:** Low
- **Note:** Insert missing brands only — preserve CRM asset_config
- **ERP columns (6):** id, name, image, status, created_at, updated_at

### `bundle_management` → `laptop_catalog` (Additive)

- **Risk:** Low
- **Note:** Insert missing SKUs only
- **ERP columns (10):** id, main_serial_id, main_serial_number, main_unique_number, spare_parts_id, spare_parts_serial_and_unique_number, user_id, user_type, created_at, updated_at

### `business_settings` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** PRESERVE companies/support_settings; optional field-level merge if CRM empty
- **ERP columns (5):** id, type, value, created_at, updated_at

### `cache` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (3):** key, value, expiration

### `cart_shippings` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, cart_group_id, shipping_method_id, shipping_cost, created_at, updated_at

### `carts` → `SKIP` (Skip)

- **Risk:** None
- **Note:** E-commerce
- **ERP columns (25):** id, customer_id, cart_group_id, product_id, product_type, digital_product_type, color, choices, variations, variant, quantity, price, tax, discount, tax_model, slug, name, thumbnail, seller_id, seller_is, created_at, updated_at, shop_info, shipping_cost, shipping_type

### `categories` → `SKIP` (Skip)

- **Risk:** None
- **Note:** E-commerce categories
- **ERP columns (11):** id, name, slug, icon, parent_id, position, created_at, updated_at, home_status, status, priority

### `category_shipping_costs` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (7):** id, seller_id, category_id, cost, multiply_qty, created_at, updated_at

### `chattings` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (18):** id, user_id, seller_id, admin_id, delivery_man_id, message, sent_by_customer, sent_by_seller, sent_by_admin, sent_by_delivery_man, seen_by_customer, seen_by_seller, seen_by_admin, seen_by_delivery_man, status, created_at, updated_at, shop_id

### `colors` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, name, code, created_at, updated_at

### `complaints_ticket` → `support_tickets + support_ticket_items + tickets` (Transform)

- **Risk:** Critical
- **Note:** ERP complaints → CRM support v3 model
- **ERP columns (29):** id, ticket_number, return_dc_number, user_id, delivery_person_id, courier_name, awb_number, customer_id, name, email, phone, serial_number, unique_number, complaint_type, damage_description, remark, status, generated_by, comments, add_parts, assign_parts, old_assign_parts, created_at, updated_at, closed_at, assigned_parts, installed_parts, replaced_parts, handover_removed

### `contacts` → `leads` (Partial)

- **Risk:** Medium
- **Note:** ERP contacts may map to leads if no CRM lead exists
- **ERP columns (11):** id, name, email, mobile_number, subject, message, seen, feedback, created_at, updated_at, reply

### `coupons` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (18):** id, added_by, coupon_type, coupon_bearer, seller_id, customer_id, title, code, start_date, expire_date, min_purchase, max_discount, discount, discount_type, status, created_at, updated_at, limit

### `courier_details` → `sm_courier_details` (Direct)

- **Risk:** Low
- **Note:** 
- **ERP columns (5):** id, courier_name, awb_number, created_at, updated_at

### `credit_and_debit_note` → `vendor_debit_notes + customer_credit_notes` (Transform)

- **Risk:** Critical
- **Note:** 
- **ERP columns (14):** id, credit_or_debit_number, customer_id, vendor_id, products_id, serial_numbers, total_credit_debit_amount, type, product_type, created_by_id, created_by_type, status, created_at, updated_at

### `currencies` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** INR assumed in CRM
- **ERP columns (8):** id, name, symbol, code, exchange_rate, status, created_at, updated_at

### `customer_audit_logs` → `ttspl_audit_log / permission_audit_logs` (Partial)

- **Risk:** Medium
- **Note:** Audit semantics differ
- **ERP columns (21):** id, customer_id, customer_name, transaction_type, action, product_name, serial_number, unique_asset_number, quantity, ticket_id, ticket_number, ticket_type, ticket_status, transaction_date, performed_by, remarks, created_at, updated_at, performed_by_id, dc_number, pod_files

### `customer_credit_note` → `customer_credit_notes` (Transform)

- **Risk:** High
- **Note:** Financial amounts must reconcile
- **ERP columns (27):** id, serial_id, month, po_id, dc_number, serial_number, unique_number, product_id, rent_start_date, rent_end_date, rent_amount, month_rent, rent_with_gst, total_amount, vendor_id, invoice_number, type, status, customer_id, rent_stop_date, rent_start_date_again, temp_amount, credit_note_amount, debit_note_amount, credit_type, created_at, updated_at

### `customer_rent_devices` → `customer_inventory + rent_devices` (Transform)

- **Risk:** High
- **Note:** Active rental assignments
- **ERP columns (28):** id, serial_id, month, po_id, dc_number, serial_number, unique_number, product_details, rent_start_date, rent_end_date, credit_start_date, credit_end_date, per_day_amount, total_credit_day, rent_amount, month_rent, rent_with_gst, total_amount, vendor_id, type, status, customer_id, rent_stop_date, rent_start_date_again, temp_amount, ordinary_amount, created_at, updated_at

### `customer_wallet_histories` → `SKIP` (Gap)

- **Risk:** Medium
- **Note:** 
- **ERP columns (8):** id, customer_id, transaction_amount, transaction_type, transaction_method, transaction_id, created_at, updated_at

### `customer_wallets` → `customer_security_deposits` (Partial)

- **Risk:** High
- **Note:** Wallet vs security deposit model differs
- **ERP columns (6):** id, customer_id, balance, royality_points, created_at, updated_at

### `customers` → `customers + customer_addresses + customer_documents` (Transform)

- **Risk:** High
- **Note:** Wide ERP row → normalized CRM; portal passwords → customer_portal_sessions
- **ERP columns (24):** id, customer_name, contact_person_name, contact_person_number, customer_number, email, billing_address, billing_address_state, billing_address_pin_code, shipping_address, shipping_address_state, shipping_address_pin_code, business_type, gst_number, pan_card_number, upload_docs, remember_token, profile, password, remember_pass, status, created_at, updated_at, role_id

### `customers_backup` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** Legacy backup table
- **ERP columns (24):** id, customer_name, contact_person_name, contact_person_number, customer_number, email, billing_address, billing_address_state, billing_address_pin_code, shipping_address, shipping_address_state, shipping_address_pin_code, business_type, gst_number, pan_card_number, upload_docs, remember_token, profile, password, remember_pass, status, created_at, updated_at, role_id

### `customers_update` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** Staging table
- **ERP columns (24):** id, customer_name, contact_person_name, contact_person_number, customer_number, email, billing_address, billing_address_state, billing_address_pin_code, shipping_address, shipping_address_state, shipping_address_pin_code, business_type, gst_number, pan_card_number, upload_docs, remember_token, profile, password, remember_pass, status, created_at, updated_at, role_id

### `damage_parts_amount` → `diagnosis_parts_required + ticket_parts` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (16):** id, ticket_id, transaction_id, pod_submission_id, billing_person_id, parts_with_amount, old_damage_parts, status, customer_id, customer_email, customer_name, customer_mobile, submitted_by_id, submitted_by_type, created_at, updated_at

### `data_table` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (9):** id, heading, sub_heading, main_heading, image1, image2, status, created_at, updated_at

### `deal_of_the_days` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (8):** id, title, product_id, discount, discount_type, status, created_at, updated_at

### `delivery_challans` → `delivery_challan_lines + demo_agreements` (Transform)

- **Risk:** Critical
- **Note:** DC lines; OTP/esign fields in CRM migrations 086/102
- **ERP columns (61):** id, dc_number, sales_order_number, quotation_number, customer_name, customer_id, email, GST_number, customer_billing_address, customer_shipping_address, brand, quantity, main_qty, serial_number, ship_by, courier_name, awb_number, delivery_person_id, supply_state, branch, remarks, model_name, submitted_name, date_and_time, submitted_remark, submitted_person_id, submitted_person_type, file_path, shiping_charges, security_amount, old_security_amount, refund_amount, pdf_path, delivered_serial_numbers, rejected_serial_numbers, returned_serial_numbers, pickuped_serial_numbers, old_returned_serial_numbers, old_rejected_serial_numbers, old_delivered_serial_numbers, old_pickuped_serial_numbers, d_customer_name, d_customer_email, d_customer_mobile, npa_assets, old_npa_assets, npa_remark, npa_status, npa_date, d_otp, latitude, longitude, rejected_otp, ordinary_amount, status, invoice_created, invoice_path, security_and_shipping_invoice_status, security_and_shipping_invoice_path, created_at, updated_at

### `delivery_country_codes` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, country_code, created_at, updated_at

### `delivery_histories` → `activities / work_logs` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (9):** id, order_id, deliveryman_id, time, longitude, latitude, location, created_at, updated_at

### `delivery_man_transactions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (10):** id, delivery_man_id, user_id, user_type, transaction_id, debit, credit, transaction_type, created_at, updated_at

### `delivery_men` → `delivery_technicians` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (26):** id, seller_id, name, f_name, l_name, address, country_code, phone, email, identity_number, identity_type, identity_image, image, password, remember_pass, bank_name, branch, account_no, holder_name, is_active, is_online, created_at, updated_at, auth_token, fcm_token, remember_token

### `delivery_zip_codes` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, zipcode, created_at, updated_at

### `deliveryman_notifications` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, delivery_man_id, order_id, description, created_at, updated_at

### `deliveryman_wallets` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (8):** id, delivery_man_id, current_balance, cash_in_hand, pending_withdraw, total_withdraw, created_at, updated_at

### `emergency_contacts` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** 
- **ERP columns (7):** id, user_id, name, phone, status, created_at, updated_at

### `failed_jobs` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, connection, queue, payload, exception, failed_at

### `feature_deals` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, url, photo, status, created_at, updated_at

### `flash_deal_products` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (7):** id, flash_deal_id, product_id, discount, discount_type, created_at, updated_at

### `flash_deals` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (14):** id, title, start_date, end_date, status, featured, background_color, text_color, banner, slug, created_at, updated_at, product_id, deal_type

### `goods_received_notes` → `vendor_goods_received_notes + grn_*` (Transform)

- **Risk:** Critical
- **Note:** GRN headers + access numbers + serial capture tokens
- **ERP columns (9):** id, grn_number, po_id, received_qty, rental_period, product_warranty, product_id, created_at, updated_at

### `goods_received_notes_parts` → `vendor_goods_received_notes (parts lines)` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (9):** id, grn_number, po_id, received_qty, rental_period, product_warranty, product_id, created_at, updated_at

### `help_topics` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (7):** id, question, answer, ranking, status, created_at, updated_at

### `insert_allocation_log_old_new` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** Migration staging
- **ERP columns (14):** id, user_id, old_serial_number, new_serial_number, new_unique_number, old_unique_number, refferenceData, replace_type, refferenceDataCurrent, reference_id, userType, created_at, updated_at, deleted_at

### `inventory` → `inventory` (Transform)

- **Risk:** Critical
- **Note:** Status enum mapping; JSON extra_details; serial linkage
- **ERP columns (9):** id, product_id, serial_id, serial_number, unique_product_serial, product_model_name, status, created_at, updated_at

### `invoices` → `customer_invoices + einvoice_records` (Transform)

- **Risk:** Critical
- **Note:** 
- **ERP columns (8):** id, dc_number, dc_id, sales_order_id, invoice_path, invoice_number, created_at, updated_at

### `inward_outward` → `inward_outward` (Direct)

- **Risk:** Medium
- **Note:** 
- **ERP columns (19):** id, serial_id, serial_number, unique_number, customer_id, vendor_id, type, product_type, found_in, purpose, remarks, ticket_number, ticket_sla_time, technician_id, courier_name, awb_number, spare_parts_serial_number, created_at, updated_at

### `issue_types` → `support_issue_categories` (Transform)

- **Risk:** Low
- **Note:** 
- **ERP columns (6):** id, name, status, created_at, updated_at, type

### `items` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** Generic items; verify if used
- **ERP columns (7):** id, title, description, image, status, created_at, updated_at

### `jobs` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (7):** id, queue, payload, attempts, reserved_at, available_at, created_at

### `last_unique_number` → `sm_document_sequences` (MonotonicBump)

- **Risk:** Medium
- **Note:** GREATEST(crm, erp) only — never lower sequences
- **ERP columns (6):** id, last_unique_number, type, last_invoice_number, created_at, updated_at

### `loyalty_point_transactions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (10):** id, user_id, transaction_id, credit, debit, balance, reference, transaction_type, created_at, updated_at

### `migrations` → `schema_migrations` (Skip)

- **Risk:** None
- **Note:** Do not migrate Laravel migrations table
- **ERP columns (3):** id, migration, batch

### `new_modules` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CRM permission_sections preserved
- **ERP columns (9):** id, type, module_name, submodule_name, parent_id, module, sub_module, created_at, updated_at

### `new_user_permissions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CRM user_permissions preserved
- **ERP columns (11):** id, role_type, user_id, module_id, show_sidebar, can_add, can_view, can_edit, can_delete, created_at, updated_at

### `notifications` → `email_queue` (Partial)

- **Risk:** Low
- **Note:** 
- **ERP columns (8):** id, title, description, notification_count, image, status, created_at, updated_at

### `npa_assets` → `inventory (disposition=npa)` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (14):** id, dc_id, dc_number, serial_number, unique_number, implode_serial, date, remark, customer_id, type, created_by_type, created_by_id, created_at, updated_at

### `oauth_access_tokens` → `SKIP` (Skip)

- **Risk:** None
- **Note:** Regenerate sessions
- **ERP columns (9):** id, user_id, client_id, name, scopes, revoked, created_at, updated_at, expires_at

### `oauth_auth_codes` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, user_id, client_id, scopes, revoked, expires_at

### `oauth_clients` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (11):** id, user_id, name, secret, redirect, personal_access_client, password_client, revoked, created_at, updated_at, provider

### `oauth_personal_access_clients` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, client_id, created_at, updated_at

### `oauth_refresh_tokens` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, access_token_id, revoked, expires_at

### `old_product_details` → `SKIP` (Archive)

- **Risk:** Low
- **Note:** Historical archive; optional JSON import
- **ERP columns (4):** id, details, created_at, updated_at

### `order_details` → `order_items` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (21):** id, order_id, product_id, seller_id, digital_file_after_sell, product_details, qty, price, tax, discount, tax_model, delivery_status, payment_status, created_at, updated_at, shipping_method_id, variant, variation, discount_type, is_stock_decreased, refund_request

### `order_expected_delivery_histories` → `activities` (Partial)

- **Risk:** Low
- **Note:** 
- **ERP columns (8):** id, order_id, user_id, user_type, expected_delivery_date, cause, created_at, updated_at

### `order_status_histories` → `activities` (Partial)

- **Risk:** Low
- **Note:** 
- **ERP columns (8):** id, order_id, user_id, user_type, status, cause, created_at, updated_at

### `order_transactions` → `sales_order_payments` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (17):** seller_id, order_id, order_amount, seller_amount, admin_commission, received_by, status, delivery_charge, tax, created_at, updated_at, customer_id, seller_is, delivered_by, payment_method, transaction_id, id

### `orders` → `orders + order_items` (Partial)

- **Risk:** High
- **Note:** ERP e-commerce orders; may overlap sales_orders
- **ERP columns (43):** id, customer_id, customer_type, payment_status, order_status, payment_method, transaction_ref, payment_by, payment_note, order_amount, admin_commission, is_pause, cause, shipping_address, created_at, updated_at, discount_amount, discount_type, coupon_code, coupon_discount_bearer, shipping_method_id, shipping_cost, order_group_id, verification_code, seller_id, seller_is, shipping_address_data, delivery_man_id, deliveryman_charge, expected_delivery_date, order_note, billing_address, billing_address_data, order_type, extra_discount, extra_discount_type, checked, shipping_type, delivery_type, delivery_service_name, third_party_delivery_tracking_id, shipment_id, order_idP444

### `password_resets` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** identity, token, created_at, user_type

### `paytabs_invoices` → `customer_invoices` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (13):** id, order_id, result, response_code, pt_invoice_id, amount, currency, transaction_id, card_brand, card_first_six_digits, card_last_four_digits, created_at, updated_at

### `personal_access_tokens` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (9):** id, tokenable_type, tokenable_id, name, token, abilities, last_used_at, created_at, updated_at

### `phone_or_email_verifications` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, phone_or_email, token, created_at, updated_at

### `pod_submissions` → `delivery_challan_lines (pod fields)` (Transform)

- **Risk:** High
- **Note:** Proof of delivery
- **ERP columns (23):** id, pod_date_time, confirmationDateTime, name, customer_name, email, mobile, otp, latitude, longitude, pod_remark, person_id, pickup_id, person_type, damage_remarks, files, auth_id, assigned_by, type, spare_parts, created_at, updated_at, pod_closed_at

### `product_details` → `vendor_product_details + inventory` (Transform)

- **Risk:** Critical
- **Note:** PO line / GRN product specs
- **ERP columns (25):** id, category, brand, model, imei_number, processor, generation, ram, storage, gpu, screen_size, quantity, rate, total_amount, vendor_locking_period, parts, warranty, status, random_id, old_product_id, old_product_details, serial_numbers, remarks, created_at, updated_at

### `product_stocks` → `vendor_product_inventory` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (8):** id, product_id, variant, sku, price, qty, created_at, updated_at

### `product_tag` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, product_id, tag_id, created_at, updated_at

### `products` → `vendor_product_inventory` (Partial)

- **Risk:** Medium
- **Note:** E-commerce product catalog; may not all apply
- **ERP columns (52):** id, added_by, user_id, name, slug, product_type, category_ids, brand_id, unit, min_qty, refundable, digital_product_type, digital_file_ready, images, color_image, thumbnail, featured, flash_deal, video_provider, video_url, colors, variant_product, attributes, choice_options, variation, published, unit_price, purchase_price, tax, tax_type, tax_model, discount, discount_type, current_stock, minimum_order_qty, details, free_shipping, attachment, created_at, updated_at, status, featured_status, meta_title, meta_description, meta_image, request_status, denied_note, shipping_cost, multiply_qty, temp_shipping_cost, is_shipping_cost_updated, code

### `purchase_orders` → `vendor_purchase_orders` (Transform)

- **Risk:** Critical
- **Note:** PO header; status workflow mapping
- **ERP columns (24):** id, purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, state, product_details_id, locking_period, assets_details, remarks, sub_total_amount, total_amount, isSameState, status, invoice_created, invoice_path, token, status_updated_by_id, status_updated_by_name, bill_name, bill_files, created_at, updated_at, deleted_at

### `qc` → `qc_results + qc_photos` (Transform)

- **Risk:** High
- **Note:** Historical QC only — CRM stages/stage_checklists PRESERVED
- **ERP columns (13):** id, name, email, phone, image, password, address, remember_token, remember_pass, status, created_at, updated_at, deleted_at

### `qc_logs` → `qc_results / repair_logs` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (6):** id, product_id, inventory_id, status, remarks, checked_at

### `qc_truetech_delivery_challans` → `dc_qc_tickets` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (20):** id, challan_number, challan_date, vendor_name, vendor_address, vendor_phone, vendor_gstin, place_of_supply, po_number, source_serial_number, source_unique_serial, transport, lr_number, purpose, items, terms, created_by, created_at, updated_at, vendor_email

### `quotations` → `sales_quotations` (Transform)

- **Risk:** High
- **Note:** Quote lines embedded in ERP → normalized lines
- **ERP columns (39):** id, quotation_number, supply_state, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, contact_person_name, contact_person_mobile, gst_number, security_amount, old_security_amount, refund_amount, shiping_charges, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_quantity, rate, quotation_type, locking_period, technical_warranty, battery_charger_warranty, remark, status, pdf_path, token, status_updated_by_id, status_updated_by_name, created_at, updated_at

### `refund_requests` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** E-commerce refunds
- **ERP columns (15):** id, order_details_id, customer_id, status, amount, product_id, order_id, refund_reason, images, created_at, updated_at, approved_note, rejected_note, payment_info, change_by

### `refund_statuses` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (8):** id, refund_request_id, change_by, change_by_id, status, message, created_at, updated_at

### `refund_transactions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (15):** id, order_id, payment_for, payer_id, payment_receiver_id, paid_by, paid_to, payment_method, payment_status, amount, transaction_type, order_details_id, created_at, updated_at, refund_id

### `rent_devices` → `rent_devices` (Transform)

- **Risk:** High
- **Note:** Device master catalog
- **ERP columns (20):** id, serial_id, po_id, serial_number, unique_number, product_id, rent_start_date, rent_end_date, rent_amount, month_rent, rent_with_gst, total_amount, vendor_id, type, status, customer_id, rent_stop_date, rent_start_date_again, created_at, updated_at

### `rent_reports` → `SKIP` (Gap)

- **Risk:** Medium
- **Note:** Reporting aggregate; may regenerate from customer_inventory
- **ERP columns (16):** id, vendor_id, month, type, excel_path, subtotal, gst_amount, total_amount, amount, pdf_path, approved_by_id, billing_person_id, status, approved_by_type, created_at, updated_at

### `rent_reports_customer` → `SKIP` (Gap)

- **Risk:** Medium
- **Note:** 
- **ERP columns (22):** id, customer_id, month, type, amount, gst_amount, subtotal, total_amount, excel_path, credit_excel_path, pdf_path, credit_note_pdf_path, created_at, updated_at, status, paid_on, admin_status, approved_by_id, approved_by_type, billing_person_id, is_checked, token

### `repair_logs` → `repair_logs + chip_level_repairs` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (12):** id, serial_number_id, serial_number, unique_number, repair_start_date, repair_end_date, type, remarks, new_serial_number, new_unique_number, created_at, updated_at

### `review_sets` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, review, review_count, status, created_at, updated_at

### `reviews` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (12):** id, product_id, customer_id, delivery_man_id, order_id, comment, attachment, rating, status, is_saved, created_at, updated_at

### `role_permissions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CRM role_permissions preserved
- **ERP columns (8):** id, role_id, sub_module_id, status, created_at, updated_at, actions, show_in_sidebar

### `roles` → `SKIP` (Skip)

- **Risk:** None
- **Note:** Legacy ERP roles; CRM RBAC preserved
- **ERP columns (6):** id, name, status, created_at, updated_at, deleted_at

### `roles_modules` → `SKIP` (Skip)

- **Risk:** None
- **Note:** CRM permission_sections preserved
- **ERP columns (9):** id, role_id, name, parent_id, status, created_at, updated_at, deleted_at, icon

### `sales_orders` → `sales_order_lines + sales_order_serials + sales_order_payments + orders` (Transform)

- **Risk:** Critical
- **Note:** ERP sales_orders is monolithic; CRM splits across SO module + legacy orders
- **ERP columns (41):** id, sales_order_number, quotation_number, supply_state, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, contact_person_name, contact_person_mobile, gst_number, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_qty, rate, quotation_type, locking_period, battery_charger_warranty, technical_warranty, main_product_warranty, sub_product_warranty, remark, branch, status, token, pdf_path, invoice_created, invoice_path, security_amount, shiping_charges, created_at, updated_at

### `search_functions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, key, url, visible_for, created_at, updated_at

### `seller_wallet_histories` → `SKIP` (Gap)

- **Risk:** Medium
- **Note:** No direct CRM wallet history table
- **ERP columns (8):** id, seller_id, amount, order_id, product_id, payment, created_at, updated_at

### `seller_wallets` → `vendor_wallets` (Partial)

- **Risk:** Medium
- **Note:** 
- **ERP columns (11):** id, seller_id, total_earning, withdrawn, created_at, updated_at, commission_given, pending_withdraw, delivery_charge_earned, collected_cash, total_tax_collected

### `sellers` → `vendors + vendor_shops` (Transform)

- **Risk:** High
- **Note:** ERP sellers = CRM vendors; shop details separate
- **ERP columns (33):** id, f_name, l_name, phone, image, email, password, status, business_name, address, state, business_type, brand_code, business_registration_number, licenses_and_permits, tax_identification_number, account_type, remember_pass, remember_token, created_at, updated_at, bank_name, account_holder_name, bank_ifsc_code, branch, account_no, holder_name, auth_token, sales_commission_percentage, gst, cm_firebase_token, pos_status, role_id

### `serial_numberOnly` → `vendor_serial_numbers` (Partial)

- **Risk:** Medium
- **Note:** Legacy serial capture
- **ERP columns (7):** id, serial_number, unique_product_serial, status, updated_at, created_at, deleted_at

### `serial_number_parts` → `part_instances + vendor_serial_numbers` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (17):** id, part_id, serial_number, main_serial_number, main_unique_number, unique_product_serial, goods_receipts_id, po_id, rental_period, product_warranty, status, status2, remark, require_parts_remark, file_path, created_at, updated_at

### `serial_number_update_logs` → `vendor_serial_number_audit` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (9):** id, old_serial_number, old_unique_number, new_serial_number, new_unique_number, updated_by_type, updated_by_id, created_at, updated_at

### `serial_numbers` → `vendor_serial_numbers` (Transform)

- **Risk:** Critical
- **Note:** Serial uniqueness; TTSPL vs rental flags
- **ERP columns (28):** id, serial_number, unique_product_serial, product_id, goods_receipts_id, po_id, rental_period, product_warranty, dataoldSerialNumber, status, status2, action_status, came_from, action_remark, remark, is_replaced, is_repaired, require_parts, require_parts_done, file_path, seller_id, vendor_name, hardware_action, hardware_remark, hardware_action_by, hardware_action_date, created_at, updated_at

### `sessions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** id, user_id, ip_address, user_agent, payload, last_activity

### `shipping_addresses` → `customer_addresses` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (15):** id, customer_id, contact_person_name, address_type, address, city, zip, phone, created_at, updated_at, state, country, latitude, longitude, is_billing

### `shipping_methods` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (9):** id, creator_id, creator_type, title, cost, duration, status, created_at, updated_at

### `shipping_types` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, seller_id, shipping_type, created_at, updated_at

### `shops` → `vendor_shops` (Partial)

- **Risk:** Low
- **Note:** Customer shops vs vendor shops
- **ERP columns (14):** id, seller_id, name, address, contact, image, vacation_start_date, vacation_end_date, vacation_note, vacation_status, temporary_close, created_at, updated_at, banner

### `social_medias` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (8):** id, name, link, icon, active_status, status, created_at, updated_at

### `soft_credentials` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, key, value, created_at, updated_at

### `spare_parts` → `spare_parts + vendor_spare_parts_catalog` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (6):** id, name, type, status, created_at, updated_at

### `spare_parts_po` → `vendor_spare_parts_purchase_orders` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (15):** id, purchase_order_number, purchase_order_date, vendor_id, product_details_id, assets_details, remarks, status, token, status_updated_by_id, status_updated_by_name, bill_name, bill_files, created_at, updated_at

### `split_rent_billing` → `customer_invoices (billing engine)` (Transform)

- **Risk:** High
- **Note:** 
- **ERP columns (10):** serial_id, serial_number, unique_number, rent_start, rent_end, rent_days, rent_amt, gst_18, total_amt, created_at

### `stock_products` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** 
- **ERP columns (8):** id, product_id, model_name, serial_number, unique_code, quantity, stock_status, added_date

### `sub_modules` → `permission_sections` (Partial)

- **Risk:** Low
- **Note:** 
- **ERP columns (7):** id, module_id, name, created_at, updated_at, deleted_at, slug

### `subscriptions` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, email, created_at, updated_at

### `support_ticket_convs` → `support_ticket_item_comments` (Transform)

- **Risk:** Medium
- **Note:** 
- **ERP columns (8):** id, support_ticket_id, admin_id, customer_message, admin_message, position, created_at, updated_at

### `support_tickets` → `support_tickets` (Partial)

- **Risk:** Medium
- **Note:** Generic support; lower volume than complaints_ticket
- **ERP columns (10):** id, customer_id, subject, type, priority, description, reply, status, created_at, updated_at

### `tags` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (4):** id, tag, created_at, updated_at

### `team_members` → `SKIP` (Skip)

- **Risk:** None
- **Note:** PRESERVE CRM user_teams
- **ERP columns (13):** id, member_name, member_email, member_mobile, member_address, aadhar_number, refrence_name, refrence_number, upload_docs, profile, status, created_at, updated_at

### `transactions` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** Generic transactions
- **ERP columns (23):** id, bill_id, customer_name, customer_id, month, type, payment_type, bank_transaction_id, bank_id, phonepe_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_method, merchant_Id, reference_Id, check_number, check_image, payment_status, status, amount, created_at, updated_at

### `translations` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (6):** translationable_type, translationable_id, locale, key, value, id

### `users` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** ERP front-end users; not CRM internal users
- **ERP columns (30):** id, name, f_name, l_name, phone, image, email, email_verified_at, password, remember_token, created_at, updated_at, street_address, country, city, zip, house_no, apartment_no, cm_firebase_token, is_active, payment_card_last_four, payment_card_brand, payment_card_fawry_token, login_medium, social_id, is_phone_verified, temporary_token, is_email_verified, wallet_balance, loyalty_point

### `video` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, video, status, created_at, updated_at

### `videos` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, video, status, created_at, updated_at

### `wallet_transactions` → `SKIP` (Skip)

- **Risk:** Low
- **Note:** 
- **ERP columns (11):** id, user_id, transaction_id, credit, debit, admin_bonus, balance, transaction_type, reference, created_at, updated_at

### `warehouse` → `teams (warehouse team)` (Transform)

- **Risk:** Low
- **Note:** 
- **ERP columns (12):** id, name, email, phone, image, password, remember_pass, status, address, created_at, updated_at, deleted_at

### `wishlists` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (5):** id, customer_id, product_id, created_at, updated_at

### `withdraw_requests` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (11):** id, seller_id, delivery_man_id, admin_id, amount, withdrawal_method_id, withdrawal_method_fields, transaction_note, approved, created_at, updated_at

### `withdrawal_methods` → `SKIP` (Skip)

- **Risk:** None
- **Note:** 
- **ERP columns (7):** id, method_name, method_fields, is_default, is_active, created_at, updated_at

