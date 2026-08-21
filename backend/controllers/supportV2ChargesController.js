'use strict';

const pool = require('../config/db');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 charges:', e);
  return res.status(status).json({ success: false, message: e.message });
}

exports.list = async (req, res) => {
  try {
    const conds = [`e.status IN ('PENDING','APPROVED')`, `e.billed_in_invoice_id IS NULL`];
    const params = [];
    if (req.query.customer_id) {
      params.push(Number(req.query.customer_id));
      conds.push(`e.customer_id = $${params.length}`);
    }
    if (req.query.billing_mode) {
      params.push(String(req.query.billing_mode).toUpperCase());
      conds.push(`e.billing_mode = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).toUpperCase());
      conds.push(`e.status = $${params.length}`);
    }
    if (req.query.month) {
      params.push(req.query.month);
      conds.push(`date_trunc('month', COALESCE(e.raised_at, e.created_at)) = date_trunc('month', $${params.length}::date)`);
    }
    const rows = await pool.query(
      `SELECT e.*, COALESCE(c.company_name, c.name) AS customer_name,
              t.ticket_number, a.ttspl_id
         FROM customer_invoice_extra_lines e
         LEFT JOIN customers c ON c.customer_id = e.customer_id
         LEFT JOIN support_tickets_v2 t ON t.ticket_id = e.ticket_id
         LEFT JOIN support_ticket_assets a ON a.line_id = e.line_id
        WHERE ${conds.join(' AND ')}
        ORDER BY e.extra_line_id DESC
        LIMIT 200`,
      params
    );
    const pending = rows.rows
      .filter((r) => r.status === 'PENDING' || r.status === 'APPROVED')
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    res.json({ success: true, rows: rows.rows, total_pending: pending });
  } catch (e) { bad(res, e); }
};

exports.decide = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.body.action || '').toUpperCase();
    const note = String(req.body.reason || req.body.accounts_note || '').trim();
    const row = (await pool.query(
      'SELECT * FROM customer_invoice_extra_lines WHERE extra_line_id = $1',
      [id]
    )).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Charge not found' });
    if (row.billed_in_invoice_id) {
      return res.status(409).json({ success: false, message: 'Already billed' });
    }
    if (action === 'BILL_NOW') {
      await pool.query(
        `UPDATE customer_invoice_extra_lines
            SET billing_mode = 'IMMEDIATE', status = 'APPROVED',
                accounts_note = COALESCE($2, accounts_note), updated_at = NOW()
          WHERE extra_line_id = $1`,
        [id, note || null]
      );
    } else if (action === 'MONTHLY') {
      await pool.query(
        `UPDATE customer_invoice_extra_lines
            SET billing_mode = 'MONTHLY', status = 'APPROVED',
                accounts_note = COALESCE($2, accounts_note), updated_at = NOW()
          WHERE extra_line_id = $1`,
        [id, note || null]
      );
    } else if (action === 'WAIVE') {
      if (!note) return res.status(400).json({ success: false, message: 'Waiver reason required' });
      await pool.query(
        `UPDATE customer_invoice_extra_lines
            SET status = 'WAIVED', accounts_note = $2, updated_at = NOW()
          WHERE extra_line_id = $1`,
        [id, note]
      );
    } else {
      return res.status(400).json({ success: false, message: 'action must be BILL_NOW, MONTHLY, or WAIVE' });
    }
    const fresh = (await pool.query(
      'SELECT * FROM customer_invoice_extra_lines WHERE extra_line_id = $1',
      [id]
    )).rows[0];
    res.json({ success: true, row: fresh });
  } catch (e) { bad(res, e); }
};

exports.bulk = async (req, res) => {
  try {
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ success: false, message: 'ids required' });
    let n = 0;
    for (const id of ids) {
      await new Promise((resolve, reject) => {
        const fakeRes = {
          status(code) { this._status = code; return this; },
          json(body) {
            if ((this._status || 200) >= 400) reject(Object.assign(new Error(body.message), { status: this._status }));
            else resolve(body);
            return this;
          },
        };
        exports.decide({ user: req.user, params: { id }, body: req.body, query: {} }, fakeRes).catch(reject);
      });
      n += 1;
    }
    res.json({ success: true, updated: n });
  } catch (e) { bad(res, e); }
};
