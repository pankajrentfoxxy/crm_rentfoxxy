-- ============================================================
-- RENTFOXXY / GOREFURBO CRM — CLEAN + FULL RESEED
-- Migration: 078_clean_and_reseed.sql
-- Purpose: Wipe ALL transactional data (preserving config / RBAC /
--          stages / companies / teams), reset document sequences,
--          then seed comprehensive dummy data across every flow so
--          each process can be verified end-to-end.
-- Aligns with migrations 074-077 (entity, serial state machine,
-- SO-serial allocation, security_type).
-- Run via: node backend/scripts/run-migration-078.js
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. WIPE TRANSACTIONAL TABLES  (preserve config / reference)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  preserve text[] := ARRAY[
    'roles','role_permissions','permission_sections',
    'stages','stage_transition_rules','stage_checklists',
    'support_issue_categories','support_settings',
    'companies','teams','laptop_catalog','lead_auto_assign_config',
    'schema_migrations','sm_document_sequences',
    'vendor_inventory_asset_sequence','vendor_spare_parts_catalog','spare_parts',
    'qc_round_robin_state'
  ];
  tlist text;
BEGIN
  -- break the only config->transactional FK before truncating users
  UPDATE lead_auto_assign_config SET updated_by = NULL, user_ids = '{}';
  UPDATE teams SET manager_id = NULL;

  SELECT string_agg(format('%I', table_name), ', ')
    INTO tlist
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND NOT (table_name = ANY(preserve));

  EXECUTE 'TRUNCATE TABLE ' || tlist || ' RESTART IDENTITY CASCADE';
  RAISE NOTICE 'Wiped transactional tables. Preserved: %', array_to_string(preserve, ', ');
END $$;

-- Reset document sequences to 0 (will bump after seeding)
UPDATE sm_document_sequences SET last_value = 0;
-- Reset TTSPL asset code counter
UPDATE vendor_inventory_asset_sequence SET next_num = 1 WHERE id = 1;

-- ─────────────────────────────────────────────────────────────
-- 1. USERS — one per role (password = Test@1234)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  pw   TEXT := '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K';
  t_hs INT;
  t_q1 INT;
  t_q2 INT;
BEGIN
  SELECT stage.team_id INTO t_hs FROM stages stage WHERE stage.stage_name = 'Diagnosis' LIMIT 1;
  SELECT stage.team_id INTO t_q1 FROM stages stage WHERE stage.stage_name = 'QC1' LIMIT 1;
  SELECT stage.team_id INTO t_q2 FROM stages stage WHERE stage.stage_name = 'QC2' LIMIT 1;

  INSERT INTO users (name, email, password_hash, role, active, status, mobile_no, designation, team_id, user_type) VALUES
    ('Super Admin','superadmin@rentfoxxy.com',pw,'super_admin',true,'active','9900000001','Super Administrator',NULL,'internal'),
    ('Admin User','admin@rentfoxxy.com',pw,'admin',true,'active','9900000002','Administrator',NULL,'internal'),
    ('Raj Sharma','manager@rentfoxxy.com',pw,'manager',true,'active','9900000003','Operations Manager',NULL,'internal'),
    ('Priya Mehta','sales@rentfoxxy.com',pw,'sales',true,'active','9900000004','Sales Executive',NULL,'internal'),
    ('Vikram Singh','floor.manager@rentfoxxy.com',pw,'floor_manager',true,'active','9900000005','Floor Manager',t_hs,'internal'),
    ('Ravi Kumar','technician@rentfoxxy.com',pw,'team_member',true,'active','9900000006','Hardware Technician',t_hs,'internal'),
    ('Suresh Verma','senior.tech@rentfoxxy.com',pw,'team_lead',true,'active','9900000007','Senior Technician',t_hs,'internal'),
    ('Anita Singh','qc@rentfoxxy.com',pw,'qc',true,'active','9900000008','QC Inspector',t_q1,'internal'),
    ('Mohan Gupta','qc2@rentfoxxy.com',pw,'qc',true,'active','9900000009','Senior QC Inspector',t_q2,'internal'),
    ('Deepak Joshi','procurement@rentfoxxy.com',pw,'procurement',true,'active','9900000010','Procurement Executive',NULL,'internal'),
    ('Sanjay Yadav','warehouse@rentfoxxy.com',pw,'warehouse',true,'active','9900000011','Warehouse Supervisor',NULL,'internal'),
    ('Amit Kaur','dispatch@rentfoxxy.com',pw,'dispatch',true,'active','9900000012','Dispatch Executive',NULL,'internal'),
    ('Neha Agarwal','accounts@rentfoxxy.com',pw,'accounts',true,'active','9900000013','Accounts Manager',NULL,'internal'),
    ('Pooja Nair','support.lead@rentfoxxy.com',pw,'support_lead',true,'active','9900000014','Support Lead',NULL,'internal'),
    ('Rahul Das','support.tech@rentfoxxy.com',pw,'support_tech',true,'active','9900000015','Support Technician',NULL,'internal');

  INSERT INTO user_teams (user_id, team_id)
  SELECT u.user_id, u.team_id FROM users u WHERE u.team_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  DELETE FROM qc_round_robin_state;
  INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id)
  VALUES (t_q1, NULL), (t_q2, NULL)
  ON CONFLICT (team_id) DO NOTHING;
END $$;

-- A delivery technician (mirrors dispatch user) for the by-hand delivery bucket
INSERT INTO delivery_technicians (user_id, first_name, last_name, phone, email, is_active, password_hash)
SELECT user_id, 'Amit', 'Kaur', mobile_no, email, true,
       '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K'
FROM users WHERE email='dispatch@rentfoxxy.com';

-- ─────────────────────────────────────────────────────────────
-- 2. PARTS INVENTORY
-- ─────────────────────────────────────────────────────────────
INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, vendor, cost, location_code, description) VALUES
  ('RAM 8GB DDR4','RAM','ram',25,5,'Kingston Technology',850.00,'Rack-A-01','8GB DDR4 2666MHz SODIMM'),
  ('RAM 16GB DDR4','RAM','ram',12,3,'Kingston Technology',1800.00,'Rack-A-02','16GB DDR4 3200MHz SODIMM'),
  ('SSD 256GB SATA','Storage','storage',20,5,'WD/Samsung',1200.00,'Rack-A-03','256GB SATA SSD'),
  ('SSD 512GB SATA','Storage','storage',10,3,'WD/Samsung',2200.00,'Rack-A-04','512GB SATA SSD'),
  ('SSD 256GB NVMe','Storage','storage',8,3,'WD/Samsung',1500.00,'Rack-A-05','256GB M.2 NVMe SSD'),
  ('Laptop Battery 6-cell','Battery','battery',15,5,'Generic Compatible',1100.00,'Rack-B-01','6-cell replacement battery'),
  ('Laptop Battery 4-cell','Battery','battery',10,3,'Generic Compatible',800.00,'Rack-B-02','4-cell replacement battery'),
  ('Keyboard Dell 15"','Keyboard','keyboard',8,2,'Dell Parts',650.00,'Rack-B-03','Dell Latitude/Inspiron 15 keyboard'),
  ('Keyboard HP 14"','Keyboard','keyboard',6,2,'HP Parts',600.00,'Rack-B-04','HP ProBook/EliteBook 14 keyboard'),
  ('Keyboard Lenovo 14"','Keyboard','keyboard',6,2,'Lenovo Parts',620.00,'Rack-B-05','Lenovo ThinkPad/IdeaPad 14 keyboard'),
  ('Display 15.6" FHD','Display','display',4,2,'BOE/AU Optronics',2800.00,'Rack-C-01','15.6 inch FHD IPS display'),
  ('Display 14" FHD','Display','display',3,2,'BOE/AU Optronics',2600.00,'Rack-C-02','14 inch FHD IPS display'),
  ('Thermal Paste','Cooling','cooling',50,10,'Arctic',80.00,'Shelf-1','Arctic MX-4 thermal compound 4g'),
  ('Cooling Fan Dell','Cooling','cooling',5,2,'Dell Parts',450.00,'Rack-D-01','Dell CPU cooling fan'),
  ('DC Jack 65W','Power','power',10,3,'Generic',120.00,'Shelf-2','DC power jack connector'),
  ('Charger 65W Dell','Power','power',6,2,'Dell OEM',850.00,'Shelf-3','Dell 65W charger'),
  ('Hinge Kit Left-Right','Body','body',8,2,'Generic Compatible',350.00,'Rack-E-01','Laptop lid hinge pair'),
  ('Bottom Panel Dell','Body','body',4,2,'Dell Parts',420.00,'Rack-E-02','Dell Latitude base panel'),
  ('USB Port Module','General','general',10,3,'Generic',180.00,'Shelf-4','USB 3.0 port module'),
  ('WiFi Card Intel','General','general',8,2,'Intel',550.00,'Shelf-5','Intel WiFi 6 AX201 M.2 card');

-- ─────────────────────────────────────────────────────────────
-- 3. VENDORS + WALLETS + SHOP
-- ─────────────────────────────────────────────────────────────
INSERT INTO vendors (
  status, first_name, last_name, business_name, email, phone, password_hash,
  address, business_type, registration_date, state, gst_number,
  bank_name, account_number, bank_ifsc_code, account_holder_name, pan_number,
  contact_person_name, contact_person_phone, po_payment_terms, credit_days,
  city, pincode, notes, vendor_portal_password_hash, vendor_portal_enabled
) VALUES
  ('approved','Bibhaw','Raj','TechRent Supplies Pvt Ltd','vendor@techrent.com','9811122233',
   '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',
   'Plot 45, Sector 18, NSEZ, Noida','Pvt Ltd','2019-04-01','Uttar Pradesh','09AABCT1234A1Z5',
   'HDFC Bank','50200012345678','HDFC0001234','TechRent Supplies Pvt Ltd','AABCT1234A',
   'Amit Gupta','9811122234','postpaid_monthly',1,'Noida','201301',
   'Primary laptop rental vendor (Dell & Lenovo).',
   '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',true),
  ('approved','Sunita','Kapoor','Kapoor Laptops','vendor2@kapoorlaptops.com','9822233344',
   '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',
   '12, Nehru Place, New Delhi','Proprietorship','2020-06-15','Delhi','07AAUPK5678B1Z1',
   'SBI','3210054321012','SBIN0001099','Sunita Kapoor','AAUPK5678B',
   'Sunita Kapoor','9822233344','net30',30,'New Delhi','110019',
   'HP and Asus specialist vendor.',NULL,true);

INSERT INTO vendor_wallets (vendor_id, total_earning, withdrawn, pending_withdraw)
SELECT vendor_id, 0, 0, 0 FROM vendors;

INSERT INTO vendor_shops (vendor_id, name, address, contact)
SELECT vendor_id, business_name || ' — Main Shop', address, phone FROM vendors WHERE email='vendor@techrent.com';

-- ─────────────────────────────────────────────────────────────
-- 4. PROCUREMENT: POs + product details + GRN + serial numbers
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v1 INT; v2 INT; u_mgr INT;
  po1 INT; po2 INT; po3 INT; po4 INT;
  grn1 INT; grn4 INT;
  pd_3510 INT; pd_5430 INT; pd_hp INT; pd_lenovo INT;
  s_fm INT; s_diag INT; s_qc1 INT;
  t_hs INT; t_q1 INT;
  u_fm INT; u_tech INT; u_qc INT;
  sid INT;
BEGIN
  SELECT vendor_id INTO v1 FROM vendors WHERE email='vendor@techrent.com';
  SELECT vendor_id INTO v2 FROM vendors WHERE email='vendor2@kapoorlaptops.com';
  SELECT user_id INTO u_mgr  FROM users WHERE email='manager@rentfoxxy.com';
  SELECT user_id INTO u_fm   FROM users WHERE email='floor.manager@rentfoxxy.com';
  SELECT user_id INTO u_tech FROM users WHERE email='technician@rentfoxxy.com';
  SELECT user_id INTO u_qc   FROM users WHERE email='qc@rentfoxxy.com';
  SELECT stage_id INTO s_fm   FROM stages WHERE stage_name='Floor Manager';
  SELECT stage_id INTO s_diag FROM stages WHERE stage_name='Diagnosis';
  SELECT stage_id INTO s_qc1  FROM stages WHERE stage_name='QC1';
  SELECT team_id  INTO t_hs   FROM stages WHERE stage_name='Diagnosis';
  SELECT team_id  INTO t_q1   FROM stages WHERE stage_name='QC1';

  INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, status, approved_at, sent_to_vendor_at, status_updated_by_admin_id, status_updated_by_name, rental_period, line_items)
  VALUES ('PO-0001', CURRENT_DATE-30, 'rental_purchase', v1, 'Delhi', false, 21000.00, 24780.00, 'processing', NOW()-INTERVAL '29 days', NOW()-INTERVAL '29 days', u_mgr, 'Raj Sharma', '12 months @ 3500/month',
    '[{"brand":"Dell","model":"Latitude 3510","processor":"Intel Core i5","generation":"10th Gen","ram":"8 GB","storage":"256 GB SSD","gpu":"Integrated","screen_size":"15.6\"","quantity":6,"rate":3500,"warranty_months":12}]'::jsonb)
  RETURNING po_id INTO po1;

  INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, status, approved_at, sent_to_vendor_at, status_updated_by_admin_id, status_updated_by_name, rental_period, line_items)
  VALUES ('PO-0004', CURRENT_DATE-25, 'rental_purchase', v1, 'Delhi', false, 18000.00, 21240.00, 'processing', NOW()-INTERVAL '24 days', NOW()-INTERVAL '24 days', u_mgr, 'Raj Sharma', '12 months @ 4500/month',
    '[{"brand":"Dell","model":"Latitude 5430","processor":"Intel Core i5","generation":"12th Gen","ram":"16 GB","storage":"512 GB SSD","gpu":"Integrated","screen_size":"14\"","quantity":4,"rate":4500,"warranty_months":12}]'::jsonb)
  RETURNING po_id INTO po4;

  INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, status, submitted_at, line_items)
  VALUES ('PO-0002', CURRENT_DATE-2, 'direct_purchase', v2, 'Delhi', false, 28000.00, 33040.00, 'pending_approval', NOW()-INTERVAL '1 day',
    '[{"brand":"HP","model":"ProBook 440","processor":"Intel Core i5","generation":"11th Gen","ram":"8 GB","storage":"512 GB SSD","gpu":"Integrated","screen_size":"14\"","quantity":4,"rate":7000,"warranty_months":12}]'::jsonb)
  RETURNING po_id INTO po2;

  INSERT INTO vendor_purchase_orders (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, status, line_items)
  VALUES ('PO-0003', CURRENT_DATE, 'rent_to_own', v1, 'Delhi', false, 15000.00, 17700.00, 'draft',
    '[{"brand":"Lenovo","model":"ThinkPad E14","processor":"Intel Core i7","generation":"12th Gen","ram":"16 GB","storage":"512 GB SSD","gpu":"Integrated","screen_size":"14\"","quantity":2,"rate":7500,"warranty_months":24}]'::jsonb)
  RETURNING po_id INTO po3;

  INSERT INTO vendor_product_details (po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, vendor_locking_period, warranty, status, random_id)
  VALUES (po1,'Laptop','Dell','Latitude 3510','Intel Core i5','10th Gen','8 GB','256 GB SSD','Integrated','15.6"',6,3500,12,12,'received','VPD-DELL3510') RETURNING product_detail_id INTO pd_3510;
  INSERT INTO vendor_product_details (po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, vendor_locking_period, warranty, status, random_id)
  VALUES (po4,'Laptop','Dell','Latitude 5430','Intel Core i5','12th Gen','16 GB','512 GB SSD','Integrated','14"',4,4500,12,12,'received','VPD-DELL5430') RETURNING product_detail_id INTO pd_5430;
  INSERT INTO vendor_product_details (po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, vendor_locking_period, warranty, status, random_id)
  VALUES (po2,'Laptop','HP','ProBook 440','Intel Core i5','11th Gen','8 GB','512 GB SSD','Integrated','14"',4,7000,12,12,'pending','VPD-HP440') RETURNING product_detail_id INTO pd_hp;
  INSERT INTO vendor_product_details (po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, vendor_locking_period, warranty, status, random_id)
  VALUES (po3,'Laptop','Lenovo','ThinkPad E14','Intel Core i7','12th Gen','16 GB','512 GB SSD','Integrated','14"',2,7500,24,24,'draft','VPD-LENE14') RETURNING product_detail_id INTO pd_lenovo;

  INSERT INTO vendor_goods_received_notes (po_id, bill_status, bill_name, meta)
  VALUES (po1,'received','INV-TECHRENT-3510-001','{"received_by":"Sanjay Yadav","notes":"All 6 units received."}'::jsonb) RETURNING grn_id INTO grn1;
  INSERT INTO vendor_goods_received_notes (po_id, bill_status, bill_name, meta)
  VALUES (po4,'received','INV-TECHRENT-5430-001','{"received_by":"Sanjay Yadav","notes":"All 4 units received."}'::jsonb) RETURNING grn_id INTO grn4;

  -- Dell Latitude 3510 serials (PO-0001): 0001-0003 mid pipeline, 0004-0006 QC-passed in_stock
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status, rent_monthly_rate, extra) VALUES
    (po1,grn1,'SN-DELL-3510-001','TTSPL0001','in_qc','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0001','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','Windows 11','condition','Good','status','in_qc')),
    (po1,grn1,'SN-DELL-3510-002','TTSPL0002','in_qc','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0002','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','Windows 11','condition','Good','status','in_qc')),
    (po1,grn1,'SN-DELL-3510-003','TTSPL0003','in_qc','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0003','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','None','condition','Minor scratches','status','in_qc')),
    (po1,grn1,'SN-DELL-3510-004','TTSPL0004','passed','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0004','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','Windows 11','condition','Good','status','passed')),
    (po1,grn1,'SN-DELL-3510-005','TTSPL0005','passed','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0005','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','Windows 11','condition','Good','status','passed')),
    (po1,grn1,'SN-DELL-3510-006','TTSPL0006','passed','in_stock',3500, jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0006','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','gpu','Integrated','screen_size','15.6"','os','Windows 11','condition','Good','status','passed'));

  -- Dell Latitude 5430 serials (PO-0004): all QC-passed in_stock
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status, rent_monthly_rate, extra) VALUES
    (po4,grn4,'SN-DELL-5430-001','TTSPL0007','passed','in_stock',4500, jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0007','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','gpu','Integrated','screen_size','14"','os','Windows 11','condition','Good','status','passed')),
    (po4,grn4,'SN-DELL-5430-002','TTSPL0008','passed','in_stock',4500, jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0008','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','gpu','Integrated','screen_size','14"','os','Windows 11','condition','Good','status','passed')),
    (po4,grn4,'SN-DELL-5430-003','TTSPL0009','passed','in_stock',4500, jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0009','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','gpu','Integrated','screen_size','14"','os','Windows 11','condition','Good','status','passed')),
    (po4,grn4,'SN-DELL-5430-004','TTSPL0010','passed','in_stock',4500, jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0010','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','gpu','Integrated','screen_size','14"','os','Windows 11','condition','Good','status','passed'));

  UPDATE vendor_inventory_asset_sequence SET next_num = 11 WHERE id = 1;

  INSERT INTO vendor_product_inventory (product_id, serial_id, serial_number, unique_product_serial, product_model_name, status)
  SELECT NULL, vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.extra->>'model', 'in_stock'
  FROM vendor_serial_numbers vsn;

  INSERT INTO inventory (stock_type, device_type, machine_number, serial_number, brand, model, processor, ram, storage, generation, gpu, screen_size, grade, status, stage)
  SELECT 'Ready','Laptop', vsn.inventory_asset_code, vsn.serial_number, vsn.extra->>'brand', vsn.extra->>'model', vsn.extra->>'processor', vsn.extra->>'ram', vsn.extra->>'storage', vsn.extra->>'generation', vsn.extra->>'gpu', vsn.extra->>'screen_size', 'A','In Stock','Inventory'
  FROM vendor_serial_numbers vsn WHERE vsn.qc_status='passed';

  -- Floor tickets (mid pipeline)
  SELECT serial_id INTO sid FROM vendor_serial_numbers WHERE serial_number='SN-DELL-3510-001';
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage, status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id, vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-3510-001','TTSPL0001','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD','in_progress','normal','grn_qc',s_fm,t_hs,u_fm,sid,'Good, minor dust');

  SELECT serial_id INTO sid FROM vendor_serial_numbers WHERE serial_number='SN-DELL-3510-002';
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage, status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id, vendor_serial_id, initial_condition)
  VALUES ('SN-DELL-3510-002','TTSPL0002','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD','in_progress','normal','grn_qc',s_diag,t_hs,u_tech,sid,'Good condition');

  SELECT serial_id INTO sid FROM vendor_serial_numbers WHERE serial_number='SN-DELL-3510-003';
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage, status, priority, ticket_type, current_stage_id, assigned_team_id, assigned_user_id, vendor_serial_id, initial_condition, qc_fail_count, qc1_failed_at, qc1_fail_reason, highlighted, highlighted_reason)
  VALUES ('SN-DELL-3510-003','TTSPL0003','Dell','Latitude 3510','Intel Core i5','8 GB','256 GB SSD','in_progress','high','grn_qc',s_qc1,t_q1,u_qc,sid,'Minor scratches',1,NOW()-INTERVAL '1 day','Battery health below 50%',true,'QC1 failed: Battery health below 50%');

  INSERT INTO qc_results (ticket_id, qc_stage, processor, generation, storage_type, ram_size, checklist_data, qc_result, final_grade, tested_by, qc_date)
  SELECT t.ticket_id,'QC1','Intel Core i5','10th Gen','SSD','8 GB','{"power_on":true,"display":true,"keyboard":true,"battery":true}'::jsonb,'pass','A',u_qc,CURRENT_DATE
  FROM tickets t WHERE t.serial_number='SN-DELL-3510-002';

  INSERT INTO work_logs (ticket_id, user_id, stage_id, start_time, end_time, notes)
  SELECT t.ticket_id, u_tech, s_diag, NOW()-INTERVAL '2 hours', NOW()-INTERVAL '1 hour', 'Diagnosis completed'
  FROM tickets t WHERE t.serial_number='SN-DELL-3510-002';

  INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
  SELECT t.ticket_id, s_diag, u_tech, 'stage_work', 'Ran full diagnosis checklist'
  FROM tickets t WHERE t.serial_number='SN-DELL-3510-002';

  INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, unit_cost, notes)
  SELECT t.ticket_id, p.part_id, 1, p.cost, 'Replaced under repair'
  FROM tickets t, parts p WHERE t.serial_number='SN-DELL-3510-003' AND p.part_name='Laptop Battery 6-cell';
END $$;

INSERT INTO ttspl_audit_log (ttspl_id, event_type, description, actor_name, created_at)
SELECT vsn.inventory_asset_code, 'received', 'Unit received via GRN', 'Sanjay Yadav', NOW()-INTERVAL '20 days'
FROM vendor_serial_numbers vsn;
INSERT INTO ttspl_audit_log (ttspl_id, event_type, description, actor_name, created_at)
SELECT vsn.inventory_asset_code, 'qc_passed', 'QC2 passed — inventory ready', 'Mohan Gupta', NOW()-INTERVAL '5 days'
FROM vendor_serial_numbers vsn WHERE vsn.qc_status='passed';

-- ─────────────────────────────────────────────────────────────
-- 5. CUSTOMERS (+ addresses, KYC documents)
-- ─────────────────────────────────────────────────────────────
INSERT INTO customers (name, company_name, email, phone, whatsapp_number, gst_no, type, address, billing_address, billing_city, billing_state, billing_pincode, shipping_same, pan_number, company_type, company_size, industry, portal_enabled, portal_password_hash, kyc_verified, kyc_status, designation)
VALUES
  ('Amit Sharma','TechCorp Solutions Pvt Ltd','amit@techcorp.com','9876500001','9876500001','06AAHCT0310N1ZG','B2B','B-204, DLF Cyber City, Phase 2, Gurugram','B-204, DLF Cyber City, Phase 2','Gurugram','Haryana','122002',true,'AAHCT0310N','Pvt Ltd',150,'IT Services',true,'$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K',true,'verified','IT Head'),
  ('Sunita Reddy','Reddy Consulting LLP','sunita@reddyconsulting.com','9876500002','9876500002','36AAFPR1234C1ZK','B2B','401, Jubilee Hills, Road No. 36, Hyderabad','401, Jubilee Hills, Road No. 36','Hyderabad','Telangana','500033',true,'AAFPR1234C','LLP',45,'Consulting',false,NULL,true,'verified','Director'),
  ('Rohan Malhotra','StartupHub Technologies','rohan@startuphub.io','9876500003','9876500003','29AABCS5678D1Z2','B2B','12, HSR Layout, Sector 7, Bengaluru','12, HSR Layout, Sector 7','Bengaluru','Karnataka','560102',true,'AABCS5678D','Pvt Ltd',28,'SaaS',false,NULL,true,'verified','Founder'),
  ('Arjun Patel','Patel Enterprises','arjun@patelent.com','9876500004','9876500004','24AABCP9012E1Z9','B2B','22, SG Highway, Ahmedabad','22, SG Highway','Ahmedabad','Gujarat','380015',true,'AABCP9012E','Proprietorship',12,'Trading',false,NULL,false,'pending','Owner');

INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type)
SELECT customer_id, name, phone, billing_address || ', ' || billing_city, billing_pincode, true, 'billing'
FROM customers;

INSERT INTO customer_documents (customer_id, doc_type, doc_label, file_path, file_name, is_signed, notes)
SELECT customer_id, 'gst_certificate', 'GST Certificate', 'uploads/kyc/gst_'||customer_id||'.pdf', 'gst.pdf', false, 'KYC document'
FROM customers WHERE kyc_verified = true;
INSERT INTO customer_documents (customer_id, doc_type, doc_label, file_path, file_name, is_signed, notes)
SELECT customer_id, 'pan_card', 'PAN Card', 'uploads/kyc/pan_'||customer_id||'.pdf', 'pan.pdf', false, 'KYC document'
FROM customers WHERE kyc_verified = true;

-- ─────────────────────────────────────────────────────────────
-- 6. LEADS (across statuses) + activities/remarks/addresses/research
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE u_sales INT; u_mgr INT; lid INT;
BEGIN
  SELECT user_id INTO u_sales FROM users WHERE email='sales@rentfoxxy.com';
  SELECT user_id INTO u_mgr   FROM users WHERE email='manager@rentfoxxy.com';

  INSERT INTO leads (name, company_name, company_brand, email, phone, whatsapp_number, city, state, source, status, lead_stage, brand, processor, generation, ram, storage, quantity_required, monthly_budget, rental_duration, use_case, company_type, company_size, industry, gst_number, assigned_user_id, assigned_by, assigned_at, follow_up_date, personal_remarks, inquiry_type, last_activity_at)
  VALUES ('Vikash Gupta','InfoSys India Ltd','Infosys','vikash.gupta@infosys.com','9811100001','9811100001','Bengaluru','Karnataka','Email','Hot','Agreement Sent','Dell','Intel Core i5','10th Gen','8 GB','256 GB SSD',10,3500.00,12,'Work From Office','Pvt Ltd',500,'IT Services','29AAACI1234F1Z0',u_sales,u_mgr,NOW()-INTERVAL '5 days',CURRENT_DATE+1,'Ready to sign. Shared agreement.','rental',NOW()-INTERVAL '2 hours')
  RETURNING lead_id INTO lid;
  INSERT INTO lead_activities (lead_id, user_id, action, status_to, notes) VALUES (lid, u_sales, 'status_changed','Hot','Lead contacted via email; agreement shared');
  INSERT INTO lead_remarks (lead_id, user_id, note) VALUES (lid, u_sales, 'Decision maker confirmed budget. Follow up tomorrow.');
  INSERT INTO lead_addresses (lead_id, concern_person, mobile_no, address, pincode, address_type, created_by) VALUES (lid,'Vikash Gupta','9811100001','Electronic City Phase 1, Bengaluru','560100','billing',u_sales);
  INSERT INTO lead_company_research (lead_id, cin, entity_type, revenue, employees, gst, city, state, industry) VALUES (lid,'L72200KA1981PLC013115','Public Ltd','₹1.46L Cr','300000+','29AAACI1234F1Z0','Bengaluru','Karnataka','IT Services');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, brand, processor, ram, storage, quantity_required, monthly_budget, assigned_user_id, assigned_by, assigned_at, inquiry_type, last_activity_at, converted_at)
  VALUES ('Meera Joshi','Digital Minds Pvt Ltd','meera@digitalminds.com','9822200002','Mumbai','Reference','Deal','HP','Intel Core i5','8 GB','256 GB SSD',5,4000.00,u_sales,u_mgr,NOW()-INTERVAL '20 days','rental',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, lead_stage, brand, processor, ram, storage, quantity_required, monthly_budget, rental_duration, assigned_user_id, assigned_by, assigned_at, follow_up_date, personal_remarks, inquiry_type, last_activity_at)
  VALUES ('Arjun Patel','Patel Enterprises','arjun.lead@patelent.com','9833300003','Ahmedabad','Cold Call','Warm','Price Negotiation','Lenovo','Intel Core i5','8 GB','512 GB SSD',3,3800.00,6,u_sales,u_mgr,NOW()-INTERVAL '8 days',CURRENT_DATE,'Wants below 3500.','rental',NOW()-INTERVAL '3 days');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, lead_stage, quantity_required, monthly_budget, assigned_user_id, assigned_by, assigned_at, follow_up_date, inquiry_type, last_activity_at)
  VALUES ('Kavitha Nair','Kerala Tech Hub','kavitha@keraltech.com','9844400004','Kochi','Website','Cold','In Follow Up',2,3000.00,u_sales,u_mgr,NOW()-INTERVAL '2 days',CURRENT_DATE+3,'rental',NOW()-INTERVAL '2 days');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, lead_stage, quantity_required, monthly_budget, assigned_user_id, assigned_by, assigned_at, follow_up_date, personal_remarks, inquiry_type, last_activity_at)
  VALUES ('Devendra Rao','Rao Industries','devendra@raoindustries.com','9855500005','Pune','LinkedIn','Warm','Price Agreed',8,3200.00,u_sales,u_mgr,NOW()-INTERVAL '15 days',CURRENT_DATE-3,'Agreed on price. Legal review pending.','rental',NOW()-INTERVAL '5 days');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, brand, processor, generation, ram, storage, quantity_required, inquiry_type, assigned_user_id, assigned_by, assigned_at, last_activity_at)
  VALUES ('Farida Khan','Khan Brothers Trading','farida@khanbros.com','9866600006','Surat','IndiaMART','Pending','Dell','Intel Core i5','10th Gen','8 GB','256 GB SSD',15,'sales',u_sales,u_mgr,NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day');

  INSERT INTO leads (name, company_name, email, phone, city, source, status, brand, quantity_required, inquiry_type, assigned_user_id, assigned_by, assigned_at, last_activity_at)
  VALUES ('Imran Shaikh','Coastal Demo Co','imran@coastaldemo.com','9877700007','Goa','Website','Demo','Dell',1,'rental',u_sales,u_mgr,NOW()-INTERVAL '4 days',NOW()-INTERVAL '1 day');
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. SALES PIPELINE: quotations, sales orders, serial allocation,
--    delivery challans, demo agreement, payments, deposits
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_tech INT; c_reddy INT; c_startup INT;
  u_sales INT; u_wh INT; u_disp INT; u_acct INT;
  l1 INT; l2 INT; l3 INT; l4 INT;
  s1 INT; s2 INT; s3 INT; s4 INT;
  qct INT; s_qc2 INT; t_q2 INT;
BEGIN
  SELECT stage_id INTO s_qc2 FROM stages WHERE stage_name='QC2';
  SELECT team_id  INTO t_q2  FROM stages WHERE stage_name='QC2';
  SELECT customer_id INTO c_tech    FROM customers WHERE email='amit@techcorp.com';
  SELECT customer_id INTO c_reddy   FROM customers WHERE email='sunita@reddyconsulting.com';
  SELECT customer_id INTO c_startup FROM customers WHERE email='rohan@startuphub.io';
  SELECT user_id INTO u_sales FROM users WHERE email='sales@rentfoxxy.com';
  SELECT user_id INTO u_wh    FROM users WHERE email='warehouse@rentfoxxy.com';
  SELECT user_id INTO u_disp  FROM users WHERE email='dispatch@rentfoxxy.com';
  SELECT user_id INTO u_acct  FROM users WHERE email='accounts@rentfoxxy.com';

  -- Serial ids for allocation
  SELECT serial_id INTO s1 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-3510-004'; -- SO-0001 rental (attached)
  SELECT serial_id INTO s2 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-5430-001'; -- SO-0002 rental (dispatched)
  SELECT serial_id INTO s3 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-5430-003'; -- GSO-0001 sale (sold)
  SELECT serial_id INTO s4 FROM vendor_serial_numbers WHERE serial_number='SN-DELL-3510-006'; -- SO-0003 demo (delivered)

  -- ===== Quotation EST-0001 (rental, rentfoxxy, approved) =====
  INSERT INTO sales_quotations (quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_quantity, rate, security_amount, shiping_charges, status, remark, created_by)
  VALUES ('EST-0001', c_tech, 'Amit Sharma','amit@techcorp.com','9876500001','06AAHCT0310N1ZG','haryana','rental','rentfoxxy','one_month_rental',
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002","gst_number":"06AAHCT0310N1ZG"}'::jsonb,
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
    'Dell','Latitude 3510','Intel Core i5','10th Gen','8 GB','256 GB SSD',2,2,3500.00,7000.00,0.00,'approved','1 month rental as security.',u_sales);

  -- ===== Quotation EST-0002 (sale, gorefurbo, approved) =====
  INSERT INTO sales_quotations (quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_quantity, rate, security_amount, shiping_charges, status, remark, created_by)
  VALUES ('EST-0002', c_reddy, 'Sunita Reddy','sunita@reddyconsulting.com','9876500002','36AAFPR1234C1ZK','telangana','sale','gorefurbo','none',
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033","gst_number":"36AAFPR1234C1ZK"}'::jsonb,
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033"}'::jsonb,
    'Dell','Latitude 5430','Intel Core i5','12th Gen','16 GB','512 GB SSD',1,1,42000.00,0.00,500.00,'approved','Refurbished sale unit.',u_sales);

  -- ===== Quotation EST-0003 (demo, rentfoxxy, approved) =====
  INSERT INTO sales_quotations (quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_quantity, rate, security_amount, shiping_charges, status, remark, created_by)
  VALUES ('EST-0003', c_startup, 'Rohan Malhotra','rohan@startuphub.io','9876500003','29AABCS5678D1Z2','karnataka','demo','rentfoxxy','none',
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102","gst_number":"29AABCS5678D1Z2"}'::jsonb,
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102"}'::jsonb,
    'Dell','Latitude 3510','Intel Core i5','10th Gen','8 GB','256 GB SSD',1,1,0.00,0.00,0.00,'approved','7-day free demo.',u_sales);

  -- ===== SO-0001 (rental, rentfoxxy) — serials attached, QC passed, NO DC (test DC generation) =====
  INSERT INTO sales_order_lines (sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, branch, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_qty, rate, locking_period, security_amount, shiping_charges, status, created_by)
  VALUES ('SO-0001','EST-0001',c_tech,'Amit Sharma','amit@techcorp.com','9876500001','06AAHCT0310N1ZG','haryana','rental','rentfoxxy','one_month_rental','rentfoxxy',
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002","gst_number":"06AAHCT0310N1ZG"}'::jsonb,
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
    'Dell','Latitude 3510','Intel Core i5','10th Gen','8 GB','256 GB SSD',2,2,3500.00,12,7000.00,0.00,'processing',u_sales)
  RETURNING id INTO l1;

  -- attach TTSPL0004 & TTSPL0005 (reserve them); QC passed -> ready for DC
  UPDATE vendor_serial_numbers SET inventory_status='reserved', current_customer_id=c_tech, status_changed_at=NOW() WHERE serial_number IN ('SN-DELL-3510-004','SN-DELL-3510-005');
  INSERT INTO sales_order_serials (sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_status, status, entity_code, created_by)
  SELECT 'SO-0001', l1, vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number, 'passed','attached','rentfoxxy', u_wh
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number IN ('SN-DELL-3510-004','SN-DELL-3510-005');
  INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, customer_id, entity_code, actor_user_id)
  SELECT vsn.serial_id, vsn.inventory_asset_code,'in_stock','reserved','SO attach SO-0001',c_tech,'rentfoxxy',u_wh
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number IN ('SN-DELL-3510-004','SN-DELL-3510-005');

  -- advance payment + security deposit for SO-0001
  INSERT INTO sales_order_payments (sales_order_number, customer_id, payment_type, amount, payment_date, payment_mode, reference_number, notes, recorded_by)
  VALUES ('SO-0001',c_tech,'advance',7000.00,CURRENT_DATE-5,'bank_transfer','HDFC-TXN-20250601-4521','Advance before dispatch',u_acct),
         ('SO-0001',c_tech,'security_deposit',7000.00,CURRENT_DATE-5,'bank_transfer','HDFC-TXN-20250601-4522','1 month rental security',u_acct);
  INSERT INTO customer_security_deposits (customer_id, sales_order_number, amount, received_date, status, notes, created_by)
  VALUES (c_tech,'SO-0001',7000.00,CURRENT_DATE-5,'held','1 month rental security deposit',u_acct);

  -- ===== SO-0002 (rental, rentfoxxy) — dispatched via DC-0001 (courier, in transit) =====
  INSERT INTO sales_order_lines (sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, branch, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_qty, rate, locking_period, security_amount, shiping_charges, status, created_by)
  VALUES ('SO-0002','N/A',c_tech,'Amit Sharma','amit@techcorp.com','9876500001','06AAHCT0310N1ZG','haryana','rental','rentfoxxy','one_month_rental','rentfoxxy',
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002","gst_number":"06AAHCT0310N1ZG"}'::jsonb,
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
    'Dell','Latitude 5430','Intel Core i5','12th Gen','16 GB','512 GB SSD',1,1,4500.00,12,4500.00,0.00,'processing',u_sales)
  RETURNING id INTO l2;

  UPDATE vendor_serial_numbers SET inventory_status='in_transit', current_customer_id=c_tech, current_dc_number='DC-0001', current_entity='rentfoxxy', dispatch_mode='courier', dispatched_at=NOW()-INTERVAL '1 day', status_changed_at=NOW()-INTERVAL '1 day' WHERE serial_number='SN-DELL-5430-001';
  INSERT INTO sales_order_serials (sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_status, status, dc_number, entity_code, created_by)
  SELECT 'SO-0002', l2, vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number,'passed','dispatched','DC-0001','rentfoxxy',u_wh
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001';

  INSERT INTO delivery_challan_lines (dc_number, sales_order_number, customer_id, customer_name, email, gst_number, supply_state, branch, entity_code, customer_billing_address, customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by, dispatch_mode, courier_name, awb_number, status, pre_dispatch_qc_passed, created_by, created_at)
  SELECT 'DC-0001','SO-0002',c_tech,'Amit Sharma','amit@techcorp.com','06AAHCT0310N1ZG','haryana','rentfoxxy','rentfoxxy',
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
    '{"name":"Amit Sharma","address":"B-204, DLF Cyber City","city":"Gurugram","state":"Haryana","pincode":"122002"}'::jsonb,
    'Dell','Latitude 5430',1,1, jsonb_build_array(vsn.inventory_asset_code),'by_courier','courier','BlueDart','BD123456789','shipped',true,u_disp,NOW()-INTERVAL '1 day'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001';
  -- pre-dispatch / attach QC ticket (passed) for SO-0002 serial
  INSERT INTO tickets (serial_number, ttspl_id, brand, model, processor, ram, storage, status, priority, ticket_type, current_stage_id, assigned_team_id, vendor_serial_id, sales_order_number, highlighted, highlighted_reason, completed_at)
  SELECT vsn.serial_number, vsn.inventory_asset_code,'Dell','Latitude 5430','Intel Core i5','16 GB','512 GB SSD','completed','high','sales_order_qc',s_qc2,t_q2,vsn.serial_id,'SO-0002',true,'Sales Order',NOW()-INTERVAL '1 day'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001'
  RETURNING ticket_id INTO qct;
  INSERT INTO dc_qc_tickets (dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status)
  SELECT 'DC-0001','SO-0002',qct,vsn.inventory_asset_code,vsn.serial_id,'qc_passed' FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001';
  UPDATE sales_order_serials SET qc_ticket_id=qct WHERE serial_number='SN-DELL-5430-001';
  INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id)
  SELECT vsn.serial_id,vsn.inventory_asset_code,'in_stock','in_transit','DC-0001 dispatch','DC-0001',c_tech,'rentfoxxy',u_disp FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001';

  -- ===== GSO-0001 (sale, gorefurbo) — delivered via GDC-0001 (sold) =====
  INSERT INTO sales_order_lines (sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, branch, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_qty, rate, security_amount, shiping_charges, status, created_by)
  VALUES ('GSO-0001','EST-0002',c_reddy,'Sunita Reddy','sunita@reddyconsulting.com','9876500002','36AAFPR1234C1ZK','telangana','sale','gorefurbo','none','gorefurbo',
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033","gst_number":"36AAFPR1234C1ZK"}'::jsonb,
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033"}'::jsonb,
    'Dell','Latitude 5430','Intel Core i5','12th Gen','16 GB','512 GB SSD',1,1,42000.00,0.00,500.00,'completed',u_sales)
  RETURNING id INTO l3;

  UPDATE vendor_serial_numbers SET inventory_status='sold', current_customer_id=c_reddy, current_dc_number='GDC-0001', current_entity='gorefurbo', dispatch_mode='courier', dispatched_at=NOW()-INTERVAL '6 days', delivered_at=NOW()-INTERVAL '4 days', status_changed_at=NOW()-INTERVAL '4 days' WHERE serial_number='SN-DELL-5430-003';
  INSERT INTO sales_order_serials (sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_status, status, dc_number, entity_code, created_by)
  SELECT 'GSO-0001', l3, vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number,'passed','dispatched','GDC-0001','gorefurbo',u_wh
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-003';
  INSERT INTO delivery_challan_lines (dc_number, sales_order_number, customer_id, customer_name, email, gst_number, supply_state, branch, entity_code, customer_billing_address, customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by, dispatch_mode, courier_name, awb_number, status, pre_dispatch_qc_passed, delivered_serial_numbers, delivery_completed_at, created_by, created_at)
  SELECT 'GDC-0001','GSO-0001',c_reddy,'Sunita Reddy','sunita@reddyconsulting.com','36AAFPR1234C1ZK','telangana','gorefurbo','gorefurbo',
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033"}'::jsonb,
    '{"name":"Sunita Reddy","address":"401, Jubilee Hills","city":"Hyderabad","state":"Telangana","pincode":"500033"}'::jsonb,
    'Dell','Latitude 5430',1,1, jsonb_build_array(vsn.inventory_asset_code),'by_courier','courier','Delhivery','DL987654321','delivered',true, jsonb_build_array(vsn.inventory_asset_code), NOW()-INTERVAL '4 days', u_disp, NOW()-INTERVAL '6 days'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-003';
  INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id)
  SELECT vsn.serial_id,vsn.inventory_asset_code,'in_stock','sold','GDC-0001 sale delivered','GDC-0001',c_reddy,'gorefurbo',u_disp FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-003';

  -- ===== SO-0003 (demo, rentfoxxy) — delivered, decision pending =====
  INSERT INTO sales_order_lines (sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, gst_number, supply_state, quotation_type, entity_code, security_type, branch, customer_billing_address, customer_shipping_address, brand, model_name, processor, generation, ram, storage, quantity, main_qty, rate, security_amount, shiping_charges, status, created_by)
  VALUES ('SO-0003','EST-0003',c_startup,'Rohan Malhotra','rohan@startuphub.io','9876500003','29AABCS5678D1Z2','karnataka','demo','rentfoxxy','none','rentfoxxy',
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102","gst_number":"29AABCS5678D1Z2"}'::jsonb,
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102"}'::jsonb,
    'Dell','Latitude 3510','Intel Core i5','10th Gen','8 GB','256 GB SSD',1,1,0.00,0.00,0.00,'processing',u_sales)
  RETURNING id INTO l4;

  UPDATE vendor_serial_numbers SET inventory_status='on_demo', current_customer_id=c_startup, current_dc_number='DC-0002', current_entity='rentfoxxy', dispatch_mode='inhouse', dispatched_at=NOW()-INTERVAL '3 days', delivered_at=NOW()-INTERVAL '2 days', status_changed_at=NOW()-INTERVAL '2 days' WHERE serial_number='SN-DELL-3510-006';
  INSERT INTO sales_order_serials (sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_status, status, dc_number, entity_code, created_by)
  SELECT 'SO-0003', l4, vsn.serial_id, vsn.inventory_asset_code, vsn.serial_number,'passed','dispatched','DC-0002','rentfoxxy',u_wh
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-3510-006';
  INSERT INTO delivery_challan_lines (dc_number, sales_order_number, customer_id, customer_name, email, gst_number, supply_state, branch, entity_code, customer_billing_address, customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by, dispatch_mode, delivery_person_id, status, pre_dispatch_qc_passed, delivered_serial_numbers, delivery_completed_at, d_otp, d_otp_verified_at, created_by, created_at)
  SELECT 'DC-0002','SO-0003',c_startup,'Rohan Malhotra','rohan@startuphub.io','29AABCS5678D1Z2','karnataka','rentfoxxy','rentfoxxy',
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102"}'::jsonb,
    '{"name":"Rohan Malhotra","address":"12, HSR Layout","city":"Bengaluru","state":"Karnataka","pincode":"560102"}'::jsonb,
    'Dell','Latitude 3510',1,1, jsonb_build_array(vsn.inventory_asset_code),'by_hand','inhouse',u_disp,'delivered',true, jsonb_build_array(vsn.inventory_asset_code), NOW()-INTERVAL '2 days','482910',NOW()-INTERVAL '2 days', u_disp, NOW()-INTERVAL '3 days'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-3510-006';
  INSERT INTO demo_agreements (sales_order_number, dc_number, customer_id, serial_id, ttspl_id, delivered_at, decision_due_at, decision, notes)
  SELECT 'SO-0003','DC-0002',c_startup,vsn.serial_id,vsn.inventory_asset_code, NOW()-INTERVAL '2 days', NOW()+INTERVAL '5 days','pending','7-day demo; keep/return decision pending.'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-3510-006';
  INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id)
  SELECT vsn.serial_id,vsn.inventory_asset_code,'in_stock','on_demo','DC-0002 demo delivered','DC-0002',c_startup,'rentfoxxy',u_disp FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-3510-006';

  -- rent_devices billing rows for rented/in-transit units
  INSERT INTO rent_devices (serial_id, dc_number, serial_number, unique_number, rent_start_date, rent_amount, month_rent, customer_id, vendor_id, type, status)
  SELECT vsn.serial_id,'DC-0001',vsn.serial_number,vsn.inventory_asset_code, CURRENT_DATE-1, vsn.rent_monthly_rate, vsn.rent_monthly_rate, c_tech, vsn.po_id, 'rental','active'
  FROM vendor_serial_numbers vsn WHERE vsn.serial_number='SN-DELL-5430-001';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 8. BILLING: customer invoices, credit note, vendor bill, debit note
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE c_tech INT; v1 INT; u_acct INT; inv1 INT; po1 INT;
BEGIN
  SELECT customer_id INTO c_tech FROM customers WHERE email='amit@techcorp.com';
  SELECT vendor_id   INTO v1     FROM vendors   WHERE email='vendor@techrent.com';
  SELECT user_id     INTO u_acct FROM users     WHERE email='accounts@rentfoxxy.com';
  SELECT po_id       INTO po1    FROM vendor_purchase_orders WHERE purchase_order_number='PO-0001';

  INSERT INTO customer_invoices (invoice_number, customer_id, entity_code, invoice_month, invoice_year, invoice_date, from_date, to_date, line_items, subtotal, gst_percent, gst_amount, grand_total, status, sent_at, sent_by)
  VALUES ('INV-0001',c_tech,'rentfoxxy',5,2025,'2025-06-01','2025-05-01','2025-05-31',
    '[{"ttspl_id":"TTSPL0007","brand":"Dell","model":"Latitude 5430","monthly_rate":4500,"amount":4500.00}]'::jsonb,
    4500.00,18,810.00,5310.00,'sent',NOW()-INTERVAL '10 days',u_acct)
  RETURNING invoice_id INTO inv1;

  INSERT INTO customer_invoices (invoice_number, customer_id, entity_code, invoice_month, invoice_year, invoice_date, from_date, to_date, line_items, subtotal, gst_percent, gst_amount, grand_total, status)
  VALUES ('INV-0002',c_tech,'rentfoxxy',6,2025,CURRENT_DATE,(date_trunc('month',CURRENT_DATE))::date,(date_trunc('month',CURRENT_DATE)+INTERVAL '1 month - 1 day')::date,
    '[{"ttspl_id":"TTSPL0007","brand":"Dell","model":"Latitude 5430","monthly_rate":4500,"amount":4500.00}]'::jsonb,
    4500.00,18,810.00,5310.00,'draft');

  INSERT INTO customer_credit_notes (credit_note_number, customer_id, invoice_id, reason, description, amount, quantity, unit_rate, from_date, to_date, ttspl_ids, status, created_by, approved_by)
  VALUES ('CN-0001',c_tech,inv1,'Mid-month return','TTSPL0007 returned for 10 days credit.',1500.00,1,4500.00,'2025-05-21','2025-05-31','["TTSPL0007"]'::jsonb,'approved',u_acct,u_acct);

  INSERT INTO vendor_monthly_bills (bill_number, vendor_id, bill_month, bill_year, bill_date, from_date, to_date, line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status, generated_by, approved_by)
  VALUES ('VB-0001',v1,5,2025,'2025-05-31','2025-05-01','2025-05-31',
    '[{"ttspl_id":"TTSPL0004","serial_number":"SN-DELL-3510-004","monthly_rate":3500,"amount":3500.00}]'::jsonb,
    3500.00,630.00,0.00,4130.00,'approved',u_acct,u_acct);

  INSERT INTO vendor_debit_notes (debit_note_number, vendor_id, po_id, reason, description, amount, quantity, unit_rate, ttspl_ids, status, created_by, approved_by)
  VALUES ('DN-0001',v1,po1,'Faulty unit','SN-DELL-3510-003 keyboard fault; repair cost deducted.',650.00,1,650.00,'["TTSPL0003"]'::jsonb,'approved',u_acct,u_acct);

  INSERT INTO vendor_billing (vendor_id, billing_month, billing_year, status, assigned_to_user_id, totals, detail)
  VALUES (v1, EXTRACT(MONTH FROM CURRENT_DATE)::int, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'pending', u_acct,
    '{"total_payable":4130.00,"units":1}'::jsonb,
    '[{"ttspl_id":"TTSPL0004","amount":3500.00}]'::jsonb);
END $$;

-- ─────────────────────────────────────────────────────────────
-- 9. SUPPORT TICKETS (+ items, comments, audit)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE c_tech INT; c_reddy INT; u_slead INT; u_stech INT; tk INT; it INT; cat INT;
BEGIN
  SELECT customer_id INTO c_tech  FROM customers WHERE email='amit@techcorp.com';
  SELECT customer_id INTO c_reddy FROM customers WHERE email='sunita@reddyconsulting.com';
  SELECT user_id INTO u_slead FROM users WHERE email='support.lead@rentfoxxy.com';
  SELECT user_id INTO u_stech FROM users WHERE email='support.tech@rentfoxxy.com';
  SELECT id INTO cat FROM support_issue_categories WHERE name LIKE 'Display%' LIMIT 1;

  -- Ticket 1: open complaint on the dispatched rental unit (TTSPL0007)
  INSERT INTO support_tickets (customer_id, customer_name, customer_phone, status, priority, ticket_category, created_by, created_by_name, ttspl_id, serial_number, dc_number, sales_order_number)
  VALUES (c_tech,'Amit Sharma','9876500001','open','high','complaint',u_slead,'Pooja Nair','TTSPL0007','SN-DELL-5430-001','DC-0001','SO-0002')
  RETURNING id INTO tk;
  INSERT INTO support_ticket_items (ticket_id, serial_number, unique_serial_number, brand, model, ram, storage, generation, item_type, issue_category_id, issue_category_label, remarks, assigned_to, status, current_step)
  VALUES (tk,'SN-DELL-5430-001','TTSPL0007','Dell','Latitude 5430','16 GB','512 GB SSD','12th Gen','complaint',cat,'Display / keyboard / touchpad','Screen flickering reported by customer.',u_stech,'open','triage')
  RETURNING id INTO it;
  INSERT INTO support_ticket_item_comments (item_id, user_id, author_role, body) VALUES (it,u_stech,'support_tech','Called customer; scheduling technician visit.');
  INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail) VALUES (it,tk,u_slead,'created','{"note":"ticket opened"}'::jsonb);

  -- Ticket 2: in-progress replacement request on the sold unit (TTSPL0009)
  INSERT INTO support_tickets (customer_id, customer_name, customer_phone, status, priority, ticket_category, created_by, created_by_name, ttspl_id, serial_number, dc_number, sales_order_number)
  VALUES (c_reddy,'Sunita Reddy','9876500002','progress','normal','complaint',u_slead,'Pooja Nair','TTSPL0009','SN-DELL-5430-003','GDC-0001','GSO-0001')
  RETURNING id INTO tk;
  INSERT INTO support_ticket_items (ticket_id, serial_number, unique_serial_number, brand, model, ram, storage, generation, item_type, issue_category_label, remarks, assigned_to, status, current_step)
  VALUES (tk,'SN-DELL-5430-003','TTSPL0009','Dell','Latitude 5430','16 GB','512 GB SSD','12th Gen','replacement','Battery / charging','Battery not charging; replacement requested.',u_stech,'progress','in_repair');
END $$;

-- ─────────────────────────────────────────────────────────────
-- 10. AUDIT / MISC sample rows
-- ─────────────────────────────────────────────────────────────
INSERT INTO allocation_logs (vendor_id, vendor_name, serial_number, unique_id, action_taken, qc_status, log_type, user_id)
SELECT vsn.po_id, 'TechRent Supplies Pvt Ltd', vsn.serial_number, vsn.inventory_asset_code, 'qc_passed','passed','qc',
  (SELECT user_id FROM users WHERE email='qc@rentfoxxy.com')
FROM vendor_serial_numbers vsn WHERE vsn.qc_status='passed' LIMIT 3;

INSERT INTO vendor_audit_logs (actor_user_id, vendor_id, entity_type, entity_id, action, payload)
SELECT (SELECT user_id FROM users WHERE email='manager@rentfoxxy.com'), v.vendor_id,'purchase_order','PO-0001','approved','{"note":"PO approved"}'::jsonb
FROM vendors v WHERE v.email='vendor@techrent.com';

-- ─────────────────────────────────────────────────────────────
-- 11. RESET DOCUMENT SEQUENCES to match seeded data
-- ─────────────────────────────────────────────────────────────
UPDATE sm_document_sequences SET last_value=3  WHERE doc_type='quotation';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='quote_rentfoxxy';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='quote_gorefurbo';
UPDATE sm_document_sequences SET last_value=3  WHERE doc_type='sales_order';
UPDATE sm_document_sequences SET last_value=3  WHERE doc_type='so_rentfoxxy';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='so_gorefurbo';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='delivery_challan';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='dc_rentfoxxy';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='dc_gorefurbo';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='customer_invoice';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='invoice_rentfoxxy';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='credit_note';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='vendor_bill';
UPDATE sm_document_sequences SET last_value=1  WHERE doc_type='vendor_debit_note';
UPDATE sm_document_sequences SET last_value=2  WHERE doc_type='support_ticket';

-- ─────────────────────────────────────────────────────────────
-- SUMMARY
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '==== SEED COMPLETE ====';
  RAISE NOTICE 'Users: 15 (Test@1234). Vendors: 2. Customers: 4. Leads: 7.';
  RAISE NOTICE 'Serials: TTSPL0001-0010. In stock & free for SO: TTSPL0010 (+0001-0003 mid-pipeline).';
  RAISE NOTICE 'SO-0001 rental: serials attached + QC passed (test DC generation).';
  RAISE NOTICE 'SO-0002 rental: DC-0001 dispatched by courier (test Mark Delivered).';
  RAISE NOTICE 'GSO-0001 sale (gorefurbo): GDC-0001 delivered -> sold.';
  RAISE NOTICE 'SO-0003 demo: DC-0002 delivered -> on_demo, decision due in 5 days.';
END $$;
