-- 351: a replacement order remembers the old laptop's lock-in / warranty end
-- dates the moment it is raised (five code paths insert these rows, so a trigger
-- rather than five copies). Delivery of the replacement stamps these dates on the
-- new laptop instead of starting a fresh lock-in / warranty (L1).

CREATE OR REPLACE FUNCTION sro_capture_old_terms() RETURNS trigger AS $$
BEGIN
  IF NEW.old_serial_id IS NOT NULL
     AND NEW.old_lock_in_end_date IS NULL
     AND NEW.old_warranty_end_date IS NULL
     AND NEW.old_battery_warranty_end_date IS NULL THEN
    SELECT v.lock_in_end_date, v.warranty_end_date, v.battery_warranty_end_date
      INTO NEW.old_lock_in_end_date, NEW.old_warranty_end_date, NEW.old_battery_warranty_end_date
      FROM vendor_serial_numbers v
     WHERE v.serial_id = NEW.old_serial_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sro_capture_old_terms ON support_replacement_orders;
CREATE TRIGGER trg_sro_capture_old_terms
  BEFORE INSERT ON support_replacement_orders
  FOR EACH ROW EXECUTE FUNCTION sro_capture_old_terms();
