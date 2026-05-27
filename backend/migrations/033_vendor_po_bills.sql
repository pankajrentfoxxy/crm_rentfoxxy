-- Bills on purchase orders (parity with Laravel PO list: bill_name, bill_files)

ALTER TABLE vendor_purchase_orders ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255);
ALTER TABLE vendor_purchase_orders ADD COLUMN IF NOT EXISTS bill_files JSONB NOT NULL DEFAULT '[]'::jsonb;
