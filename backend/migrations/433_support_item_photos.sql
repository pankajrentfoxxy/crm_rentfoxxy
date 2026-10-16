-- 433: Laptop photos on a support pickup (16 Oct 2026).
--
-- Collecting a laptop on a return or repair pickup needs 6 photos — front,
-- back, screen on, keyboard, left side, right side — compressed in the browser.
-- One row per slot (a re-take replaces it). The technician cannot take the
-- customer's OTP until all 6 are in. Additive only.

CREATE TABLE IF NOT EXISTS support_item_photos (
  photo_id     SERIAL PRIMARY KEY,
  item_id      INT NOT NULL,
  slot         VARCHAR(20) NOT NULL CHECK (slot IN ('front', 'back', 'screen', 'keyboard', 'left', 'right')),
  path         TEXT NOT NULL,
  uploaded_by  INT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_support_item_photos_item ON support_item_photos (item_id);
