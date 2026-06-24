# ERP Schema Analysis

> Generated: 2026-06-23T17:26:39.533Z
> Source: `erp_rentfoxxy_db.sql` (MySQL / Laravel)
> Total tables: **142**

## Summary

- **Master / reference tables:** 18
- **Transaction / business tables:** 85
- **Audit / history / log tables:** 9
- **CMS / e-commerce / infra (skip):** 26
- **Legacy / staging (skip):** 4

## Record Count Estimates (from SQL dump INSERT blocks)

Run on live MySQL for authoritative counts:

```sql
SELECT 'about_sliders' AS tbl, COUNT(*) AS cnt FROM `about_sliders` UNION ALL
SELECT 'admin_roles' AS tbl, COUNT(*) AS cnt FROM `admin_roles` UNION ALL
SELECT 'admin_wallet_histories' AS tbl, COUNT(*) AS cnt FROM `admin_wallet_histories` UNION ALL
SELECT 'admin_wallets' AS tbl, COUNT(*) AS cnt FROM `admin_wallets` UNION ALL
SELECT 'admins' AS tbl, COUNT(*) AS cnt FROM `admins` UNION ALL
SELECT 'allocation_logs' AS tbl, COUNT(*) AS cnt FROM `allocation_logs` UNION ALL
SELECT 'assigned_assets' AS tbl, COUNT(*) AS cnt FROM `assigned_assets` UNION ALL
SELECT 'attributes' AS tbl, COUNT(*) AS cnt FROM `attributes` UNION ALL
SELECT 'banners' AS tbl, COUNT(*) AS cnt FROM `banners` UNION ALL
SELECT 'billing_addresses' AS tbl, COUNT(*) AS cnt FROM `billing_addresses` UNION ALL
SELECT 'billing_manager' AS tbl, COUNT(*) AS cnt FROM `billing_manager` UNION ALL
SELECT 'blog_posts' AS tbl, COUNT(*) AS cnt FROM `blog_posts` UNION ALL
SELECT 'brands' AS tbl, COUNT(*) AS cnt FROM `brands` UNION ALL
SELECT 'bundle_management' AS tbl, COUNT(*) AS cnt FROM `bundle_management` UNION ALL
SELECT 'business_settings' AS tbl, COUNT(*) AS cnt FROM `business_settings` UNION ALL
SELECT 'cache' AS tbl, COUNT(*) AS cnt FROM `cache` UNION ALL
SELECT 'cart_shippings' AS tbl, COUNT(*) AS cnt FROM `cart_shippings` UNION ALL
SELECT 'carts' AS tbl, COUNT(*) AS cnt FROM `carts` UNION ALL
SELECT 'categories' AS tbl, COUNT(*) AS cnt FROM `categories` UNION ALL
SELECT 'category_shipping_costs' AS tbl, COUNT(*) AS cnt FROM `category_shipping_costs` UNION ALL
SELECT 'chattings' AS tbl, COUNT(*) AS cnt FROM `chattings` UNION ALL
SELECT 'colors' AS tbl, COUNT(*) AS cnt FROM `colors` UNION ALL
SELECT 'complaints_ticket' AS tbl, COUNT(*) AS cnt FROM `complaints_ticket` UNION ALL
SELECT 'contacts' AS tbl, COUNT(*) AS cnt FROM `contacts` UNION ALL
SELECT 'coupons' AS tbl, COUNT(*) AS cnt FROM `coupons` UNION ALL
SELECT 'courier_details' AS tbl, COUNT(*) AS cnt FROM `courier_details` UNION ALL
SELECT 'credit_and_debit_note' AS tbl, COUNT(*) AS cnt FROM `credit_and_debit_note` UNION ALL
SELECT 'currencies' AS tbl, COUNT(*) AS cnt FROM `currencies` UNION ALL
SELECT 'customer_audit_logs' AS tbl, COUNT(*) AS cnt FROM `customer_audit_logs` UNION ALL
SELECT 'customer_credit_note' AS tbl, COUNT(*) AS cnt FROM `customer_credit_note` UNION ALL
SELECT 'customer_rent_devices' AS tbl, COUNT(*) AS cnt FROM `customer_rent_devices` UNION ALL
SELECT 'customer_wallet_histories' AS tbl, COUNT(*) AS cnt FROM `customer_wallet_histories` UNION ALL
SELECT 'customer_wallets' AS tbl, COUNT(*) AS cnt FROM `customer_wallets` UNION ALL
SELECT 'customers' AS tbl, COUNT(*) AS cnt FROM `customers` UNION ALL
SELECT 'customers_backup' AS tbl, COUNT(*) AS cnt FROM `customers_backup` UNION ALL
SELECT 'customers_update' AS tbl, COUNT(*) AS cnt FROM `customers_update` UNION ALL
SELECT 'damage_parts_amount' AS tbl, COUNT(*) AS cnt FROM `damage_parts_amount` UNION ALL
SELECT 'data_table' AS tbl, COUNT(*) AS cnt FROM `data_table` UNION ALL
SELECT 'deal_of_the_days' AS tbl, COUNT(*) AS cnt FROM `deal_of_the_days` UNION ALL
SELECT 'delivery_challans' AS tbl, COUNT(*) AS cnt FROM `delivery_challans` UNION ALL
SELECT 'delivery_country_codes' AS tbl, COUNT(*) AS cnt FROM `delivery_country_codes` UNION ALL
SELECT 'delivery_histories' AS tbl, COUNT(*) AS cnt FROM `delivery_histories` UNION ALL
SELECT 'delivery_man_transactions' AS tbl, COUNT(*) AS cnt FROM `delivery_man_transactions` UNION ALL
SELECT 'delivery_men' AS tbl, COUNT(*) AS cnt FROM `delivery_men` UNION ALL
SELECT 'delivery_zip_codes' AS tbl, COUNT(*) AS cnt FROM `delivery_zip_codes` UNION ALL
SELECT 'deliveryman_notifications' AS tbl, COUNT(*) AS cnt FROM `deliveryman_notifications` UNION ALL
SELECT 'deliveryman_wallets' AS tbl, COUNT(*) AS cnt FROM `deliveryman_wallets` UNION ALL
SELECT 'emergency_contacts' AS tbl, COUNT(*) AS cnt FROM `emergency_contacts` UNION ALL
SELECT 'failed_jobs' AS tbl, COUNT(*) AS cnt FROM `failed_jobs` UNION ALL
SELECT 'feature_deals' AS tbl, COUNT(*) AS cnt FROM `feature_deals` UNION ALL
SELECT 'flash_deal_products' AS tbl, COUNT(*) AS cnt FROM `flash_deal_products` UNION ALL
SELECT 'flash_deals' AS tbl, COUNT(*) AS cnt FROM `flash_deals` UNION ALL
SELECT 'goods_received_notes' AS tbl, COUNT(*) AS cnt FROM `goods_received_notes` UNION ALL
SELECT 'goods_received_notes_parts' AS tbl, COUNT(*) AS cnt FROM `goods_received_notes_parts` UNION ALL
SELECT 'help_topics' AS tbl, COUNT(*) AS cnt FROM `help_topics` UNION ALL
SELECT 'insert_allocation_log_old_new' AS tbl, COUNT(*) AS cnt FROM `insert_allocation_log_old_new` UNION ALL
SELECT 'inventory' AS tbl, COUNT(*) AS cnt FROM `inventory` UNION ALL
SELECT 'invoices' AS tbl, COUNT(*) AS cnt FROM `invoices` UNION ALL
SELECT 'inward_outward' AS tbl, COUNT(*) AS cnt FROM `inward_outward` UNION ALL
SELECT 'issue_types' AS tbl, COUNT(*) AS cnt FROM `issue_types` UNION ALL
SELECT 'items' AS tbl, COUNT(*) AS cnt FROM `items` UNION ALL
SELECT 'jobs' AS tbl, COUNT(*) AS cnt FROM `jobs` UNION ALL
SELECT 'last_unique_number' AS tbl, COUNT(*) AS cnt FROM `last_unique_number` UNION ALL
SELECT 'loyalty_point_transactions' AS tbl, COUNT(*) AS cnt FROM `loyalty_point_transactions` UNION ALL
SELECT 'migrations' AS tbl, COUNT(*) AS cnt FROM `migrations` UNION ALL
SELECT 'new_modules' AS tbl, COUNT(*) AS cnt FROM `new_modules` UNION ALL
SELECT 'new_user_permissions' AS tbl, COUNT(*) AS cnt FROM `new_user_permissions` UNION ALL
SELECT 'notifications' AS tbl, COUNT(*) AS cnt FROM `notifications` UNION ALL
SELECT 'npa_assets' AS tbl, COUNT(*) AS cnt FROM `npa_assets` UNION ALL
SELECT 'oauth_access_tokens' AS tbl, COUNT(*) AS cnt FROM `oauth_access_tokens` UNION ALL
SELECT 'oauth_auth_codes' AS tbl, COUNT(*) AS cnt FROM `oauth_auth_codes` UNION ALL
SELECT 'oauth_clients' AS tbl, COUNT(*) AS cnt FROM `oauth_clients` UNION ALL
SELECT 'oauth_personal_access_clients' AS tbl, COUNT(*) AS cnt FROM `oauth_personal_access_clients` UNION ALL
SELECT 'oauth_refresh_tokens' AS tbl, COUNT(*) AS cnt FROM `oauth_refresh_tokens` UNION ALL
SELECT 'old_product_details' AS tbl, COUNT(*) AS cnt FROM `old_product_details` UNION ALL
SELECT 'order_details' AS tbl, COUNT(*) AS cnt FROM `order_details` UNION ALL
SELECT 'order_expected_delivery_histories' AS tbl, COUNT(*) AS cnt FROM `order_expected_delivery_histories` UNION ALL
SELECT 'order_status_histories' AS tbl, COUNT(*) AS cnt FROM `order_status_histories` UNION ALL
SELECT 'order_transactions' AS tbl, COUNT(*) AS cnt FROM `order_transactions` UNION ALL
SELECT 'orders' AS tbl, COUNT(*) AS cnt FROM `orders` UNION ALL
SELECT 'password_resets' AS tbl, COUNT(*) AS cnt FROM `password_resets` UNION ALL
SELECT 'paytabs_invoices' AS tbl, COUNT(*) AS cnt FROM `paytabs_invoices` UNION ALL
SELECT 'personal_access_tokens' AS tbl, COUNT(*) AS cnt FROM `personal_access_tokens` UNION ALL
SELECT 'phone_or_email_verifications' AS tbl, COUNT(*) AS cnt FROM `phone_or_email_verifications` UNION ALL
SELECT 'pod_submissions' AS tbl, COUNT(*) AS cnt FROM `pod_submissions` UNION ALL
SELECT 'product_details' AS tbl, COUNT(*) AS cnt FROM `product_details` UNION ALL
SELECT 'product_stocks' AS tbl, COUNT(*) AS cnt FROM `product_stocks` UNION ALL
SELECT 'product_tag' AS tbl, COUNT(*) AS cnt FROM `product_tag` UNION ALL
SELECT 'products' AS tbl, COUNT(*) AS cnt FROM `products` UNION ALL
SELECT 'purchase_orders' AS tbl, COUNT(*) AS cnt FROM `purchase_orders` UNION ALL
SELECT 'qc' AS tbl, COUNT(*) AS cnt FROM `qc` UNION ALL
SELECT 'qc_logs' AS tbl, COUNT(*) AS cnt FROM `qc_logs` UNION ALL
SELECT 'qc_truetech_delivery_challans' AS tbl, COUNT(*) AS cnt FROM `qc_truetech_delivery_challans` UNION ALL
SELECT 'quotations' AS tbl, COUNT(*) AS cnt FROM `quotations` UNION ALL
SELECT 'refund_requests' AS tbl, COUNT(*) AS cnt FROM `refund_requests` UNION ALL
SELECT 'refund_statuses' AS tbl, COUNT(*) AS cnt FROM `refund_statuses` UNION ALL
SELECT 'refund_transactions' AS tbl, COUNT(*) AS cnt FROM `refund_transactions` UNION ALL
SELECT 'rent_devices' AS tbl, COUNT(*) AS cnt FROM `rent_devices` UNION ALL
SELECT 'rent_reports' AS tbl, COUNT(*) AS cnt FROM `rent_reports` UNION ALL
SELECT 'rent_reports_customer' AS tbl, COUNT(*) AS cnt FROM `rent_reports_customer` UNION ALL
SELECT 'repair_logs' AS tbl, COUNT(*) AS cnt FROM `repair_logs` UNION ALL
SELECT 'review_sets' AS tbl, COUNT(*) AS cnt FROM `review_sets` UNION ALL
SELECT 'reviews' AS tbl, COUNT(*) AS cnt FROM `reviews` UNION ALL
SELECT 'role_permissions' AS tbl, COUNT(*) AS cnt FROM `role_permissions` UNION ALL
SELECT 'roles' AS tbl, COUNT(*) AS cnt FROM `roles` UNION ALL
SELECT 'roles_modules' AS tbl, COUNT(*) AS cnt FROM `roles_modules` UNION ALL
SELECT 'sales_orders' AS tbl, COUNT(*) AS cnt FROM `sales_orders` UNION ALL
SELECT 'search_functions' AS tbl, COUNT(*) AS cnt FROM `search_functions` UNION ALL
SELECT 'seller_wallet_histories' AS tbl, COUNT(*) AS cnt FROM `seller_wallet_histories` UNION ALL
SELECT 'seller_wallets' AS tbl, COUNT(*) AS cnt FROM `seller_wallets` UNION ALL
SELECT 'sellers' AS tbl, COUNT(*) AS cnt FROM `sellers` UNION ALL
SELECT 'serial_numberOnly' AS tbl, COUNT(*) AS cnt FROM `serial_numberOnly` UNION ALL
SELECT 'serial_number_parts' AS tbl, COUNT(*) AS cnt FROM `serial_number_parts` UNION ALL
SELECT 'serial_number_update_logs' AS tbl, COUNT(*) AS cnt FROM `serial_number_update_logs` UNION ALL
SELECT 'serial_numbers' AS tbl, COUNT(*) AS cnt FROM `serial_numbers` UNION ALL
SELECT 'sessions' AS tbl, COUNT(*) AS cnt FROM `sessions` UNION ALL
SELECT 'shipping_addresses' AS tbl, COUNT(*) AS cnt FROM `shipping_addresses` UNION ALL
SELECT 'shipping_methods' AS tbl, COUNT(*) AS cnt FROM `shipping_methods` UNION ALL
SELECT 'shipping_types' AS tbl, COUNT(*) AS cnt FROM `shipping_types` UNION ALL
SELECT 'shops' AS tbl, COUNT(*) AS cnt FROM `shops` UNION ALL
SELECT 'social_medias' AS tbl, COUNT(*) AS cnt FROM `social_medias` UNION ALL
SELECT 'soft_credentials' AS tbl, COUNT(*) AS cnt FROM `soft_credentials` UNION ALL
SELECT 'spare_parts' AS tbl, COUNT(*) AS cnt FROM `spare_parts` UNION ALL
SELECT 'spare_parts_po' AS tbl, COUNT(*) AS cnt FROM `spare_parts_po` UNION ALL
SELECT 'split_rent_billing' AS tbl, COUNT(*) AS cnt FROM `split_rent_billing` UNION ALL
SELECT 'stock_products' AS tbl, COUNT(*) AS cnt FROM `stock_products` UNION ALL
SELECT 'sub_modules' AS tbl, COUNT(*) AS cnt FROM `sub_modules` UNION ALL
SELECT 'subscriptions' AS tbl, COUNT(*) AS cnt FROM `subscriptions` UNION ALL
SELECT 'support_ticket_convs' AS tbl, COUNT(*) AS cnt FROM `support_ticket_convs` UNION ALL
SELECT 'support_tickets' AS tbl, COUNT(*) AS cnt FROM `support_tickets` UNION ALL
SELECT 'tags' AS tbl, COUNT(*) AS cnt FROM `tags` UNION ALL
SELECT 'team_members' AS tbl, COUNT(*) AS cnt FROM `team_members` UNION ALL
SELECT 'transactions' AS tbl, COUNT(*) AS cnt FROM `transactions` UNION ALL
SELECT 'translations' AS tbl, COUNT(*) AS cnt FROM `translations` UNION ALL
SELECT 'users' AS tbl, COUNT(*) AS cnt FROM `users` UNION ALL
SELECT 'video' AS tbl, COUNT(*) AS cnt FROM `video` UNION ALL
SELECT 'videos' AS tbl, COUNT(*) AS cnt FROM `videos` UNION ALL
SELECT 'wallet_transactions' AS tbl, COUNT(*) AS cnt FROM `wallet_transactions` UNION ALL
SELECT 'warehouse' AS tbl, COUNT(*) AS cnt FROM `warehouse` UNION ALL
SELECT 'wishlists' AS tbl, COUNT(*) AS cnt FROM `wishlists` UNION ALL
SELECT 'withdraw_requests' AS tbl, COUNT(*) AS cnt FROM `withdraw_requests` UNION ALL
SELECT 'withdrawal_methods' AS tbl, COUNT(*) AS cnt FROM `withdrawal_methods`;
```

### Top tables by estimated rows

| Table | Est. Rows | Soft Delete |
| --- | --- | --- |
| delivery_challans | 130 | No |
| sales_orders | 100 | No |
| inward_outward | 73 | No |
| customer_rent_devices | 44 | No |
| customer_audit_logs | 40 | No |
| allocation_logs | 26 | No |
| product_details | 24 | No |
| serial_numbers | 19 | No |
| complaints_ticket | 16 | No |
| pod_submissions | 15 | No |
| inventory | 11 | No |
| serial_numberOnly | 8 | Yes |
| serial_number_parts | 7 | No |
| customers | 6 | No |
| customers_backup | 6 | No |
| customers_update | 6 | No |
| rent_devices | 5 | No |
| goods_received_notes_parts | 4 | No |
| spare_parts_po | 4 | No |
| purchase_orders | 3 | Yes |
| bundle_management | 2 | No |
| new_user_permissions | 2 | No |
| sellers | 2 | No |
| sessions | 2 | No |
| admins | 1 | No |

## Master Tables

- `admin_roles`
- `attributes`
- `brands`
- `bundle_management`
- `business_settings`
- `categories`
- `colors`
- `courier_details`
- `currencies`
- `delivery_men`
- `issue_types`
- `items`
- `last_unique_number`
- `new_modules`
- `products`
- `product_details`
- `rent_devices`
- `sellers`

## Transaction Tables

- `admins`
- `admin_wallets`
- `assigned_assets`
- `billing_addresses`
- `billing_manager`
- `category_shipping_costs`
- `complaints_ticket`
- `credit_and_debit_note`
- `customers`
- `customers_backup`
- `customers_update`
- `customer_credit_note`
- `customer_rent_devices`
- `customer_wallets`
- `damage_parts_amount`
- `deliveryman_wallets`
- `delivery_challans`
- `delivery_country_codes`
- `delivery_histories`
- `delivery_man_transactions`
- `delivery_zip_codes`
- `goods_received_notes`
- `goods_received_notes_parts`
- `inventory`
- `invoices`
- `inward_outward`
- `loyalty_point_transactions`
- `new_user_permissions`
- `npa_assets`
- `orders`
- `order_details`
- `order_expected_delivery_histories`
- `order_status_histories`
- `order_transactions`
- `paytabs_invoices`
- `pod_submissions`
- `product_stocks`
- `product_tag`
- `purchase_orders`
- `qc`
- `qc_truetech_delivery_challans`
- `quotations`
- `refund_requests`
- `refund_statuses`
- `refund_transactions`
- `rent_reports`
- `rent_reports_customer`
- `reviews`
- `review_sets`
- `roles`
- `roles_modules`
- `role_permissions`
- `sales_orders`
- `search_functions`
- `seller_wallets`
- `serial_numberOnly`
- `serial_numbers`
- `serial_number_parts`
- `sessions`
- `shipping_addresses`
- `shipping_methods`
- `shipping_types`
- `shops`
- `social_medias`
- `soft_credentials`
- `spare_parts`
- `spare_parts_po`
- `split_rent_billing`
- `stock_products`
- `subscriptions`
- `sub_modules`
- `support_tickets`
- `support_ticket_convs`
- `tags`
- `team_members`
- `transactions`
- `translations`
- `users`
- `video`
- `videos`
- `wallet_transactions`
- `warehouse`
- `wishlists`
- `withdrawal_methods`
- `withdraw_requests`

## Audit / Log Tables

- `admin_wallet_histories`
- `allocation_logs`
- `customer_audit_logs`
- `customer_wallet_histories`
- `insert_allocation_log_old_new`
- `qc_logs`
- `repair_logs`
- `seller_wallet_histories`
- `serial_number_update_logs`

## Full Table Catalog

### `about_sliders`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` int(11) NOT NULL; `image` varchar(255) NOT NULL; `status` int(11) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `admin_roles`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(30) DEFAULT NULL; `module_access` varchar(250) DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `admin_wallet_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `admin_id` bigint(20) DEFAULT NULL; `amount` double NOT NULL DEFAULT 0; `order_id` bigint(20) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `payment` varchar(191) NOT NULL DEFAULT 'received'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `admin_wallets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (10):** `id` bigint(20) UNSIGNED NOT NULL; `admin_id` bigint(20) DEFAULT NULL; `inhouse_earning` double NOT NULL DEFAULT 0; `withdrawn` double NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `commission_earned` double(8; `delivery_charge_earned` double(8; `pending_amount` double(8; `total_tax_collected` double(8
- **CRM mapping:** Skip → TBD

### `admins`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (16):** `id` bigint(20) UNSIGNED NOT NULL; `admin_type` varchar(255) NOT NULL DEFAULT 'admin'; `name` varchar(80) DEFAULT NULL; `phone` varchar(25) DEFAULT NULL; `admin_role_id` bigint(20) NOT NULL DEFAULT 8; `image` longtext NOT NULL DEFAULT 'def.png'; `email` varchar(80) NOT NULL; `email_verified_at` timestamp NULL DEFAULT NULL; `password` varchar(80) NOT NULL; `remember_token` varchar(100) DEFAULT NULL; `see_price_permission` int(11) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `is_superadmin` int(11) NOT NULL DEFAULT 0; `status` tinyint(1) NOT NULL DEFAULT 1; `role_id` int(11) NOT NULL DEFAULT 1
- **CRM mapping:** Additive → users

### `allocation_logs`

- **Est. rows:** 26
- **Soft delete:** No
- **Columns (32):** `id` int(11) NOT NULL; `user_id` int(11) NOT NULL; `vendor_name` varchar(255) DEFAULT NULL; `vendor_id` varchar(255) DEFAULT NULL; `customer_id` int(11) DEFAULT NULL; `customer_name` varchar(255) DEFAULT NULL; `challan_id` varchar(255) DEFAULT NULL; `product_id` int(10) DEFAULT NULL; `model_name` varchar(255) DEFAULT NULL; `serial_number` varchar(255) DEFAULT NULL; `old_serial_number` varchar(255) DEFAULT NULL; `unique_id` varchar(255) DEFAULT NULL; `action_taken` varchar(50) DEFAULT NULL; `remarks` text DEFAULT NULL; `po_type` varchar(50) DEFAULT NULL; `purchase_type` varchar(50) DEFAULT NULL; `qc_status` varchar(50) DEFAULT NULL; `locking_period` int(11) DEFAULT NULL; `added_date` date DEFAULT NULL; `failure_reason` text DEFAULT NULL; `checked_by` int(11) DEFAULT NULL; `assigned_to` int(11) DEFAULT NULL; `warranty_status` varchar(50) DEFAULT NULL; `rental_status` varchar(50) DEFAULT NULL; `in_ward` varchar(255) DEFAULT NULL; `out_ward` varchar(255) DEFAULT NULL; `require_parts` varchar(255) DEFAULT NULL; `file_path` varchar(255) DEFAULT NULL; `logType` enum('qc_log'; `created_at` timestamp NULL DEFAULT current_timestamp()
- **CRM mapping:** Direct → allocation_logs

### `assigned_assets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (19):** `id` int(25) NOT NULL; `product_detail_id` varchar(255) DEFAULT NULL; `member_id` int(25) NOT NULL; `type` varchar(255) DEFAULT NULL; `serial_number` varchar(255) DEFAULT NULL; `serial_unique_id` varchar(255) DEFAULT NULL; `serial_number_parts` varchar(255) DEFAULT NULL; `serial_number_mobile` varchar(255) DEFAULT NULL; `parts_unique_id` varchar(255) DEFAULT NULL; `serial_details` longtext DEFAULT NULL; `parts_details` varchar(2000) DEFAULT NULL; `returned_serial_details` longtext DEFAULT NULL; `returned_parts_details` longtext DEFAULT NULL; `returned_mobile_details` varchar(255) DEFAULT NULL; `date` date DEFAULT NULL; `assigned_by` varchar(255) DEFAULT NULL; `status` int(11) NOT NULL DEFAULT 1; `created_at` datetime NOT NULL DEFAULT current_timestamp(); `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → customer_inventory

### `attributes`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(100) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `attributes` longtext DEFAULT NULL; `status` varchar(255) DEFAULT '1'
- **CRM mapping:** Additive → asset_config_*

### `banners`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `photo` varchar(255) DEFAULT NULL; `banner_type` varchar(255) NOT NULL; `published` int(11) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `url` varchar(255) DEFAULT NULL; `resource_type` varchar(191) DEFAULT NULL; `resource_id` bigint(20) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `billing_addresses`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (14):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `contact_person_name` varchar(191) DEFAULT NULL; `address_type` varchar(191) DEFAULT NULL; `address` varchar(191) DEFAULT NULL; `city` varchar(191) DEFAULT NULL; `zip` varchar(191) DEFAULT NULL; `phone` varchar(191) DEFAULT NULL; `state` varchar(191) DEFAULT NULL; `country` varchar(191) DEFAULT NULL; `latitude` varchar(191) DEFAULT NULL; `longitude` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → customer_addresses

### `billing_manager`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (26):** `id` int(11) NOT NULL; `name` varchar(255) DEFAULT NULL; `f_name` varchar(255) DEFAULT NULL; `l_name` varchar(255) DEFAULT NULL; `address` text DEFAULT NULL; `country_code` varchar(10) DEFAULT NULL; `phone` varchar(20) DEFAULT NULL; `email` varchar(255) DEFAULT NULL; `identity_number` varchar(100) DEFAULT NULL; `identity_type` varchar(50) DEFAULT NULL; `identity_image` text DEFAULT NULL; `image` text DEFAULT NULL; `password` varchar(255) DEFAULT NULL; `remember_pass` varchar(255) DEFAULT NULL; `bank_name` varchar(255) DEFAULT NULL; `branch` varchar(255) DEFAULT NULL; `account_no` varchar(255) DEFAULT NULL; `holder_name` varchar(255) DEFAULT NULL; `is_active` tinyint(1) DEFAULT NULL; `is_online` tinyint(1) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp(); `auth_token` text DEFAULT NULL; `fcm_token` text DEFAULT NULL; `remember_token` varchar(100) DEFAULT NULL; `role_id` int(11) NOT NULL DEFAULT 4
- **CRM mapping:** Transform → customer_invoices + users

### `blog_posts`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (12):** `id` bigint(20) UNSIGNED NOT NULL; `title` varchar(255) NOT NULL; `subTitle` varchar(255) NOT NULL DEFAULT 'sub Title'; `slug` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `image` varchar(255) NOT NULL; `shortdescription` text NOT NULL; `description` text DEFAULT NULL; `type` varchar(255) NOT NULL DEFAULT 'ex'; `date` date NOT NULL DEFAULT current_timestamp(); `status` int(11) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `brands`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(50) DEFAULT NULL; `image` varchar(50) NOT NULL DEFAULT 'def.png'; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Additive → asset_config_brands + laptop_catalog

### `bundle_management`

- **Est. rows:** 2
- **Soft delete:** No
- **Columns (10):** `id` bigint(20) UNSIGNED NOT NULL; `main_serial_id` bigint(20) UNSIGNED NOT NULL; `main_serial_number` varchar(191) DEFAULT NULL; `main_unique_number` varchar(191) DEFAULT NULL; `spare_parts_id` longtext DEFAULT NULL; `spare_parts_serial_and_unique_number` longtext DEFAULT NULL; `user_id` bigint(20) UNSIGNED DEFAULT NULL; `user_type` varchar(191) NOT NULL DEFAULT 'admin'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Additive → laptop_catalog

### `business_settings`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `type` varchar(50) NOT NULL; `value` longtext NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `cache`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (3):** `key` varchar(191) NOT NULL; `value` mediumtext NOT NULL; `expiration` int(11) NOT NULL
- **CRM mapping:** Skip → TBD

### `cart_shippings`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `cart_group_id` varchar(191) DEFAULT NULL; `shipping_method_id` bigint(20) DEFAULT NULL; `shipping_cost` double(8; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `carts`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (25):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) DEFAULT NULL; `cart_group_id` varchar(191) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `product_type` varchar(20) NOT NULL DEFAULT 'physical'; `digital_product_type` varchar(30) DEFAULT NULL; `color` varchar(191) DEFAULT NULL; `choices` text DEFAULT NULL; `variations` text DEFAULT NULL; `variant` text DEFAULT NULL; `quantity` int(11) NOT NULL DEFAULT 1; `price` double NOT NULL DEFAULT 1; `tax` double NOT NULL DEFAULT 1; `discount` double NOT NULL DEFAULT 1; `tax_model` varchar(20) NOT NULL DEFAULT 'exclude'; `slug` varchar(191) DEFAULT NULL; `name` varchar(191) DEFAULT NULL; `thumbnail` varchar(191) DEFAULT NULL; `seller_id` bigint(20) DEFAULT NULL; `seller_is` varchar(191) NOT NULL DEFAULT 'admin'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `shop_info` varchar(191) DEFAULT NULL; `shipping_cost` double(8; `shipping_type` varchar(191) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `categories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (11):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(100) NOT NULL; `slug` varchar(100) NOT NULL; `icon` varchar(250) DEFAULT NULL; `parent_id` int(11) NOT NULL; `position` int(11) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `home_status` tinyint(1) NOT NULL DEFAULT 0; `status` int(11) NOT NULL DEFAULT 1; `priority` int(11) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `category_shipping_costs`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) UNSIGNED DEFAULT NULL; `category_id` int(10) UNSIGNED DEFAULT NULL; `cost` double(8; `multiply_qty` tinyint(1) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `chattings`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (18):** `id` bigint(20) UNSIGNED NOT NULL; `user_id` bigint(20) DEFAULT NULL; `seller_id` bigint(20) DEFAULT NULL; `admin_id` bigint(20) DEFAULT NULL; `delivery_man_id` bigint(20) DEFAULT NULL; `message` text NOT NULL; `sent_by_customer` tinyint(1) NOT NULL DEFAULT 0; `sent_by_seller` tinyint(1) NOT NULL DEFAULT 0; `sent_by_admin` tinyint(1) DEFAULT NULL; `sent_by_delivery_man` tinyint(1) DEFAULT NULL; `seen_by_customer` tinyint(1) NOT NULL DEFAULT 1; `seen_by_seller` tinyint(1) NOT NULL DEFAULT 1; `seen_by_admin` tinyint(1) DEFAULT NULL; `seen_by_delivery_man` tinyint(1) DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `shop_id` bigint(20) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `colors`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` int(11) NOT NULL; `name` varchar(30) DEFAULT NULL; `code` varchar(10) DEFAULT NULL; `created_at` timestamp NOT NULL DEFAULT current_timestamp(); `updated_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Skip → TBD

### `complaints_ticket`

- **Est. rows:** 16
- **Soft delete:** No
- **Columns (29):** `id` bigint(20) UNSIGNED NOT NULL; `ticket_number` varchar(255) DEFAULT NULL; `return_dc_number` varchar(255) DEFAULT NULL; `user_id` bigint(20) UNSIGNED NOT NULL; `delivery_person_id` int(11) DEFAULT NULL; `courier_name` varchar(255) DEFAULT NULL; `awb_number` varchar(255) DEFAULT NULL; `customer_id` int(255) DEFAULT NULL; `name` varchar(255) NOT NULL; `email` varchar(255) NOT NULL; `phone` varchar(20) NOT NULL; `serial_number` varchar(255) NOT NULL; `unique_number` varchar(255) NOT NULL; `complaint_type` enum('pickup'; `damage_description` text DEFAULT NULL; `remark` text NOT NULL; `status` enum('open'; `generated_by` enum('customer'; `comments` text DEFAULT NULL; `add_parts` longtext DEFAULT NULL; `assign_parts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`assign_parts`)); `old_assign_parts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_assign_parts`)); `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `closed_at` timestamp NULL DEFAULT NULL; `assigned_parts` longtext DEFAULT NULL; `installed_parts` longtext DEFAULT NULL; `replaced_parts` longtext DEFAULT NULL; `handover_removed` longtext DEFAULT NULL
- **CRM mapping:** Transform → support_tickets + support_ticket_items + tickets

### `contacts`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (11):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) DEFAULT NULL; `email` varchar(191) DEFAULT NULL; `mobile_number` varchar(191) NOT NULL; `subject` varchar(191) NOT NULL; `message` text NOT NULL; `seen` tinyint(1) NOT NULL DEFAULT 0; `feedback` varchar(191) NOT NULL DEFAULT '0'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `reply` longtext DEFAULT NULL
- **CRM mapping:** Partial → leads

### `coupons`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (18):** `id` bigint(20) UNSIGNED NOT NULL; `added_by` varchar(191) NOT NULL DEFAULT 'admin'; `coupon_type` varchar(50) DEFAULT NULL; `coupon_bearer` varchar(191) NOT NULL DEFAULT 'inhouse'; `seller_id` bigint(20) DEFAULT NULL COMMENT 'NULL=in-house; `customer_id` bigint(20) DEFAULT NULL COMMENT '0 = all customer'; `title` varchar(100) DEFAULT NULL; `code` varchar(15) DEFAULT NULL; `start_date` date DEFAULT NULL; `expire_date` date DEFAULT NULL; `min_purchase` decimal(8; `max_discount` decimal(8; `discount` decimal(8; `discount_type` varchar(15) NOT NULL DEFAULT 'percentage'; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `limit` int(11) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `courier_details`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `courier_name` varchar(255) NOT NULL; `awb_number` varchar(100) NOT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Direct → sm_courier_details

### `credit_and_debit_note`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (14):** `id` bigint(20) UNSIGNED NOT NULL; `credit_or_debit_number` varchar(191) NOT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `vendor_id` bigint(20) UNSIGNED DEFAULT NULL; `products_id` text DEFAULT NULL; `serial_numbers` text DEFAULT NULL; `total_credit_debit_amount` decimal(10; `type` enum('credit'; `product_type` enum('laptop_desktop'; `created_by_id` int(255) DEFAULT NULL; `created_by_type` varchar(255) DEFAULT NULL; `status` enum('1'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → vendor_debit_notes + customer_credit_notes

### `currencies`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) NOT NULL; `symbol` varchar(191) NOT NULL; `code` varchar(191) NOT NULL; `exchange_rate` varchar(191) NOT NULL; `status` tinyint(1) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `customer_audit_logs`

- **Est. rows:** 40
- **Soft delete:** No
- **Columns (21):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `customer_name` varchar(191) DEFAULT NULL; `transaction_type` varchar(191) DEFAULT NULL; `action` varchar(191) DEFAULT NULL; `product_name` varchar(191) DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_asset_number` varchar(191) DEFAULT NULL; `quantity` int(11) DEFAULT NULL; `ticket_id` bigint(20) UNSIGNED DEFAULT NULL; `ticket_number` varchar(191) DEFAULT NULL; `ticket_type` varchar(191) DEFAULT NULL; `ticket_status` varchar(191) DEFAULT NULL; `transaction_date` datetime DEFAULT NULL; `performed_by` varchar(191) DEFAULT NULL; `remarks` text DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `performed_by_id` int(11) DEFAULT NULL; `dc_number` varchar(255) DEFAULT NULL; `pod_files` text DEFAULT NULL
- **CRM mapping:** Partial → ttspl_audit_log / permission_audit_logs

### `customer_credit_note`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (27):** `id` bigint(20) UNSIGNED NOT NULL; `serial_id` varchar(191) DEFAULT NULL; `month` varchar(255) DEFAULT NULL; `po_id` varchar(255) DEFAULT NULL; `dc_number` varchar(255) DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_number` varchar(191) DEFAULT NULL; `product_id` varchar(191) DEFAULT NULL; `rent_start_date` date DEFAULT NULL; `rent_end_date` date DEFAULT NULL; `rent_amount` double DEFAULT NULL; `month_rent` double DEFAULT NULL; `rent_with_gst` varchar(191) DEFAULT NULL; `total_amount` varchar(255) DEFAULT NULL; `vendor_id` bigint(20) UNSIGNED DEFAULT NULL; `invoice_number` varchar(255) DEFAULT NULL; `type` varchar(191) DEFAULT NULL; `status` varchar(191) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `rent_stop_date` date DEFAULT NULL; `rent_start_date_again` date DEFAULT NULL; `temp_amount` decimal(65; `credit_note_amount` int(11) DEFAULT NULL; `debit_note_amount` int(11) DEFAULT NULL; `credit_type` enum('credit_note'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → customer_credit_notes

### `customer_rent_devices`

- **Est. rows:** 44
- **Soft delete:** No
- **Columns (28):** `id` bigint(20) UNSIGNED NOT NULL; `serial_id` varchar(191) DEFAULT NULL; `month` varchar(255) DEFAULT NULL; `po_id` varchar(255) DEFAULT NULL; `dc_number` varchar(255) DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_number` varchar(191) DEFAULT NULL; `product_details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`product_details`)); `rent_start_date` date DEFAULT NULL; `rent_end_date` date DEFAULT NULL; `credit_start_date` varchar(255) DEFAULT NULL; `credit_end_date` varchar(255) DEFAULT NULL; `per_day_amount` varchar(255) DEFAULT '0'; `total_credit_day` int(11) NOT NULL DEFAULT 0; `rent_amount` double DEFAULT NULL; `month_rent` double DEFAULT NULL; `rent_with_gst` varchar(191) DEFAULT NULL; `total_amount` varchar(255) DEFAULT NULL; `vendor_id` bigint(20) UNSIGNED DEFAULT NULL; `type` varchar(191) DEFAULT NULL; `status` varchar(191) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `rent_stop_date` date DEFAULT NULL; `rent_start_date_again` date DEFAULT NULL; `temp_amount` decimal(65; `ordinary_amount` decimal(65; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → customer_inventory + rent_devices

### `customer_wallet_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) DEFAULT NULL; `transaction_amount` decimal(8; `transaction_type` varchar(20) DEFAULT NULL; `transaction_method` varchar(30) DEFAULT NULL; `transaction_id` varchar(20) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Gap → TBD

### `customer_wallets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) DEFAULT NULL; `balance` decimal(8; `royality_points` decimal(8; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → customer_security_deposits

### `customers`

- **Est. rows:** 6
- **Soft delete:** No
- **Columns (24):** `id` bigint(20) UNSIGNED NOT NULL; `customer_name` varchar(191) NOT NULL; `contact_person_name` varchar(191) NOT NULL; `contact_person_number` varchar(15) NOT NULL; `customer_number` varchar(15) DEFAULT NULL; `email` varchar(191) NOT NULL; `billing_address` text DEFAULT NULL; `billing_address_state` varchar(191) DEFAULT NULL; `billing_address_pin_code` varchar(10) DEFAULT NULL; `shipping_address` text DEFAULT NULL; `shipping_address_state` varchar(191) DEFAULT NULL; `shipping_address_pin_code` varchar(10) DEFAULT NULL; `business_type` varchar(191) NOT NULL; `gst_number` varchar(191) DEFAULT NULL; `pan_card_number` varchar(191) DEFAULT NULL; `upload_docs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`upload_docs`)); `remember_token` text DEFAULT NULL; `profile` varchar(191) DEFAULT NULL; `password` varchar(191) DEFAULT NULL; `remember_pass` varchar(191) DEFAULT NULL; `status` varchar(191) NOT NULL DEFAULT '1'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `role_id` int(11) NOT NULL DEFAULT 2
- **CRM mapping:** Transform → customers + customer_addresses + customer_documents

### `customers_backup`

- **Est. rows:** 6
- **Soft delete:** No
- **Columns (24):** `id` bigint(20) UNSIGNED NOT NULL DEFAULT 0; `customer_name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL; `contact_person_name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL; `contact_person_number` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL; `customer_number` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL; `billing_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `billing_address_state` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `billing_address_pin_code` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `shipping_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `shipping_address_state` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `shipping_address_pin_code` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `business_type` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL; `gst_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `pan_card_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `upload_docs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`upload_docs`)); `remember_token` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `profile` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `password` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `remember_pass` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL; `status` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `role_id` int(11) NOT NULL DEFAULT 2
- **CRM mapping:** Skip → TBD

### `customers_update`

- **Est. rows:** 6
- **Soft delete:** No
- **Columns (24):** `id` bigint(20) UNSIGNED NOT NULL; `customer_name` varchar(191) NOT NULL; `contact_person_name` varchar(191) NOT NULL; `contact_person_number` varchar(15) NOT NULL; `customer_number` varchar(15) DEFAULT NULL; `email` varchar(191) NOT NULL; `billing_address` text DEFAULT NULL; `billing_address_state` varchar(191) DEFAULT NULL; `billing_address_pin_code` varchar(10) DEFAULT NULL; `shipping_address` text DEFAULT NULL; `shipping_address_state` varchar(191) DEFAULT NULL; `shipping_address_pin_code` varchar(10) DEFAULT NULL; `business_type` varchar(191) NOT NULL; `gst_number` varchar(191) DEFAULT NULL; `pan_card_number` varchar(191) DEFAULT NULL; `upload_docs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`upload_docs`)); `remember_token` text DEFAULT NULL; `profile` varchar(191) DEFAULT NULL; `password` varchar(191) DEFAULT NULL; `remember_pass` varchar(191) DEFAULT NULL; `status` varchar(191) NOT NULL DEFAULT '1'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `role_id` int(11) NOT NULL DEFAULT 2
- **CRM mapping:** Skip → TBD

### `damage_parts_amount`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (16):** `id` int(10) NOT NULL; `ticket_id` int(10) DEFAULT NULL; `transaction_id` varchar(25) DEFAULT NULL; `pod_submission_id` int(10) DEFAULT NULL; `billing_person_id` int(11) DEFAULT NULL; `parts_with_amount` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`parts_with_amount`)); `old_damage_parts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_damage_parts`)); `status` enum('pending'; `customer_id` int(15) DEFAULT NULL; `customer_email` varchar(255) DEFAULT NULL; `customer_name` varchar(255) DEFAULT NULL; `customer_mobile` varchar(255) DEFAULT NULL; `submitted_by_id` int(15) DEFAULT NULL; `submitted_by_type` varchar(255) DEFAULT NULL; `created_at` timestamp NOT NULL DEFAULT current_timestamp(); `updated_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Transform → diagnosis_parts_required + ticket_parts

### `data_table`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `heading` varchar(255) NOT NULL; `sub_heading` longtext DEFAULT NULL; `main_heading` varchar(255) NOT NULL; `image1` varchar(255) DEFAULT NULL; `image2` varchar(255) DEFAULT NULL; `status` tinyint(1) DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `deal_of_the_days`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `title` varchar(150) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `discount` decimal(8; `discount_type` varchar(12) NOT NULL DEFAULT 'amount'; `status` tinyint(1) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `delivery_challans`

- **Est. rows:** 130
- **Soft delete:** No
- **Columns (61):** `id` bigint(20) UNSIGNED NOT NULL; `dc_number` varchar(255) DEFAULT NULL; `sales_order_number` varchar(191) DEFAULT NULL; `quotation_number` varchar(191) DEFAULT NULL; `customer_name` varchar(191) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED NOT NULL; `email` varchar(191) DEFAULT NULL; `GST_number` varchar(191) DEFAULT NULL; `customer_billing_address` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`customer_billing_address`)); `customer_shipping_address` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`customer_shipping_address`)); `brand` varchar(191) DEFAULT NULL; `quantity` varchar(191) DEFAULT NULL; `main_qty` int(11) DEFAULT NULL; `serial_number` longtext DEFAULT NULL; `ship_by` varchar(191) DEFAULT NULL; `courier_name` varchar(191) DEFAULT NULL; `awb_number` varchar(191) DEFAULT NULL; `delivery_person_id` varchar(20) DEFAULT NULL; `supply_state` varchar(255) DEFAULT NULL; `branch` varchar(255) DEFAULT NULL; `remarks` text DEFAULT NULL; `model_name` varchar(255) DEFAULT NULL; `submitted_name` varchar(255) DEFAULT NULL; `date_and_time` varchar(255) DEFAULT NULL; `submitted_remark` varchar(255) DEFAULT NULL; `submitted_person_id` int(255) DEFAULT NULL; `submitted_person_type` varchar(255) DEFAULT NULL; `file_path` longtext DEFAULT NULL; `shiping_charges` varchar(255) DEFAULT '0'; `security_amount` varchar(255) DEFAULT '0'
- **CRM mapping:** Transform → delivery_challan_lines + demo_agreements

### `delivery_country_codes`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` bigint(20) UNSIGNED NOT NULL; `country_code` varchar(191) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `delivery_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) DEFAULT NULL; `deliveryman_id` bigint(20) DEFAULT NULL; `time` datetime DEFAULT NULL; `longitude` varchar(191) DEFAULT NULL; `latitude` varchar(191) DEFAULT NULL; `location` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → activities / work_logs

### `delivery_man_transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (10):** `id` bigint(20) UNSIGNED NOT NULL; `delivery_man_id` bigint(20) NOT NULL; `user_id` bigint(20) NOT NULL; `user_type` varchar(20) NOT NULL; `transaction_id` char(36) NOT NULL; `debit` decimal(50; `credit` decimal(50; `transaction_type` varchar(20) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `delivery_men`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (26):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) DEFAULT NULL; `name` varchar(255) DEFAULT NULL; `f_name` varchar(100) DEFAULT NULL; `l_name` varchar(100) DEFAULT NULL; `address` text DEFAULT NULL; `country_code` varchar(20) DEFAULT NULL; `phone` varchar(20) NOT NULL; `email` varchar(100) DEFAULT NULL; `identity_number` varchar(30) DEFAULT NULL; `identity_type` varchar(50) DEFAULT NULL; `identity_image` varchar(191) DEFAULT NULL; `image` varchar(100) DEFAULT NULL; `password` varchar(100) NOT NULL; `remember_pass` varchar(255) DEFAULT NULL; `bank_name` varchar(191) DEFAULT NULL; `branch` varchar(191) DEFAULT NULL; `account_no` varchar(191) DEFAULT NULL; `holder_name` varchar(191) DEFAULT NULL; `is_active` tinyint(1) NOT NULL DEFAULT 1; `is_online` tinyint(4) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `auth_token` varchar(191) NOT NULL DEFAULT '6yIRXJRRfp78qJsAoKZZ6TTqhzuNJ3TcdvPBmk6n'; `fcm_token` varchar(191) DEFAULT NULL; `remember_token` varchar(255) DEFAULT NULL
- **CRM mapping:** Transform → delivery_technicians

### `delivery_zip_codes`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` bigint(20) UNSIGNED NOT NULL; `zipcode` varchar(191) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `deliveryman_notifications`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `delivery_man_id` bigint(20) NOT NULL; `order_id` bigint(20) NOT NULL; `description` varchar(191) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `deliveryman_wallets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `delivery_man_id` bigint(20) NOT NULL; `current_balance` decimal(50; `cash_in_hand` decimal(50; `pending_withdraw` decimal(50; `total_withdraw` decimal(50; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `emergency_contacts`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `user_id` bigint(20) NOT NULL; `name` varchar(191) NOT NULL; `phone` varchar(25) NOT NULL; `status` tinyint(1) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `failed_jobs`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `connection` text NOT NULL; `queue` text NOT NULL; `payload` longtext NOT NULL; `exception` longtext NOT NULL; `failed_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Skip → TBD

### `feature_deals`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `url` varchar(191) DEFAULT NULL; `photo` varchar(191) DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `flash_deal_products`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `flash_deal_id` bigint(20) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `discount` decimal(8; `discount_type` varchar(20) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `flash_deals`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (14):** `id` bigint(20) UNSIGNED NOT NULL; `title` varchar(150) DEFAULT NULL; `start_date` date DEFAULT NULL; `end_date` date DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 0; `featured` tinyint(1) NOT NULL DEFAULT 0; `background_color` varchar(255) DEFAULT NULL; `text_color` varchar(255) DEFAULT NULL; `banner` varchar(100) DEFAULT NULL; `slug` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `product_id` int(11) DEFAULT NULL; `deal_type` varchar(191) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `goods_received_notes`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `grn_number` varchar(255) NOT NULL; `po_id` bigint(20) UNSIGNED NOT NULL; `received_qty` int(11) NOT NULL; `rental_period` varchar(255) DEFAULT NULL; `product_warranty` varchar(255) DEFAULT NULL; `product_id` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_goods_received_notes + grn_*

### `goods_received_notes_parts`

- **Est. rows:** 4
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `grn_number` varchar(255) NOT NULL; `po_id` bigint(20) UNSIGNED NOT NULL; `received_qty` int(11) NOT NULL; `rental_period` varchar(255) DEFAULT NULL; `product_warranty` varchar(255) DEFAULT NULL; `product_id` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_goods_received_notes (parts lines)

### `help_topics`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `question` text DEFAULT NULL; `answer` text DEFAULT NULL; `ranking` int(11) NOT NULL DEFAULT 1; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `insert_allocation_log_old_new`

- **Est. rows:** 1
- **Soft delete:** Yes (`deleted_at`)
- **Columns (14):** `id` int(11) NOT NULL; `user_id` int(11) NOT NULL; `old_serial_number` varchar(255) NOT NULL; `new_serial_number` varchar(255) NOT NULL; `new_unique_number` varchar(255) DEFAULT NULL; `old_unique_number` varchar(255) DEFAULT NULL; `refferenceData` longtext DEFAULT NULL; `replace_type` enum('replace_type'; `refferenceDataCurrent` longtext DEFAULT NULL; `reference_id` int(11) NOT NULL; `userType` enum('admin'; `created_at` datetime NOT NULL DEFAULT current_timestamp(); `updated_at` datetime NOT NULL DEFAULT current_timestamp(); `deleted_at` datetime NOT NULL
- **CRM mapping:** Skip → TBD

### `inventory`

- **Est. rows:** 11
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) UNSIGNED NOT NULL; `serial_id` bigint(20) UNSIGNED DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_product_serial` varchar(255) DEFAULT NULL; `product_model_name` varchar(191) NOT NULL; `status` enum('in_stock'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → inventory

### `invoices`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` int(11) NOT NULL; `dc_number` varchar(255) DEFAULT NULL; `dc_id` varchar(50) NOT NULL; `sales_order_id` varchar(50) NOT NULL; `invoice_path` varchar(255) NOT NULL; `invoice_number` varchar(100) NOT NULL; `created_at` datetime DEFAULT current_timestamp(); `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → customer_invoices + einvoice_records

### `inward_outward`

- **Est. rows:** 73
- **Soft delete:** No
- **Columns (19):** `id` bigint(20) UNSIGNED NOT NULL; `serial_id` bigint(20) UNSIGNED DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_number` varchar(191) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `vendor_id` bigint(20) UNSIGNED DEFAULT NULL; `type` varchar(191) DEFAULT NULL; `product_type` varchar(191) DEFAULT NULL; `found_in` varchar(191) DEFAULT NULL; `purpose` varchar(255) DEFAULT NULL; `remarks` varchar(255) DEFAULT NULL; `ticket_number` varchar(255) DEFAULT NULL; `ticket_sla_time` varchar(255) DEFAULT NULL; `technician_id` bigint(191) DEFAULT NULL; `courier_name` varchar(255) DEFAULT NULL; `awb_number` varchar(255) DEFAULT NULL; `spare_parts_serial_number` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Direct → inward_outward

### `issue_types`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` int(11) NOT NULL; `name` varchar(255) NOT NULL; `status` tinyint(4) DEFAULT 1; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `type` varchar(50) DEFAULT NULL
- **CRM mapping:** Transform → support_issue_categories

### `items`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `title` varchar(255) NOT NULL; `description` text NOT NULL; `image` varchar(255) NOT NULL; `status` int(11) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `jobs`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `queue` varchar(191) NOT NULL; `payload` longtext NOT NULL; `attempts` tinyint(3) UNSIGNED NOT NULL; `reserved_at` int(10) UNSIGNED DEFAULT NULL; `available_at` int(10) UNSIGNED NOT NULL; `created_at` int(10) UNSIGNED NOT NULL
- **CRM mapping:** Skip → TBD

### `last_unique_number`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` int(11) NOT NULL; `last_unique_number` varchar(255) NOT NULL; `type` int(11) NOT NULL DEFAULT 1; `last_invoice_number` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** MonotonicBump → sm_document_sequences

### `loyalty_point_transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (10):** `id` bigint(20) UNSIGNED NOT NULL; `user_id` bigint(20) UNSIGNED DEFAULT NULL; `transaction_id` char(36) NOT NULL; `credit` decimal(24; `debit` decimal(24; `balance` decimal(24; `reference` varchar(191) DEFAULT NULL; `transaction_type` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `migrations`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (3):** `id` int(10) UNSIGNED NOT NULL; `migration` varchar(191) NOT NULL; `batch` int(11) NOT NULL
- **CRM mapping:** Skip → schema_migrations

### `new_modules`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (9):** `id` int(11) NOT NULL; `type` varchar(50) NOT NULL; `module_name` varchar(255) NOT NULL; `submodule_name` varchar(255) DEFAULT NULL; `parent_id` int(11) DEFAULT 0; `module` varchar(255) DEFAULT NULL; `sub_module` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Skip → TBD

### `new_user_permissions`

- **Est. rows:** 2
- **Soft delete:** No
- **Columns (11):** `id` int(11) NOT NULL; `role_type` varchar(50) NOT NULL; `user_id` int(11) NOT NULL; `module_id` int(11) NOT NULL; `show_sidebar` tinyint(1) DEFAULT 0; `can_add` tinyint(1) DEFAULT 0; `can_view` tinyint(1) DEFAULT 0; `can_edit` tinyint(1) DEFAULT 0; `can_delete` tinyint(1) DEFAULT 0; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Skip → TBD

### `notifications`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `title` varchar(100) DEFAULT NULL; `description` varchar(191) DEFAULT NULL; `notification_count` int(11) NOT NULL DEFAULT 0; `image` varchar(50) DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → email_queue

### `npa_assets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (14):** `id` bigint(20) UNSIGNED NOT NULL; `dc_id` bigint(20) UNSIGNED DEFAULT NULL; `dc_number` varchar(191) DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_number` varchar(191) DEFAULT NULL; `implode_serial` text DEFAULT NULL; `date` date DEFAULT current_timestamp(); `remark` text DEFAULT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `type` varchar(191) DEFAULT NULL; `created_by_type` varchar(255) DEFAULT NULL; `created_by_id` int(10) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → inventory (disposition=npa)

### `oauth_access_tokens`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (9):** `id` varchar(100) NOT NULL; `user_id` bigint(20) DEFAULT NULL; `client_id` int(10) UNSIGNED NOT NULL; `name` varchar(191) DEFAULT NULL; `scopes` text DEFAULT NULL; `revoked` tinyint(1) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `expires_at` datetime DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `oauth_auth_codes`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` varchar(100) NOT NULL; `user_id` bigint(20) NOT NULL; `client_id` int(10) UNSIGNED NOT NULL; `scopes` text DEFAULT NULL; `revoked` tinyint(1) NOT NULL; `expires_at` datetime DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `oauth_clients`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (11):** `id` int(10) UNSIGNED NOT NULL; `user_id` bigint(20) DEFAULT NULL; `name` varchar(191) NOT NULL; `secret` varchar(100) NOT NULL; `redirect` text NOT NULL; `personal_access_client` tinyint(1) NOT NULL; `password_client` tinyint(1) NOT NULL; `revoked` tinyint(1) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `provider` varchar(191) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `oauth_personal_access_clients`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` int(10) UNSIGNED NOT NULL; `client_id` int(10) UNSIGNED NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `oauth_refresh_tokens`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` varchar(100) NOT NULL; `access_token_id` varchar(100) NOT NULL; `revoked` tinyint(1) NOT NULL; `expires_at` datetime DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `old_product_details`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (4):** `id` int(11) NOT NULL; `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)); `created_at` timestamp NOT NULL DEFAULT current_timestamp(); `updated_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Archive → TBD

### `order_details`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (21):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `seller_id` bigint(20) DEFAULT NULL; `digital_file_after_sell` varchar(191) DEFAULT NULL; `product_details` text DEFAULT NULL; `qty` int(11) NOT NULL DEFAULT 0; `price` double NOT NULL DEFAULT 0; `tax` double NOT NULL DEFAULT 0; `discount` double NOT NULL DEFAULT 0; `tax_model` varchar(20) NOT NULL DEFAULT 'exclude'; `delivery_status` varchar(15) NOT NULL DEFAULT 'pending'; `payment_status` varchar(15) NOT NULL DEFAULT 'unpaid'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `shipping_method_id` bigint(20) DEFAULT NULL; `variant` varchar(255) DEFAULT NULL; `variation` varchar(255) DEFAULT NULL; `discount_type` varchar(30) DEFAULT NULL; `is_stock_decreased` tinyint(1) NOT NULL DEFAULT 1; `refund_request` int(11) NOT NULL DEFAULT 0
- **CRM mapping:** Transform → order_items

### `order_expected_delivery_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) NOT NULL; `user_id` bigint(20) NOT NULL; `user_type` varchar(191) NOT NULL; `expected_delivery_date` date NOT NULL; `cause` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → activities

### `order_status_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) NOT NULL; `user_id` bigint(20) NOT NULL; `user_type` varchar(191) NOT NULL; `status` varchar(191) NOT NULL; `cause` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → activities

### `order_transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (17):** `seller_id` bigint(20) NOT NULL; `order_id` bigint(20) NOT NULL; `order_amount` decimal(50; `seller_amount` decimal(50; `admin_commission` decimal(50; `received_by` varchar(191) NOT NULL; `status` varchar(191) DEFAULT NULL; `delivery_charge` decimal(50; `tax` decimal(50; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `customer_id` bigint(20) DEFAULT NULL; `seller_is` varchar(191) DEFAULT NULL; `delivered_by` varchar(191) NOT NULL DEFAULT 'admin'; `payment_method` varchar(191) DEFAULT NULL; `transaction_id` varchar(191) DEFAULT NULL; `id` bigint(20) UNSIGNED NOT NULL
- **CRM mapping:** Partial → sales_order_payments

### `orders`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (43):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` varchar(15) DEFAULT NULL; `customer_type` varchar(10) DEFAULT NULL; `payment_status` varchar(15) NOT NULL DEFAULT 'unpaid'; `order_status` varchar(50) NOT NULL DEFAULT 'pending'; `payment_method` varchar(100) DEFAULT NULL; `transaction_ref` varchar(30) DEFAULT NULL; `payment_by` varchar(191) DEFAULT NULL; `payment_note` text DEFAULT NULL; `order_amount` double NOT NULL DEFAULT 0; `admin_commission` decimal(8; `is_pause` varchar(20) NOT NULL DEFAULT '0'; `cause` varchar(191) DEFAULT NULL; `shipping_address` text DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `discount_amount` double NOT NULL DEFAULT 0; `discount_type` varchar(30) DEFAULT NULL; `coupon_code` varchar(191) DEFAULT NULL; `coupon_discount_bearer` varchar(191) NOT NULL DEFAULT 'inhouse'; `shipping_method_id` bigint(20) NOT NULL DEFAULT 0; `shipping_cost` double(8; `order_group_id` varchar(191) NOT NULL DEFAULT 'def-order-group'; `verification_code` varchar(191) NOT NULL DEFAULT '0'; `seller_id` bigint(20) DEFAULT NULL; `seller_is` varchar(191) DEFAULT NULL; `shipping_address_data` text DEFAULT NULL; `delivery_man_id` bigint(20) DEFAULT NULL; `deliveryman_charge` double NOT NULL DEFAULT 0; `expected_delivery_date` date DEFAULT NULL
- **CRM mapping:** Partial → orders + order_items

### `password_resets`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (4):** `identity` varchar(191) NOT NULL; `token` varchar(191) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `user_type` varchar(191) NOT NULL DEFAULT 'customer'
- **CRM mapping:** Skip → TBD

### `paytabs_invoices`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (13):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) UNSIGNED NOT NULL; `result` text NOT NULL; `response_code` int(10) UNSIGNED NOT NULL; `pt_invoice_id` int(10) UNSIGNED DEFAULT NULL; `amount` double(8; `currency` varchar(191) DEFAULT NULL; `transaction_id` int(10) UNSIGNED DEFAULT NULL; `card_brand` varchar(191) DEFAULT NULL; `card_first_six_digits` int(10) UNSIGNED DEFAULT NULL; `card_last_four_digits` int(10) UNSIGNED DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → customer_invoices

### `personal_access_tokens`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `tokenable_type` varchar(191) NOT NULL; `tokenable_id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) NOT NULL; `token` varchar(64) NOT NULL; `abilities` text DEFAULT NULL; `last_used_at` timestamp NULL DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `phone_or_email_verifications`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `phone_or_email` varchar(191) DEFAULT NULL; `token` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `pod_submissions`

- **Est. rows:** 15
- **Soft delete:** No
- **Columns (23):** `id` bigint(20) UNSIGNED NOT NULL; `pod_date_time` timestamp NULL DEFAULT NULL; `confirmationDateTime` date DEFAULT NULL; `name` varchar(255) NOT NULL; `customer_name` varchar(255) NOT NULL; `email` varchar(255) NOT NULL; `mobile` varchar(50) NOT NULL; `otp` varchar(50) NOT NULL; `latitude` decimal(10; `longitude` decimal(11; `pod_remark` text DEFAULT NULL; `person_id` bigint(20) NOT NULL; `pickup_id` int(11) NOT NULL; `person_type` varchar(255) NOT NULL; `damage_remarks` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`damage_remarks`)); `files` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`files`)); `auth_id` bigint(20) UNSIGNED NOT NULL; `assigned_by` enum('technician'; `type` varchar(255) DEFAULT NULL; `spare_parts` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `pod_closed_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → delivery_challan_lines (pod fields)

### `product_details`

- **Est. rows:** 24
- **Soft delete:** No
- **Columns (25):** `id` bigint(20) UNSIGNED NOT NULL; `category` varchar(191) DEFAULT NULL; `brand` varchar(191) DEFAULT '1'; `model` varchar(191) DEFAULT NULL; `imei_number` varchar(255) DEFAULT NULL; `processor` varchar(191) DEFAULT NULL; `generation` varchar(191) DEFAULT NULL; `ram` varchar(191) DEFAULT NULL; `storage` varchar(191) DEFAULT NULL; `gpu` varchar(191) DEFAULT NULL; `screen_size` varchar(191) DEFAULT NULL; `quantity` int(11) NOT NULL; `rate` double NOT NULL DEFAULT 0; `total_amount` double NOT NULL DEFAULT 0; `vendor_locking_period` varchar(255) DEFAULT NULL; `parts` varchar(255) DEFAULT NULL; `warranty` varchar(255) DEFAULT NULL; `status` varchar(11) DEFAULT '1'; `random_id` varchar(25) DEFAULT NULL; `old_product_id` int(11) DEFAULT NULL; `old_product_details` bigint(55) DEFAULT NULL; `serial_numbers` text DEFAULT NULL; `remarks` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_product_details + inventory

### `product_stocks`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) DEFAULT NULL; `variant` varchar(255) DEFAULT NULL; `sku` varchar(255) DEFAULT NULL; `price` decimal(8; `qty` int(11) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → vendor_product_inventory

### `product_tag`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) UNSIGNED NOT NULL; `tag_id` bigint(20) UNSIGNED NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `products`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (52):** `id` bigint(20) UNSIGNED NOT NULL; `added_by` varchar(191) DEFAULT NULL; `user_id` bigint(20) DEFAULT NULL; `name` varchar(80) DEFAULT NULL; `slug` varchar(120) DEFAULT NULL; `product_type` varchar(20) NOT NULL DEFAULT 'physical'; `category_ids` varchar(80) DEFAULT NULL; `brand_id` bigint(20) DEFAULT NULL; `unit` varchar(191) DEFAULT NULL; `min_qty` int(11) NOT NULL DEFAULT 1; `refundable` tinyint(1) NOT NULL DEFAULT 1; `digital_product_type` varchar(30) DEFAULT NULL; `digital_file_ready` varchar(191) DEFAULT NULL; `images` longtext DEFAULT NULL; `color_image` text NOT NULL; `thumbnail` varchar(255) DEFAULT NULL; `featured` varchar(255) DEFAULT NULL; `flash_deal` varchar(255) DEFAULT NULL; `video_provider` varchar(30) DEFAULT NULL; `video_url` varchar(150) DEFAULT NULL; `colors` varchar(150) DEFAULT NULL; `variant_product` tinyint(1) NOT NULL DEFAULT 0; `attributes` varchar(255) DEFAULT NULL; `choice_options` text DEFAULT NULL; `variation` text DEFAULT NULL; `published` tinyint(1) NOT NULL DEFAULT 0; `unit_price` double NOT NULL DEFAULT 0; `purchase_price` double NOT NULL DEFAULT 0; `tax` varchar(191) NOT NULL DEFAULT '0.00'; `tax_type` varchar(80) DEFAULT NULL
- **CRM mapping:** Partial → vendor_product_inventory

### `purchase_orders`

- **Est. rows:** 3
- **Soft delete:** Yes (`deleted_at`)
- **Columns (24):** `id` int(11) NOT NULL; `purchase_order_number` varchar(255) NOT NULL; `purchase_order_date` date NOT NULL; `purchase_order_type` varchar(191) NOT NULL; `vendor_id` bigint(20) UNSIGNED NOT NULL; `state` varchar(255) DEFAULT NULL; `product_details_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`product_details_id`)); `locking_period` varchar(191) DEFAULT NULL; `assets_details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`assets_details`)); `remarks` text DEFAULT NULL; `sub_total_amount` decimal(10; `total_amount` decimal(10; `isSameState` tinyint(1) DEFAULT 0; `status` enum('pending'; `invoice_created` enum('pending'; `invoice_path` varchar(255) DEFAULT NULL; `token` varchar(255) DEFAULT NULL; `status_updated_by_id` int(11) DEFAULT NULL; `status_updated_by_name` varchar(255) DEFAULT NULL; `bill_name` varchar(255) DEFAULT NULL; `bill_files` longtext DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `deleted_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_purchase_orders

### `qc`

- **Est. rows:** unknown
- **Soft delete:** Yes (`deleted_at`)
- **Columns (13):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) NOT NULL; `email` varchar(191) NOT NULL; `phone` varchar(191) DEFAULT NULL; `image` varchar(191) DEFAULT NULL; `password` varchar(191) NOT NULL; `address` varchar(255) DEFAULT NULL; `remember_token` varchar(255) DEFAULT NULL; `remember_pass` varchar(191) DEFAULT NULL; `status` enum('1'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp(); `deleted_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → qc_results + qc_photos

### `qc_logs`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) UNSIGNED NOT NULL; `inventory_id` bigint(20) UNSIGNED NOT NULL; `status` enum('passed'; `remarks` text DEFAULT NULL; `checked_at` timestamp NULL DEFAULT current_timestamp()
- **CRM mapping:** Partial → qc_results / repair_logs

### `qc_truetech_delivery_challans`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (20):** `id` bigint(20) UNSIGNED NOT NULL; `challan_number` varchar(191) NOT NULL; `challan_date` date NOT NULL; `vendor_name` varchar(191) NOT NULL; `vendor_address` text DEFAULT NULL; `vendor_phone` varchar(191) DEFAULT NULL; `vendor_gstin` varchar(191) DEFAULT NULL; `place_of_supply` varchar(191) DEFAULT NULL; `po_number` varchar(191) DEFAULT NULL; `source_serial_number` varchar(191) DEFAULT NULL; `source_unique_serial` varchar(191) DEFAULT NULL; `transport` varchar(191) DEFAULT NULL; `lr_number` varchar(191) DEFAULT NULL; `purpose` varchar(191) DEFAULT NULL; `items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`items`)); `terms` text DEFAULT NULL; `created_by` bigint(20) UNSIGNED DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `vendor_email` varchar(191) DEFAULT NULL
- **CRM mapping:** Transform → dc_qc_tickets

### `quotations`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (39):** `id` bigint(20) UNSIGNED NOT NULL; `quotation_number` varchar(191) NOT NULL; `supply_state` varchar(255) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED NOT NULL; `customer_name` varchar(191) NOT NULL; `customer_email` varchar(191) NOT NULL; `customer_mobile` varchar(191) NOT NULL; `customer_shipping_address` text NOT NULL; `customer_billing_address` text NOT NULL; `contact_person_name` varchar(191) DEFAULT NULL; `contact_person_mobile` varchar(191) DEFAULT NULL; `gst_number` varchar(191) DEFAULT NULL; `security_amount` varchar(25) DEFAULT NULL; `old_security_amount` varchar(255) DEFAULT NULL; `refund_amount` varchar(255) DEFAULT NULL; `shiping_charges` varchar(25) DEFAULT NULL; `brand` varchar(255) DEFAULT NULL; `model_name` varchar(191) DEFAULT NULL; `processor` varchar(191) DEFAULT NULL; `generation` varchar(191) DEFAULT NULL; `ram` varchar(191) DEFAULT NULL; `storage` varchar(191) DEFAULT NULL; `gpu` varchar(191) DEFAULT NULL; `screen_size` varchar(191) DEFAULT NULL; `quantity` int(11) NOT NULL; `main_quantity` int(11) DEFAULT 0; `rate` decimal(10; `quotation_type` enum('rental'; `locking_period` int(11) DEFAULT NULL; `technical_warranty` int(255) DEFAULT NULL
- **CRM mapping:** Transform → sales_quotations

### `refund_requests`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (15):** `id` bigint(20) UNSIGNED NOT NULL; `order_details_id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) UNSIGNED NOT NULL; `status` varchar(191) NOT NULL; `amount` double(8; `product_id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) UNSIGNED NOT NULL; `refund_reason` longtext NOT NULL; `images` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `approved_note` longtext DEFAULT NULL; `rejected_note` longtext DEFAULT NULL; `payment_info` longtext DEFAULT NULL; `change_by` varchar(191) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `refund_statuses`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `refund_request_id` bigint(20) UNSIGNED DEFAULT NULL; `change_by` varchar(191) DEFAULT NULL; `change_by_id` bigint(20) UNSIGNED DEFAULT NULL; `status` varchar(191) DEFAULT NULL; `message` longtext DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `refund_transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (15):** `id` bigint(20) UNSIGNED NOT NULL; `order_id` bigint(20) UNSIGNED DEFAULT NULL; `payment_for` varchar(191) DEFAULT NULL; `payer_id` bigint(20) UNSIGNED DEFAULT NULL; `payment_receiver_id` bigint(20) UNSIGNED DEFAULT NULL; `paid_by` varchar(191) DEFAULT NULL; `paid_to` varchar(191) DEFAULT NULL; `payment_method` varchar(191) DEFAULT NULL; `payment_status` varchar(191) DEFAULT NULL; `amount` double(8; `transaction_type` varchar(191) DEFAULT NULL; `order_details_id` bigint(20) UNSIGNED DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `refund_id` bigint(20) UNSIGNED DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `rent_devices`

- **Est. rows:** 5
- **Soft delete:** No
- **Columns (20):** `id` bigint(20) UNSIGNED NOT NULL; `serial_id` varchar(191) DEFAULT NULL; `po_id` varchar(255) DEFAULT NULL; `serial_number` varchar(191) DEFAULT NULL; `unique_number` varchar(191) DEFAULT NULL; `product_id` varchar(191) DEFAULT NULL; `rent_start_date` date DEFAULT NULL; `rent_end_date` date DEFAULT NULL; `rent_amount` double DEFAULT NULL; `month_rent` double DEFAULT NULL; `rent_with_gst` varchar(191) DEFAULT NULL; `total_amount` varchar(255) DEFAULT NULL; `vendor_id` bigint(20) UNSIGNED DEFAULT NULL; `type` varchar(191) DEFAULT NULL; `status` varchar(191) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED DEFAULT NULL; `rent_stop_date` date DEFAULT NULL; `rent_start_date_again` date DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → rent_devices

### `rent_reports`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (16):** `id` int(11) NOT NULL; `vendor_id` int(11) NOT NULL; `month` varchar(20) NOT NULL; `type` varchar(255) DEFAULT NULL; `excel_path` varchar(255) NOT NULL; `subtotal` varchar(255) DEFAULT '0'; `gst_amount` varchar(255) DEFAULT '0'; `total_amount` varchar(255) DEFAULT '0'; `amount` varchar(255) DEFAULT '0'; `pdf_path` varchar(255) NOT NULL; `approved_by_id` int(11) DEFAULT NULL; `billing_person_id` int(11) DEFAULT NULL; `status` enum('send_to_rentfoxxy'; `approved_by_type` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Gap → TBD

### `rent_reports_customer`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (22):** `id` int(11) NOT NULL; `customer_id` int(11) NOT NULL; `month` varchar(20) NOT NULL; `type` varchar(255) DEFAULT NULL; `amount` decimal(8; `gst_amount` varchar(255) DEFAULT '0'; `subtotal` varchar(255) DEFAULT '0'; `total_amount` varchar(255) NOT NULL DEFAULT '0'; `excel_path` varchar(255) NOT NULL; `credit_excel_path` longtext DEFAULT NULL; `pdf_path` varchar(255) NOT NULL; `credit_note_pdf_path` longtext DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `status` enum('pending'; `paid_on` varchar(255) DEFAULT NULL; `admin_status` enum('waiting'; `approved_by_id` int(20) DEFAULT NULL; `approved_by_type` varchar(255) DEFAULT NULL; `billing_person_id` int(15) DEFAULT NULL; `is_checked` enum('yes'; `token` varchar(255) DEFAULT NULL
- **CRM mapping:** Gap → TBD

### `repair_logs`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (12):** `id` int(11) NOT NULL; `serial_number_id` int(11) NOT NULL; `serial_number` varchar(200) NOT NULL; `unique_number` varchar(200) NOT NULL; `repair_start_date` date DEFAULT NULL; `repair_end_date` date DEFAULT NULL; `type` varchar(50) NOT NULL; `remarks` text DEFAULT NULL; `new_serial_number` varchar(255) DEFAULT NULL; `new_unique_number` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Transform → repair_logs + chip_level_repairs

### `review_sets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `review` text NOT NULL; `review_count` int(11) DEFAULT 0; `status` tinyint(1) DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `reviews`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (12):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) NOT NULL; `customer_id` bigint(20) NOT NULL; `delivery_man_id` bigint(20) DEFAULT NULL; `order_id` bigint(20) DEFAULT NULL; `comment` mediumtext DEFAULT NULL; `attachment` varchar(191) DEFAULT NULL; `rating` int(11) NOT NULL DEFAULT 0; `status` int(11) NOT NULL DEFAULT 1; `is_saved` tinyint(1) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `role_permissions`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (8):** `id` int(11) NOT NULL; `role_id` int(11) NOT NULL; `sub_module_id` int(11) NOT NULL; `status` enum('0'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `actions` varchar(255) DEFAULT NULL; `show_in_sidebar` tinyint(1) NOT NULL DEFAULT 1
- **CRM mapping:** Skip → TBD

### `roles`

- **Est. rows:** 1
- **Soft delete:** Yes (`deleted_at`)
- **Columns (6):** `id` int(11) NOT NULL; `name` varchar(255) NOT NULL; `status` int(10) NOT NULL DEFAULT 1; `created_at` timestamp NOT NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp(); `deleted_at` timestamp NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Skip → TBD

### `roles_modules`

- **Est. rows:** 1
- **Soft delete:** Yes (`deleted_at`)
- **Columns (9):** `id` int(11) NOT NULL; `role_id` int(11) DEFAULT NULL; `name` varchar(255) NOT NULL; `parent_id` int(11) NOT NULL DEFAULT 0; `status` enum('1'; `created_at` timestamp NOT NULL DEFAULT current_timestamp(); `updated_at` timestamp NOT NULL DEFAULT current_timestamp(); `deleted_at` timestamp NOT NULL DEFAULT current_timestamp(); `icon` varchar(255) DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `sales_orders`

- **Est. rows:** 100
- **Soft delete:** No
- **Columns (41):** `id` bigint(20) UNSIGNED NOT NULL; `sales_order_number` varchar(255) NOT NULL; `quotation_number` varchar(191) NOT NULL; `supply_state` varchar(255) DEFAULT NULL; `customer_id` bigint(20) UNSIGNED NOT NULL; `customer_name` varchar(191) NOT NULL; `customer_email` varchar(191) NOT NULL; `customer_mobile` varchar(191) NOT NULL; `customer_shipping_address` text NOT NULL; `customer_billing_address` text NOT NULL; `contact_person_name` varchar(191) DEFAULT NULL; `contact_person_mobile` varchar(191) DEFAULT NULL; `gst_number` varchar(191) DEFAULT NULL; `brand` varchar(255) DEFAULT NULL; `model_name` varchar(191) DEFAULT NULL; `processor` varchar(191) DEFAULT NULL; `generation` varchar(191) DEFAULT NULL; `ram` varchar(191) DEFAULT NULL; `storage` varchar(191) DEFAULT NULL; `gpu` varchar(191) DEFAULT NULL; `screen_size` varchar(191) DEFAULT NULL; `quantity` int(11) NOT NULL; `main_qty` int(255) DEFAULT NULL; `rate` decimal(10; `quotation_type` enum('rental'; `locking_period` int(11) DEFAULT NULL; `battery_charger_warranty` int(255) DEFAULT NULL; `technical_warranty` int(255) DEFAULT NULL; `main_product_warranty` varchar(255) DEFAULT NULL; `sub_product_warranty` varchar(255) DEFAULT NULL
- **CRM mapping:** Transform → sales_order_lines + sales_order_serials + sales_order_payments + orders

### `search_functions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `key` varchar(150) DEFAULT NULL; `url` varchar(250) DEFAULT NULL; `visible_for` varchar(191) NOT NULL DEFAULT 'admin'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `seller_wallet_histories`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) DEFAULT NULL; `amount` double NOT NULL DEFAULT 0; `order_id` bigint(20) DEFAULT NULL; `product_id` bigint(20) DEFAULT NULL; `payment` varchar(191) NOT NULL DEFAULT 'received'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Gap → TBD

### `seller_wallets`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (11):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) DEFAULT NULL; `total_earning` double NOT NULL DEFAULT 0; `withdrawn` double NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `commission_given` double(8; `pending_withdraw` double(8; `delivery_charge_earned` double(8; `collected_cash` double(8; `total_tax_collected` double(8
- **CRM mapping:** Partial → vendor_wallets

### `sellers`

- **Est. rows:** 2
- **Soft delete:** No
- **Columns (33):** `id` bigint(20) UNSIGNED NOT NULL; `f_name` varchar(255) DEFAULT NULL; `l_name` varchar(255) DEFAULT NULL; `phone` varchar(25) DEFAULT NULL; `image` varchar(30) NOT NULL DEFAULT 'def.png'; `email` varchar(80) NOT NULL; `password` varchar(80) DEFAULT NULL; `status` varchar(15) NOT NULL DEFAULT 'approved'; `business_name` varchar(255) DEFAULT NULL; `address` varchar(255) DEFAULT NULL; `state` varchar(255) DEFAULT NULL; `business_type` varchar(255) DEFAULT NULL; `brand_code` varchar(255) DEFAULT NULL; `business_registration_number` varchar(255) DEFAULT NULL; `licenses_and_permits` varchar(255) DEFAULT NULL; `tax_identification_number` varchar(255) DEFAULT NULL; `account_type` varchar(255) DEFAULT NULL; `remember_pass` varchar(255) DEFAULT NULL; `remember_token` varchar(100) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `bank_name` varchar(191) DEFAULT NULL; `account_holder_name` varchar(255) DEFAULT NULL; `bank_ifsc_code` varchar(255) DEFAULT NULL; `branch` varchar(191) DEFAULT NULL; `account_no` varchar(191) DEFAULT NULL; `holder_name` varchar(191) DEFAULT NULL; `auth_token` text DEFAULT NULL; `sales_commission_percentage` double(8; `gst` varchar(191) DEFAULT NULL
- **CRM mapping:** Transform → vendors + vendor_shops

### `serial_numberOnly`

- **Est. rows:** 8
- **Soft delete:** Yes (`deleted_at`)
- **Columns (7):** `id` int(11) NOT NULL; `serial_number` varchar(255) NOT NULL; `unique_product_serial` varchar(255) DEFAULT NULL; `status` int(11) NOT NULL DEFAULT 1; `updated_at` datetime NOT NULL DEFAULT current_timestamp(); `created_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(); `deleted_at` datetime DEFAULT NULL
- **CRM mapping:** Partial → vendor_serial_numbers

### `serial_number_parts`

- **Est. rows:** 7
- **Soft delete:** No
- **Columns (17):** `id` bigint(20) UNSIGNED NOT NULL; `part_id` int(11) NOT NULL DEFAULT 0; `serial_number` varchar(255) NOT NULL; `main_serial_number` varchar(255) DEFAULT NULL; `main_unique_number` varchar(255) DEFAULT NULL; `unique_product_serial` varchar(255) NOT NULL; `goods_receipts_id` int(11) DEFAULT NULL; `po_id` bigint(20) UNSIGNED NOT NULL; `rental_period` varchar(255) DEFAULT NULL; `product_warranty` varchar(255) DEFAULT NULL; `status` enum('pending'; `status2` varchar(255) DEFAULT NULL; `remark` varchar(255) DEFAULT NULL; `require_parts_remark` varchar(255) DEFAULT NULL; `file_path` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → part_instances + vendor_serial_numbers

### `serial_number_update_logs`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `old_serial_number` varchar(255) DEFAULT NULL; `old_unique_number` varchar(255) DEFAULT NULL; `new_serial_number` varchar(255) DEFAULT NULL; `new_unique_number` varchar(255) DEFAULT NULL; `updated_by_type` varchar(50) DEFAULT NULL; `updated_by_id` bigint(20) UNSIGNED DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_serial_number_audit

### `serial_numbers`

- **Est. rows:** 19
- **Soft delete:** No
- **Columns (28):** `id` bigint(20) UNSIGNED NOT NULL; `serial_number` varchar(255) NOT NULL; `unique_product_serial` varchar(255) NOT NULL; `product_id` int(11) DEFAULT 86; `goods_receipts_id` int(11) DEFAULT NULL; `po_id` bigint(20) UNSIGNED NOT NULL; `rental_period` varchar(255) DEFAULT NULL; `product_warranty` varchar(255) DEFAULT NULL; `dataoldSerialNumber` longtext DEFAULT NULL; `status` enum('pending'; `status2` varchar(255) DEFAULT NULL; `action_status` varchar(255) DEFAULT NULL; `came_from` varchar(255) DEFAULT NULL; `action_remark` varchar(255) DEFAULT NULL; `remark` varchar(255) DEFAULT NULL; `is_replaced` int(10) NOT NULL DEFAULT 0; `is_repaired` int(10) NOT NULL DEFAULT 0; `require_parts` longtext DEFAULT NULL; `require_parts_done` longtext DEFAULT NULL; `file_path` text DEFAULT NULL; `seller_id` int(11) DEFAULT NULL; `vendor_name` varchar(255) DEFAULT NULL; `hardware_action` varchar(255) DEFAULT NULL; `hardware_remark` text DEFAULT NULL; `hardware_action_by` int(11) DEFAULT NULL; `hardware_action_date` datetime DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
- **CRM mapping:** Transform → vendor_serial_numbers

### `sessions`

- **Est. rows:** 2
- **Soft delete:** No
- **Columns (6):** `id` varchar(191) NOT NULL; `user_id` bigint(20) UNSIGNED DEFAULT NULL; `ip_address` varchar(45) DEFAULT NULL; `user_agent` text DEFAULT NULL; `payload` text NOT NULL; `last_activity` int(11) NOT NULL
- **CRM mapping:** Skip → TBD

### `shipping_addresses`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (15):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` varchar(15) DEFAULT NULL; `contact_person_name` varchar(50) DEFAULT NULL; `address_type` varchar(20) NOT NULL DEFAULT 'home'; `address` varchar(255) DEFAULT NULL; `city` varchar(50) DEFAULT NULL; `zip` varchar(10) DEFAULT NULL; `phone` varchar(20) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `state` varchar(191) DEFAULT NULL; `country` varchar(191) DEFAULT NULL; `latitude` varchar(191) DEFAULT NULL; `longitude` varchar(191) DEFAULT NULL; `is_billing` tinyint(1) DEFAULT NULL
- **CRM mapping:** Transform → customer_addresses

### `shipping_methods`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (9):** `id` bigint(20) UNSIGNED NOT NULL; `creator_id` bigint(20) DEFAULT NULL; `creator_type` varchar(191) NOT NULL DEFAULT 'admin'; `title` varchar(100) DEFAULT NULL; `cost` decimal(8; `duration` varchar(20) DEFAULT NULL; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `shipping_types`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) UNSIGNED DEFAULT NULL; `shipping_type` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `shops`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (14):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) NOT NULL; `name` varchar(100) NOT NULL; `address` varchar(255) NOT NULL; `contact` varchar(25) NOT NULL; `image` varchar(30) NOT NULL DEFAULT 'def.png'; `vacation_start_date` date DEFAULT NULL; `vacation_end_date` date DEFAULT NULL; `vacation_note` varchar(255) DEFAULT NULL; `vacation_status` tinyint(4) NOT NULL DEFAULT 0; `temporary_close` tinyint(4) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `banner` varchar(191) NOT NULL
- **CRM mapping:** Partial → vendor_shops

### `social_medias`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(100) NOT NULL; `link` varchar(100) NOT NULL; `icon` varchar(100) DEFAULT NULL; `active_status` int(11) NOT NULL; `status` tinyint(1) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `soft_credentials`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `key` varchar(191) DEFAULT NULL; `value` longtext DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `spare_parts`

- **Est. rows:** 1
- **Soft delete:** No
- **Columns (6):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) NOT NULL; `type` varchar(191) DEFAULT NULL; `status` varchar(255) NOT NULL DEFAULT '1'; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp()
- **CRM mapping:** Transform → spare_parts + vendor_spare_parts_catalog

### `spare_parts_po`

- **Est. rows:** 4
- **Soft delete:** No
- **Columns (15):** `id` bigint(20) UNSIGNED NOT NULL; `purchase_order_number` varchar(191) NOT NULL; `purchase_order_date` varchar(191) NOT NULL; `vendor_id` bigint(20) UNSIGNED NOT NULL; `product_details_id` longtext NOT NULL; `assets_details` longtext NOT NULL; `remarks` varchar(191) DEFAULT NULL; `status` enum('pending'; `token` varchar(255) DEFAULT NULL; `status_updated_by_id` int(191) DEFAULT NULL; `status_updated_by_name` varchar(255) DEFAULT NULL; `bill_name` varchar(255) DEFAULT NULL; `bill_files` longtext DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → vendor_spare_parts_purchase_orders

### `split_rent_billing`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (10):** `serial_id` int(11) NOT NULL; `serial_number` varchar(100) NOT NULL; `unique_number` varchar(100) NOT NULL; `rent_start` date NOT NULL; `rent_end` date NOT NULL; `rent_days` int(11) NOT NULL; `rent_amt` decimal(10; `gst_18` decimal(10; `total_amt` decimal(10; `created_at` timestamp NULL DEFAULT current_timestamp()
- **CRM mapping:** Transform → customer_invoices (billing engine)

### `stock_products`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `product_id` bigint(20) UNSIGNED NOT NULL; `model_name` varchar(255) DEFAULT NULL; `serial_number` varchar(50) NOT NULL; `unique_code` varchar(50) NOT NULL; `quantity` int(11) DEFAULT 1; `stock_status` enum('in_stock'; `added_date` timestamp NULL DEFAULT current_timestamp()
- **CRM mapping:** Skip → TBD

### `sub_modules`

- **Est. rows:** unknown
- **Soft delete:** Yes (`deleted_at`)
- **Columns (7):** `id` int(11) NOT NULL; `module_id` int(11) NOT NULL; `name` varchar(255) DEFAULT NULL; `created_at` datetime NOT NULL DEFAULT current_timestamp(); `updated_at` datetime NOT NULL DEFAULT current_timestamp(); `deleted_at` datetime DEFAULT NULL; `slug` varchar(255) DEFAULT NULL
- **CRM mapping:** Partial → permission_sections

### `subscriptions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` bigint(20) UNSIGNED NOT NULL; `email` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `support_ticket_convs`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (8):** `id` bigint(20) UNSIGNED NOT NULL; `support_ticket_id` bigint(20) DEFAULT NULL; `admin_id` bigint(20) DEFAULT NULL; `customer_message` varchar(191) DEFAULT NULL; `admin_message` varchar(191) DEFAULT NULL; `position` int(11) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → support_ticket_item_comments

### `support_tickets`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (10):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) DEFAULT NULL; `subject` varchar(150) DEFAULT NULL; `type` varchar(50) DEFAULT NULL; `priority` varchar(15) NOT NULL DEFAULT 'low'; `description` varchar(255) DEFAULT NULL; `reply` varchar(255) DEFAULT NULL; `status` varchar(15) NOT NULL DEFAULT 'open'; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Partial → support_tickets

### `tags`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (4):** `id` bigint(20) UNSIGNED NOT NULL; `tag` varchar(191) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `team_members`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (13):** `id` int(25) NOT NULL; `member_name` varchar(255) NOT NULL; `member_email` varchar(255) NOT NULL; `member_mobile` varchar(255) DEFAULT NULL; `member_address` longtext DEFAULT NULL; `aadhar_number` varchar(25) DEFAULT NULL; `refrence_name` varchar(255) DEFAULT NULL; `refrence_number` varchar(25) DEFAULT NULL; `upload_docs` varchar(255) DEFAULT NULL; `profile` varchar(255) DEFAULT NULL; `status` int(25) NOT NULL DEFAULT 1; `created_at` datetime NOT NULL DEFAULT current_timestamp(); `updated_at` datetime NOT NULL DEFAULT current_timestamp()
- **CRM mapping:** Skip → TBD

### `transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (23):** `id` int(10) UNSIGNED NOT NULL; `bill_id` int(25) DEFAULT NULL; `customer_name` varchar(255) DEFAULT NULL; `customer_id` varchar(25) DEFAULT NULL; `month` varchar(255) DEFAULT NULL; `type` varchar(255) DEFAULT NULL; `payment_type` varchar(255) DEFAULT NULL; `bank_transaction_id` varchar(255) DEFAULT NULL; `bank_id` varchar(255) DEFAULT NULL; `phonepe_order_id` varchar(50) DEFAULT NULL; `razorpay_order_id` varchar(255) DEFAULT NULL; `razorpay_payment_id` varchar(100) DEFAULT NULL; `razorpay_signature` bigint(255) DEFAULT NULL; `payment_method` varchar(15) DEFAULT NULL; `merchant_Id` varchar(50) DEFAULT NULL; `reference_Id` varchar(50) DEFAULT NULL; `check_number` varchar(25) DEFAULT NULL; `check_image` varchar(255) DEFAULT NULL; `payment_status` varchar(10) NOT NULL DEFAULT 'success'; `status` varchar(255) DEFAULT NULL; `amount` decimal(8; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `translations`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (6):** `translationable_type` varchar(191) NOT NULL; `translationable_id` bigint(20) UNSIGNED NOT NULL; `locale` varchar(191) NOT NULL; `key` varchar(191) DEFAULT NULL; `value` text DEFAULT NULL; `id` bigint(20) UNSIGNED NOT NULL
- **CRM mapping:** Skip → TBD

### `users`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (30):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(80) DEFAULT NULL; `f_name` varchar(255) DEFAULT NULL; `l_name` varchar(255) DEFAULT NULL; `phone` varchar(25) NOT NULL; `image` varchar(30) NOT NULL DEFAULT 'def.png'; `email` varchar(80) NOT NULL; `email_verified_at` timestamp NULL DEFAULT NULL; `password` varchar(80) NOT NULL; `remember_token` varchar(100) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL; `street_address` varchar(250) DEFAULT NULL; `country` varchar(50) DEFAULT NULL; `city` varchar(50) DEFAULT NULL; `zip` varchar(20) DEFAULT NULL; `house_no` varchar(50) DEFAULT NULL; `apartment_no` varchar(50) DEFAULT NULL; `cm_firebase_token` varchar(191) DEFAULT NULL; `is_active` tinyint(1) NOT NULL DEFAULT 1; `payment_card_last_four` varchar(191) DEFAULT NULL; `payment_card_brand` varchar(191) DEFAULT NULL; `payment_card_fawry_token` text DEFAULT NULL; `login_medium` varchar(191) DEFAULT NULL; `social_id` varchar(191) DEFAULT NULL; `is_phone_verified` tinyint(1) NOT NULL DEFAULT 0; `temporary_token` varchar(191) DEFAULT NULL; `is_email_verified` tinyint(1) NOT NULL DEFAULT 0; `wallet_balance` double(8; `loyalty_point` double(8
- **CRM mapping:** Skip → TBD

### `video`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `video` text NOT NULL; `status` tinyint(1) DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `videos`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `video` text NOT NULL; `status` tinyint(1) DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `wallet_transactions`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (11):** `id` bigint(20) UNSIGNED NOT NULL; `user_id` bigint(20) UNSIGNED DEFAULT NULL; `transaction_id` char(36) NOT NULL; `credit` decimal(24; `debit` decimal(24; `admin_bonus` decimal(24; `balance` decimal(24; `transaction_type` varchar(191) DEFAULT NULL; `reference` varchar(191) DEFAULT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `warehouse`

- **Est. rows:** unknown
- **Soft delete:** Yes (`deleted_at`)
- **Columns (12):** `id` bigint(20) UNSIGNED NOT NULL; `name` varchar(191) NOT NULL; `email` varchar(191) NOT NULL; `phone` varchar(191) DEFAULT NULL; `image` varchar(191) DEFAULT NULL; `password` varchar(191) NOT NULL; `remember_pass` varchar(191) DEFAULT NULL; `status` enum('1'; `address` varchar(255) DEFAULT NULL; `created_at` timestamp NULL DEFAULT current_timestamp(); `updated_at` timestamp NULL DEFAULT current_timestamp(); `deleted_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Transform → teams (warehouse team)

### `wishlists`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (5):** `id` bigint(20) UNSIGNED NOT NULL; `customer_id` bigint(20) NOT NULL; `product_id` bigint(20) NOT NULL; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `withdraw_requests`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (11):** `id` bigint(20) UNSIGNED NOT NULL; `seller_id` bigint(20) DEFAULT NULL; `delivery_man_id` bigint(20) DEFAULT NULL; `admin_id` bigint(20) DEFAULT NULL; `amount` varchar(191) NOT NULL DEFAULT '0.00'; `withdrawal_method_id` bigint(20) UNSIGNED DEFAULT NULL; `withdrawal_method_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL; `transaction_note` text DEFAULT NULL; `approved` tinyint(1) NOT NULL DEFAULT 0; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

### `withdrawal_methods`

- **Est. rows:** unknown
- **Soft delete:** No
- **Columns (7):** `id` bigint(20) UNSIGNED NOT NULL; `method_name` varchar(191) NOT NULL; `method_fields` text NOT NULL; `is_default` tinyint(4) NOT NULL DEFAULT 0; `is_active` tinyint(4) NOT NULL DEFAULT 1; `created_at` timestamp NULL DEFAULT NULL; `updated_at` timestamp NULL DEFAULT NULL
- **CRM mapping:** Skip → TBD

