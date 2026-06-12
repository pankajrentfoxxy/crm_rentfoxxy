const { query, body, param, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { logVendorAudit } = require('../../services/vendorAuditLogService');

const listValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('vendor_id').optional().isInt().toInt(),
  query('billing_year').optional().isInt({ min: 2000 }).toInt(),
  query('billing_month').optional().isInt({ min: 1, max: 12 }).toInt(),
  query('status').optional().isIn(['pending', 'approved', 'completed'])
];

async function list(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 50;
  const offset = (page - 1) * limit;

  let where = `b.deleted_at IS NULL`;
  const p = [];
  let i = 1;
  if (req.query.status) {
    where += ` AND b.status = $${i}`;
    p.push(req.query.status);
    i++;
  }
  if (req.query.vendor_id) {
    where += ` AND b.vendor_id = $${i}`;
    p.push(req.query.vendor_id);
    i++;
  }
  if (req.query.billing_year) {
    where += ` AND b.billing_year = $${i}`;
    p.push(req.query.billing_year);
    i++;
  }
  if (req.query.billing_month) {
    where += ` AND b.billing_month = $${i}`;
    p.push(req.query.billing_month);
    i++;
  }

  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS c FROM vendor_billing b WHERE ${where}`,
    p
  );
  const total = cnt.rows[0].c;
  const data = await pool.query(
    `
    SELECT b.*, v.business_name AS vendor_business_name, v.email AS vendor_email
    FROM vendor_billing b
    LEFT JOIN vendors v ON v.vendor_id = b.vendor_id
    WHERE ${where}
    ORDER BY billing_year DESC, billing_month DESC, billing_id DESC
    LIMIT $${i} OFFSET $${i + 1}
    `,
    [...p, limit, offset]
  );

  res.json({
    success: true,
    data: data.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

const getValidators = [param('id').isInt().toInt()];

async function getOne(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const r = await pool.query(
    `SELECT b.*, v.business_name FROM vendor_billing b LEFT JOIN vendors v ON v.vendor_id = b.vendor_id
     WHERE b.billing_id = $1 AND b.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: r.rows[0] });
}

function createValidators() {
  return [
    body('vendor_id').optional().isInt().toInt(),
    body('billing_month').isInt({ min: 1, max: 12 }).toInt(),
    body('billing_year').isInt({ min: 2000 }).toInt(),
    body('status').optional().isIn(['pending', 'approved', 'completed']),
    body('assigned_to_user_id').optional().isInt().toInt(),
    body('notes').optional().isString(),
    body('detail').optional(),
    body('totals').optional(),
    body('file_path').optional().isString()
  ];
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const b = req.body;
  const ins = await pool.query(
    `INSERT INTO vendor_billing (vendor_id, billing_month, billing_year, status, assigned_to_user_id, totals, detail, file_path, notes)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
     RETURNING *`,
    [
      b.vendor_id ?? null,
      b.billing_month,
      b.billing_year,
      b.status || 'pending',
      b.assigned_to_user_id ?? null,
      JSON.stringify(b.totals || {}),
      JSON.stringify(Array.isArray(b.detail) ? b.detail : []),
      b.file_path || null,
      b.notes || null
    ]
  );

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: b.vendor_id,
    entityType: 'vendor_billing',
    entityId: ins.rows[0].billing_id,
    action: 'create',
    payload: {}
  });

  res.status(201).json({ success: true, data: ins.rows[0] });
}

async function update(req, res) {
  await body('billing_month').optional().isInt({ min: 1, max: 12 }).run(req);
  await body('billing_year').optional().isInt({ min: 2000 }).run(req);
  await body('status').optional().isIn(['pending', 'approved', 'completed']).run(req);
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = Number(req.params.id);
  const cur = await pool.query(`SELECT * FROM vendor_billing WHERE billing_id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const b = req.body;
  const upd = await pool.query(
    `UPDATE vendor_billing SET
       vendor_id = COALESCE($1, vendor_id),
       billing_month = COALESCE($2, billing_month),
       billing_year = COALESCE($3, billing_year),
       status = COALESCE($4, status),
       assigned_to_user_id = COALESCE($5, assigned_to_user_id),
       totals = COALESCE($6::jsonb, totals),
       detail = COALESCE($7::jsonb, detail),
       file_path = COALESCE($8, file_path),
       notes = COALESCE($9, notes),
       updated_at = NOW()
     WHERE billing_id = $10 RETURNING *`,
    [
      b.vendor_id,
      b.billing_month,
      b.billing_year,
      b.status,
      b.assigned_to_user_id,
      b.totals != null ? JSON.stringify(b.totals) : null,
      b.detail != null ? JSON.stringify(Array.isArray(b.detail) ? b.detail : b.detail) : null,
      b.file_path !== undefined ? b.file_path : null,
      b.notes !== undefined ? b.notes : null,
      id
    ]
  );

  res.json({ success: true, data: upd.rows[0] });
}

async function remove(req, res) {
  await pool.query(`UPDATE vendor_billing SET deleted_at = NOW() WHERE billing_id = $1`, [req.params.id]);
  res.json({ success: true });
}

module.exports = {
  listValidators,
  list,
  getValidators,
  getOne,
  createValidators,
  create,
  updateValidators: [
    param('id').isInt().toInt()
  ],
  update,
  remove
};
