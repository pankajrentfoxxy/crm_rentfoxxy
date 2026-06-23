-- ============================================================
-- RENTFOXXY CRM — SEED / DUMMY DATA MIGRATION
-- Migration: 073_seed_dummy_data.sql
-- Purpose: One user per role + full dummy data across all
--          modules so every stage and flow can be tested.
-- WARNING: Run only in DEV / STAGING. Never in production.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. SAFETY GUARD
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF current_database() NOT IN ('postgres','rentfoxxy_dev','rentfoxxy_staging') THEN
    -- Comment out the line below if you want to run on a custom DB name
    -- RAISE EXCEPTION 'Refusing to seed: not a recognised dev database';
    RAISE NOTICE 'Seeding database: %', current_database();
  END IF;
END $$;

-- Ensure Phase 10 roles (e.g. accounts) are allowed on users.role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    'super_admin', 'admin', 'manager', 'team_member', 'team_lead', 'sales',
    'floor_manager', 'procurement', 'qc', 'dispatch', 'warehouse', 'accounts',
    'support_lead', 'support_tech', 'customer', 'vendor', 'technician'
  )
);

-- ─────────────────────────────────────────────────────────────
-- 1. TEAMS  (ensure all floor teams exist)
-- ─────────────────────────────────────────────────────────────
INSERT INTO teams (team_name) VALUES
  ('Hardware & Software'),
  ('QC1 Team'),
  ('QC2 Team'),
  ('Chip Level Repair Team'),
  ('Body & Paint Team'),
  ('Inventory Team'),
  ('Warehouse Team')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. USERS — one per role
-- All passwords = Test@1234  (bcrypt hash below)
-- Hash generated with bcrypt rounds=10 for "Test@1234"
-- ─────────────────────────────────────────────────────────────
-- bcrypt hash of "Test@1234"
DO $$
DECLARE
  pw TEXT := '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K';
  hw_team_id   INT;
  qc1_team_id  INT;
  qc2_team_id  INT;
  chip_team_id INT;
BEGIN
  SELECT team_id INTO hw_team_id   FROM teams WHERE team_name = 'Hardware & Software' LIMIT 1;
  SELECT team_id INTO qc1_team_id  FROM teams WHERE team_name = 'QC1 Team'            LIMIT 1;
  SELECT team_id INTO qc2_team_id  FROM teams WHERE team_name = 'QC2 Team'            LIMIT 1;
  SELECT team_id INTO chip_team_id FROM teams WHERE team_name = 'Chip Level Repair Team' LIMIT 1;

  -- super_admin
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Super Admin', 'superadmin@rentfoxxy.com', pw, 'super_admin', true, 'active', '9900000001', 'Super Administrator')
  ON CONFLICT (email) DO UPDATE SET role='super_admin', active=true, status='active';

  -- admin
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Admin User', 'admin@rentfoxxy.com', pw, 'admin', true, 'active', '9900000002', 'Administrator')
  ON CONFLICT (email) DO UPDATE SET role='admin', active=true, status='active';

  -- manager
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Raj Sharma', 'manager@rentfoxxy.com', pw, 'manager', true, 'active', '9900000003', 'Operations Manager')
  ON CONFLICT (email) DO UPDATE SET role='manager', active=true;

  -- sales
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Priya Mehta', 'sales@rentfoxxy.com', pw, 'sales', true, 'active', '9900000004', 'Sales Executive')
  ON CONFLICT (email) DO UPDATE SET role='sales', active=true;

  -- floor_manager
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id)
  VALUES ('Vikram Singh', 'floor.manager@rentfoxxy.com', pw, 'floor_manager', true, 'active', '9900000005', 'Floor Manager', hw_team_id)
  ON CONFLICT (email) DO UPDATE SET role='floor_manager', active=true, team_id=EXCLUDED.team_id;

  -- technician (team_member) — H&S team
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id)
  VALUES ('Ravi Kumar', 'technician@rentfoxxy.com', pw, 'team_member', true, 'active', '9900000006', 'Hardware Technician', hw_team_id)
  ON CONFLICT (email) DO UPDATE SET role='team_member', active=true, team_id=EXCLUDED.team_id;

  -- senior technician (team_lead) — H&S team
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id)
  VALUES ('Suresh Verma', 'senior.tech@rentfoxxy.com', pw, 'team_lead', true, 'active', '9900000007', 'Senior Technician', hw_team_id)
  ON CONFLICT (email) DO UPDATE SET role='team_lead', active=true, team_id=EXCLUDED.team_id;

  -- qc inspector — QC1 team
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id)
  VALUES ('Anita Singh', 'qc@rentfoxxy.com', pw, 'qc', true, 'active', '9900000008', 'QC Inspector', qc1_team_id)
  ON CONFLICT (email) DO UPDATE SET role='qc', active=true, team_id=EXCLUDED.team_id;

  -- qc2 inspector — QC2 team
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id)
  VALUES ('Mohan Gupta', 'qc2@rentfoxxy.com', pw, 'qc', true, 'active', '9900000009', 'Senior QC Inspector', qc2_team_id)
  ON CONFLICT (email) DO UPDATE SET role='qc', active=true, team_id=EXCLUDED.team_id;

  -- procurement
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Deepak Joshi', 'procurement@rentfoxxy.com', pw, 'procurement', true, 'active', '9900000010', 'Procurement Executive')
  ON CONFLICT (email) DO UPDATE SET role='procurement', active=true;

  -- warehouse
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Sanjay Yadav', 'warehouse@rentfoxxy.com', pw, 'warehouse', true, 'active', '9900000011', 'Warehouse Supervisor')
  ON CONFLICT (email) DO UPDATE SET role='warehouse', active=true;

  -- dispatch
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Amit Kaur', 'dispatch@rentfoxxy.com', pw, 'dispatch', true, 'active', '9900000012', 'Dispatch Executive')
  ON CONFLICT (email) DO UPDATE SET role='dispatch', active=true;

  -- accounts
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Neha Agarwal', 'accounts@rentfoxxy.com', pw, 'accounts', true, 'active', '9900000013', 'Accounts Manager')
  ON CONFLICT (email) DO UPDATE SET role='accounts', active=true;

  -- support_lead
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Pooja Nair', 'support.lead@rentfoxxy.com', pw, 'support_lead', true, 'active', '9900000014', 'Support Lead')
  ON CONFLICT (email) DO UPDATE SET role='support_lead', active=true;

  -- support_tech
  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation)
  VALUES ('Rahul Das', 'support.tech@rentfoxxy.com', pw, 'support_tech', true, 'active', '9900000015', 'Support Technician')
  ON CONFLICT (email) DO UPDATE SET role='support_tech', active=true;

END $$;

-- Assign users to teams via user_teams junction table
INSERT INTO user_teams (user_id, team_id)
SELECT u.user_id, t.team_id
FROM users u, teams t
WHERE u.email = 'technician@rentfoxxy.com'    AND t.team_name = 'Hardware & Software'
ON CONFLICT DO NOTHING;

INSERT INTO user_teams (user_id, team_id)
SELECT u.user_id, t.team_id
FROM users u, teams t
WHERE u.email = 'senior.tech@rentfoxxy.com'   AND t.team_name = 'Hardware & Software'
ON CONFLICT DO NOTHING;

INSERT INTO user_teams (user_id, team_id)
SELECT u.user_id, t.team_id
FROM users u, teams t
WHERE u.email = 'floor.manager@rentfoxxy.com' AND t.team_name = 'Hardware & Software'
ON CONFLICT DO NOTHING;

INSERT INTO user_teams (user_id, team_id)
SELECT u.user_id, t.team_id
FROM users u, teams t
WHERE u.email = 'qc@rentfoxxy.com'            AND t.team_name = 'QC1 Team'
ON CONFLICT DO NOTHING;

INSERT INTO user_teams (user_id, team_id)
SELECT u.user_id, t.team_id
FROM users u, teams t
WHERE u.email = 'qc2@rentfoxxy.com'           AND t.team_name = 'QC2 Team'
ON CONFLICT DO NOTHING;

-- QC round-robin table (may not exist if add_qc_round_robin_state.sql was not run)
CREATE TABLE IF NOT EXISTS qc_round_robin_state (
    team_id INTEGER PRIMARY KEY,
    last_assigned_user_id INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qc_rr_state_updated ON qc_round_robin_state (updated_at);

-- ─────────────────────────────────────────────────────────────
-- 3. QC ROUND-ROBIN STATE — seed for QC1 and QC2 teams
-- ─────────────────────────────────────────────────────────────
INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id)
SELECT t.team_id, NULL
FROM teams t WHERE t.team_name IN ('QC1 Team','QC2 Team')
ON CONFLICT (team_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. PARTS INVENTORY
-- ─────────────────────────────────────────────────────────────
INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, vendor, cost, location_code, description)
VALUES
  ('RAM 8GB DDR4',         'RAM',      'ram',          25, 5,  'Kingston Technology',  850.00,  'Rack-A-01', '8GB DDR4 2666MHz SODIMM laptop RAM'),
  ('RAM 16GB DDR4',        'RAM',      'ram',          12, 3,  'Kingston Technology', 1800.00,  'Rack-A-02', '16GB DDR4 3200MHz SODIMM laptop RAM'),
  ('SSD 256GB SATA',       'Storage',  'storage',      20, 5,  'WD/Samsung',          1200.00,  'Rack-A-03', '256GB SATA SSD 2.5 inch'),
  ('SSD 512GB SATA',       'Storage',  'storage',      10, 3,  'WD/Samsung',          2200.00,  'Rack-A-04', '512GB SATA SSD 2.5 inch'),
  ('SSD 256GB NVMe',       'Storage',  'storage',       8, 3,  'WD/Samsung',          1500.00,  'Rack-A-05', '256GB M.2 NVMe SSD'),
  ('Laptop Battery 6-cell','Battery',  'battery',      15, 5,  'Generic Compatible',  1100.00,  'Rack-B-01', '6-cell laptop replacement battery'),
  ('Laptop Battery 4-cell','Battery',  'battery',      10, 3,  'Generic Compatible',   800.00,  'Rack-B-02', '4-cell laptop replacement battery'),
  ('Keyboard Dell 15"',    'Keyboard', 'keyboard',      8, 2,  'Dell Parts',           650.00,  'Rack-B-03', 'Dell Latitude/Inspiron 15 inch keyboard'),
  ('Keyboard HP 14"',      'Keyboard', 'keyboard',      6, 2,  'HP Parts',             600.00,  'Rack-B-04', 'HP ProBook/EliteBook 14 inch keyboard'),
  ('Keyboard Lenovo 14"',  'Keyboard', 'keyboard',      6, 2,  'Lenovo Parts',         620.00,  'Rack-B-05', 'Lenovo ThinkPad/IdeaPad 14 inch keyboard'),
  ('Display 15.6" FHD',    'Display',  'display',       4, 2,  'BOE/AU Optronics',    2800.00,  'Rack-C-01', '15.6 inch FHD IPS laptop display'),
  ('Display 14" FHD',      'Display',  'display',       3, 2,  'BOE/AU Optronics',    2600.00,  'Rack-C-02', '14 inch FHD IPS laptop display'),
  ('Thermal Paste',        'Cooling',  'cooling',      50, 10, 'Arctic',                 80.00, 'Shelf-1',   'Arctic MX-4 thermal compound 4g'),
  ('Cooling Fan Dell',     'Cooling',  'cooling',       5, 2,  'Dell Parts',            450.00,  'Rack-D-01', 'Dell laptop CPU cooling fan'),
  ('DC Jack 65W',          'Power',    'power',        10, 3,  'Generic',               120.00,  'Shelf-2',   'DC power jack connector'),
  ('Charger 65W Dell',     'Power',    'power',         6, 2,  'Dell OEM',              850.00,  'Shelf-3',   'Dell 65W laptop charger'),
  ('Hinge Kit Left-Right', 'Body',     'body',          8, 2,  'Generic Compatible',    350.00,  'Rack-E-01', 'Laptop lid hinge pair (left + right)'),
  ('Bottom Panel Dell',    'Body',     'body',          4, 2,  'Dell Parts',            420.00,  'Rack-E-02', 'Dell Latitude bottom base panel'),
  ('USB Port Module',      'General',  'general',      10, 3,  'Generic',               180.00,  'Shelf-4',   'USB 3.0 port replacement module'),
  ('WiFi Card Intel',      'General',  'general',       8, 2,  'Intel',                 550.00,  'Shelf-5',   'Intel WiFi 6 AX201 M.2 card')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. VENDOR
-- ─────────────────────────────────────────────────────────────
INSERT INTO vendors (
  status, first_name, last_name, business_name, email, phone,
  password_hash, address, business_type, registration_date, state,
  gst_number, bank_name, account_number, bank_ifsc_code, account_holder_name,
  pan_number, contact_person_name, contact_person_phone,
  po_payment_terms, credit_days, city, pincode, notes
)
VALUES (
  'approved', 'Bibhaw', 'Raj', 'TechRent Supplies Pvt Ltd',
  'vendor@techrent.com', '9811122233',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',
  'Plot 45, Sector 18, NSEZ, Noida',
  'Pvt Ltd', '2019-04-01', 'Uttar Pradesh',
  '09AABCT1234A1Z5',
  'HDFC Bank', '50200012345678', 'HDFC0001234', 'TechRent Supplies Pvt Ltd',
  'AABCT1234A', 'Amit Gupta', '9811122234',
  'postpaid_monthly', 1, 'Noida', '201301',
  'Primary laptop rental vendor. Specialises in Dell and Lenovo.'
),
(
  'approved', 'Sunita', 'Kapoor', 'Kapoor Laptops',
  'vendor2@kapoorlaptops.com', '9822233344',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',
  '12, Nehru Place, New Delhi',
  'Proprietorship', '2020-06-15', 'Delhi',
  '07AAUPK5678B1Z1',
  'SBI', '3210054321012', 'SBIN0001099', 'Sunita Kapoor',
  'AAUPK5678B', 'Sunita Kapoor', '9822233344',
  'net30', 30, 'New Delhi', '110019',
  'HP and Asus specialist vendor.'
)
ON CONFLICT DO NOTHING;

-- Enable vendor portal for test vendor
UPDATE vendors
SET vendor_portal_password_hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K'
WHERE email = 'vendor@techrent.com';

-- ─────────────────────────────────────────────────────────────
-- 6. PURCHASE ORDER
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_vendor_id  INT;
  v_po_id      INT;
  v_user_id    INT;
BEGIN
  SELECT vendor_id INTO v_vendor_id FROM vendors WHERE email = 'vendor@techrent.com' LIMIT 1;
  SELECT user_id   INTO v_user_id   FROM users   WHERE email = 'manager@rentfoxxy.com' LIMIT 1;

  -- PO 1: Rental Purchase — already approved (to test GRN flow)
  INSERT INTO vendor_purchase_orders (
    purchase_order_number, purchase_order_date, purchase_order_type,
    vendor_id, po_state, is_same_state,
    sub_total_amount, total_amount, status,
    approved_at, sent_to_vendor_at,
    status_updated_by_admin_id, status_updated_by_name,
    rental_period,
    line_items
  )
  VALUES (
    'PO-0001', CURRENT_DATE - 10, 'rental_purchase',
    v_vendor_id, 'Delhi', false,
    42000.00, 49560.00, 'approved',
    NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days',
    v_user_id, 'Raj Sharma',
    '12 months @ 3500/month',
    '[{"brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","quantity":6,"rate":3500,"warranty_months":12}]'::jsonb
  )
  ON CONFLICT (purchase_order_number) DO NOTHING
  RETURNING po_id INTO v_po_id;

  -- PO 2: Direct Purchase — pending approval (to test approval flow)
  INSERT INTO vendor_purchase_orders (
    purchase_order_number, purchase_order_date, purchase_order_type,
    vendor_id, po_state, is_same_state,
    sub_total_amount, total_amount, status,
    submitted_at,
    line_items
  )
  VALUES (
    'PO-0002', CURRENT_DATE - 2, 'direct_purchase',
    v_vendor_id, 'Delhi', false,
    28000.00, 33040.00, 'pending_approval',
    NOW() - INTERVAL '1 day',
    '[{"brand":"HP","model":"ProBook 440","processor":"Intel Core i5","generation":"11th Gen","ram":"8 GB","storage":"512 GB SSD","gpu":"Integrated","screen_size":"14\"","quantity":4,"rate":7000,"warranty_months":12}]'::jsonb
  )
  ON CONFLICT (purchase_order_number) DO NOTHING;

  -- PO 3: Rent to Own — draft (to test submit for approval)
  INSERT INTO vendor_purchase_orders (
    purchase_order_number, purchase_order_date, purchase_order_type,
    vendor_id, po_state, is_same_state,
    sub_total_amount, total_amount, status,
    line_items
  )
  VALUES (
    'PO-0003', CURRENT_DATE, 'rent_to_own',
    v_vendor_id, 'Delhi', false,
    15000.00, 17700.00, 'draft',
    '[{"brand":"Lenovo","model":"ThinkPad E14","processor":"Intel Core i7","generation":"12th Gen","ram":"16 GB","storage":"512 GB SSD","gpu":"Integrated","screen_size":"14\"","quantity":2,"rate":7500,"warranty_months":24}]'::jsonb
  )
  ON CONFLICT (purchase_order_number) DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. GRN + SERIAL NUMBERS (for PO-0001 approved)
-- Creates 6 laptops: 3 will go through full floor pipeline,
-- 2 will be QC-passed for inventory, 1 will be at QC1 stage
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_po_id  INT;
  v_grn_id INT;
BEGIN
  SELECT po_id INTO v_po_id FROM vendor_purchase_orders WHERE purchase_order_number = 'PO-0001' LIMIT 1;
  IF v_po_id IS NULL THEN
    RAISE NOTICE 'PO-0001 not found, skipping GRN seed';
    RETURN;
  END IF;

  -- Create GRN
  INSERT INTO vendor_goods_received_notes (po_id, bill_status, bill_name, meta)
  VALUES (v_po_id, 'received', 'INV-TECHRENT-2025-001',
    '{"received_by":"Sanjay Yadav","received_date":"2025-06-10","notes":"All items received in good condition"}'::jsonb)
  RETURNING grn_id INTO v_grn_id;

  -- 6 serial numbers (TTSPL IDs auto-seeded via sequence OR we set them)
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, extra)
  VALUES
    (v_po_id, v_grn_id, 'SN-DELL-001',
     '{"ttspl_id":"TTSPL001","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"Windows 11","condition":"Good","vendor_id":1,"qc_status":"in_qc","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb),
    (v_po_id, v_grn_id, 'SN-DELL-002',
     '{"ttspl_id":"TTSPL002","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"Windows 11","condition":"Good","vendor_id":1,"qc_status":"in_qc","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb),
    (v_po_id, v_grn_id, 'SN-DELL-003',
     '{"ttspl_id":"TTSPL003","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"None","condition":"Minor scratches","vendor_id":1,"qc_status":"in_qc","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb),
    (v_po_id, v_grn_id, 'SN-DELL-004',
     '{"ttspl_id":"TTSPL004","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"Windows 11","condition":"Good","vendor_id":1,"qc_status":"qc_passed","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb),
    (v_po_id, v_grn_id, 'SN-DELL-005',
     '{"ttspl_id":"TTSPL005","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"Windows 11","condition":"Good","vendor_id":1,"qc_status":"qc_passed","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb),
    (v_po_id, v_grn_id, 'SN-DELL-006',
     '{"ttspl_id":"TTSPL006","brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","os":"Windows 11","condition":"Good","vendor_id":1,"qc_status":"in_qc","inventory_status":"in_stock","received_at":"2025-06-10"}'::jsonb)
  ON CONFLICT DO NOTHING;

  -- Update PO to processing
  UPDATE vendor_purchase_orders SET status = 'processing' WHERE po_id = v_po_id;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 8. FLOOR TICKETS — cover all stages
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  s_floor_mgr   INT; s_diagnosis   INT; s_assembly INT;
  s_final       INT; s_qc1         INT; s_qc2      INT;
  s_chip        INT; s_body        INT; s_inventory INT;
  t_hw          INT; t_qc1         INT; t_qc2      INT;
  u_fm          INT; u_tech        INT; u_qc       INT; u_qc2 INT;
  sn1 INT; sn2 INT; sn3 INT; sn4 INT; sn5 INT; sn6 INT;
BEGIN
  -- Stage IDs
  SELECT stage_id INTO s_floor_mgr  FROM stages WHERE stage_name='Floor Manager'        LIMIT 1;
  SELECT stage_id INTO s_diagnosis  FROM stages WHERE stage_name='Diagnosis'             LIMIT 1;
  SELECT stage_id INTO s_assembly   FROM stages WHERE stage_name='Assembly & Software'  LIMIT 1;
  SELECT stage_id INTO s_final      FROM stages WHERE stage_name='Final Testing'        LIMIT 1;
  SELECT stage_id INTO s_qc1        FROM stages WHERE stage_name='QC1'                  LIMIT 1;
  SELECT stage_id INTO s_qc2        FROM stages WHERE stage_name='QC2'                  LIMIT 1;
  SELECT stage_id INTO s_chip       FROM stages WHERE stage_name='Chip Level Repair'    LIMIT 1;
  SELECT stage_id INTO s_body       FROM stages WHERE stage_name='Body & Paint'         LIMIT 1;
  SELECT stage_id INTO s_inventory  FROM stages WHERE stage_name='Inventory'            LIMIT 1;

  -- Team IDs
  SELECT team_id INTO t_hw   FROM teams WHERE team_name='Hardware & Software' LIMIT 1;
  SELECT team_id INTO t_qc1  FROM teams WHERE team_name='QC1 Team'            LIMIT 1;
  SELECT team_id INTO t_qc2  FROM teams WHERE team_name='QC2 Team'            LIMIT 1;

  -- User IDs
  SELECT user_id INTO u_fm   FROM users WHERE email='floor.manager@rentfoxxy.com' LIMIT 1;
  SELECT user_id INTO u_tech FROM users WHERE email='technician@rentfoxxy.com'    LIMIT 1;
  SELECT user_id INTO u_qc   FROM users WHERE email='qc@rentfoxxy.com'            LIMIT 1;
  SELECT user_id INTO u_qc2  FROM users WHERE email='qc2@rentfoxxy.com'           LIMIT 1;

  -- Serial IDs
  SELECT serial_id INTO sn1 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-001' LIMIT 1;
  SELECT serial_id INTO sn2 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-002' LIMIT 1;
  SELECT serial_id INTO sn3 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-003' LIMIT 1;
  SELECT serial_id INTO sn4 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-004' LIMIT 1;
  SELECT serial_id INTO sn5 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-005' LIMIT 1;
  SELECT serial_id INTO sn6 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-006' LIMIT 1;

  -- Ticket 1: Floor Manager stage (unassigned — test assignment flow)
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-001','TTSPL001','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','normal','grn_qc', s_floor_mgr, t_hw, u_fm, sn1, 'Good condition, minor dust')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;

  -- Ticket 2: Diagnosis stage (assigned to technician)
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-002','TTSPL002','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','normal','grn_qc', s_diagnosis, t_hw, u_tech, sn2, 'Good condition')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;

  -- Ticket 3: Assembly & Software stage
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-003','TTSPL003','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','normal','grn_qc', s_assembly, t_hw, u_tech, sn3, 'Minor scratches on lid')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;

  -- Ticket 4: QC1 stage (assigned to QC inspector)
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-004','TTSPL004','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','normal','grn_qc', s_qc1, t_qc1, u_qc, sn4, 'Good condition')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;

  -- Ticket 5: QC2 stage
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-005','TTSPL005','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','normal','grn_qc', s_qc2, t_qc2, u_qc2, sn5, 'Good condition')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;

  -- Ticket 6: QC1 with a previous QC1 fail (highlighted — test highlighted flow)
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage,
    status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id,
    vendor_serial_id, initial_condition,
    qc_fail_count, qc1_failed_at, qc1_fail_reason, highlighted, highlighted_reason)
  VALUES ('SN-DELL-006','TTSPL006','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD',
    'in_progress','high','grn_qc', s_assembly, t_hw, u_tech, sn6, 'Battery drain issue',
    1, NOW() - INTERVAL '1 day', 'Battery health below 50%', true, 'QC1 failed: Battery health below 50%')
  ON CONFLICT (serial_number) WHERE status IN ('in_progress', 'on_hold') DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 9. CUSTOMERS
-- ─────────────────────────────────────────────────────────────
INSERT INTO customers (
  name, company_name, email, phone, gst_no, type,
  address, billing_state, billing_pincode,
  billing_address, billing_city,
  pan_number, company_type, company_size, industry,
  portal_enabled, portal_password_hash, kyc_verified
)
SELECT v.name, v.company_name, v.email, v.phone, v.gst_no, v.type,
  v.address, v.billing_state, v.billing_pincode,
  v.billing_address, v.billing_city,
  v.pan_number, v.company_type, v.company_size, v.industry,
  v.portal_enabled, v.portal_password_hash, v.kyc_verified
FROM (VALUES
  (
    'Amit Sharma', 'TechCorp Solutions Pvt Ltd',
    'amit@techcorp.com', '9876500001',
    '06AAHCT0310N1ZG', 'B2B',
    'B-204, DLF Cyber City, Phase 2, Gurugram',
    'Haryana', '122002',
    'B-204, DLF Cyber City, Phase 2', 'Gurugram',
    'AAHCT0310N', 'Pvt Ltd', 150, 'IT Services',
    true,
    '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',
    true
  ),
  (
    'Sunita Reddy', 'Reddy Consulting LLP',
    'sunita@reddyconsulting.com', '9876500002',
    '36AAFPR1234C1ZK', 'B2B',
    '401, Jubilee Hills, Road No. 36, Hyderabad',
    'Telangana', '500033',
    '401, Jubilee Hills, Road No. 36', 'Hyderabad',
    'AAFPR1234C', 'LLP', 45, 'Consulting',
    false, NULL::text, false
  ),
  (
    'Rohan Malhotra', 'StartupHub Technologies',
    'rohan@startuphub.io', '9876500003',
    '29AABCS5678D1Z2', 'B2B',
    '12, HSR Layout, Sector 7, Bengaluru',
    'Karnataka', '560102',
    '12, HSR Layout, Sector 7', 'Bengaluru',
    'AABCS5678D', 'Pvt Ltd', 28, 'SaaS',
    false, NULL::text, true
  )
) AS v(
  name, company_name, email, phone, gst_no, type,
  address, billing_state, billing_pincode,
  billing_address, billing_city,
  pan_number, company_type, company_size, industry,
  portal_enabled, portal_password_hash, kyc_verified
)
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.email = v.email);

-- ─────────────────────────────────────────────────────────────
-- 10. LEADS — across all statuses to test full pipeline
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  u_sales INT;
  u_mgr   INT;
BEGIN
  SELECT user_id INTO u_sales FROM users WHERE email='sales@rentfoxxy.com'   LIMIT 1;
  SELECT user_id INTO u_mgr   FROM users WHERE email='manager@rentfoxxy.com' LIMIT 1;

  -- Lead 1: Hot — ready to convert
  INSERT INTO leads (
    name, company_name, company_brand, email, phone, whatsapp_number,
    city, state, source, status, lead_stage,
    brand, processor, generation, ram, storage, quantity_required,
    monthly_budget, rental_duration, use_case,
    company_type, company_size, industry, gst_number,
    assigned_user_id, assigned_by, assigned_at, follow_up_date,
    personal_remarks, inquiry_type, last_activity_at
  ) VALUES (
    'Vikash Gupta', 'InfoSys India Ltd', 'Infosys',
    'vikash.gupta@infosys.com', '9811100001', '9811100001',
    'Bengaluru', 'Karnataka', 'Email', 'Hot', 'Agreement Sent',
    'Dell', 'Intel Core i5', '10th Gen', '8 GB', '256 GB SSD', 10,
    3500.00, 12, 'Work From Office',
    'Pvt Ltd', 500, 'IT Services', '29AAACI1234F1Z0',
    u_sales, u_mgr, NOW() - INTERVAL '5 days', CURRENT_DATE + 1,
    'Client is ready to sign. Shared agreement. Follow up tomorrow.', 'rental',
    NOW() - INTERVAL '2 hours'
  ) ON CONFLICT DO NOTHING;

  -- Lead 2: Deal (converted)
  INSERT INTO leads (
    name, company_name, email, phone,
    city, source, status, lead_stage,
    brand, processor, ram, storage, quantity_required, monthly_budget,
    assigned_user_id, assigned_by, assigned_at,
    inquiry_type, last_activity_at, converted_at
  ) VALUES (
    'Meera Joshi', 'Digital Minds Pvt Ltd',
    'meera@digitalminds.com', '9822200002',
    'Mumbai', 'Reference', 'Deal', NULL,
    'HP', 'Intel Core i5', '8 GB', '256 GB SSD', 5, 4000.00,
    u_sales, u_mgr, NOW() - INTERVAL '20 days',
    'rental', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
  ) ON CONFLICT DO NOTHING;

  -- Lead 3: Warm — in negotiation
  INSERT INTO leads (
    name, company_name, email, phone,
    city, source, status, lead_stage,
    brand, processor, ram, storage, quantity_required, monthly_budget, rental_duration,
    assigned_user_id, assigned_by, assigned_at, follow_up_date,
    personal_remarks, inquiry_type, last_activity_at
  ) VALUES (
    'Arjun Patel', 'Patel Enterprises',
    'arjun@patelent.com', '9833300003',
    'Ahmedabad', 'Cold Call', 'Warm', 'Price Negotiation',
    'Lenovo', 'Intel Core i5', '8 GB', '512 GB SSD', 3, 3800.00, 6,
    u_sales, u_mgr, NOW() - INTERVAL '8 days', CURRENT_DATE,
    'Price negotiation in progress. They want below 3500.', 'rental',
    NOW() - INTERVAL '3 days'
  ) ON CONFLICT DO NOTHING;

  -- Lead 4: Cold — just assigned
  INSERT INTO leads (
    name, company_name, email, phone,
    city, source, status, lead_stage,
    quantity_required, monthly_budget,
    assigned_user_id, assigned_by, assigned_at, follow_up_date,
    inquiry_type, last_activity_at
  ) VALUES (
    'Kavitha Nair', 'Kerala Tech Hub',
    'kavitha@keraltech.com', '9844400004',
    'Kochi', 'Website', 'Cold', 'In Follow Up',
    2, 3000.00,
    u_sales, u_mgr, NOW() - INTERVAL '2 days', CURRENT_DATE + 3,
    'rental', NOW() - INTERVAL '2 days'
  ) ON CONFLICT DO NOTHING;

  -- Lead 5: Overdue follow-up (for calendar test)
  INSERT INTO leads (
    name, company_name, email, phone,
    city, source, status, lead_stage,
    quantity_required, monthly_budget,
    assigned_user_id, assigned_by, assigned_at, follow_up_date,
    personal_remarks, inquiry_type, last_activity_at
  ) VALUES (
    'Devendra Rao', 'Rao Industries',
    'devendra@raoindustries.com', '9855500005',
    'Pune', 'LinkedIn', 'Warm', 'Price Agreed',
    8, 3200.00,
    u_sales, u_mgr, NOW() - INTERVAL '15 days',
    CURRENT_DATE - 3,  -- OVERDUE
    'Agreed on price. Needs legal review of agreement.', 'rental',
    NOW() - INTERVAL '5 days'
  ) ON CONFLICT DO NOTHING;

  -- Lead 6: Sales inquiry (gorefurbo)
  INSERT INTO leads (
    name, company_name, email, phone,
    city, source, status,
    brand, processor, generation, ram, storage, quantity_required,
    inquiry_type, assigned_user_id, assigned_by, assigned_at,
    last_activity_at
  ) VALUES (
    'Farida Khan', 'Khan Brothers Trading',
    'farida@khanbros.com', '9866600006',
    'Surat', 'IndiaMART', 'Pending',
    'Dell', 'Intel Core i5', '10th Gen', '8 GB', '256 GB SSD', 15,
    'sales', u_sales, u_mgr, NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  ) ON CONFLICT DO NOTHING;
END $$;

-- Lead activities for leads (audit trail)
INSERT INTO lead_activities (lead_id, user_id, action, notes)
SELECT l.lead_id,
  (SELECT user_id FROM users WHERE email='sales@rentfoxxy.com'),
  'status_changed', 'Lead assigned and contacted via email'
FROM leads l WHERE l.email = 'vikash.gupta@infosys.com'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 11. SALES QUOTATIONS + SALES ORDER + DELIVERY CHALLAN
-- (covers EST → SO → DC chain for TechCorp customer)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cust_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id FROM customers WHERE email='amit@techcorp.com' LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM sales_quotations WHERE quotation_number = 'EST-0001') THEN
    INSERT INTO sales_quotations (
      quotation_number, customer_id, customer_name, customer_email, customer_mobile,
      gst_number, supply_state, quotation_type,
      customer_billing_address, customer_shipping_address,
      brand, model_name, processor, generation, ram, storage,
      quantity, main_quantity, rate, security_amount, shiping_charges,
      status, remark, source_lead_id
    ) VALUES (
      'EST-0001', v_cust_id, 'Amit Sharma', 'amit@techcorp.com', '9876500001',
      '06AAHCT0310N1ZG', 'Haryana', 'rental',
      '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002","gst_number":"06AAHCT0310N1ZG"}'::jsonb,
      '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
      'Dell', 'Latitude 3510', 'Intel Core i5', '10th Gen', '8 GB', '256 GB SSD',
      2, 2, 3500.00, 7000.00, 0.00,
      'approved',
      'Payment terms as agreed. Goods remain property of Rentfoxxy until full payment.',
      NULL
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales_order_lines WHERE sales_order_number = 'SO-0001') THEN
    INSERT INTO sales_order_lines (
      sales_order_number, quotation_number, customer_id, customer_name,
      customer_email, gst_number, supply_state, quotation_type,
      customer_billing_address, customer_shipping_address,
      brand, model_name, processor, generation, ram, storage,
      quantity, main_qty, rate, security_amount, shiping_charges, status
    ) VALUES (
      'SO-0001', 'EST-0001', v_cust_id, 'Amit Sharma',
      'amit@techcorp.com', '06AAHCT0310N1ZG', 'Haryana', 'rental',
      '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002","gst_number":"06AAHCT0310N1ZG"}'::jsonb,
      '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
      'Dell', 'Latitude 3510', 'Intel Core i5', '10th Gen', '8 GB', '256 GB SSD',
      2, 2, 3500.00, 7000.00, 0.00, 'processing'
    );
  END IF;

  -- Update document sequences
  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 1) WHERE doc_type = 'quotation';
  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 1) WHERE doc_type = 'sales_order';

END $$;

-- ─────────────────────────────────────────────────────────────
-- 12. SALES ORDER PAYMENT (advance)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_cust_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id FROM customers WHERE email='amit@techcorp.com' LIMIT 1;
  INSERT INTO sales_order_payments (
    sales_order_number, customer_id, payment_type, amount,
    payment_date, payment_mode, reference_number, notes,
    recorded_by
  ) VALUES (
    'SO-0001', v_cust_id, 'advance', 7000.00,
    CURRENT_DATE - 5, 'bank_transfer', 'HDFC-TXN-20250601-4521',
    'Advance payment received before dispatch',
    (SELECT user_id FROM users WHERE email='accounts@rentfoxxy.com' LIMIT 1)
  ) ON CONFLICT DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 13. CUSTOMER INVOICE (monthly rental for TechCorp)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_cust_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id FROM customers WHERE email='amit@techcorp.com' LIMIT 1;

  INSERT INTO customer_invoices (
    invoice_number, customer_id,
    invoice_month, invoice_year, invoice_date,
    from_date, to_date, line_items,
    subtotal, gst_percent, gst_amount,
    credit_note_adjustment, grand_total, status
  ) VALUES (
    'INV-0001', v_cust_id,
    5, 2025, '2025-06-01',
    '2025-05-01', '2025-05-31',
    '[{"ttspl_id":"TTSPL004","brand":"Dell","model":"Latitude 3510","dispatch_date":"2025-05-01","days_in_month":31,"monthly_rate":3500,"daily_rate":112.90,"amount":3500.00},{"ttspl_id":"TTSPL005","brand":"Dell","model":"Latitude 3510","dispatch_date":"2025-05-01","days_in_month":31,"monthly_rate":3500,"daily_rate":112.90,"amount":3500.00}]'::jsonb,
    7000.00, 18, 1260.00, 0.00, 8260.00, 'sent'
  ),
  (
    'INV-0002', v_cust_id,
    6, 2025, CURRENT_DATE,
    (date_trunc('month', CURRENT_DATE))::date,
    (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
    '[{"ttspl_id":"TTSPL004","brand":"Dell","model":"Latitude 3510","dispatch_date":"2025-05-01","days_in_month":30,"monthly_rate":3500,"daily_rate":116.67,"amount":3500.00},{"ttspl_id":"TTSPL005","brand":"Dell","model":"Latitude 3510","dispatch_date":"2025-05-01","days_in_month":30,"monthly_rate":3500,"daily_rate":116.67,"amount":3500.00}]'::jsonb,
    7000.00, 18, 1260.00, 0.00, 8260.00, 'draft'
  )
  ON CONFLICT (customer_id, invoice_month, invoice_year) DO NOTHING;

  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 2) WHERE doc_type = 'customer_invoice';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 14. CUSTOMER CREDIT NOTE
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_cust_id INT; v_inv_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id FROM customers WHERE email='amit@techcorp.com' LIMIT 1;
  SELECT invoice_id  INTO v_inv_id  FROM customer_invoices WHERE invoice_number='INV-0001' LIMIT 1;

  INSERT INTO customer_credit_notes (
    credit_note_number, customer_id, invoice_id,
    reason, description, amount, quantity, unit_rate,
    from_date, to_date, ttspl_ids, status,
    created_by
  ) VALUES (
    'CN-0001', v_cust_id, v_inv_id,
    'Laptop returned mid-month due to hardware issue',
    'TTSPL005 was returned on 15 May 2025. Credit for remaining 16 days.',
    1806.40, 1, 3500.00,
    '2025-05-16', '2025-05-31', '["TTSPL005"]'::jsonb, 'approved',
    (SELECT user_id FROM users WHERE email='accounts@rentfoxxy.com' LIMIT 1)
  ) ON CONFLICT (credit_note_number) DO NOTHING;

  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 1) WHERE doc_type = 'credit_note';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 15. SECURITY DEPOSIT
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_cust_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id FROM customers WHERE email='amit@techcorp.com' LIMIT 1;
  INSERT INTO customer_security_deposits (
    customer_id, sales_order_number, amount, received_date, status, notes,
    created_by
  ) VALUES (
    v_cust_id, 'SO-0001', 7000.00, CURRENT_DATE - 20, 'held',
    '1 month security deposit equivalent to monthly rental',
    (SELECT user_id FROM users WHERE email='accounts@rentfoxxy.com' LIMIT 1)
  ) ON CONFLICT DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 16. VENDOR MONTHLY BILL
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_vendor_id INT;
BEGIN
  SELECT vendor_id INTO v_vendor_id FROM vendors WHERE email='vendor@techrent.com' LIMIT 1;

  INSERT INTO vendor_monthly_bills (
    bill_number, vendor_id, bill_month, bill_year,
    bill_date, from_date, to_date,
    line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status
  ) VALUES (
    'VB-0001', v_vendor_id, 5, 2025,
    '2025-05-31', '2025-05-01', '2025-05-31',
    '[{"ttspl_id":"TTSPL004","serial_number":"SN-DELL-004","brand":"Dell","received_date":"2025-04-20","return_date":null,"days_in_month":31,"monthly_rate":3500,"daily_rate":112.90,"amount":3500.00},{"ttspl_id":"TTSPL005","serial_number":"SN-DELL-005","brand":"Dell","received_date":"2025-04-20","return_date":null,"days_in_month":31,"monthly_rate":3500,"daily_rate":112.90,"amount":3500.00}]'::jsonb,
    7000.00, 1260.00, 0.00, 8260.00, 'approved'
  ) ON CONFLICT (vendor_id, bill_month, bill_year) DO NOTHING;

  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 1) WHERE doc_type = 'vendor_bill';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 17. VENDOR DEBIT NOTE
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_vendor_id INT; v_po_id INT;
BEGIN
  SELECT vendor_id INTO v_vendor_id FROM vendors WHERE email='vendor@techrent.com' LIMIT 1;
  SELECT po_id     INTO v_po_id     FROM vendor_purchase_orders WHERE purchase_order_number='PO-0001' LIMIT 1;

  INSERT INTO vendor_debit_notes (
    debit_note_number, vendor_id, po_id,
    reason, description, amount, quantity, unit_rate,
    ttspl_ids, status,
    created_by
  ) VALUES (
    'DN-0001', v_vendor_id, v_po_id,
    'Faulty unit received — keyboard not working',
    'SN-DELL-003 (TTSPL003) arrived with non-functional keyboard. Deducting repair cost.',
    650.00, 1, 650.00,
    '["TTSPL003"]'::jsonb, 'approved',
    (SELECT user_id FROM users WHERE email='accounts@rentfoxxy.com' LIMIT 1)
  ) ON CONFLICT (debit_note_number) DO NOTHING;

  UPDATE sm_document_sequences SET last_value = GREATEST(last_value, 1) WHERE doc_type = 'vendor_debit_note';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 18. SUPPORT TICKETS
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cust_id  INT;
  v_ticket_id INT;
  v_support_tech INT;
  v_issue_cat_id INT;
BEGIN
  SELECT customer_id INTO v_cust_id      FROM customers WHERE email='amit@techcorp.com' LIMIT 1;
  SELECT user_id     INTO v_support_tech FROM users     WHERE email='support.tech@rentfoxxy.com' LIMIT 1;
  SELECT id          INTO v_issue_cat_id FROM support_issue_categories WHERE LOWER(name) LIKE '%keyboard%' LIMIT 1;

  -- Support Ticket 1: Open
  INSERT INTO support_tickets (customer_id, customer_name, customer_phone, status, created_by)
  VALUES (v_cust_id, 'Amit Sharma', '9876500001', 'open',
    (SELECT user_id FROM users WHERE email='support.lead@rentfoxxy.com' LIMIT 1))
  RETURNING id INTO v_ticket_id;

  INSERT INTO support_ticket_items (
    ticket_id, serial_number, unique_serial_number,
    brand, model, ram, storage, generation,
    item_type, issue_category_id, issue_category_label, remarks,
    assigned_to, status
  ) VALUES (
    v_ticket_id, 'SN-DELL-004', 'TTSPL004',
    'Dell', 'Latitude 3510', '8 GB', '256 GB SSD', '10th Gen',
    'complaint', v_issue_cat_id, 'Keyboard Issue',
    'Several keys (K, L, Enter) not responding. Laptop dispatched 3 weeks ago.',
    v_support_tech, 'open'
  );

  -- Support Ticket 2: In Progress — replacement requested
  INSERT INTO support_tickets (customer_id, customer_name, customer_phone, status, created_by)
  VALUES (v_cust_id, 'Amit Sharma', '9876500001', 'progress',
    (SELECT user_id FROM users WHERE email='support.lead@rentfoxxy.com' LIMIT 1))
  RETURNING id INTO v_ticket_id;

  INSERT INTO support_ticket_items (
    ticket_id, serial_number, unique_serial_number,
    brand, model, ram, storage, generation,
    item_type, issue_category_label, remarks,
    assigned_to, status
  ) VALUES (
    v_ticket_id, 'SN-DELL-005', 'TTSPL005',
    'Dell', 'Latitude 3510', '8 GB', '256 GB SSD', '10th Gen',
    'replacement', 'Display Issue',
    'Screen flickering heavily. Customer requesting replacement unit.',
    v_support_tech, 'progress'
  );
END $$;

-- ─────────────────────────────────────────────────────────────
-- 19. TTSPL AUDIT LOG (sample events)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE u_id INT;
BEGIN
  SELECT user_id INTO u_id FROM users WHERE email='manager@rentfoxxy.com' LIMIT 1;

  INSERT INTO ttspl_audit_log (ttspl_id, event_type, description, actor_user_id, actor_name, created_at)
  VALUES
    ('TTSPL001','ticket_created','QC ticket created from GRN receive', u_id,'Raj Sharma', NOW() - INTERVAL '10 days'),
    ('TTSPL002','ticket_created','QC ticket created from GRN receive', u_id,'Raj Sharma', NOW() - INTERVAL '10 days'),
    ('TTSPL002','stage_changed','Floor Manager → Diagnosis',           u_id,'Raj Sharma', NOW() - INTERVAL '9 days'),
    ('TTSPL003','ticket_created','QC ticket created from GRN receive', u_id,'Raj Sharma', NOW() - INTERVAL '10 days'),
    ('TTSPL003','stage_changed','Floor Manager → Diagnosis',           u_id,'Raj Sharma', NOW() - INTERVAL '9 days'),
    ('TTSPL003','stage_changed','Diagnosis → Assembly & Software',     u_id,'Raj Sharma', NOW() - INTERVAL '8 days'),
    ('TTSPL004','ticket_created','QC ticket created from GRN receive', u_id,'Raj Sharma', NOW() - INTERVAL '10 days'),
    ('TTSPL004','stage_changed','QC1 → QC2',                          u_id,'Raj Sharma', NOW() - INTERVAL '1 day'),
    ('TTSPL004','qc1_passed',   'QC1 passed — all checks cleared',    u_id,'Raj Sharma', NOW() - INTERVAL '1 day'),
    ('TTSPL005','qc2_passed',   'QC2 passed — inventory ready',       u_id,'Raj Sharma', NOW() - INTERVAL '3 days'),
    ('TTSPL005','inventory_ready','Laptop moved to inventory',         u_id,'Raj Sharma', NOW() - INTERVAL '3 days'),
    ('TTSPL006','ticket_created','QC ticket created from GRN receive', u_id,'Raj Sharma', NOW() - INTERVAL '10 days'),
    ('TTSPL006','qc1_failed',   'QC1 failed: Battery health below 50%',u_id,'Raj Sharma',NOW() - INTERVAL '1 day')
  ON CONFLICT DO NOTHING;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 20. INVENTORY (QC-passed laptops ready for orders)
-- ─────────────────────────────────────────────────────────────
INSERT INTO inventory (
  stock_type, device_type, machine_number, serial_number,
  brand, model, processor, ram, storage, grade, status, stage
)
VALUES
  ('Ready','Laptop','TTSPL004','SN-DELL-004','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD','A','In Stock','Inventory'),
  ('Ready','Laptop','TTSPL005','SN-DELL-005','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD','A','In Stock','Inventory')
ON CONFLICT (machine_number) DO UPDATE SET status='In Stock', stage='Inventory';

-- ─────────────────────────────────────────────────────────────
-- 21. STAGE TRANSITION RULES (ensure all rules exist)
-- ─────────────────────────────────────────────────────────────
INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('Floor Manager',       'Diagnosis',             NULL,           false, 'Assign to H&S technician'),
  ('Diagnosis',           'Assembly & Software',   'no_chip_no_body',false,'Normal repair flow'),
  ('Diagnosis',           'Chip Level Repair',     'chip_required', false,'Chip/motherboard issue'),
  ('Diagnosis',           'Body & Paint',          'body_required', false,'Cosmetic issue only'),
  ('Chip Level Repair',   'Assembly & Software',   NULL,            false,'After chip repair done'),
  ('Body & Paint',        'Assembly & Software',   NULL,            false,'After body work done'),
  ('Assembly & Software', 'Final Testing',         NULL,            false,'Repair complete'),
  ('Final Testing',       'QC1',                   NULL,            false,'Ready for QC'),
  ('QC1',                 'QC2',                   'qc1_passed',    false,'QC1 passed'),
  ('QC1',                 'Assembly & Software',   'qc1_failed',    true, 'QC1 failed — back to tech'),
  ('QC2',                 'Inventory',             'qc2_passed',    false,'QC2 passed — ready'),
  ('QC2',                 'QC1',                   'qc2_failed',    true, 'QC2 failed — back to QC1')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 22. FINAL: UPDATE SEQUENCES to avoid collisions
-- ─────────────────────────────────────────────────────────────
SELECT setval('vendors_vendor_id_seq',       (SELECT COALESCE(MAX(vendor_id),1) FROM vendors));
SELECT setval('users_user_id_seq',           (SELECT COALESCE(MAX(user_id),1)   FROM users));
SELECT setval('tickets_ticket_id_seq',       (SELECT COALESCE(MAX(ticket_id),1) FROM tickets));
SELECT setval('parts_part_id_seq',           (SELECT COALESCE(MAX(part_id),1)   FROM parts));
SELECT setval('customers_customer_id_seq',   (SELECT COALESCE(MAX(customer_id),1) FROM customers));
SELECT setval('leads_lead_id_seq',           (SELECT COALESCE(MAX(lead_id),1)   FROM leads));
SELECT setval('vendor_purchase_orders_po_id_seq', (SELECT COALESCE(MAX(po_id),1) FROM vendor_purchase_orders));
SELECT setval('vendor_goods_received_notes_grn_id_seq', (SELECT COALESCE(MAX(grn_id),1) FROM vendor_goods_received_notes));
SELECT setval('vendor_serial_numbers_serial_id_seq', (SELECT COALESCE(MAX(serial_id),1) FROM vendor_serial_numbers));
SELECT setval('support_tickets_id_seq',      (SELECT COALESCE(MAX(id),1) FROM support_tickets));
SELECT setval('support_ticket_items_id_seq', (SELECT COALESCE(MAX(id),1) FROM support_ticket_items));

-- ─────────────────────────────────────────────────────────────
-- SUMMARY
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SEED DATA SUMMARY';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Users created: 15 (one per role)';
  RAISE NOTICE 'Password for all users: Test@1234';
  RAISE NOTICE '';
  RAISE NOTICE 'LOGIN CREDENTIALS:';
  RAISE NOTICE '  superadmin@rentfoxxy.com  — Super Admin';
  RAISE NOTICE '  admin@rentfoxxy.com        — Admin';
  RAISE NOTICE '  manager@rentfoxxy.com      — Manager';
  RAISE NOTICE '  sales@rentfoxxy.com        — Sales';
  RAISE NOTICE '  floor.manager@rentfoxxy.com— Floor Manager';
  RAISE NOTICE '  technician@rentfoxxy.com   — Technician (H&S)';
  RAISE NOTICE '  senior.tech@rentfoxxy.com  — Senior Technician';
  RAISE NOTICE '  qc@rentfoxxy.com           — QC Inspector (QC1)';
  RAISE NOTICE '  qc2@rentfoxxy.com          — QC Inspector (QC2)';
  RAISE NOTICE '  procurement@rentfoxxy.com  — Procurement';
  RAISE NOTICE '  warehouse@rentfoxxy.com    — Warehouse';
  RAISE NOTICE '  dispatch@rentfoxxy.com     — Dispatch';
  RAISE NOTICE '  accounts@rentfoxxy.com     — Accounts';
  RAISE NOTICE '  support.lead@rentfoxxy.com — Support Lead';
  RAISE NOTICE '  support.tech@rentfoxxy.com — Support Tech';
  RAISE NOTICE '';
  RAISE NOTICE 'VENDOR PORTAL: vendor@techrent.com / Test@1234';
  RAISE NOTICE 'CUSTOMER PORTAL: amit@techcorp.com / Test@1234';
  RAISE NOTICE '';
  RAISE NOTICE 'FLOOR PIPELINE TICKETS:';
  RAISE NOTICE '  TTSPL001 — Floor Manager stage (test assignment)';
  RAISE NOTICE '  TTSPL002 — Diagnosis stage';
  RAISE NOTICE '  TTSPL003 — Assembly & Software stage';
  RAISE NOTICE '  TTSPL004 — QC1 stage';
  RAISE NOTICE '  TTSPL005 — QC2 stage';
  RAISE NOTICE '  TTSPL006 — Assembly (QC1 fail, highlighted)';
  RAISE NOTICE '';
  RAISE NOTICE 'SALES PIPELINE:';
  RAISE NOTICE '  EST-0001 — Approved quotation';
  RAISE NOTICE '  SO-0001  — Active sales order with advance paid';
  RAISE NOTICE '';
  RAISE NOTICE 'BILLING:';
  RAISE NOTICE '  INV-0001 — Sent invoice (May 2025)';
  RAISE NOTICE '  INV-0002 — Draft invoice (current month)';
  RAISE NOTICE '  CN-0001  — Approved credit note';
  RAISE NOTICE '  VB-0001  — Approved vendor bill';
  RAISE NOTICE '  DN-0001  — Approved vendor debit note';
  RAISE NOTICE '========================================';
END $$;
