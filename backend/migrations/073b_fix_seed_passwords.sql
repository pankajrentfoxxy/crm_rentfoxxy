-- ============================================================
-- FIX: Update seed user passwords to Test@1234
-- The original 073 seed used the bcrypt hash for 'password'
-- This script updates all seed users to use Test@1234
-- ============================================================

-- bcrypt hash of 'Test@1234' (rounds=10) — verified correct
DO $$
DECLARE
  correct_hash TEXT := '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K';
BEGIN
  UPDATE users
  SET password_hash = correct_hash, updated_at = NOW()
  WHERE email IN (
    'superadmin@rentfoxxy.com',
    'admin@rentfoxxy.com',
    'manager@rentfoxxy.com',
    'sales@rentfoxxy.com',
    'floor.manager@rentfoxxy.com',
    'technician@rentfoxxy.com',
    'senior.tech@rentfoxxy.com',
    'qc@rentfoxxy.com',
    'qc2@rentfoxxy.com',
    'procurement@rentfoxxy.com',
    'warehouse@rentfoxxy.com',
    'dispatch@rentfoxxy.com',
    'accounts@rentfoxxy.com',
    'support.lead@rentfoxxy.com',
    'support.tech@rentfoxxy.com'
  );

  RAISE NOTICE 'Updated seed user passwords to Test@1234';
END $$;

-- Also fix vendor portal password for test vendor
UPDATE vendors
SET vendor_portal_password_hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K'
WHERE email = 'vendor@techrent.com';

-- Fix customer portal password
UPDATE customers
SET portal_password_hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K'
WHERE email = 'amit@techcorp.com';
