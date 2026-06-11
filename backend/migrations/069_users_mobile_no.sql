-- Add mobile_no to users if missing (required by auth and support technician list)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_no VARCHAR(50);
