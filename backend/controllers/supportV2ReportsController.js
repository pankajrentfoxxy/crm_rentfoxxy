'use strict';

const pool = require('../config/db');
const XLSX = require('xlsx');
const { runReport } = require('../services/supportReportsService');

function flattenRows(payload) {
  if (Array.isArray(payload.rows) && payload.rows.length) return payload.rows;
  if (Array.isArray(payload.top_issues)) return payload.top_issues;
  if (Array.isArray(payload.by_reason)) return payload.by_reason;
  return [payload];
}

exports.getReport = async (req, res) => {
  try {
    const name = String(req.params.name || '').toLowerCase();
    const data = await runReport(pool, name, { from: req.query.from, to: req.query.to });
    res.json({ success: true, report: name, ...data });
  } catch (e) {
    console.error('getReport:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.exportReport = async (req, res) => {
  try {
    const name = String(req.params.name || '').toLowerCase();
    const data = await runReport(pool, name, { from: req.query.from, to: req.query.to });
    const rows = flattenRows(data);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="support-${name}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('exportReport:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};
