CREATE TABLE IF NOT EXISTS customer_addresses (
  customer_address_id     SERIAL PRIMARY KEY,
  customer_id             INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  concern_person          VARCHAR(255),
  mobile_no               VARCHAR(50),
  address                 TEXT NOT NULL,
  pincode                 VARCHAR(20),
  is_head_office          BOOLEAN DEFAULT FALSE,
  source_lead_address_id  INT UNIQUE,
  address_type            VARCHAR(30),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id
  ON customer_addresses (customer_id);
