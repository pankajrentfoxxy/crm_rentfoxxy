-- ERP Sales Management parity: quotations → sales orders → delivery challans
-- One row per line item, grouped by document number (matches Laravel ERP pattern)

CREATE TABLE IF NOT EXISTS public.sm_document_sequences (
  doc_type VARCHAR(20) PRIMARY KEY,
  last_value INT NOT NULL DEFAULT 0,
  prefix VARCHAR(20) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('quotation', 0, 'EST-'),
  ('sales_order', 0, 'SO-'),
  ('delivery_challan', 0, 'DC-'),
  ('return_dc', 0, 'RDC')
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_quotations (
  id SERIAL PRIMARY KEY,
  quotation_number VARCHAR(50) NOT NULL,
  customer_id INT REFERENCES public.customers(customer_id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_mobile VARCHAR(50),
  customer_shipping_address JSONB,
  customer_billing_address JSONB,
  contact_person_name VARCHAR(255),
  contact_person_mobile VARCHAR(50),
  gst_number VARCHAR(50),
  supply_state VARCHAR(100),
  security_amount DECIMAL(12, 2) DEFAULT 0,
  shiping_charges DECIMAL(12, 2) DEFAULT 0,
  quotation_type VARCHAR(20) DEFAULT 'rental' CHECK (quotation_type IN ('sale', 'rental')),
  brand VARCHAR(100),
  model_name VARCHAR(255),
  processor VARCHAR(100),
  generation VARCHAR(50),
  ram VARCHAR(50),
  storage VARCHAR(50),
  gpu VARCHAR(100),
  screen_size VARCHAR(50),
  quantity INT NOT NULL DEFAULT 1,
  main_quantity INT NOT NULL DEFAULT 1,
  rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
  locking_period INT,
  battery_charger_warranty INT,
  technical_warranty INT,
  remark TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  token VARCHAR(64),
  pdf_path TEXT,
  status_updated_by_id INT,
  status_updated_by_name VARCHAR(50),
  created_by INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_quotations_number ON public.sales_quotations (quotation_number);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_customer ON public.sales_quotations (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_status ON public.sales_quotations (status);

CREATE TABLE IF NOT EXISTS public.sales_order_lines (
  id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL,
  quotation_number VARCHAR(50) NOT NULL DEFAULT 'N/A',
  customer_id INT REFERENCES public.customers(customer_id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_mobile VARCHAR(50),
  customer_shipping_address JSONB,
  customer_billing_address JSONB,
  gst_number VARCHAR(50),
  supply_state VARCHAR(100),
  security_amount DECIMAL(12, 2) DEFAULT 0,
  shiping_charges DECIMAL(12, 2) DEFAULT 0,
  quotation_type VARCHAR(20) DEFAULT 'rental',
  branch VARCHAR(50),
  brand VARCHAR(100),
  model_name VARCHAR(255),
  processor VARCHAR(100),
  generation VARCHAR(50),
  ram VARCHAR(50),
  storage VARCHAR(50),
  gpu VARCHAR(100),
  screen_size VARCHAR(50),
  quantity INT NOT NULL DEFAULT 1,
  main_qty INT NOT NULL DEFAULT 1,
  rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
  locking_period INT,
  battery_charger_warranty INT,
  technical_warranty INT,
  remark TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  token VARCHAR(64),
  pdf_path TEXT,
  created_by INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_number ON public.sales_order_lines (sales_order_number);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_quotation ON public.sales_order_lines (quotation_number);

CREATE TABLE IF NOT EXISTS public.delivery_challan_lines (
  id SERIAL PRIMARY KEY,
  dc_number VARCHAR(50) NOT NULL,
  sales_order_number VARCHAR(50),
  quotation_number VARCHAR(50),
  customer_id INT REFERENCES public.customers(customer_id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  email VARCHAR(255),
  gst_number VARCHAR(50),
  supply_state VARCHAR(100),
  security_amount DECIMAL(12, 2) DEFAULT 0,
  shiping_charges DECIMAL(12, 2) DEFAULT 0,
  branch VARCHAR(50),
  customer_billing_address JSONB,
  customer_shipping_address JSONB,
  brand VARCHAR(100),
  model_name VARCHAR(255),
  quantity INT NOT NULL DEFAULT 1,
  main_qty INT,
  serial_number JSONB,
  ship_by VARCHAR(20) CHECK (ship_by IS NULL OR ship_by IN ('by_hand', 'by_courier')),
  courier_name VARCHAR(255),
  awb_number VARCHAR(100),
  delivery_person_id INT,
  remarks TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled')),
  pdf_path TEXT,
  file_path TEXT,
  delivered_serial_numbers JSONB,
  rejected_serial_numbers JSONB,
  pickuped_serial_numbers JSONB,
  submitted_remark TEXT,
  submitted_name VARCHAR(255),
  submitted_person_id INT,
  submitted_person_type VARCHAR(50),
  created_by INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_challan_lines_dc ON public.delivery_challan_lines (dc_number);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_lines_so ON public.delivery_challan_lines (sales_order_number);

CREATE TABLE IF NOT EXISTS public.sm_courier_details (
  id SERIAL PRIMARY KEY,
  courier_name VARCHAR(255) NOT NULL,
  awb_number VARCHAR(100) NOT NULL,
  dc_number VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin defaults for sales management
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'sales_quotations', true, true, true, true),
  ('admin', 'sales_orders_doc', true, true, true, true),
  ('admin', 'delivery_challans', true, true, true, true),
  ('admin', 'return_dc', true, true, false, false),
  ('manager', 'sales_quotations', true, true, true, false),
  ('manager', 'sales_orders_doc', true, true, true, false),
  ('manager', 'delivery_challans', true, true, true, false),
  ('manager', 'return_dc', true, false, false, false),
  ('sales', 'sales_quotations', true, true, true, false),
  ('sales', 'sales_orders_doc', true, true, true, false),
  ('sales', 'delivery_challans', true, true, false, false),
  ('sales', 'return_dc', true, false, false, false)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES
  ('sales_quotations', 'Sales quotations (EST)', 45),
  ('sales_orders_doc', 'Sales order documents (SO)', 46),
  ('delivery_challans', 'Delivery challans (DC)', 47),
  ('return_dc', 'Return delivery challans', 48)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
