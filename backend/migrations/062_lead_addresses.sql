-- lead_addresses table (required for lead detail + conversion flow)

CREATE TABLE IF NOT EXISTS lead_addresses (
  address_id      SERIAL PRIMARY KEY,
  lead_id         INT NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
  concern_person  VARCHAR(255),
  mobile_no       VARCHAR(32),
  address         TEXT NOT NULL,
  pincode         VARCHAR(20),
  address_type    VARCHAR(30),
  created_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_addresses_lead_id ON lead_addresses (lead_id);
