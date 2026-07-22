# CRM Gap Analysis

> Generated: 2026-06-23T17:26:39.533Z

## ERP Modules Not Migrated (intentional skip)

- `about_sliders`: CMS
- `admin_roles`: PRESERVE CRM roles — see AUTH_TABLES.md
- `admin_wallets`: 
- `admin_wallet_histories`: 
- `banners`: CMS
- `blog_posts`: CMS
- `business_settings`: PRESERVE companies/support_settings; optional field-level merge if CRM empty
- `cache`: 
- `carts`: E-commerce
- `cart_shippings`: 
- `categories`: E-commerce categories
- `category_shipping_costs`: 
- `chattings`: 
- `colors`: 
- `coupons`: 
- `currencies`: INR assumed in CRM
- `customers_backup`: Legacy backup table
- `customers_update`: Staging table
- `data_table`: 
- `deal_of_the_days`: 
- `deliveryman_notifications`: 
- `deliveryman_wallets`: 
- `delivery_country_codes`: 
- `delivery_man_transactions`: 
- `delivery_zip_codes`: 
- `emergency_contacts`: 
- `failed_jobs`: 
- `feature_deals`: 
- `flash_deals`: 
- `flash_deal_products`: 
- `help_topics`: 
- `insert_allocation_log_old_new`: Migration staging
- `items`: Generic items; verify if used
- `jobs`: 
- `loyalty_point_transactions`: 
- `migrations`: Do not migrate Laravel migrations table
- `new_modules`: CRM permission_sections preserved
- `new_user_permissions`: CRM user_permissions preserved
- `oauth_access_tokens`: Regenerate sessions
- `oauth_auth_codes`: 
- `oauth_clients`: 
- `oauth_personal_access_clients`: 
- `oauth_refresh_tokens`: 
- `password_resets`: 
- `personal_access_tokens`: 
- `phone_or_email_verifications`: 
- `product_tag`: 
- `refund_requests`: E-commerce refunds
- `refund_statuses`: 
- `refund_transactions`: 
- `reviews`: 
- `review_sets`: 
- `roles`: Legacy ERP roles; CRM RBAC preserved
- `roles_modules`: CRM permission_sections preserved
- `role_permissions`: CRM role_permissions preserved
- `search_functions`: 
- `sessions`: 
- `shipping_methods`: 
- `shipping_types`: 
- `social_medias`: 
- `soft_credentials`: 
- `stock_products`: 
- `subscriptions`: 
- `tags`: 
- `team_members`: PRESERVE CRM user_teams
- `transactions`: Generic transactions
- `translations`: 
- `users`: ERP front-end users; not CRM internal users
- `video`: 
- `videos`: 
- `wallet_transactions`: 
- `wishlists`: 
- `withdrawal_methods`: 
- `withdraw_requests`: 

## ERP Data With No CRM Target (gaps)

- `customer_wallet_histories` → 
- `rent_reports` → Reporting aggregate; may regenerate from customer_inventory
- `rent_reports_customer` → 
- `seller_wallet_histories` → No direct CRM wallet history table

## CRM Features Without ERP Equivalent

- `public.leads` — CRM-native; preserve existing rows
- `public.lead_activities` — CRM-native; preserve existing rows
- `public.lead_addresses` — CRM-native; preserve existing rows
- `public.lead_assignments` — CRM-native; preserve existing rows
- `public.lead_auto_assign_config` — CRM-native; preserve existing rows
- `public.lead_company_research` — CRM-native; preserve existing rows
- `public.lead_followup_notifications` — CRM-native; preserve existing rows
- `public.lead_import_logs` — CRM-native; preserve existing rows
- `public.lead_orders` — CRM-native; preserve existing rows
- `public.lead_remarks` — CRM-native; preserve existing rows
- `public.asset_config_brands` — CRM-native; preserve existing rows
- `public.asset_config_models` — CRM-native; preserve existing rows
- `public.asset_config_processors` — CRM-native; preserve existing rows
- `public.asset_config_generations` — CRM-native; preserve existing rows
- `public.asset_config_ram` — CRM-native; preserve existing rows
- `public.asset_config_storage` — CRM-native; preserve existing rows
- `public.asset_config_gpu` — CRM-native; preserve existing rows
- `public.asset_config_screen_sizes` — CRM-native; preserve existing rows
- `public.stages` — CRM-native; preserve existing rows
- `public.stage_checklists` — CRM-native; preserve existing rows
- `public.stage_transition_rules` — CRM-native; preserve existing rows
- `public.inventory_status_transitions` — CRM-native; preserve existing rows
- `public.qc_round_robin_state` — CRM-native; preserve existing rows
- `public.procurement_requests` — CRM-native; preserve existing rows
- `public.part_requests` — CRM-native; preserve existing rows
- `public.parts` — CRM-native; preserve existing rows
- `public.part_instances` — CRM-native; preserve existing rows
- `public.photos` — CRM-native; preserve existing rows
- `public.diagnosis_results` — CRM-native; preserve existing rows
- `public.diagnosis_images` — CRM-native; preserve existing rows
- `public.diagnosis_parts_required` — CRM-native; preserve existing rows
- `public.support_part_challans` — CRM-native; preserve existing rows
- `public.support_part_requests` — CRM-native; preserve existing rows
- `public.support_challan_items` — CRM-native; preserve existing rows
- `public.support_replacement_orders` — CRM-native; preserve existing rows
- `public.ticket_checklist_progress` — CRM-native; preserve existing rows
- `public.ticket_part_blocks` — CRM-native; preserve existing rows
- `public.ticket_services` — CRM-native; preserve existing rows
- `public.grn_access_attempts` — CRM-native; preserve existing rows
- `public.grn_access_numbers` — CRM-native; preserve existing rows
- `public.grn_config_verifications` — CRM-native; preserve existing rows
- `public.grn_serial_capture_tokens` — CRM-native; preserve existing rows
- `public.eway_bill_records` — CRM-native; preserve existing rows
- `public.einvoice_records` — CRM-native; preserve existing rows
- `public.email_queue` — CRM-native; preserve existing rows
- `public.existing_customer` — CRM-native; preserve existing rows
- `public.vendor_portal_sessions` — CRM-native; preserve existing rows
- `public.vendor_refresh_tokens` — CRM-native; preserve existing rows
- `public.vendor_billing` — CRM-native; preserve existing rows
- `public.vendor_monthly_bills` — CRM-native; preserve existing rows
- `public.vendor_replaced_products` — CRM-native; preserve existing rows
- `public.vendor_inventory_asset_sequence` — CRM-native; preserve existing rows
- `public.demo_agreements` — CRM-native; preserve existing rows
- `public.customer_portal_sessions` — CRM-native; preserve existing rows
- `public.customer_documents` — CRM-native; preserve existing rows
- `public.companies` — CRM-native; preserve existing rows
- `public.work_logs` — CRM-native; preserve existing rows
- `public.activities` — CRM-native; preserve existing rows
- `public.ttspl_audit_log` — CRM-native; preserve existing rows
- `public.ttspl_config_history` — CRM-native; preserve existing rows
- `public.permission_audit_logs` — CRM-native; preserve existing rows
- `public.schema_migrations` — CRM-native; preserve existing rows
- `public.laptop_catalog` — CRM-native; preserve existing rows
- `public.support_settings` — CRM-native; preserve existing rows
- `public.support_ticket_item_audit` — CRM-native; preserve existing rows

## Recommended Schema Changes (pre-migration)

| Change | Reason | Priority |
| --- | --- | --- |
| Add `erp_source_id` + `erp_source_table` on major entities OR dedicated `erp_id_map` | ID remapping traceability | Critical |
| Add `legacy_file_path` text on attachments | ERP storage paths differ from CRM uploads | High |
| Confirm `inventory.inventory_status` enum covers all ERP statuses | Prevent state machine violations | Critical |
| Wallet history tables OR JSON audit on vendor_wallets | seller_wallet_histories gap | Medium |
| Rent report materialized views | rent_reports* gap | Low |
