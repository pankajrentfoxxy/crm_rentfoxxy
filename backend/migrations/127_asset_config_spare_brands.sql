-- Spare Part Brand master — independent from laptop asset_config_brands.

CREATE TABLE IF NOT EXISTS asset_config_spare_brands (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_spare_brands_name
  ON asset_config_spare_brands (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

-- Preserve existing spare-part brand names from catalog, floor parts, and PO lines.
INSERT INTO asset_config_spare_brands (name, status)
SELECT DISTINCT TRIM(src.name), 'active'
  FROM (
    SELECT default_brand AS name
      FROM vendor_spare_parts_catalog
     WHERE default_brand IS NOT NULL AND TRIM(default_brand) <> ''
    UNION
    SELECT UNNEST(compatible_brands) AS name
      FROM vendor_spare_parts_catalog
     WHERE compatible_brands IS NOT NULL
    UNION
    SELECT UNNEST(compatible_brands) AS name
      FROM parts
     WHERE compatible_brands IS NOT NULL
    UNION
    SELECT li->>'brand_name' AS name
      FROM vendor_spare_parts_purchase_orders po,
           LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(po.line_items) = 'array' THEN po.line_items ELSE '[]'::jsonb END
           ) AS li
     WHERE li->>'brand_name' IS NOT NULL AND TRIM(li->>'brand_name') <> ''
  ) src
 WHERE TRIM(src.name) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM asset_config_spare_brands sb
      WHERE LOWER(TRIM(sb.name)) = LOWER(TRIM(src.name)) AND sb.deleted_at IS NULL
   );
