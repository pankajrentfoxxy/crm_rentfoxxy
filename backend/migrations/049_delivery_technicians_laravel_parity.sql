-- Delivery technicians — Laravel delivery_mans field parity

ALTER TABLE public.delivery_technicians
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) NOT NULL DEFAULT '91',
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS identity_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS identity_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS identity_image JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image VARCHAR(255),
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_technicians_email
  ON public.delivery_technicians (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_technicians_phone_country
  ON public.delivery_technicians (country_code, phone)
  WHERE phone IS NOT NULL AND phone <> '';
