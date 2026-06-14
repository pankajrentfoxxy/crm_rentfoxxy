-- ============================================================
-- Migration: 081_billing_test_scenario.sql
-- Seeds a dedicated customer with 4 rented laptops covering every
-- pro-rata case, so May + June 2026 invoices can be verified.
-- (Today = 2026-06-15.) Billing engine reads vendor_serial_numbers:
-- inventory_status IN ('rented','returned') + rent_start_date /
-- rent_end_date|returned_at, pro-rated by days-in-month.
--
-- Scenario (customer: Quantum Softwares Pvt Ltd):
--   A TTSPL0015 rate 4000 — rented 2026-04-20, ongoing      -> May FULL (31d) + June FULL (30d)
--   B TTSPL0016 rate 3500 — rented 2026-04-20, RETURNED 05-15 -> May 15d only; not in June
--   C TTSPL0017 rate 4500 — rented 2026-05-16, ongoing      -> May 16d + June FULL
--   D TTSPL0018 rate 5000 — rented 2026-06-10, ongoing      -> not in May; June 21d (lands in next month)
-- ============================================================
DO $$
DECLARE
  cust INT;
  po_3510 INT; po_5430 INT; grn_3510 INT; grn_5430 INT;
  pd_3510 INT; pd_5430 INT;
BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE email = 'accounts@quantumsoft.test') THEN
    RAISE NOTICE 'Billing test customer already exists — skipping';
    RETURN;
  END IF;

  INSERT INTO customers (name, company_name, email, phone, whatsapp_number, gst_no, type,
    billing_address, billing_city, billing_state, billing_pincode, shipping_same,
    pan_number, company_type, company_size, industry, kyc_verified, kyc_status, designation)
  VALUES ('Karan Mehta','Quantum Softwares Pvt Ltd','accounts@quantumsoft.test','9876512345','9876512345',
    '27AABCQ1234R1Z5','B2B','5th Floor, Tech Park, Hinjewadi','Pune','Maharashtra','411057',true,
    'AABCQ1234R','Pvt Ltd',80,'IT Services',true,'verified','Finance Head')
  RETURNING customer_id INTO cust;

  SELECT po_id INTO po_3510 FROM vendor_purchase_orders WHERE purchase_order_number='PO-0001';
  SELECT po_id INTO po_5430 FROM vendor_purchase_orders WHERE purchase_order_number='PO-0004';
  SELECT grn_id INTO grn_3510 FROM vendor_goods_received_notes WHERE po_id=po_3510 LIMIT 1;
  SELECT grn_id INTO grn_5430 FROM vendor_goods_received_notes WHERE po_id=po_5430 LIMIT 1;
  SELECT product_detail_id INTO pd_3510 FROM vendor_product_details WHERE random_id='VPD-DELL3510';
  SELECT product_detail_id INTO pd_5430 FROM vendor_product_details WHERE random_id='VPD-DELL5430';

  -- A: full both months
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status,
    rent_monthly_rate, current_customer_id, current_entity, current_dc_number, dispatch_mode,
    rent_start_date, dispatched_at, delivered_at, status_changed_at, extra)
  VALUES (po_5430, grn_5430, 'SN-BILL-A', 'TTSPL0015','passed','rented',4000, cust,'rentfoxxy','DC-B001','courier',
    '2026-04-20','2026-04-20 10:00+05:30','2026-04-20 18:00+05:30','2026-04-20 18:00+05:30',
    jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0015','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','status','passed'));

  -- B: returned mid-May
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status,
    rent_monthly_rate, current_customer_id, current_entity, current_dc_number, dispatch_mode,
    rent_start_date, rent_end_date, returned_at, dispatched_at, delivered_at, status_changed_at, extra)
  VALUES (po_3510, grn_3510, 'SN-BILL-B', 'TTSPL0016','passed','returned',3500, cust,'rentfoxxy','DC-B001','courier',
    '2026-04-20','2026-05-15','2026-05-15 12:00+05:30','2026-04-20 10:00+05:30','2026-04-20 18:00+05:30','2026-05-15 12:00+05:30',
    jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0016','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','status','passed'));

  -- C: taken mid-May, ongoing
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status,
    rent_monthly_rate, current_customer_id, current_entity, current_dc_number, dispatch_mode,
    rent_start_date, dispatched_at, delivered_at, status_changed_at, extra)
  VALUES (po_5430, grn_5430, 'SN-BILL-C', 'TTSPL0017','passed','rented',4500, cust,'rentfoxxy','DC-B002','courier',
    '2026-05-16','2026-05-16 10:00+05:30','2026-05-16 18:00+05:30','2026-05-16 18:00+05:30',
    jsonb_build_object('product_detail_id',pd_5430::text,'ttspl_id','TTSPL0017','brand','Dell','model','Latitude 5430','processor','Intel Core i5','generation','12th Gen','ram','16 GB','storage','512 GB SSD','status','passed'));

  -- D: taken mid-June (lands in next month's bill)
  INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status,
    rent_monthly_rate, current_customer_id, current_entity, current_dc_number, dispatch_mode,
    rent_start_date, dispatched_at, delivered_at, status_changed_at, extra)
  VALUES (po_3510, grn_3510, 'SN-BILL-D', 'TTSPL0018','passed','rented',5000, cust,'rentfoxxy','DC-B003','courier',
    '2026-06-10','2026-06-10 10:00+05:30','2026-06-10 18:00+05:30','2026-06-10 18:00+05:30',
    jsonb_build_object('product_detail_id',pd_3510::text,'ttspl_id','TTSPL0018','brand','Dell','model','Latitude 3510','processor','Intel Core i5','generation','10th Gen','ram','8 GB','storage','256 GB SSD','status','passed'));

  UPDATE vendor_inventory_asset_sequence SET next_num = 19 WHERE id = 1;
  RAISE NOTICE 'Billing test customer % seeded with TTSPL0015-0014', cust;
END $$;
