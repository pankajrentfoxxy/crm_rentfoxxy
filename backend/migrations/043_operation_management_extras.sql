-- Operation management: delivery POD/OTP + support return DC fields

ALTER TABLE public.delivery_challan_lines
  ADD COLUMN IF NOT EXISTS d_otp VARCHAR(10),
  ADD COLUMN IF NOT EXISTS d_otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS d_customer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS d_customer_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS d_customer_mobile VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivery_completed_at TIMESTAMPTZ;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS return_dc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS complaint_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS serial_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS unique_number VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_support_tickets_return_dc ON public.support_tickets (return_dc_number);

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES ('operation_management', 'Operation Management', 44)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
