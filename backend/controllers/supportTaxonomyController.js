'use strict';

const pool = require('../config/db');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportTaxonomy:', e);
  return res.status(status).json({ success: false, message: e.message });
}

exports.listCatalog = async (req, res) => {
  try {
    const { level, parent_id, class: cls, active } = req.query;
    const conds = [];
    const params = [];
    if (level) { params.push(Number(level)); conds.push(`level = $${params.length}`); }
    if (parent_id) { params.push(Number(parent_id)); conds.push(`parent_id = $${params.length}`); }
    if (cls) { params.push(cls); conds.push(`(applies_to_class = 'BOTH' OR applies_to_class = $${params.length})`); }
    if (active === 'true' || active === 'false') {
      params.push(active === 'true');
      conds.push(`active = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT * FROM support_issue_catalog ${where} ORDER BY level, sort_order, name`,
      params
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.searchCatalog = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, rows: [] });
    const r = await pool.query(
      `WITH RECURSIVE chain AS (
         SELECT c.*, c.catalog_id AS root_id
           FROM support_issue_catalog c
          WHERE c.active = TRUE
            AND c.name ILIKE $1
         UNION
         SELECT child.*, chain.root_id
           FROM support_issue_catalog child
           JOIN chain ON child.parent_id = chain.catalog_id
          WHERE child.active = TRUE
       ),
       leaves AS (
         SELECT * FROM chain WHERE level = 3
       )
       SELECT l.catalog_id, l.code, l.name, l.default_impact, l.default_urgency,
              l.default_wo_type, l.chargeable_default, l.requires_photo, l.is_safety,
              l.skill_required, l.kb_article_id,
              jsonb_build_object('catalog_id', t.catalog_id, 'code', t.code, 'name', t.name) AS type,
              jsonb_build_object('catalog_id', s.catalog_id, 'code', s.code, 'name', s.name) AS subtype
         FROM leaves l
         JOIN support_issue_catalog s ON s.catalog_id = l.parent_id
         JOIN support_issue_catalog t ON t.catalog_id = s.parent_id
        ORDER BY t.sort_order, s.sort_order, l.sort_order`,
      [`%${q}%`]
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.catalogTree = async (_req, res) => {
  try {
    const all = (await pool.query(
      `SELECT * FROM support_issue_catalog WHERE active = TRUE ORDER BY level, sort_order, name`
    )).rows;
    const byParent = new Map();
    for (const row of all) {
      const key = row.parent_id || 0;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(row);
    }
    const attach = (node) => ({
      ...node,
      children: (byParent.get(node.catalog_id) || []).map(attach),
    });
    const tree = (byParent.get(0) || []).map(attach);
    res.json({ success: true, tree, counts: {
      level1: all.filter((x) => x.level === 1).length,
      level2: all.filter((x) => x.level === 2).length,
      level3: all.filter((x) => x.level === 3).length,
    } });
  } catch (e) { bad(res, e); }
};

exports.createCatalog = async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO support_issue_catalog (
         parent_id, level, code, name, applies_to_class, default_impact, default_urgency,
         default_wo_type, is_safety, requires_photo, chargeable_default, skill_required,
         kb_article_id, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        b.parent_id || null, b.level, b.code, b.name, b.applies_to_class || 'BOTH',
        b.default_impact || null, b.default_urgency || null, b.default_wo_type || null,
        Boolean(b.is_safety), Boolean(b.requires_photo), Boolean(b.chargeable_default),
        b.skill_required || null, b.kb_article_id || null, b.sort_order || 0,
      ]
    );
    res.status(201).json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.patchCatalog = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE support_issue_catalog SET
         name = COALESCE($2, name),
         applies_to_class = COALESCE($3, applies_to_class),
         default_impact = COALESCE($4, default_impact),
         default_urgency = COALESCE($5, default_urgency),
         default_wo_type = COALESCE($6, default_wo_type),
         is_safety = COALESCE($7, is_safety),
         requires_photo = COALESCE($8, requires_photo),
         chargeable_default = COALESCE($9, chargeable_default),
         skill_required = COALESCE($10, skill_required),
         kb_article_id = COALESCE($11, kb_article_id),
         active = COALESCE($12, active),
         sort_order = COALESCE($13, sort_order),
         updated_at = NOW()
       WHERE catalog_id = $1
       RETURNING *`,
      [
        id, b.name, b.applies_to_class, b.default_impact, b.default_urgency,
        b.default_wo_type, b.is_safety, b.requires_photo, b.chargeable_default,
        b.skill_required, b.kb_article_id, b.active, b.sort_order,
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.deleteCatalog = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `UPDATE support_issue_catalog SET active = false, updated_at = NOW()
        WHERE catalog_id = $1 RETURNING *`,
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, row: r.rows[0] });
  } catch (e) { bad(res, e); }
};

exports.catalogStats = async (_req, res) => {
  res.json({
    success: true,
    stats: { reported_90d: 0, confirmed_pct: 0, avg_resolution_hours: 0, amount_recovered: 0 },
  });
};

exports.listResolutionCodes = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM support_resolution_codes WHERE active = TRUE ORDER BY sort_order, name`
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.listRootCauses = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM support_root_causes WHERE active = TRUE ORDER BY sort_order, name`
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.listActionCodes = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM support_action_codes WHERE active = TRUE ORDER BY sort_order, name`
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};
