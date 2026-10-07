const crypto = require('crypto');
const XLSX = require('xlsx');
const pool = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/whatsappCampaignService');
const { importContacts, MAX_ROWS } = require('../services/whatsappCampaignImportService');
const { nudgeWhatsAppCampaignWorker } = require('../services/whatsappCampaignWorker');
const { WHATSAPP_IMPORT_MAX_FILE_MB } = require('../config/whatsappCampaignUpload');

function campaignId(req) {
  const id = parseInt(req.params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(res, err, fallback) {
  const status = err?.status && err.status < 500 ? err.status : 500;
  if (status === 500) logger.error({ err: err?.message, stack: err?.stack }, fallback);
  return res.status(status).json({ success: false, message: status === 500 ? fallback : err.message });
}

/** Guard against spreadsheet formula injection when a downloaded file is opened in Excel. */
function safeCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const withId = (handler, fallback) => async (req, res) => {
  const id = campaignId(req);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid campaign id' });
  try {
    return await handler(req, res, id);
  } catch (err) {
    return fail(res, err, fallback);
  }
};

exports.getConfig = async (req, res) => {
  res.json({
    success: true,
    data: { ...svc.sendingConfig(), maxFileMb: WHATSAPP_IMPORT_MAX_FILE_MB, maxRows: MAX_ROWS },
  });
};

exports.listCampaigns = async (req, res) => {
  try {
    const result = await svc.listCampaigns(pool, req.query);
    res.json({
      success: true,
      data: result.rows,
      pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages },
    });
  } catch (err) {
    fail(res, err, 'Server error listing WhatsApp campaigns');
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const campaign = await svc.createCampaign(pool, req.body, req.user.user_id);
    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    fail(res, err, 'Server error creating WhatsApp campaign');
  }
};

exports.getCampaign = withId(async (req, res, id) => {
  res.json({ success: true, data: await svc.getCampaignDetail(pool, id) });
}, 'Server error loading WhatsApp campaign');

exports.updateCampaign = withId(async (req, res, id) => {
  const { campaign, contactsCleared } = await svc.updateCampaign(pool, id, req.body);
  res.json({
    success: true,
    data: campaign,
    contactsCleared,
    message: contactsCleared ? 'Template variables changed — please upload the contacts again' : 'Campaign updated',
  });
}, 'Server error updating WhatsApp campaign');

exports.deleteCampaign = withId(async (req, res, id) => {
  await svc.deleteCampaign(pool, id);
  res.json({ success: true, message: 'Campaign deleted' });
}, 'Server error deleting WhatsApp campaign');

exports.importContacts = withId(async (req, res, id) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose a .xlsx, .xls or .csv file to upload' });
  const result = await importContacts(pool, {
    campaignId: id,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    buffer: req.file.buffer,
    userId: req.user.user_id,
  });
  logger.info({ campaignId: id, userId: req.user.user_id, ...result.summary }, 'WhatsApp campaign contacts imported');
  res.json({ success: true, data: result, message: `Imported ${result.summary.valid} valid contact(s)` });
}, 'Server error importing contacts');

exports.listImports = withId(async (req, res, id) => {
  const detail = await svc.getCampaignDetail(pool, id);
  res.json({ success: true, data: detail.imports });
}, 'Server error loading import history');

exports.listContacts = withId(async (req, res, id) => {
  const result = await svc.listContacts(pool, id, req.query);
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages },
  });
}, 'Server error loading campaign contacts');

exports.exportContacts = withId(async (req, res, id) => {
  const { campaign, rows, type } = await svc.exportContacts(pool, id, req.query.type);
  const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const safeRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
  const ws = rows.length
    ? XLSX.utils.json_to_sheet(safeRows)
    : XLSX.utils.aoa_to_sheet([['No matching contacts']]);
  const base = `whatsapp_campaign_${campaign.id}_${type}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(`﻿${XLSX.utils.sheet_to_csv(ws)}`);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
  return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}, 'Server error exporting contacts');

exports.getStats = withId(async (req, res, id) => {
  res.json({ success: true, data: await svc.getStats(pool, id) });
}, 'Server error loading campaign statistics');

exports.startCampaign = withId(async (req, res, id) => {
  const queued = await svc.startCampaign(pool, id, req.user.user_id);
  nudgeWhatsAppCampaignWorker();
  res.json({ success: true, message: 'Campaign queued successfully', data: { queued } });
}, 'Server error starting campaign');

exports.pauseCampaign = withId(async (req, res, id) => {
  await svc.pauseCampaign(pool, id, req.user.user_id);
  res.json({ success: true, message: 'Campaign paused' });
}, 'Server error pausing campaign');

exports.resumeCampaign = withId(async (req, res, id) => {
  await svc.resumeCampaign(pool, id, req.user.user_id);
  nudgeWhatsAppCampaignWorker();
  res.json({ success: true, message: 'Campaign resumed' });
}, 'Server error resuming campaign');

exports.cancelCampaign = withId(async (req, res, id) => {
  const skipped = await svc.cancelCampaign(pool, id, req.user.user_id);
  res.json({ success: true, message: 'Campaign cancelled', data: { skipped } });
}, 'Server error cancelling campaign');

// ── Public: Interakt delivery-status webhook ────────────────────────────────

function tokenMatches(given) {
  const expected = String(process.env.INTERAKT_WEBHOOK_TOKEN || '').trim();
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.interaktWebhook = async (req, res) => {
  if (!String(process.env.INTERAKT_WEBHOOK_TOKEN || '').trim()) {
    return res.status(503).json({ success: false, message: 'Webhook not configured' });
  }
  const given = req.query.token || req.get('x-webhook-token');
  if (!tokenMatches(given)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const event = svc.parseWebhookEvent(req.body);
    if (event) {
      const matched = await svc.applyWebhookEvent(pool, event, req.body);
      logger.debug({ status: event.status, matched }, 'Interakt webhook processed');
    }
  } catch (err) {
    // Acknowledge anyway; Interakt retries would only repeat the same failure.
    logger.error({ err: err.message }, 'Interakt webhook processing failed');
  }
  return res.json({ success: true });
};
