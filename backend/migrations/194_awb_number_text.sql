-- Allow comma-separated multi-AWB strings on a single DC
ALTER TABLE delivery_challan_lines
  ALTER COLUMN awb_number TYPE TEXT;
