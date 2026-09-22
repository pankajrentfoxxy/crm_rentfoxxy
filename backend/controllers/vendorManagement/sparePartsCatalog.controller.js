const { param, query, body, validationResult } = require('express-validator');
const pool = require('../../config/db');
const {
  listActiveSpareBrandsForDropdown,
  resolveSpareBrandModelPair,
} = require('../../services/assetConfigurationService');
const { PART_CATEGORIES: CATEGORIES } = require('../../constants/laptopConditions');

function toBrandArray(val) {
  if (val == null || val === '') return null;
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  return String(val).split(',').map((s) => s.trim()).filter(Boolean);
}

async function ensureFloorPart(client, { name, category, part_type, specifications, default_brand, default_model }) {
  const existing = await client.query(
    `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
    [name]
  );
  if (existing.rows.length) {
    await client.query(
      `UPDATE parts SET
         default_brand = COALESCE($2, default_brand),
         default_model = COALESCE($3, default_model)
       WHERE part_id = $1`,
      [existing.rows[0].part_id, default_brand || null, default_model || null]
    ).catch(() => {});
    return existing.rows[0].part_id;
  }

  // compatible_brands = laptop fitment default; do not seed with spare brand.
  const ins = await client.query(
    `INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, description, compatible_brands, default_brand, default_model)
     VALUES ($1, $2, $3, 0, 5, $4, NULL, $5, $6) RETURNING part_id`,
    [name, part_type || category, category, specifications || name, default_brand || null, default_model || null]
  );
  return ins.rows[0].part_id;
}

async function syncSparePartsMirror(client, catalogId, name, active) {
  await client.query(
    `INSERT INTO spare_parts (id, name, status, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = NOW()`,
    [catalogId, name, active ? 1 : 0]
  ).catch(() => {});
}

function mapCatalogRow(row) {
  const cat = CATEGORIES.find((c) => c.value === row.category);
  return {
    id: row.part_id,
    name: row.name,
    category: row.category,
    category_label: cat?.label || row.category,
    part_type: row.part_type || null,
    default_brand: row.default_brand || null,
    default_model: row.default_model || null,
    specifications: row.specifications || null,
    compatible_brands: row.compatible_brands || [],
    floor_part_id: row.floor_part_id,
    stock_qty: row.stock_qty,
    unit_cost: row.unit_cost,
    location_code: row.location_code,
    active: row.active,
    erp_spare_part_id: row.erp_spare_part_id,
  };
}

async function listCatalog(req, res) {
  try {
    const category = (req.query.category || '').trim();
    const search = (req.query.search || '').trim();
    const params = [];
    let where = 'WHERE v.active = TRUE';
    if (category) {
      params.push(category);
      where += ` AND v.category = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where += ` AND (v.name ILIKE $${i} OR COALESCE(v.part_type,'') ILIKE $${i} OR COALESCE(v.default_brand,'') ILIKE $${i} OR COALESCE(v.default_model,'') ILIKE $${i})`;
    }
    const { rows } = await pool.query(
      `SELECT v.*, p.quantity AS stock_qty, p.cost AS unit_cost, p.location_code
         FROM vendor_spare_parts_catalog v
         LEFT JOIN parts p ON p.part_id = v.floor_part_id
         ${where}
         ORDER BY v.category ASC NULLS LAST, v.name ASC
         LIMIT 500`,
      params
    );
    const brands = await listActiveSpareBrandsForDropdown();

    res.json({
      success: true,
      categories: CATEGORIES,
      brands,
      data: rows.map(mapCatalogRow),
    });
  } catch (e) {
    console.error('listCatalog', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load catalog' });
  }
}

const createValidators = [
  body('name').trim().notEmpty().isLength({ max: 255 }),
  body('category').isIn(CATEGORIES.map((c) => c.value)),
  body('part_type').optional({ nullable: true }).isString().trim(),
  body('default_brand').optional({ nullable: true }).isString().trim(),
  body('default_model').optional({ nullable: true }).isString().trim(),
  body('specifications').optional({ nullable: true }).isString().trim(),
  body('compatible_brands').optional(),
];

async function createCatalogItem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { name, category, part_type, specifications, compatible_brands } = req.body;
  let default_brand = req.body.default_brand || null;
  let default_model = req.body.default_model || null;
  try {
    if (default_brand || default_model) {
      const resolved = await resolveSpareBrandModelPair(default_brand, default_model, { requireModel: false });
      default_brand = resolved.brand;
      default_model = resolved.model;
    }
  } catch (e) {
    return res.status(e.status || 400).json({ success: false, message: e.message || 'Invalid brand/model' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dup = await client.query(
      `SELECT part_id FROM vendor_spare_parts_catalog WHERE LOWER(name) = LOWER($1) AND category = $2 LIMIT 1`,
      [name, category]
    );
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This part already exists in the catalog' });
    }

    const floorPartId = await ensureFloorPart(client, {
      name, category, part_type, specifications, default_brand, default_model,
    });

    const ins = await client.query(
      `INSERT INTO vendor_spare_parts_catalog
         (name, category, part_type, default_brand, default_model, specifications, compatible_brands, floor_part_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
      [
        name.trim(),
        category,
        part_type || null,
        default_brand || null,
        default_model || null,
        specifications || null,
        toBrandArray(compatible_brands),
        floorPartId,
      ]
    );
    const row = ins.rows[0];
    await syncSparePartsMirror(client, row.part_id, row.name, true);
    await client.query('COMMIT');

    const full = await pool.query(
      `SELECT v.*, p.quantity AS stock_qty, p.cost AS unit_cost, p.location_code
         FROM vendor_spare_parts_catalog v
         LEFT JOIN parts p ON p.part_id = v.floor_part_id
        WHERE v.part_id = $1`,
      [row.part_id]
    );
    res.status(201).json({ success: true, message: 'Spare part added to catalog', data: mapCatalogRow(full.rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('createCatalogItem', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to create catalog item' });
  } finally {
    client.release();
  }
}

const updateValidators = [
  param('id').isInt().toInt(),
  body('name').optional().trim().notEmpty(),
  body('category').optional().isIn(CATEGORIES.map((c) => c.value)),
  body('part_type').optional({ nullable: true }).isString().trim(),
  body('default_brand').optional({ nullable: true }).isString().trim(),
  body('default_model').optional({ nullable: true }).isString().trim(),
  body('specifications').optional({ nullable: true }).isString().trim(),
  body('active').optional().isBoolean(),
];

async function updateCatalogItem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT * FROM vendor_spare_parts_catalog WHERE part_id = $1`, [id]);
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Catalog item not found' });
    }
    const row = cur.rows[0];
    const name = req.body.name != null ? String(req.body.name).trim() : row.name;
    const category = req.body.category || row.category;
    const part_type = req.body.part_type !== undefined ? (req.body.part_type || null) : row.part_type;
    let default_brand = req.body.default_brand !== undefined ? (req.body.default_brand || null) : row.default_brand;
    let default_model = req.body.default_model !== undefined ? (req.body.default_model || null) : row.default_model;
    const specifications = req.body.specifications !== undefined ? (req.body.specifications || null) : row.specifications;
    const active = req.body.active !== undefined ? !!req.body.active : row.active;

    if (default_brand || default_model) {
      try {
        const resolved = await resolveSpareBrandModelPair(default_brand, default_model, { requireModel: false });
        default_brand = resolved.brand;
        default_model = resolved.model;
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(e.status || 400).json({ success: false, message: e.message || 'Invalid brand/model' });
      }
    } else {
      default_brand = null;
      default_model = null;
    }

    let floorPartId = row.floor_part_id;
    if (!floorPartId) {
      floorPartId = await ensureFloorPart(client, {
        name, category, part_type, specifications, default_brand, default_model,
      });
    } else {
      await client.query(
        `UPDATE parts SET part_name = $2, category = $3, part_type = $4, description = COALESCE($5, description),
                default_brand = $6, default_model = $7
          WHERE part_id = $1`,
        [
          floorPartId, name, category, part_type || category, specifications,
          default_brand || null, default_model || null,
        ]
      );
    }

    await client.query(
      `UPDATE vendor_spare_parts_catalog SET
          name = $2, category = $3, part_type = $4, default_brand = $5, default_model = $6,
          specifications = $7, floor_part_id = $8, active = $9, updated_at = NOW()
       WHERE part_id = $1`,
      [id, name, category, part_type, default_brand, default_model, specifications, floorPartId, active]
    );
    await syncSparePartsMirror(client, id, name, active);
    await client.query('COMMIT');

    const full = await pool.query(
      `SELECT v.*, p.quantity AS stock_qty, p.cost AS unit_cost, p.location_code
         FROM vendor_spare_parts_catalog v
         LEFT JOIN parts p ON p.part_id = v.floor_part_id
        WHERE v.part_id = $1`,
      [id]
    );
    res.json({ success: true, message: 'Catalog updated', data: mapCatalogRow(full.rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('updateCatalogItem', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update catalog item' });
  } finally {
    client.release();
  }
}

module.exports = {
  listCatalog,
  createValidators,
  createCatalogItem,
  updateValidators,
  updateCatalogItem,
  CATEGORIES,
};
