-- ============================================================================
-- Migration 076 — Real seller details on companies + email/phone columns.
-- The legal seller for both brands is TrueTech (per issued DCs); brands differ
-- by logo and document number series. Editable later via Company Settings.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

UPDATE companies SET
  legal_name = 'TRUETECH SERVICES PRIVATE LIMITED',
  gstin      = '06AAHCT0310N1ZG',
  state_code = '06',
  email      = 'accounts@truetechservices.in',
  address    = '429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06',
  logo_url   = 'assets/rentfoxxy-logo.png'
WHERE code = 'rentfoxxy';

UPDATE companies SET
  legal_name = 'TRUETECH SERVICES PRIVATE LIMITED',
  gstin      = '06AAHCT0310N1ZG',
  state_code = '06',
  email      = 'accounts@truetechservices.in',
  address    = '429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06',
  logo_url   = 'assets/gorefurbo-logo.png'
WHERE code = 'gorefurbo';
