const pool = require('../config/db');

/**
 * Sales order drafts (migration 406) — the new SO form saved half-way.
 *
 * A draft holds the form state as JSON and nothing else: no SO number, no
 * dispatch workflow, no PDF or mail. storeSalesOrder deletes the draft
 * (body.draft_id) inside its own transaction once the order exists.
 *
 * A salesperson sees their own drafts; super_admin and admin see everyone's.
 */
const seesAll = (user) => ['super_admin', 'admin'].includes(String(user?.role || ''));

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function summary(body) {
  const payload = body && typeof body.payload === 'object' && body.payload ? body.payload : null;
  const total = Number(body?.total);
  return {
    payload,
    customer_id: toInt(body?.customer_id),
    customer_name: String(body?.customer_name || '').trim().slice(0, 500) || null,
    quotation_type: String(body?.quotation_type || '').trim().slice(0, 20) || null,
    quotation_number: String(body?.quotation_number || '').trim().slice(0, 60) || null,
    total: Number.isFinite(total) && total >= 0 ? Math.round(total * 100) / 100 : 0,
  };
}

async function loadOwned(req, res) {
  const id = toInt(req.params.draftId);
  if (!id) { res.status(400).json({ success: false, message: 'Invalid draft id' }); return null; }
  const { rows } = await pool.query('SELECT * FROM sales_order_drafts WHERE draft_id = $1', [id]);
  const d = rows[0];
  if (!d) { res.status(404).json({ success: false, message: 'This draft no longer exists — it may have been turned into an order or deleted.' }); return null; }
  if (!seesAll(req.user) && Number(d.created_by) !== Number(req.user?.user_id)) {
    res.status(403).json({ success: false, message: 'This draft belongs to another user.' });
    return null;
  }
  return d;
}

exports.listDrafts = async (req, res) => {
  try {
    const all = seesAll(req.user);
    const { rows } = await pool.query(
      `SELECT d.draft_id, d.created_by, u.name AS created_by_name, d.customer_id, d.customer_name,
              d.quotation_type, d.quotation_number, d.total, d.created_at, d.updated_at
         FROM sales_order_drafts d
         LEFT JOIN users u ON u.user_id = d.created_by
        WHERE ($1::boolean OR d.created_by = $2)
        ORDER BY d.updated_at DESC
        LIMIT 200`,
      [all, req.user?.user_id || 0]
    );
    res.json({ success: true, drafts: rows });
  } catch (e) {
    console.error('listSalesOrderDrafts:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getDraft = async (req, res) => {
  try {
    const d = await loadOwned(req, res);
    if (d) res.json({ success: true, draft: d });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.createDraft = async (req, res) => {
  try {
    const s = summary(req.body);
    if (!s.payload) return res.status(400).json({ success: false, message: 'Nothing to save' });
    const { rows } = await pool.query(
      `INSERT INTO sales_order_drafts (created_by, customer_id, customer_name, quotation_type, quotation_number, total, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING draft_id, updated_at`,
      [req.user?.user_id || null, s.customer_id, s.customer_name, s.quotation_type, s.quotation_number, s.total, JSON.stringify(s.payload)]
    );
    res.status(201).json({ success: true, draft_id: rows[0].draft_id, updated_at: rows[0].updated_at });
  } catch (e) {
    console.error('createSalesOrderDraft:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateDraft = async (req, res) => {
  try {
    const d = await loadOwned(req, res);
    if (!d) return;
    const s = summary(req.body);
    if (!s.payload) return res.status(400).json({ success: false, message: 'Nothing to save' });
    const { rows } = await pool.query(
      `UPDATE sales_order_drafts
          SET customer_id = $2, customer_name = $3, quotation_type = $4, quotation_number = $5,
              total = $6, payload = $7::jsonb, updated_at = NOW()
        WHERE draft_id = $1
        RETURNING draft_id, updated_at`,
      [d.draft_id, s.customer_id, s.customer_name, s.quotation_type, s.quotation_number, s.total, JSON.stringify(s.payload)]
    );
    res.json({ success: true, draft_id: rows[0].draft_id, updated_at: rows[0].updated_at });
  } catch (e) {
    console.error('updateSalesOrderDraft:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.deleteDraft = async (req, res) => {
  try {
    const d = await loadOwned(req, res);
    if (!d) return;
    await pool.query('DELETE FROM sales_order_drafts WHERE draft_id = $1', [d.draft_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Called by storeSalesOrder inside its transaction. Only the owner's (or an
 * admin's) draft is removed; anything else is left alone rather than failing
 * the order.
 */
exports.consumeDraft = async (client, draftId, user) => {
  const id = toInt(draftId);
  if (!id) return;
  await client.query(
    'DELETE FROM sales_order_drafts WHERE draft_id = $1 AND ($2::boolean OR created_by = $3)',
    [id, seesAll(user), user?.user_id || 0]
  );
};
