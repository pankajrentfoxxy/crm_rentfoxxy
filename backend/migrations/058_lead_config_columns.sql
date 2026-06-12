-- Lead config + profile columns referenced by Prisma but missing on some DBs

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS company_brand  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS brand          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS processor      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS generation     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ram            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS storage        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS personal_remarks TEXT;
