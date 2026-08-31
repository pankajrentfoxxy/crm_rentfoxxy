/**
 * Secure QR payloads for warehouse gate documents.
 *
 * Payload is a document identifier + unguessable token — not customer/vendor PII.
 * Example: RFXG1|dc|DC/26-27/1206|a1b2c3...
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const pool = require('../config/db');

const PREFIX = 'RFXG1';

function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}

function buildPayload({ docType, docNumber, token }) {
  return `${PREFIX}|${String(docType || '').toLowerCase()}|${String(docNumber || '').trim()}|${token}`;
}

function parseGateQrPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const parts = text.split('|');
  if (parts.length >= 4 && parts[0] === PREFIX) {
    return {
      kind: 'qr',
      docType: String(parts[1] || '').toLowerCase(),
      docNumber: parts.slice(2, -1).join('|'),
      token: parts[parts.length - 1],
    };
  }
  return null;
}

async function ensureDocumentToken(db, { docType, docNumber }) {
  const client = db || pool;
  const type = String(docType || '').toLowerCase();
  const number = String(docNumber || '').trim();
  if (!type || !number) throw new Error('Document type and number are required for a gate QR');

  const existing = await client.query(
    `SELECT token FROM gate_document_tokens
      WHERE document_type = $1 AND document_number = $2
      LIMIT 1`,
    [type, number]
  );
  if (existing.rows[0]) {
    return {
      token: existing.rows[0].token,
      payload: buildPayload({ docType: type, docNumber: number, token: existing.rows[0].token }),
    };
  }

  const token = makeToken();
  try {
    await client.query(
      `INSERT INTO gate_document_tokens (token, document_type, document_number)
       VALUES ($1, $2, $3)`,
      [token, type, number]
    );
    return { token, payload: buildPayload({ docType: type, docNumber: number, token }) };
  } catch (err) {
    if (err.code === '23505') {
      const again = await client.query(
        `SELECT token FROM gate_document_tokens
          WHERE document_type = $1 AND document_number = $2
          LIMIT 1`,
        [type, number]
      );
      if (again.rows[0]) {
        return {
          token: again.rows[0].token,
          payload: buildPayload({ docType: type, docNumber: number, token: again.rows[0].token }),
        };
      }
    }
    throw err;
  }
}

async function lookupToken(db, token) {
  if (!token) return null;
  const client = db || pool;
  const r = await client.query(
    `SELECT token, document_type, document_number
       FROM gate_document_tokens
      WHERE token = $1
      LIMIT 1`,
    [String(token).trim()]
  );
  return r.rows[0] || null;
}

async function renderGateQrPng(payload, pixels = 240) {
  return QRCode.toBuffer(String(payload), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: pixels,
    color: { dark: '#111827', light: '#FFFFFF' },
  });
}

async function ensureGateQrPng(opts) {
  const { payload } = await ensureDocumentToken(opts.db, {
    docType: opts.docType,
    docNumber: opts.docNumber,
  });
  const png = await renderGateQrPng(payload, opts.pixels || 240);
  return { payload, png };
}

function drawGateQr(doc, png, {
  x, y, size = 36, caption = 'Gate scan',
} = {}) {
  if (!doc || !png) return;
  doc.image(png, x, y, { width: size, height: size });
  if (caption) {
    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
      .text(caption, x, y + size + 1, { width: size, align: 'center' });
  }
}

module.exports = {
  PREFIX,
  buildPayload,
  parseGateQrPayload,
  ensureDocumentToken,
  lookupToken,
  renderGateQrPng,
  ensureGateQrPng,
  drawGateQr,
};
