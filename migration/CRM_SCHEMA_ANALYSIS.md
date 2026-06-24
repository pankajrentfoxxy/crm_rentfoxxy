# CRM Schema Analysis

> Generated: 2026-06-23T17:26:39.533Z
> Source: `crm_backup.sql` (PostgreSQL / Node.js)
> Total tables: **138** (117 public, 21 auth)

## Business Modules (public schema)

### Identity & RBAC

- `public.users`
- `public.roles`
- `public.role_permissions`
- `public.user_permissions`
- `public.permission_sections`
- `public.teams`
- `public.user_teams`

### Lead CRM

- `public.leads`
- `public.lead_activities`
- `public.lead_addresses`
- `public.lead_assignments`
- `public.lead_company_research`
- `public.lead_orders`
- `public.lead_remarks`

### Customers

- `public.customers`
- `public.customer_addresses`
- `public.customer_documents`
- `public.customer_inventory`
- `public.customer_invoices`
- `public.customer_credit_notes`
- `public.customer_security_deposits`
- `public.customer_portal_sessions`

### Sales

- `public.sales_quotations`
- `public.sales_order_lines`
- `public.sales_order_serials`
- `public.sales_order_payments`
- `public.orders`
- `public.order_items`
- `public.sm_document_sequences`
- `public.sm_courier_details`

### Vendors & Procurement

- `public.vendors`
- `public.vendor_shops`
- `public.vendor_purchase_orders`
- `public.vendor_goods_received_notes`
- `public.vendor_serial_numbers`
- `public.vendor_product_details`
- `public.vendor_product_inventory`
- `public.vendor_wallets`
- `public.vendor_billing`
- `public.vendor_monthly_bills`
- `public.vendor_debit_notes`
- `public.vendor_spare_parts_catalog`
- `public.vendor_spare_parts_purchase_orders`

### Inventory & QC

- `public.inventory`
- `public.allocation_logs`
- `public.inward_outward`
- `public.rent_devices`
- `public.laptop_catalog`
- `public.asset_config_brands`
- `public.asset_config_models`
- `public.stages`
- `public.qc_results`
- `public.qc_photos`

### Delivery

- `public.delivery_challan_lines`
- `public.delivery_technicians`
- `public.demo_agreements`
- `public.dc_qc_tickets`
- `public.eway_bill_records`

### Support

- `public.support_tickets`
- `public.support_ticket_items`
- `public.support_ticket_item_comments`
- `public.tickets`
- `public.ticket_parts`
- `public.repair_logs`
- `public.chip_level_repairs`
- `public.diagnosis_results`

### Billing

- `public.customer_invoices`
- `public.einvoice_records`
- `public.companies`

### GRN Portal

- `public.grn_access_numbers`
- `public.grn_serial_capture_tokens`
- `public.grn_config_verifications`

## CRM-Only Tables (no direct ERP table)

- `public.leads`
- `public.lead_activities`
- `public.lead_addresses`
- `public.lead_assignments`
- `public.lead_auto_assign_config`
- `public.lead_company_research`
- `public.lead_followup_notifications`
- `public.lead_import_logs`
- `public.lead_orders`
- `public.lead_remarks`
- `public.asset_config_brands`
- `public.asset_config_models`
- `public.asset_config_processors`
- `public.asset_config_generations`
- `public.asset_config_ram`
- `public.asset_config_storage`
- `public.asset_config_gpu`
- `public.asset_config_screen_sizes`
- `public.stages`
- `public.stage_checklists`
- `public.stage_transition_rules`
- `public.inventory_status_transitions`
- `public.qc_round_robin_state`
- `public.procurement_requests`
- `public.part_requests`
- `public.parts`
- `public.part_instances`
- `public.photos`
- `public.diagnosis_results`
- `public.diagnosis_images`
- `public.diagnosis_parts_required`
- `public.support_part_challans`
- `public.support_part_requests`
- `public.support_challan_items`
- `public.support_replacement_orders`
- `public.ticket_checklist_progress`
- `public.ticket_part_blocks`
- `public.ticket_services`
- `public.grn_access_attempts`
- `public.grn_access_numbers`
- `public.grn_config_verifications`
- `public.grn_serial_capture_tokens`
- `public.eway_bill_records`
- `public.einvoice_records`
- `public.email_queue`
- `public.existing_customer`
- `public.vendor_portal_sessions`
- `public.vendor_refresh_tokens`
- `public.vendor_billing`
- `public.vendor_monthly_bills`
- `public.vendor_replaced_products`
- `public.vendor_inventory_asset_sequence`
- `public.demo_agreements`
- `public.customer_portal_sessions`
- `public.customer_documents`
- `public.companies`
- `public.work_logs`
- `public.activities`
- `public.ttspl_audit_log`
- `public.ttspl_config_history`
- `public.permission_audit_logs`
- `public.schema_migrations`
- `public.laptop_catalog`
- `public.support_settings`
- `public.support_ticket_item_audit`

## Record Counts (from backup COPY blocks)

| Table | Rows in backup |
| --- | --- |
| role_permissions | 576 |
| work_logs | 75 |
| permission_sections | 70 |
| schema_migrations | 70 |
| parts | 31 |
| sm_courier_details | 29 |
| teams | 22 |
| roles | 18 |
| users | 17 |
| support_challan_items | 15 |
| ttspl_config_history | 13 |
| stage_transition_rules | 12 |
| stages | 12 |
| support_replacement_orders | 11 |
| laptop_catalog | 9 |
| lead_addresses | 9 |
| lead_auto_assign_config | 9 |
| activities | 8 |
| asset_config_brands | 8 |
| asset_config_gpu | 8 |
| asset_config_processors | 8 |
| asset_config_screen_sizes | 8 |
| chip_level_repairs | 8 |
| customer_addresses | 8 |
| customer_documents | 8 |
| customer_invoices | 8 |
| customer_security_deposits | 8 |
| dc_qc_tickets | 8 |
| delivery_technicians | 8 |
| diagnosis_images | 8 |
| diagnosis_results | 8 |
| email_queue | 8 |
| existing_customer | 8 |
| grn_access_numbers | 8 |
| grn_serial_capture_tokens | 8 |
| inventory_status_transitions | 8 |
| lead_followup_notifications | 8 |
| lead_orders | 8 |
| order_items | 8 |
| part_instances | 8 |

## Full Table Catalog

### `public.activities`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** activity_id, action
- **Columns (8):** `activity_id` integer NOT NULL; `ticket_id` integer; `stage_id` integer; `user_id` integer; `action` character varying(50) NOT NULL; `notes` text; `metadata` jsonb; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.allocation_logs`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, serial_number
- **Columns (33):** `id` integer NOT NULL; `vendor_id` integer; `vendor_name` character varying(255); `serial_number` character varying(255) NOT NULL; `unique_id` character varying(255); `action_taken` character varying(128); `remarks` text; `qc_status` character varying(64); `in_ward` character varying(32); `out_ward` character varying(32); `extra` jsonb DEFAULT '{}'::jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `user_id` integer; `customer_id` integer; `customer_name` character varying(255); `challan_id` integer; `product_id` integer; `model_name` character varying(255); `old_serial_number` character varying(255); `po_type` character varying(64); `purchase_type` character varying(64); `locking_period` integer; `added_date` timestamp with time zone; `failure_reason` text; `checked_by` integer; `assigned_to` integer; `warranty_status` character varying(128); `rental_status` character varying(128); `extra_details` jsonb DEFAULT '{}'::jsonb; `require_parts` text

### `public.asset_config_brands`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(120) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_brands_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_generations`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, processor_id, name
- **Columns (9):** `id` integer NOT NULL; `processor_id` integer NOT NULL; `name` character varying(80) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_generations_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_gpu`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(120) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_gpu_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_models`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, brand_id, name
- **Columns (9):** `id` integer NOT NULL; `brand_id` integer NOT NULL; `name` character varying(200) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_models_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_processors`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(120) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_processors_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_ram`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(40) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_ram_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_screen_sizes`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(40) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_screen_sizes_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.asset_config_storage`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** id, name
- **Columns (8):** `id` integer NOT NULL; `name` character varying(60) NOT NULL; `status` character varying(10) DEFAULT 'active'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `created_by` integer; `updated_by` integer; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT asset_config_storage_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))

### `public.chip_level_repairs`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** repair_id
- **Columns (12):** `repair_id` integer NOT NULL; `ticket_id` integer; `created_by` integer; `updated_by` integer; `status` character varying(50) DEFAULT 'in_progress'::character varying; `issues` text[] DEFAULT '{}'::text[]; `issue_notes` text; `parts_required` boolean DEFAULT false; `parts_notes` text; `resolved_checks` text[] DEFAULT '{}'::text[]; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP
- **Constraints:** CONSTRAINT chip_level_repairs_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('waiting_parts'::character varying)::text, ('completed'::character varying)::text])))

### `public.companies`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** company_id, code, legal_name, dc_prefix, invoice_prefix
- **Columns (16):** `company_id` integer NOT NULL; `code` character varying(20) NOT NULL; `legal_name` character varying(255) NOT NULL; `gstin` character varying(20); `pan` character varying(20); `address` text; `state_code` character varying(4); `hsn_code` character varying(20) DEFAULT '84713000'::character varying; `logo_url` text; `dc_prefix` character varying(12) NOT NULL; `invoice_prefix` character varying(12) NOT NULL; `active` boolean DEFAULT true; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now(); `email` character varying(255); `phone` character varying(32)

### `public.customer_addresses`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** customer_address_id, customer_id, address
- **Columns (11):** `customer_address_id` integer NOT NULL; `customer_id` integer NOT NULL; `concern_person` character varying(255); `mobile_no` character varying(50); `address` text NOT NULL; `pincode` character varying(20); `is_head_office` boolean DEFAULT false; `source_lead_address_id` integer; `address_type` character varying(30); `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()

### `public.customer_credit_notes`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** credit_note_id, credit_note_number, customer_id, reason
- **Columns (21):** `credit_note_id` integer NOT NULL; `credit_note_number` character varying(50) NOT NULL; `customer_id` integer NOT NULL; `invoice_id` integer; `reason` character varying(255) NOT NULL; `description` text; `amount` numeric(12,2) DEFAULT 0 NOT NULL; `quantity` integer DEFAULT 0; `unit_rate` numeric(12,2) DEFAULT 0; `from_date` date; `to_date` date; `ttspl_ids` jsonb DEFAULT '[]'::jsonb; `status` character varying(20) DEFAULT 'pending'::character varying; `applied_in_invoice_id` integer; `created_by` integer; `approved_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now(); `serial_id` integer; `return_ticket_id` integer; `source` character varying(30)
- **Constraints:** CONSTRAINT customer_credit_notes_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('applied'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.customer_documents`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** doc_id, customer_id, doc_type, file_path
- **Columns (12):** `doc_id` integer NOT NULL; `customer_id` integer NOT NULL; `lead_id` integer; `doc_type` character varying(50) NOT NULL; `doc_label` character varying(255); `file_path` text NOT NULL; `file_name` character varying(255); `file_size_bytes` integer; `uploaded_by` integer; `is_signed` boolean DEFAULT false; `notes` text; `created_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT customer_documents_doc_type_check CHECK (((doc_type)::text = ANY (ARRAY[('gst_certificate'::character varying)::text, ('pan_card'::character varying)::text, ('agreement'::character varying)::text, ('kyc_id'::character varying)::text, ('other'::character varying)::text])))

### `public.customer_inventory`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, customer_id, asset_kind
- **Columns (33):** `id` integer NOT NULL; `customer_id` integer NOT NULL; `asset_kind` character varying(20) NOT NULL; `asset_bucket` character varying(20) DEFAULT 'live'::character varying NOT NULL; `delivery_challan_id` bigint; `dc_number` character varying(80); `delivery_date` timestamp with time zone; `erp_serial_id` character varying(80); `serial_number` character varying(120); `unique_serial_number` character varying(120); `model_name` character varying(300); `generation` character varying(80); `screen_size` character varying(80); `ram` character varying(120); `storage` character varying(200); `gpu` character varying(200); `processor` character varying(120); `quotation_type` character varying(40); `rate` character varying(80); `locking_period` integer; `delivery_status` character varying(80); `delivery_type` character varying(120); `courier_name` character varying(120); `awb_number` character varying(120); `sales_status` character varying(80); `documents` jsonb; `erp_raw` jsonb; `synced_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.customer_invoices`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** invoice_id, invoice_number, customer_id, invoice_month, invoice_year, invoice_date, from_date, to_date
- **Columns (31):** `invoice_id` integer NOT NULL; `invoice_number` character varying(50) NOT NULL; `customer_id` integer NOT NULL; `invoice_month` integer NOT NULL; `invoice_year` integer NOT NULL; `invoice_date` date NOT NULL; `from_date` date NOT NULL; `to_date` date NOT NULL; `line_items` jsonb DEFAULT '[]'::jsonb NOT NULL; `subtotal` numeric(12,2) DEFAULT 0; `gst_percent` numeric(5,2) DEFAULT 18; `gst_amount` numeric(12,2) DEFAULT 0; `credit_note_adjustment` numeric(12,2) DEFAULT 0; `security_deposit` numeric(12,2) DEFAULT 0; `grand_total` numeric(12,2) DEFAULT 0; `status` character varying(20) DEFAULT 'draft'::character varying; `irn` character varying(100); `irn_generated_at` timestamp with time zone; `qr_code_url` text; `signed_qr_code` text; `eway_bill_number` character varying(50); `eway_bill_valid_till` timestamp with time zone; `pdf_path` text; `sent_at` timestamp with time zone; `sent_by` integer; `paid_at` timestamp with time zone; `payment_reference` character varying(100); `notes` text; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT customer_invoices_invoice_month_check CHECK (((invoice_month >= 1) AND (invoice_month <= 12))); CONSTRAINT customer_invoices_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('sent'::character varying)::text, ('paid'::character varying)::text, ('overdue'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.customer_portal_sessions`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** session_id, customer_id, token, expires_at
- **Columns (5):** `session_id` integer NOT NULL; `customer_id` integer NOT NULL; `token` text NOT NULL; `expires_at` timestamp with time zone NOT NULL; `created_at` timestamp with time zone DEFAULT now()

### `public.customer_security_deposits`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** deposit_id, customer_id, amount, received_date
- **Columns (13):** `deposit_id` integer NOT NULL; `customer_id` integer NOT NULL; `sales_order_number` character varying(50); `amount` numeric(12,2) NOT NULL; `received_date` date NOT NULL; `status` character varying(20) DEFAULT 'held'::character varying; `refund_amount` numeric(12,2) DEFAULT 0; `refund_date` date; `refund_reference` character varying(100); `notes` text; `created_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT customer_security_deposits_status_check CHECK (((status)::text = ANY (ARRAY[('held'::character varying)::text, ('partially_refunded'::character varying)::text, ('refunded'::character varying)::text, ('adjusted'::character varying)::text])))

### `public.customers`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** customer_id, name
- **Columns (40):** `customer_id` integer NOT NULL; `name` character varying(255) NOT NULL; `email` character varying(255); `phone` character varying(50); `gst_no` character varying(50); `type` character varying(50) DEFAULT 'New'::character varying; `details` jsonb; `address` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `status` smallint DEFAULT 1 NOT NULL; `company_name` character varying(255); `pan_number` character varying(20); `company_type` character varying(100); `company_size` integer; `industry` character varying(100); `billing_address` text; `billing_city` character varying(100); `billing_state` character varying(100); `billing_pincode` character varying(10); `shipping_same` boolean DEFAULT true; `shipping_address` text; `shipping_city` character varying(100); `shipping_state` character varying(100); `shipping_pincode` character varying(10); `whatsapp_number` character varying(32); `designation` character varying(255); `source_lead_stage` character varying(100); `onboarded_by` integer; `onboarded_at` timestamp with time zone
- **Constraints:** CONSTRAINT customers_kyc_status_check CHECK (((kyc_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('submitted'::character varying)::text, ('verified'::character varying)::text, ('rejected'::character varying)::text])))

### `public.dc_qc_tickets`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, dc_number, ticket_id
- **Columns (9):** `id` integer NOT NULL; `dc_number` character varying(50) NOT NULL; `sales_order_number` character varying(50); `ticket_id` integer NOT NULL; `ttspl_id` character varying(50); `serial_id` integer; `status` character varying(20) DEFAULT 'pending'::character varying; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT dc_qc_tickets_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('qc_passed'::character varying)::text, ('qc_failed'::character varying)::text])))

### `public.delivery_challan_lines`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, dc_number
- **Columns (90):** `id` integer NOT NULL; `dc_number` character varying(50) NOT NULL; `sales_order_number` character varying(50); `quotation_number` character varying(50); `customer_id` integer; `customer_name` character varying(255); `email` character varying(255); `gst_number` character varying(50); `supply_state` character varying(100); `security_amount` numeric(12,2) DEFAULT 0; `shiping_charges` numeric(12,2) DEFAULT 0; `branch` character varying(50); `customer_billing_address` jsonb; `customer_shipping_address` jsonb; `brand` character varying(100); `model_name` character varying(255); `quantity` integer DEFAULT 1 NOT NULL; `main_qty` integer; `serial_number` jsonb; `ship_by` character varying(20); `courier_name` character varying(255); `awb_number` character varying(100); `delivery_person_id` integer; `remarks` text; `status` character varying(20) DEFAULT 'pending'::character varying NOT NULL; `pdf_path` text; `file_path` text; `delivered_serial_numbers` jsonb; `rejected_serial_numbers` jsonb; `pickuped_serial_numbers` jsonb
- **Constraints:** CONSTRAINT delivery_challan_lines_dispatch_mode_check CHECK (((dispatch_mode)::text = ANY (ARRAY[('courier'::character varying)::text, ('porter'::character varying)::text, ('inhouse'::character varying)::text]))); CONSTRAINT delivery_challan_lines_movement_type_check CHECK (((movement_type)::text = ANY (ARRAY[('outbound'::character varying)::text, ('return'::character varying)::text]))); CONSTRAINT delivery_challan_lines_ship_by_check CHECK (((ship_by IS NULL) OR ((ship_by)::text = ANY (ARRAY[('by_hand'::character varying)::text, ('by_courier'::character varying)::text])))); CONSTRAINT delivery_challan_lines_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('shipped'::character varying)::text, ('in_transit'::character varying)::text, ('reached'::character varying)::text, ('delivered'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.delivery_technicians`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** technician_id, first_name
- **Columns (16):** `technician_id` integer NOT NULL; `user_id` integer; `first_name` character varying(100) NOT NULL; `last_name` character varying(100); `phone` character varying(50); `email` character varying(255); `is_active` boolean DEFAULT true NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `country_code` character varying(10) DEFAULT '91'::character varying NOT NULL; `address` text; `identity_type` character varying(50); `identity_number` character varying(100); `identity_image` jsonb DEFAULT '[]'::jsonb NOT NULL; `image` character varying(255); `password_hash` text

### `public.demo_agreements`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** demo_id, customer_id
- **Columns (16):** `demo_id` integer NOT NULL; `sales_order_number` character varying(50); `dc_number` character varying(50); `customer_id` integer NOT NULL; `serial_id` integer; `ttspl_id` character varying(64); `delivered_at` timestamp with time zone; `decision_due_at` timestamp with time zone; `decision` character varying(20) DEFAULT 'pending'::character varying; `decided_at` timestamp with time zone; `decided_by` integer; `rent_start_date` date; `pickup_ticket_id` integer; `notes` text; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT demo_agreements_decision_check CHECK (((decision)::text = ANY (ARRAY[('pending'::character varying)::text, ('keep'::character varying)::text, ('return'::character varying)::text])))

### `public.diagnosis_images`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** image_id
- **Columns (5):** `image_id` integer NOT NULL; `diagnosis_id` integer; `section_name` character varying(100); `image_path` text; `uploaded_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.diagnosis_parts_required`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, part_name
- **Columns (12):** `id` integer NOT NULL; `diagnosis_id` integer; `ticket_id` integer; `part_name` character varying(255) NOT NULL; `part_category` character varying(100); `quantity` integer DEFAULT 1; `is_available` boolean DEFAULT false; `inventory_part_id` integer; `status` character varying(50) DEFAULT 'Required'::character varying; `attached_by` integer; `attached_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.diagnosis_results`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** diagnosis_id
- **Columns (63):** `diagnosis_id` integer NOT NULL; `ticket_id` integer; `diagnosed_by` integer; `diagnosed_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `power_on` boolean; `power_button_working` boolean; `boots_successfully` boolean; `bios_accessible` boolean; `bios_password_lock` boolean; `display_on` boolean; `brightness_control` boolean; `no_flickering` boolean; `no_lines_spots` boolean; `webcam_working` boolean; `all_keys_working` boolean; `touchpad_working` boolean; `left_click_working` boolean; `right_click_working` boolean; `battery_detected` boolean; `battery_charging` boolean; `charging_port_tight` boolean; `battery_swollen` boolean; `storage_detected` boolean; `smart_status_ok` boolean; `no_bad_sectors` boolean; `ram_detected` boolean; `correct_capacity` boolean; `slot_1_working` boolean; `slot_2_working` boolean; `wifi_detected` boolean

### `public.einvoice_records`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** record_id, dc_number
- **Columns (17):** `record_id` integer NOT NULL; `dc_number` character varying(50) NOT NULL; `invoice_id` integer; `customer_id` integer; `invoice_number` character varying(50); `irn` character varying(100); `ack_number` character varying(100); `ack_date` timestamp with time zone; `signed_invoice` text; `signed_qr_code` text; `qr_code_image_url` text; `status` character varying(20) DEFAULT 'generated'::character varying; `cancelled_at` timestamp with time zone; `cancel_reason` character varying(255); `zoho_response` jsonb; `generated_by` integer; `created_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT einvoice_records_status_check CHECK (((status)::text = ANY (ARRAY[('generated'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.email_queue`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** email_id, to_email, subject
- **Columns (13):** `email_id` integer NOT NULL; `to_email` character varying(255) NOT NULL; `subject` text NOT NULL; `body_text` text; `body_html` text; `dedupe_key` character varying(255); `status` character varying(20) DEFAULT 'pending'::character varying NOT NULL; `attempts` integer DEFAULT 0 NOT NULL; `max_attempts` integer DEFAULT 5 NOT NULL; `scheduled_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL; `sent_at` timestamp with time zone; `last_error` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP
- **Constraints:** CONSTRAINT email_queue_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))

### `public.eway_bill_records`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** record_id, dc_number
- **Columns (15):** `record_id` integer NOT NULL; `dc_number` character varying(50) NOT NULL; `ewb_number` character varying(50); `ewb_date` timestamp with time zone; `valid_upto` timestamp with time zone; `transporter_id` character varying(50); `transporter_name` character varying(100); `vehicle_number` character varying(20); `mode_of_transport` character varying(20) DEFAULT 'road'::character varying; `distance_km` integer; `status` character varying(20) DEFAULT 'active'::character varying; `zoho_response` jsonb; `generated_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT eway_bill_records_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('extended'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.existing_customer`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** customer_id
- **Columns (12):** `customer_id` integer NOT NULL; `customer_name` character varying(500); `contact_person_name` character varying(300); `contact_person_number` character varying(80); `customer_number` character varying(80); `email` character varying(320); `billing_address` jsonb; `shipping_address` jsonb; `erp_raw` jsonb; `synced_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.grn_access_attempts`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id
- **Columns (8):** `id` integer NOT NULL; `access_number` integer; `access_id` integer; `success` boolean DEFAULT false NOT NULL; `result` character varying(40); `ip` character varying(64); `user_agent` text; `created_at` timestamp with time zone DEFAULT now()

### `public.grn_access_numbers`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, access_number, capture_url
- **Columns (10):** `id` integer NOT NULL; `access_number` integer NOT NULL; `capture_url` text NOT NULL; `capture_token` uuid; `po_id` integer; `status` character varying(20) DEFAULT 'pending'::character varying NOT NULL; `created_by` integer; `created_at` timestamp with time zone DEFAULT now(); `used_at` timestamp with time zone; `expires_at` timestamp with time zone
- **Constraints:** CONSTRAINT grn_access_numbers_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('used'::character varying)::text, ('expired'::character varying)::text])))

### `public.grn_config_verifications`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id
- **Columns (11):** `id` integer NOT NULL; `token_id` uuid; `po_id` integer; `line_index` integer; `expected_config` jsonb; `actual_config` jsonb; `matched_fields` text[]; `mismatched_fields` jsonb; `configuration_matched` boolean DEFAULT false NOT NULL; `ip` character varying(64); `created_at` timestamp with time zone DEFAULT now()

### `public.grn_serial_capture_tokens`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** po_id, line_index, expires_at
- **Columns (16):** `token_id` uuid DEFAULT gen_random_uuid() NOT NULL; `po_id` integer NOT NULL; `line_index` integer NOT NULL; `unit_index` integer DEFAULT 0 NOT NULL; `total_units` integer DEFAULT 1 NOT NULL; `serial_number` text; `status` text DEFAULT 'pending'::text NOT NULL; `created_by` integer; `expires_at` timestamp with time zone NOT NULL; `captured_at` timestamp with time zone; `used_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `config_verified` boolean DEFAULT false; `config_verified_at` timestamp with time zone; `actual_config` jsonb; `config_check` jsonb
- **Constraints:** CONSTRAINT grn_serial_capture_tokens_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'captured'::text, 'used'::text, 'expired'::text, 'cancelled'::text])))

### `public.inventory`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** inventory_id, stock_type, device_type, machine_number, serial_number, brand, model
- **Columns (18):** `inventory_id` integer NOT NULL; `stock_type` character varying(50) NOT NULL; `device_type` character varying(50) NOT NULL; `machine_number` character varying(100) NOT NULL; `serial_number` character varying(100) NOT NULL; `brand` character varying(100) NOT NULL; `model` character varying(100) NOT NULL; `processor` character varying(100); `ram` character varying(50); `storage` character varying(50); `grade` character varying(10); `status` character varying(50) DEFAULT 'In Stock'::character varying; `stage` character varying(100); `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `generation` character varying(80); `gpu` character varying(120); `screen_size` character varying(40)
- **Constraints:** CONSTRAINT inventory_device_type_check CHECK (((device_type)::text = ANY (ARRAY[('Laptop'::character varying)::text, ('Desktop'::character varying)::text]))); CONSTRAINT inventory_stock_type_check CHECK (((stock_type)::text = ANY (ARRAY[('Cooling Period'::character varying)::text, ('Ready'::character varying)::text])))

### `public.inventory_status_transitions`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** transition_id, to_status
- **Columns (11):** `transition_id` integer NOT NULL; `serial_id` integer; `ttspl_id` character varying(64); `from_status` character varying(64); `to_status` character varying(64) NOT NULL; `reason` character varying(255); `dc_number` character varying(50); `customer_id` integer; `entity_code` character varying(20); `actor_user_id` integer; `created_at` timestamp with time zone DEFAULT now()

### `public.inward_outward`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id
- **Columns (7):** `id` integer NOT NULL; `serial_number` character varying(255); `unique_number` character varying(255); `product_type` character varying(64); `transaction_type` character varying(64); `meta` jsonb DEFAULT '{}'::jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.laptop_catalog`

- **Rows in backup:** 9
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** catalog_id, brand
- **Columns (11):** `catalog_id` integer NOT NULL; `brand` character varying(100) NOT NULL; `model` character varying(120); `processor` character varying(120); `generation` character varying(80); `ram` character varying(50); `storage` character varying(50); `device_type` character varying(50) DEFAULT 'Laptop'::character varying; `active` boolean DEFAULT true; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.lead_activities`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** activity_id
- **Columns (10):** `activity_id` integer NOT NULL; `lead_id` integer; `user_id` integer; `action` character varying(50); `status_from` character varying(50); `status_to` character varying(50); `notes` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `stage_from` character varying(200); `stage_to` character varying(200)

### `public.lead_addresses`

- **Rows in backup:** 9
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** address_id, lead_id, address
- **Columns (9):** `address_id` integer NOT NULL; `lead_id` integer NOT NULL; `concern_person` character varying(255); `mobile_no` character varying(32); `address` text NOT NULL; `pincode` character varying(20); `address_type` character varying(30); `created_by` integer; `created_at` timestamp with time zone DEFAULT now()

### `public.lead_assignments`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** assignment_id
- **Columns (6):** `assignment_id` integer NOT NULL; `lead_id` integer; `assigned_to` integer; `assigned_by` integer; `assigned_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `batch_id` uuid

### `public.lead_auto_assign_config`

- **Rows in backup:** 9
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id
- **Columns (5):** `id` integer NOT NULL; `user_ids` integer[] DEFAULT '{}'::integer[] NOT NULL; `round_robin_index` integer DEFAULT 0 NOT NULL; `updated_at` timestamp with time zone DEFAULT now(); `updated_by` integer

### `public.lead_company_research`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** research_id
- **Columns (15):** `research_id` integer NOT NULL; `lead_id` integer; `cin` character varying(100); `entity_type` character varying(100); `roc` character varying(100); `revenue` character varying(100); `employees` character varying(100); `gst` character varying(100); `address` text; `city` character varying(100); `state` character varying(100); `raw_response` jsonb; `researched_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `industry` character varying(255); `pincode` character varying(20)

### `public.lead_followup_notifications`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** notification_id, follow_up_at, recipient_email
- **Columns (6):** `notification_id` integer NOT NULL; `lead_id` integer; `follow_up_at` timestamp with time zone NOT NULL; `recipient_email` character varying(255) NOT NULL; `channel` character varying(20) DEFAULT 'email'::character varying NOT NULL; `notified_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.lead_import_logs`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** import_id
- **Columns (8):** `import_id` integer NOT NULL; `imported_by` integer; `total_rows` integer DEFAULT 0; `imported` integer DEFAULT 0; `duplicates` integer DEFAULT 0; `errors` integer DEFAULT 0; `error_details` jsonb DEFAULT '[]'::jsonb; `created_at` timestamp with time zone DEFAULT now()

### `public.lead_orders`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** lead_order_id
- **Columns (7):** `lead_order_id` integer NOT NULL; `lead_id` integer; `order_status` character varying(50) DEFAULT 'New'::character varying; `amount` numeric(10,2) DEFAULT 0; `details` jsonb; `created_by` integer; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.lead_remarks`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** remark_id, lead_id, note
- **Columns (5):** `remark_id` integer NOT NULL; `lead_id` integer NOT NULL; `user_id` integer; `note` text NOT NULL; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.leads`

- **Rows in backup:** 1
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** lead_id, name
- **Columns (55):** `lead_id` integer NOT NULL; `name` character varying(255) NOT NULL; `company_name` character varying(255); `email` character varying(255); `phone` character varying(50); `city` character varying(100); `source` character varying(100); `status` character varying(50) DEFAULT 'Pending'::character varying NOT NULL; `assigned_user_id` integer; `assigned_by` integer; `assigned_at` timestamp with time zone; `follow_up_date` timestamp with time zone; `is_duplicate` boolean DEFAULT false; `duplicate_of` integer; `rejection_reason` text; `research_status` character varying(50) DEFAULT 'pending'::character varying; `research_requested_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `lead_stage` character varying(200); `quotation_accept_token` character varying(64); `quotation_accepted_at` timestamp with time zone; `quotation_last_sent_at` timestamp with time zone; `quotation_last_estimate_no` character varying(50); `quotation_last_to_email` character varying(255); `whatsapp_number` character varying(32); `designation` character varying(255); `quantity_required` integer; `monthly_budget` numeric(12,2); `rental_duration` integer
- **Constraints:** CONSTRAINT leads_inquiry_type_check CHECK (((inquiry_type)::text = ANY (ARRAY[('rental'::character varying)::text, ('sales'::character varying)::text, ('both'::character varying)::text]))); CONSTRAINT leads_research_status_check CHECK (((research_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text]))); CONSTRAINT leads_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('Cold'::character varying)::text, ('Warm'::character varying)::text, ('Hot'::character varying)::text, ('Gone'::character varying)::text, ('Hold'::character varying)::text, ('Rejected'::character varying)::text, ('Call Back'::character varying)::text, ('Deal'::character varying)::text, ('Demo'::character varying)::text])))

### `public.order_items`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** item_id
- **Columns (29):** `item_id` integer NOT NULL; `order_id` integer; `brand` character varying(100); `processor` character varying(100); `ram` character varying(50); `storage` character varying(50); `quantity` integer DEFAULT 1; `preferred_model` character varying(100); `status` character varying(50) DEFAULT 'New'::character varying; `inventory_id` integer; `unit_price` numeric(10,2) DEFAULT 0; `gst_percent` numeric(5,2) DEFAULT 18; `gst_amount` numeric(10,2) DEFAULT 0; `total_with_gst` numeric(10,2) DEFAULT 0; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `qc_passed` boolean DEFAULT false; `is_wfh` boolean DEFAULT false; `shipping_charge` numeric(10,2) DEFAULT 0; `estimate_id` character varying(120); `destination_pincode` character varying(20); `tracking_status` character varying(30) DEFAULT 'Not Dispatched'::character varying; `item_tracker_id` character varying(120); `item_courier_partner` character varying(120); `item_dispatch_date` date; `item_estimated_delivery` date; `delivered_at` timestamp with time zone; `proposed_delivery_date` date; `qc_sales_checklist` jsonb; `qc_sales_passed_at` timestamp with time zone

### `public.orders`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** order_id
- **Columns (31):** `order_id` integer NOT NULL; `customer_id` integer; `lead_type` character varying(50); `order_type` character varying(20) DEFAULT 'Sales'::character varying; `status` character varying(50) DEFAULT 'New Lead'::character varying; `owner_user_id` integer; `lockin_period_days` integer DEFAULT 0; `security_amount` numeric(10,2) DEFAULT 0; `is_wfh` boolean DEFAULT false; `shipping_charge` numeric(10,2) DEFAULT 0; `shipping_gst_amount` numeric(10,2) DEFAULT 0; `subtotal_amount` numeric(12,2) DEFAULT 0; `items_gst_amount` numeric(12,2) DEFAULT 0; `grand_total_amount` numeric(12,2) DEFAULT 0; `invoice_number` character varying(100); `invoice_generated_at` timestamp with time zone; `eway_bill_number` character varying(100); `eway_bill_generated_at` timestamp with time zone; `delivery_date` date; `shipping_address` text; `dispatch_date` date; `tracker_id` character varying(100); `courier_partner` character varying(100); `dispatched_at` timestamp with time zone; `estimated_delivery` date; `qc_received_at` timestamp with time zone; `qc_completed_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `cancelled_at` timestamp with time zone
- **Constraints:** CONSTRAINT orders_order_type_check CHECK (((order_type)::text = ANY (ARRAY[('Sales'::character varying)::text, ('Rent'::character varying)::text, ('Demo'::character varying)::text])))

### `public.part_instances`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** instance_id, prt_id, part_id
- **Columns (19):** `instance_id` integer NOT NULL; `prt_id` character varying(30) NOT NULL; `part_id` integer NOT NULL; `spo_id` integer; `grn_id` integer; `batch_number` character varying(50); `unit_cost` numeric(10,2) DEFAULT 0 NOT NULL; `status` character varying(30) DEFAULT 'in_stock'::character varying NOT NULL; `location_code` character varying(100); `installed_ttspl_id` character varying(50); `installed_ticket_id` integer; `installed_at` timestamp with time zone; `removed_at` timestamp with time zone; `condition_on_removal` character varying(20); `notes` text; `received_at` timestamp with time zone DEFAULT now(); `received_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT part_instances_status_check CHECK (((status)::text = ANY (ARRAY[('in_stock'::character varying)::text, ('reserved'::character varying)::text, ('installed'::character varying)::text, ('defective'::character varying)::text, ('returned'::character varying)::text, ('discarded'::character varying)::text, ('sold'::character varying)::text, ('with_technician'::character varying)::text])))

### `public.part_requests`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** request_id, part_name
- **Columns (31):** `request_id` integer NOT NULL; `ticket_id` integer; `requested_by` integer; `part_name` character varying(255) NOT NULL; `description` text; `status` character varying(50) DEFAULT 'pending'::character varying; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `request_number` character varying(30); `request_type` character varying(20) DEFAULT 'replacement'::character varying; `part_id` integer; `quantity` integer DEFAULT 1; `stage_name` character varying(100); `ticket_stage_id` integer; `config_field` character varying(50); `old_value` character varying(200); `new_value` character varying(200); `blocks_stage` boolean DEFAULT true; `approved_by` integer; `approved_at` timestamp with time zone; `rejection_reason` text; `escalated_by` integer; `escalated_at` timestamp with time zone; `spo_id` integer; `instance_id` integer; `attached_at` timestamp with time zone; `attached_by` integer; `old_part_returned` boolean DEFAULT false; `old_part_returned_at` timestamp with time zone; `old_part_condition` character varying(20)

### `public.parts`

- **Rows in backup:** 31
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** part_id, part_name
- **Columns (19):** `part_id` integer NOT NULL; `part_name` character varying(100) NOT NULL; `part_type` character varying(50); `quantity` integer DEFAULT 0; `vendor` character varying(100); `cost` numeric(10,2); `location_code` character varying(100); `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `min_threshold` integer DEFAULT 5; `description` text; `category` character varying(100) DEFAULT 'general'::character varying; `part_sku` character varying(100); `compatible_brands` text[]; `compatible_models` text[]; `is_consumable` boolean DEFAULT false; `warranty_months` integer DEFAULT 0; `notes` text; `archived` boolean DEFAULT false; `updated_at` timestamp with time zone DEFAULT now()

### `public.permission_audit_logs`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, target_type, action
- **Columns (7):** `id` integer NOT NULL; `actor_user_id` integer; `target_type` character varying(32) NOT NULL; `target_id` character varying(100); `action` character varying(64) NOT NULL; `payload` jsonb DEFAULT '{}'::jsonb NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.permission_sections`

- **Rows in backup:** 70
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, section
- **Columns (5):** `id` integer NOT NULL; `section` character varying(100) NOT NULL; `description` text; `sort_order` integer DEFAULT 0 NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.photos`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** photo_id, photo_url
- **Columns (7):** `photo_id` integer NOT NULL; `ticket_id` integer; `stage_id` integer; `photo_url` text NOT NULL; `photo_type` character varying(20); `uploaded_by` integer; `uploaded_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP
- **Constraints:** CONSTRAINT photos_photo_type_check CHECK (((photo_type)::text = ANY (ARRAY[('before'::character varying)::text, ('after'::character varying)::text, ('issue'::character varying)::text, ('repair'::character varying)::text])))

### `public.procurement_requests`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** request_id
- **Columns (5):** `request_id` integer NOT NULL; `order_item_id` integer; `status` character varying(50) DEFAULT 'New'::character varying; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.qc_photos`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** photo_id, photo_path
- **Columns (4):** `photo_id` integer NOT NULL; `qc_id` integer; `photo_path` text NOT NULL; `uploaded_at` timestamp without time zone DEFAULT CURRENT_TIMESTAMP

### `public.qc_results`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** qc_id, qc_stage, checklist_data
- **Columns (22):** `qc_id` integer NOT NULL; `ticket_id` integer; `qc_stage` character varying(20) NOT NULL; `processor` character varying(20); `generation` character varying(20); `storage_type` character varying(50); `ram_size` character varying(20); `checklist_data` jsonb NOT NULL; `parts_replaced` boolean DEFAULT false; `replaced_parts` jsonb; `qc_result` character varying(20); `failure_reasons` text[]; `remarks` text; `final_grade` character varying(50); `grade_notes` text; `tested_by` integer; `checked_by` integer; `qc_date` date; `dispatch_date` date; `is_locked` boolean DEFAULT false; `created_at` timestamp without time zone DEFAULT CURRENT_TIMESTAMP; `submitted_at` timestamp without time zone
- **Constraints:** CONSTRAINT qc_results_qc_stage_check CHECK (((qc_stage)::text = ANY (ARRAY[('QC1'::character varying)::text, ('QC2'::character varying)::text, ('Dispatch QC'::character varying)::text])))

### `public.qc_round_robin_state`

- **Rows in backup:** 2
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** team_id
- **Columns (3):** `team_id` integer NOT NULL; `last_assigned_user_id` integer; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.rent_devices`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, serial_id
- **Columns (21):** `id` integer NOT NULL; `serial_id` integer NOT NULL; `po_id` integer; `dc_number` character varying(64); `serial_number` character varying(255); `unique_number` character varying(255); `product_id` integer; `rent_start_date` date; `rent_end_date` date; `rent_amount` numeric(12,2); `month_rent` numeric(12,2); `rent_with_gst` numeric(12,2); `total_amount` numeric(12,2); `vendor_id` integer; `type` character varying(64); `status` character varying(64); `customer_id` integer; `rent_stop_date` date; `rent_start_date_again` date; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.repair_logs`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, serial_number_id
- **Columns (12):** `id` integer NOT NULL; `serial_number_id` integer NOT NULL; `serial_number` character varying(255); `unique_number` character varying(255); `new_serial_number` character varying(255); `new_unique_number` character varying(255); `repair_start_date` date; `repair_end_date` date; `type` character varying(64); `remarks` text; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.role_permissions`

- **Rows in backup:** 576
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, role, section
- **Columns (7):** `id` integer NOT NULL; `role` character varying(50) NOT NULL; `section` character varying(100) NOT NULL; `can_view` boolean DEFAULT false; `can_create` boolean DEFAULT false; `can_edit` boolean DEFAULT false; `can_delete` boolean DEFAULT false

### `public.roles`

- **Rows in backup:** 18
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, name, display_name
- **Columns (7):** `id` integer NOT NULL; `name` character varying(50) NOT NULL; `display_name` character varying(100) NOT NULL; `description` text; `is_system_role` boolean DEFAULT false NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.sales_order_lines`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, sales_order_number
- **Columns (41):** `id` integer NOT NULL; `sales_order_number` character varying(50) NOT NULL; `quotation_number` character varying(50) DEFAULT 'N/A'::character varying NOT NULL; `customer_id` integer; `customer_name` character varying(255); `customer_email` character varying(255); `customer_mobile` character varying(50); `customer_shipping_address` jsonb; `customer_billing_address` jsonb; `gst_number` character varying(50); `supply_state` character varying(100); `security_amount` numeric(12,2) DEFAULT 0; `shiping_charges` numeric(12,2) DEFAULT 0; `quotation_type` character varying(20) DEFAULT 'rental'::character varying; `branch` character varying(50); `brand` character varying(100); `model_name` character varying(255); `processor` character varying(100); `generation` character varying(50); `ram` character varying(50); `storage` character varying(50); `gpu` character varying(100); `screen_size` character varying(50); `quantity` integer DEFAULT 1 NOT NULL; `main_qty` integer DEFAULT 1 NOT NULL; `rate` numeric(12,2) DEFAULT 0 NOT NULL; `locking_period` integer; `battery_charger_warranty` integer; `technical_warranty` integer; `remark` text

### `public.sales_order_payments`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** payment_id, sales_order_number, payment_type, amount, payment_date
- **Columns (11):** `payment_id` integer NOT NULL; `sales_order_number` character varying(50) NOT NULL; `customer_id` integer; `payment_type` character varying(30) NOT NULL; `amount` numeric(12,2) NOT NULL; `payment_date` date NOT NULL; `payment_mode` character varying(30) DEFAULT 'bank_transfer'::character varying; `reference_number` character varying(100); `notes` text; `recorded_by` integer; `created_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT sales_order_payments_payment_mode_check CHECK (((payment_mode)::text = ANY (ARRAY[('bank_transfer'::character varying)::text, ('cheque'::character varying)::text, ('upi'::character varying)::text, ('cash'::character varying)::text, ('other'::character varying)::text]))); CONSTRAINT sales_order_payments_payment_type_check CHECK (((payment_type)::text = ANY (ARRAY[('advance'::character varying)::text, ('security_deposit'::character varying)::text, ('monthly'::character varying)::text, ('partial'::character varying)::text, ('final'::character varying)::text])))

### `public.sales_order_serials`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** allocation_id, sales_order_number
- **Columns (17):** `allocation_id` integer NOT NULL; `sales_order_number` character varying(50) NOT NULL; `line_id` integer; `serial_id` integer; `ttspl_id` character varying(64); `serial_number` character varying(255); `qc_ticket_id` integer; `qc_status` character varying(20) DEFAULT 'pending'::character varying; `status` character varying(20) DEFAULT 'attached'::character varying; `dc_number` character varying(50); `entity_code` character varying(20); `created_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now(); `delivery_address` jsonb; `delivery_notes` text; `is_wfh` boolean DEFAULT false
- **Constraints:** CONSTRAINT sales_order_serials_qc_status_check CHECK (((qc_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('passed'::character varying)::text, ('failed'::character varying)::text]))); CONSTRAINT sales_order_serials_status_check CHECK (((status)::text = ANY (ARRAY[('attached'::character varying)::text, ('dispatched'::character varying)::text, ('removed'::character varying)::text])))

### `public.sales_quotations`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, quotation_number
- **Columns (41):** `id` integer NOT NULL; `quotation_number` character varying(50) NOT NULL; `customer_id` integer; `customer_name` character varying(255); `customer_email` character varying(255); `customer_mobile` character varying(50); `customer_shipping_address` jsonb; `customer_billing_address` jsonb; `contact_person_name` character varying(255); `contact_person_mobile` character varying(50); `gst_number` character varying(50); `supply_state` character varying(100); `security_amount` numeric(12,2) DEFAULT 0; `shiping_charges` numeric(12,2) DEFAULT 0; `quotation_type` character varying(20) DEFAULT 'rental'::character varying; `brand` character varying(100); `model_name` character varying(255); `processor` character varying(100); `generation` character varying(50); `ram` character varying(50); `storage` character varying(50); `gpu` character varying(100); `screen_size` character varying(50); `quantity` integer DEFAULT 1 NOT NULL; `main_quantity` integer DEFAULT 1 NOT NULL; `rate` numeric(12,2) DEFAULT 0 NOT NULL; `locking_period` integer; `battery_charger_warranty` integer; `technical_warranty` integer; `remark` text
- **Constraints:** CONSTRAINT sales_quotations_quotation_type_check CHECK (((quotation_type)::text = ANY ((ARRAY['sale'::character varying, 'rental'::character varying, 'demo'::character varying])::text[]))); CONSTRAINT sales_quotations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))

### `public.schema_migrations`

- **Rows in backup:** 70
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** name
- **Columns (2):** `name` character varying(255) NOT NULL; `applied_at` timestamp with time zone DEFAULT now()

### `public.sm_courier_details`

- **Rows in backup:** 29
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, courier_name, awb_number
- **Columns (5):** `id` integer NOT NULL; `courier_name` character varying(255) NOT NULL; `awb_number` character varying(100) NOT NULL; `dc_number` character varying(50); `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.sm_document_sequences`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** doc_type, prefix
- **Columns (4):** `doc_type` character varying(20) NOT NULL; `last_value` integer DEFAULT 0 NOT NULL; `prefix` character varying(20) NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.spare_parts`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, name
- **Columns (5):** `id` integer NOT NULL; `name` character varying(255) NOT NULL; `status` smallint DEFAULT 1 NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.stage_checklists`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** checklist_id, checklist_items
- **Columns (4):** `checklist_id` integer NOT NULL; `stage_id` integer; `checklist_items` jsonb NOT NULL; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.stage_transition_rules`

- **Rows in backup:** 12
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** rule_id, from_stage_name, to_stage_name
- **Columns (6):** `rule_id` integer NOT NULL; `from_stage_name` character varying(100) NOT NULL; `to_stage_name` character varying(100) NOT NULL; `condition` character varying(100); `is_backward` boolean DEFAULT false; `notes` text

### `public.stages`

- **Rows in backup:** 12
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** stage_id, stage_name, stage_order
- **Columns (7):** `stage_id` integer NOT NULL; `stage_name` character varying(100) NOT NULL; `stage_order` integer NOT NULL; `team_id` integer; `stage_category` character varying(100); `description` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.support_challan_items`

- **Rows in backup:** 15
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, challan_id, part_request_id, part_id
- **Columns (12):** `id` integer NOT NULL; `challan_id` integer NOT NULL; `part_request_id` integer NOT NULL; `part_id` integer NOT NULL; `instance_id` integer; `prt_id` character varying(30); `part_name` character varying(255); `quantity` integer DEFAULT 1 NOT NULL; `unit_cost` numeric(10,2) DEFAULT 0; `returned_qty` integer DEFAULT 0; `return_status` character varying(20) DEFAULT 'held'::character varying; `created_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT support_challan_items_return_status_check CHECK (((return_status)::text = ANY (ARRAY[('held'::character varying)::text, ('used'::character varying)::text, ('returned'::character varying)::text])))

### `public.support_issue_categories`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, name
- **Columns (5):** `id` integer NOT NULL; `name` character varying(120) NOT NULL; `active` boolean DEFAULT true NOT NULL; `sort_order` integer DEFAULT 0 NOT NULL; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.support_part_challans`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, challan_number, support_ticket_id, issued_to
- **Columns (19):** `id` integer NOT NULL; `challan_number` character varying(30) NOT NULL; `support_ticket_id` integer NOT NULL; `ttspl_id` character varying(120); `issued_to` integer NOT NULL; `issued_by` integer; `issued_at` timestamp with time zone; `status` character varying(20) DEFAULT 'draft'::character varying NOT NULL; `tech_esign_url` text; `tech_esign_at` timestamp with time zone; `tech_esign_name` character varying(255); `wh_esign_url` text; `wh_esign_at` timestamp with time zone; `wh_esign_name` character varying(255); `pdf_path` text; `return_pdf_path` text; `notes` text; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT support_part_challans_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('issued'::character varying)::text, ('partially_returned'::character varying)::text, ('fully_returned'::character varying)::text])))

### `public.support_part_requests`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, request_number, support_ticket_id, requested_by, part_id
- **Columns (32):** `id` integer NOT NULL; `request_number` character varying(30) NOT NULL; `support_ticket_id` integer NOT NULL; `support_item_id` integer; `ttspl_id` character varying(120); `serial_number` character varying(255); `requested_by` integer NOT NULL; `assigned_to_tech` integer; `part_id` integer NOT NULL; `quantity` integer DEFAULT 1 NOT NULL; `reason` text; `status` character varying(30) DEFAULT 'pending'::character varying NOT NULL; `instance_id` integer; `challan_id` integer; `approved_by` integer; `approved_at` timestamp with time zone; `issued_at` timestamp with time zone; `used_at` timestamp with time zone; `return_requested_at` timestamp with time zone; `returned_at` timestamp with time zone; `returned_to` integer; `rejection_reason` text; `notes` text; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now(); `reassign_to_ticket_id` integer; `reassign_to_item_id` integer; `reassign_to_ttspl_id` character varying(120); `reassign_to_serial` character varying(255); `reassign_reason` text
- **Constraints:** CONSTRAINT support_part_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('challan_generated'::character varying)::text, ('issued'::character varying)::text, ('used'::character varying)::text, ('return_requested'::character varying)::text, ('returned'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.support_replacement_orders`

- **Rows in backup:** 11
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, ticket_id, item_id
- **Columns (34):** `id` integer NOT NULL; `ticket_id` integer NOT NULL; `item_id` integer NOT NULL; `source_item_id` integer; `old_customer_inventory_id` integer; `new_customer_inventory_id` integer; `old_machine_serial` character varying(120); `new_machine_serial` character varying(120); `status` character varying(40) DEFAULT 'placed'::character varying NOT NULL; `created_by` integer; `notes` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `dispatched_at` timestamp with time zone; `delivered_at` timestamp with time zone; `inventory_updated_at` timestamp with time zone; `complaint_item_id` integer; `pickup_item_id` integer; `dispatch_method` character varying(20); `courier_name` character varying(200); `awb_number` character varying(120); `delivery_otp_code` character varying(6); `delivery_otp_verified_at` timestamp with time zone; `warehouse_otp_code` character varying(6); `warehouse_otp_verified_at` timestamp with time zone; `flagged_at` timestamp with time zone; `approved_at` timestamp with time zone; `out_for_delivery_at` timestamp with time zone; `pickup_completed_at` timestamp with time zone; `sales_order_number` character varying(50); `dc_number` character varying(50)

### `public.support_settings`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** key
- **Columns (3):** `key` character varying(80) NOT NULL; `value` jsonb DEFAULT '{}'::jsonb NOT NULL; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.support_ticket_item_audit`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, ticket_id, action
- **Columns (7):** `id` integer NOT NULL; `item_id` integer; `ticket_id` integer NOT NULL; `user_id` integer; `action` character varying(80) NOT NULL; `detail` jsonb; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.support_ticket_item_comments`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, item_id, user_id, body
- **Columns (6):** `id` integer NOT NULL; `item_id` integer NOT NULL; `user_id` integer NOT NULL; `author_role` character varying(40); `body` text NOT NULL; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.support_ticket_items`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, ticket_id, item_type
- **Columns (69):** `id` integer NOT NULL; `ticket_id` integer NOT NULL; `customer_inventory_id` integer; `serial_number` character varying(120); `unique_serial_number` character varying(120); `brand` character varying(120); `model` character varying(300); `ram` character varying(120); `storage` character varying(200); `generation` character varying(80); `item_type` character varying(20) NOT NULL; `issue_category_id` integer; `issue_category_label` character varying(120); `remarks` text; `assigned_to` integer; `status` character varying(40) DEFAULT 'open'::character varying NOT NULL; `otp_code` character varying(6); `otp_verified_at` timestamp with time zone; `pod_image_path` text; `work_done_at` timestamp with time zone; `loan_machine_serial` character varying(120); `loan_delivered_at` timestamp with time zone; `pickup_scheduled_at` timestamp with time zone; `resolved_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `visited_at` timestamp with time zone; `picked_up_at` timestamp with time zone; `replacement_flagged_by` integer; `replacement_flag_reason` text
- **Constraints:** CONSTRAINT support_ticket_items_pickup_type_check CHECK (((pickup_type IS NULL) OR ((pickup_type)::text = ANY (ARRAY[('repair'::character varying)::text, ('return'::character varying)::text]))))

### `public.support_tickets`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, customer_id
- **Columns (32):** `id` integer NOT NULL; `customer_id` integer NOT NULL; `customer_name` character varying(500); `customer_phone` character varying(80); `status` character varying(40) DEFAULT 'open'::character varying NOT NULL; `created_by` integer; `closed_by` integer; `closed_at` timestamp with time zone; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `last_activity_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `priority` character varying(20) DEFAULT 'normal'::character varying NOT NULL; `top_level_remarks` text; `ticket_phone_override` character varying(80); `ticket_alt_phone` character varying(80); `ticket_email` character varying(320); `ticket_address` text; `created_by_name` character varying(300); `ticket_category` character varying(20) DEFAULT 'complaint'::character varying; `return_dc_number` character varying(50); `complaint_type` character varying(50); `serial_number` character varying(120); `unique_number` character varying(120); `delivery_person_id` integer; `assigned_parts` jsonb DEFAULT '[]'::jsonb NOT NULL; `replaced_parts` jsonb DEFAULT '[]'::jsonb NOT NULL; `ttspl_id` character varying(50); `dc_number` character varying(50); `sales_order_number` character varying(50); `customer_portal_ticket` boolean DEFAULT false

### `public.teams`

- **Rows in backup:** 22
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** team_id, team_name
- **Columns (4):** `team_id` integer NOT NULL; `team_name` character varying(100) NOT NULL; `manager_id` integer; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.ticket_checklist_progress`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, checklist_data
- **Columns (6):** `id` integer NOT NULL; `ticket_id` integer; `stage_id` integer; `checklist_data` jsonb NOT NULL; `completed_by` integer; `completed_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.ticket_part_blocks`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** block_id, ticket_id, request_id
- **Columns (6):** `block_id` integer NOT NULL; `ticket_id` integer NOT NULL; `request_id` integer NOT NULL; `blocked_at` timestamp with time zone DEFAULT now(); `unblocked_at` timestamp with time zone; `is_active` boolean DEFAULT true

### `public.ticket_parts`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, quantity_used
- **Columns (8):** `id` integer NOT NULL; `ticket_id` integer; `part_id` integer; `quantity_used` integer NOT NULL; `notes` text; `added_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `unit_cost` numeric(10,2) DEFAULT 0; `is_upgrade` boolean DEFAULT false

### `public.ticket_services`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** service_id, service_type
- **Columns (6):** `service_id` integer NOT NULL; `ticket_id` integer; `service_type` character varying(255) NOT NULL; `cost` numeric(10,2) DEFAULT 0 NOT NULL; `added_by` integer; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

### `public.tickets`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** ticket_id, serial_number
- **Columns (40):** `ticket_id` integer NOT NULL; `serial_number` character varying(100) NOT NULL; `ttspl_id` character varying(100); `machine_number` character varying(100); `brand` character varying(50); `model` character varying(100); `processor` character varying(100); `ram` character varying(50); `storage` character varying(50); `status` character varying(50) DEFAULT 'in_progress'::character varying; `priority` character varying(20) DEFAULT 'normal'::character varying; `current_stage_id` integer; `assigned_team_id` integer; `assigned_user_id` integer; `initial_condition` text; `final_grade` character varying(10); `initial_cost` numeric(10,2) DEFAULT 0; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `completed_at` timestamp with time zone; `vendor_serial_id` integer; `ticket_type` character varying(50) DEFAULT 'grn_qc'::character varying; `qc_fail_count` integer DEFAULT 0; `qc1_failed_at` timestamp with time zone; `qc2_failed_at` timestamp with time zone; `qc1_fail_reason` text; `qc2_fail_reason` text; `qc1_passed_at` timestamp with time zone; `qc2_passed_at` timestamp with time zone; `body_paint_required` boolean DEFAULT false
- **Constraints:** CONSTRAINT tickets_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('normal'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))); CONSTRAINT tickets_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('on_hold'::character varying)::text, ('qc_failed_return_vendor'::character varying)::text, ('cancelled'::character varying)::text]))); CONSTRAINT tickets_ticket_type_check CHECK (((ticket_type)::text = ANY (ARRAY[('grn_qc'::character varying)::text, ('sales_order_qc'::character varying)::text, ('return_qc'::character varying)::text, ('support'::character varying)::text, ('general'::character varying)::text])))

### `public.ttspl_audit_log`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** log_id, ttspl_id, event_type, description
- **Columns (9):** `log_id` integer NOT NULL; `ttspl_id` character varying(50) NOT NULL; `vendor_serial_id` integer; `event_type` character varying(80) NOT NULL; `description` text NOT NULL; `metadata` jsonb DEFAULT '{}'::jsonb; `actor_user_id` integer; `actor_name` character varying(255); `created_at` timestamp with time zone DEFAULT now()

### `public.ttspl_config_history`

- **Rows in backup:** 13
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** history_id, ttspl_id, change_type, field_name
- **Columns (13):** `history_id` integer NOT NULL; `ttspl_id` character varying(50) NOT NULL; `vendor_serial_id` integer; `ticket_id` integer; `changed_by` integer; `change_type` character varying(50) NOT NULL; `field_name` character varying(50) NOT NULL; `old_value` text; `new_value` text; `notes` text; `part_used_id` integer; `part_cost` numeric(10,2) DEFAULT 0; `created_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT ttspl_config_history_change_type_check CHECK (((change_type)::text = ANY (ARRAY[('upgrade'::character varying)::text, ('replacement'::character varying)::text, ('correction'::character varying)::text, ('initial'::character varying)::text])))

### `public.user_permissions`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, user_id, section
- **Columns (9):** `id` integer NOT NULL; `user_id` integer NOT NULL; `section` character varying(100) NOT NULL; `can_view` boolean; `can_create` boolean; `can_edit` boolean; `can_delete` boolean; `granted_by` integer; `granted_at` timestamp without time zone DEFAULT now()

### `public.user_teams`

- **Rows in backup:** 5
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** user_id, team_id
- **Columns (2):** `user_id` integer NOT NULL; `team_id` integer NOT NULL

### `public.users`

- **Rows in backup:** 17
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** user_id, name, email, password_hash, role
- **Columns (30):** `user_id` integer NOT NULL; `name` character varying(100) NOT NULL; `email` character varying(100) NOT NULL; `password_hash` character varying(255) NOT NULL; `role` character varying(50) NOT NULL; `team_id` integer; `active` boolean DEFAULT true; `barcode` character varying(100); `permissions` text[] DEFAULT '{}'::text[]; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `updated_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `status` character varying(20) DEFAULT 'active'::character varying; `user_type` character varying(20) DEFAULT 'internal'::character varying; `approved_by` integer; `approved_at` timestamp without time zone; `rejection_reason` text; `company_name` character varying(255); `gst_number` character varying(50); `mobile_no` character varying(50); `last_login` timestamp with time zone; `last_login_ip` character varying(50); `deactivated_at` timestamp with time zone; `deactivated_by` integer; `deactivation_reason` text; `profile_photo_url` text; `designation` character varying(100); `department` character varying(100); `employee_id` character varying(50); `joining_date` date; `notes` text
- **Constraints:** CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'manager'::character varying, 'team_member'::character varying, 'team_lead'::character varying, 'sales'::character varying, 'floor_manager'::character varying, 'procurement'::character varying, 'qc'::character varying, 'dispatch'::character varying, 'warehouse'::character varying, 'accounts'::character varying, 'support_lead'::character varying, 'support_tech'::character varying, 'dispatch_qc'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[]))); CONSTRAINT users_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('pending_approval'::character varying)::text, ('rejected'::character varying)::text, ('blocked'::character varying)::text, ('inactive'::character varying)::text]))); CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY (ARRAY[('internal'::character varying)::text, ('customer'::character varying)::text, ('vendor'::character varying)::text, ('technician'::character varying)::text])))

### `public.vendor_audit_logs`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** log_id, entity_type, action
- **Columns (8):** `log_id` integer NOT NULL; `actor_user_id` integer; `vendor_id` integer; `entity_type` character varying(64) NOT NULL; `entity_id` character varying(64); `action` character varying(64) NOT NULL; `payload` jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_billing`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** billing_id, billing_month, billing_year
- **Columns (13):** `billing_id` integer NOT NULL; `vendor_id` integer; `billing_month` integer NOT NULL; `billing_year` integer NOT NULL; `status` character varying(32) DEFAULT 'pending'::character varying NOT NULL; `assigned_to_user_id` integer; `totals` jsonb DEFAULT '{}'::jsonb; `detail` jsonb DEFAULT '[]'::jsonb; `file_path` text; `notes` text; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone
- **Constraints:** CONSTRAINT vendor_billing_billing_month_check CHECK (((billing_month >= 1) AND (billing_month <= 12)))

### `public.vendor_debit_notes`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** debit_note_id, debit_note_number, vendor_id, reason
- **Columns (19):** `debit_note_id` integer NOT NULL; `debit_note_number` character varying(50) NOT NULL; `vendor_id` integer NOT NULL; `po_id` integer; `reason` character varying(255) NOT NULL; `description` text; `amount` numeric(12,2) DEFAULT 0 NOT NULL; `quantity` integer DEFAULT 0; `unit_rate` numeric(12,2) DEFAULT 0; `ttspl_ids` jsonb DEFAULT '[]'::jsonb; `status` character varying(20) DEFAULT 'pending'::character varying; `adjusted_in_bill_id` integer; `created_by` integer; `approved_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now(); `serial_id` integer; `return_ticket_id` integer; `support_ticket_id` integer
- **Constraints:** CONSTRAINT vendor_debit_notes_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('adjusted'::character varying)::text, ('cancelled'::character varying)::text])))

### `public.vendor_goods_received_notes`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** grn_id
- **Columns (10):** `grn_id` integer NOT NULL; `po_id` integer; `meta` jsonb DEFAULT '{}'::jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone; `spo_id` integer; `bill_status` character varying(20) DEFAULT 'pending'::character varying; `bill_files` jsonb DEFAULT '[]'::jsonb NOT NULL; `bill_name` character varying(255)
- **Constraints:** CONSTRAINT vendor_goods_received_notes_bill_status_check CHECK (((bill_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('received'::character varying)::text]))); CONSTRAINT vendor_grn_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))

### `public.vendor_inventory_asset_sequence`

- **Rows in backup:** 1
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** none parsed
- **Columns (2):** `id` smallint DEFAULT 1 NOT NULL; `next_num` integer DEFAULT 1 NOT NULL
- **Constraints:** CONSTRAINT vendor_inventory_asset_sequence_id_check CHECK ((id = 1))

### `public.vendor_monthly_bills`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** bill_id, bill_number, vendor_id, bill_month, bill_year, bill_date, from_date, to_date
- **Columns (21):** `bill_id` integer NOT NULL; `bill_number` character varying(50) NOT NULL; `vendor_id` integer NOT NULL; `bill_month` integer NOT NULL; `bill_year` integer NOT NULL; `bill_date` date NOT NULL; `from_date` date NOT NULL; `to_date` date NOT NULL; `line_items` jsonb DEFAULT '[]'::jsonb NOT NULL; `subtotal` numeric(12,2) DEFAULT 0; `gst_amount` numeric(12,2) DEFAULT 0; `debit_note_adjustment` numeric(12,2) DEFAULT 0; `total_payable` numeric(12,2) DEFAULT 0; `status` character varying(20) DEFAULT 'generated'::character varying; `payment_date` date; `payment_reference` character varying(100); `notes` text; `generated_by` integer; `approved_by` integer; `created_at` timestamp with time zone DEFAULT now(); `updated_at` timestamp with time zone DEFAULT now()
- **Constraints:** CONSTRAINT vendor_monthly_bills_status_check CHECK (((status)::text = ANY (ARRAY[('generated'::character varying)::text, ('approved'::character varying)::text, ('paid'::character varying)::text, ('disputed'::character varying)::text])))

### `public.vendor_portal_sessions`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** session_id, vendor_id, token, expires_at
- **Columns (5):** `session_id` integer NOT NULL; `vendor_id` integer NOT NULL; `token` text NOT NULL; `expires_at` timestamp with time zone NOT NULL; `created_at` timestamp with time zone DEFAULT now()

### `public.vendor_product_details`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** product_detail_id
- **Columns (24):** `product_detail_id` integer NOT NULL; `po_id` integer; `category` character varying(128); `brand` character varying(255); `model` character varying(255); `processor` character varying(255); `generation` character varying(128); `ram` character varying(64); `storage` character varying(128); `gpu` character varying(128); `screen_size` character varying(64); `quantity` integer DEFAULT 1 NOT NULL; `rate` numeric(18,2) DEFAULT 0 NOT NULL; `remarks` text; `total_amount` numeric(18,2); `vendor_locking_period` integer; `warranty` integer; `parts` integer; `status` character varying(64); `random_id` character varying(64); `old_product_id` integer; `old_product_details` jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_product_inventory`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, serial_id, serial_number
- **Columns (9):** `id` integer NOT NULL; `product_id` integer; `serial_id` integer NOT NULL; `serial_number` character varying(255) NOT NULL; `unique_product_serial` character varying(255); `product_model_name` character varying(255); `status` character varying(64) DEFAULT 'in_stock'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_purchase_orders`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** po_id, purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state
- **Columns (33):** `po_id` integer NOT NULL; `purchase_order_number` character varying(64) NOT NULL; `purchase_order_date` date NOT NULL; `purchase_order_type` character varying(64) NOT NULL; `vendor_id` integer NOT NULL; `po_state` character varying(128) NOT NULL; `is_same_state` boolean DEFAULT false NOT NULL; `sub_total_amount` numeric(18,2) DEFAULT 0 NOT NULL; `total_amount` numeric(18,2) DEFAULT 0 NOT NULL; `line_items` jsonb DEFAULT '[]'::jsonb NOT NULL; `assets_details` jsonb; `product_details_legacy_ids` jsonb; `remarks` text; `public_token` uuid DEFAULT gen_random_uuid() NOT NULL; `status` character varying(64) DEFAULT 'draft'::character varying NOT NULL; `invoice_created` boolean DEFAULT false NOT NULL; `invoice_path` text; `rental_period` character varying(128); `status_updated_by_admin_id` integer; `status_updated_by_name` character varying(255); `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone; `bill_name` character varying(255); `bill_files` jsonb DEFAULT '[]'::jsonb NOT NULL; `expected_delivery_date` date; `rejection_reason` text; `submitted_at` timestamp with time zone; `approved_at` timestamp with time zone; `sent_to_vendor_at` timestamp with time zone

### `public.vendor_refresh_tokens`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** id, vendor_id, token_hash, expires_at
- **Columns (5):** `id` integer NOT NULL; `vendor_id` integer NOT NULL; `token_hash` text NOT NULL; `expires_at` timestamp with time zone NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_replaced_products`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** replaced_id
- **Columns (8):** `replaced_id` integer NOT NULL; `vendor_id` integer; `po_id` integer; `payload` jsonb DEFAULT '{}'::jsonb NOT NULL; `status` character varying(64) DEFAULT 'open'::character varying NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone

### `public.vendor_serial_number_audit`

- **Rows in backup:** 0
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** audit_id, po_id, grn_id, old_serial, new_serial
- **Columns (7):** `audit_id` integer NOT NULL; `po_id` integer NOT NULL; `grn_id` integer NOT NULL; `old_serial` character varying(255) NOT NULL; `new_serial` character varying(255) NOT NULL; `changed_by_user_id` integer; `created_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_serial_numbers`

- **Rows in backup:** 8
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** serial_id, grn_id, serial_number
- **Columns (26):** `serial_id` integer NOT NULL; `po_id` integer; `grn_id` integer NOT NULL; `serial_number` character varying(255) NOT NULL; `extra` jsonb DEFAULT '{}'::jsonb; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone; `spo_id` integer; `inventory_asset_code` character varying(32); `rental_start_date` date; `qc_status` character varying(64); `inventory_status` character varying(64); `remark` text; `current_customer_id` integer; `current_dc_number` character varying(50); `current_entity` character varying(20); `dispatch_mode` character varying(20); `dispatched_at` timestamp with time zone; `delivered_at` timestamp with time zone; `returned_at` timestamp with time zone; `rent_start_date` date; `rent_end_date` date; `rent_monthly_rate` numeric(12,2); `status_changed_at` timestamp with time zone; `rent_billed_until` date
- **Constraints:** CONSTRAINT vendor_serial_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))

### `public.vendor_shops`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** shop_id, vendor_id, name
- **Columns (10):** `shop_id` integer NOT NULL; `vendor_id` integer NOT NULL; `name` character varying(255) NOT NULL; `address` text; `contact` character varying(32); `image_url` text; `banner_url` text; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone

### `public.vendor_spare_parts_catalog`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** part_id, name
- **Columns (5):** `part_id` integer NOT NULL; `name` character varying(255) NOT NULL; `active` boolean DEFAULT true NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendor_spare_parts_purchase_orders`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** spo_id, purchase_order_number, purchase_order_date, vendor_id, po_state
- **Columns (20):** `spo_id` integer NOT NULL; `purchase_order_number` character varying(64) NOT NULL; `purchase_order_date` date NOT NULL; `vendor_id` integer NOT NULL; `po_state` character varying(128) NOT NULL; `is_same_state` boolean DEFAULT false NOT NULL; `sub_total_amount` numeric(18,2) DEFAULT 0 NOT NULL; `total_amount` numeric(18,2) DEFAULT 0 NOT NULL; `line_items` jsonb DEFAULT '[]'::jsonb NOT NULL; `assets_details` jsonb; `remarks` text; `public_token` uuid DEFAULT gen_random_uuid() NOT NULL; `status` character varying(64) DEFAULT 'draft'::character varying NOT NULL; `status_updated_by_admin_id` integer; `status_updated_by_name` character varying(255); `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone; `bill_name` character varying(255); `bill_files` jsonb DEFAULT '[]'::jsonb NOT NULL

### `public.vendor_wallets`

- **Rows in backup:** 8
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** wallet_id, vendor_id
- **Columns (10):** `wallet_id` integer NOT NULL; `vendor_id` integer NOT NULL; `withdrawn` numeric(18,2) DEFAULT 0 NOT NULL; `commission_given` numeric(18,2) DEFAULT 0 NOT NULL; `total_earning` numeric(18,2) DEFAULT 0 NOT NULL; `pending_withdraw` numeric(18,2) DEFAULT 0 NOT NULL; `delivery_charge_earned` numeric(18,2) DEFAULT 0 NOT NULL; `collected_cash` numeric(18,2) DEFAULT 0 NOT NULL; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL

### `public.vendors`

- **Rows in backup:** 0
- **Soft delete:** Yes
- **Required columns (NOT NULL, no default):** vendor_id, first_name, business_name, email, phone, password_hash, address, business_type, registration_date, state, bank_name, account_number, bank_ifsc_code, account_holder_name
- **Columns (40):** `vendor_id` integer NOT NULL; `status` character varying(32) DEFAULT 'approved'::character varying NOT NULL; `first_name` character varying(255) NOT NULL; `last_name` character varying(255); `business_name` character varying(255) NOT NULL; `email` character varying(255) NOT NULL; `phone` character varying(32) NOT NULL; `password_hash` text NOT NULL; `address` text NOT NULL; `business_type` character varying(255) NOT NULL; `registration_date` date NOT NULL; `state` character varying(128) NOT NULL; `gst_number` character varying(64); `brand_code` character varying(64); `business_registration_number` character varying(128); `tax_identification_number` character varying(128); `bank_name` character varying(255) NOT NULL; `account_number` character varying(64) NOT NULL; `bank_ifsc_code` character varying(32) NOT NULL; `account_holder_name` character varying(255) NOT NULL; `image_url` text; `licenses_url` text; `remember_pass_plain` text; `created_at` timestamp with time zone DEFAULT now() NOT NULL; `updated_at` timestamp with time zone DEFAULT now() NOT NULL; `deleted_at` timestamp with time zone; `vendor_portal_password_hash` text; `vendor_portal_last_login` timestamp with time zone; `vendor_portal_enabled` boolean DEFAULT true NOT NULL; `po_payment_terms` character varying(50) DEFAULT 'postpaid_monthly'::character varying

### `public.work_logs`

- **Rows in backup:** 75
- **Soft delete:** No
- **Required columns (NOT NULL, no default):** log_id
- **Columns (8):** `log_id` integer NOT NULL; `ticket_id` integer; `user_id` integer; `stage_id` integer; `start_time` timestamp with time zone DEFAULT CURRENT_TIMESTAMP; `end_time` timestamp with time zone; `notes` text; `created_at` timestamp with time zone DEFAULT CURRENT_TIMESTAMP

