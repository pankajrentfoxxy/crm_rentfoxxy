const { validationResult, body, param } = require('express-validator');
const dispatchQcCapture = require('../services/dispatchQcCaptureService');
const { buildSessionExe } = require('../services/hwCaptureExeService');

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function parseActual(body = {}) {
  return {
    manufacturer: body.manufacturer ?? body.brand ?? '',
    model: body.model ?? '',
    model_version: body.model_version ?? '',
    system_family: body.system_family ?? '',
    processor: body.processor ?? '',
    generation: body.generation ?? '',
    ram: body.ram ?? '',
    ssd: body.ssd ?? body.storage ?? '',
    gpu: body.gpu ?? '',
  };
}

async function createTicketCaptureToken(req, res) {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    if (!ticketId) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }
    const data = await dispatchQcCapture.createDispatchQcToken({
      ticketId,
      createdBy: req.user?.user_id,
      req,
    });
    res.json({ success: true, data });
  } catch (e) {
    console.error('createDispatchQcCaptureToken:', e);
    res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to create token' });
  }
}

async function getTicketCaptureStatus(req, res) {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const row = await dispatchQcCapture.getLatestTokenForTicket(ticketId);
    if (!row) {
      return res.json({ success: true, data: null });
    }
    res.json({
      success: true,
      data: {
        token: row.token_id,
        access_number: row.access_number,
        status: row.status,
        expires_at: row.expires_at,
        matched_at: row.matched_at,
        match_result: row.match_result,
        actual_config: row.actual_config,
        serial_number: row.serial_number,
        configurationMatched: row.status === 'matched',
        sales_order_number: row.sales_order_number,
        allocation_id: row.allocation_id,
      },
    });
  } catch (e) {
    console.error('getDispatchQcCaptureStatus:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load status' });
  }
}

const resolveValidators = [
  body('access_number').isString().trim().isLength({ min: 4, max: 8 }),
];

async function resolveAccessNumber(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid access number', errors: errors.array() });
  }
  try {
    const result = await dispatchQcCapture.resolveByAccessNumber(req.body.access_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      data: {
        token: result.token,
        expires_at: result.expires_at,
        ticket_id: result.ticket_id,
        sales_order_number: result.sales_order_number,
        expected_config: result.expected_config,
        ttspl_id: result.ttspl_id,
        api_base_url: dispatchQcCapture.apiBaseUrl(req),
      },
    });
  } catch (e) {
    console.error('resolveAccessNumber dispatch-qc:', e);
    res.status(500).json({ success: false, message: e.message || 'Resolve failed' });
  }
}

async function getPublicSession(req, res) {
  try {
    const session = await dispatchQcCapture.getPublicSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Link not found or expired' });
    }
    res.json({ success: true, data: session });
  } catch (e) {
    console.error('getPublicSession dispatch-qc:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

async function downloadWindowsExe(req, res) {
  try {
    const session = await dispatchQcCapture.getPublicSession(req.params.token);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Link not found or expired' });
    }
    const { buffer, filename } = buildSessionExe({
      apiBase: dispatchQcCapture.apiBaseUrl(req),
      token: req.params.token,
      apiPrefix: 'dispatch-qc-capture',
      brand: 'Dispatch QC',
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (e) {
    console.error('downloadWindowsExe dispatch-qc:', e);
    res.status(e.status || 500).json({ success: false, message: e.message || 'EXE build failed' });
  }
}

const verifyValidators = [param('token').isUUID()];

async function verifyConfiguration(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const actual = parseActual(req.body);
    const result = await dispatchQcCapture.verifyDispatchQcConfiguration(
      req.params.token,
      actual,
      clientIp(req)
    );
    if (!result.ok && result.code) {
      return res.status(result.code).json({
        success: false,
        configurationMatched: false,
        message: result.message,
      });
    }
    return res.json({
      success: result.configurationMatched,
      configurationMatched: result.configurationMatched,
      checks: result.checks,
      errors: result.errors,
      expected: result.expected,
      dispatch_qc_failed: result.dispatch_qc_failed || false,
      routed_to_pending_inventory: result.routed_to_pending_inventory || false,
      remarks: result.remarks || null,
    });
  } catch (e) {
    console.error('verifyConfiguration dispatch-qc:', e);
    res.status(500).json({ success: false, message: e.message || 'Verify failed' });
  }
}

const submitSerialValidators = [
  param('token').isUUID(),
  body('serial_number').isString().trim().isLength({ min: 3, max: 120 }),
];

async function submitSerial(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const result = await dispatchQcCapture.submitDispatchQcSerial(req.params.token, req.body.serial_number);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, serial_number: result.serial_number });
  } catch (e) {
    console.error('submitSerial dispatch-qc:', e);
    res.status(500).json({ success: false, message: e.message || 'Submit failed' });
  }
}

module.exports = {
  createTicketCaptureToken,
  getTicketCaptureStatus,
  resolveValidators,
  resolveAccessNumber,
  getPublicSession,
  downloadWindowsExe,
  verifyValidators,
  verifyConfiguration,
  submitSerialValidators,
  submitSerial,
};
