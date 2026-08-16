'use strict';

const pool = require('../config/db');
const { loadCsatToken, csatTokenState, submitCsat } = require('../services/supportCsatService');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 public:', e);
  return res.status(status).json({ success: false, message: e.message, reason: e.reason || null });
}

exports.getCsat = async (req, res) => {
  try {
    const row = await loadCsatToken(pool, req.params.token);
    const state = csatTokenState(row);
    if (!row) return res.status(404).json({ success: false, message: state.message, reason: state.reason });
    res.json({
      success: true,
      ok: state.ok,
      reason: state.ok ? null : state.reason,
      message: state.ok ? null : state.message,
      ticket_number: row.ticket_number,
      customer_name: row.customer_name,
    });
  } catch (e) { bad(res, e); }
};

exports.postCsat = async (req, res) => {
  try {
    const result = await submitCsat(pool, req.params.token, {
      score: req.body.score,
      comment: req.body.comment,
    });
    res.json({ success: true, ...result });
  } catch (e) { bad(res, e); }
};
