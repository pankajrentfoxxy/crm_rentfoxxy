-- Admin-visible copy of last set CRM login password (set on create/reset only).
ALTER TABLE users ADD COLUMN IF NOT EXISTS remember_pass_plain TEXT;
