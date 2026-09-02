-- Interakt WhatsApp template send log (sent / failed).
-- Used by sendWhatsAppTemplate; one successful non-OTP message per template + ref.

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  country_code VARCHAR(8) NOT NULL DEFAULT '+91',
  template_name VARCHAR(80) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  body_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider_response JSONB,
  http_status INTEGER,
  ref_type VARCHAR(40),
  ref_id VARCHAR(80),
  sales_order_number VARCHAR(80),
  dc_number VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_ref
  ON whatsapp_messages (ref_type, ref_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status
  ON whatsapp_messages (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone
  ON whatsapp_messages (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_so
  ON whatsapp_messages (sales_order_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_once
  ON whatsapp_messages (template_name, ref_type, ref_id)
  WHERE status = 'sent' AND template_name <> 'delivery_otp_v1';
