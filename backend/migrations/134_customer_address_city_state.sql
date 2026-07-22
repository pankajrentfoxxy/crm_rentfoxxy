-- Persist city/state on saved customer addresses (quotation/DC shipping book).
ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS state VARCHAR(120);
