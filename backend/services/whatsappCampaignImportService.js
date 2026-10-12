/**
 * Contact import for WhatsApp campaigns: parse an uploaded .xlsx / .xls / .csv,
 * normalise Indian mobiles, classify every row (valid / invalid / duplicate) and
 * persist the result. Nothing is dropped silently: invalid and duplicate rows are
 * stored with status SKIPPED and a reason, so they can be reviewed and downloaded.
 *
 * The original file is never written to disk; only normalised rows are kept.
 */
const XLSX = require('xlsx');
const {
  NAME_HEADERS, MOBILE_HEADERS, normalizeHeader, sanitizeText, missingColumns,
} = require('./whatsappCampaignTemplate');

const MAX_ROWS = Math.max(1, parseInt(process.env.WHATSAPP_IMPORT_MAX_ROWS || '50000', 10));
const MAX_NAME_LENGTH = 100;
const INDIA = '+91';

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
    this.status = 400;
  }
}

/** Decide the real file type from its bytes; the extension must agree. */
function detectFileKind(buffer, originalName) {
  const ext = String(originalName || '').toLowerCase().split('.').pop();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw new ImportError('Only .xlsx, .xls and .csv files are allowed');
  }
  if (!buffer || !buffer.length) throw new ImportError('The uploaded file is empty');
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isOle = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (ext === 'xlsx' && !isZip) throw new ImportError('This file is not a valid .xlsx workbook');
  if (ext === 'xls' && !isOle) throw new ImportError('This file is not a valid .xls workbook');
  if (ext === 'csv') {
    if (isZip || isOle) throw new ImportError('This looks like an Excel workbook — save it with the .xlsx/.xls extension');
    if (buffer.subarray(0, 8192).includes(0)) throw new ImportError('This file is not a text CSV');
  }
  return ext;
}

function cellToString(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** @returns {string[][]} first sheet as rows of raw strings, trailing blank rows removed */
function parseRows(buffer, kind) {
  let workbook;
  try {
    const common = {
      cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, sheetRows: MAX_ROWS + 2,
    };
    workbook = kind === 'csv'
      // raw: keep every CSV value as text, so 919876543210 never becomes 9.19E+11
      ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { ...common, type: 'string', raw: true })
      : XLSX.read(buffer, { ...common, type: 'buffer' });
  } catch (err) {
    throw new ImportError(`Could not read the file: ${err.message}`);
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ImportError('The file has no sheets');
  const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1, raw: true, defval: '', blankrows: true,
  });
  const rows = raw.map((r) => (Array.isArray(r) ? r.map(cellToString) : []));
  while (rows.length && rows[rows.length - 1].every((c) => !String(c).trim())) rows.pop();
  return rows;
}

/**
 * Indian mobile normalisation. Accepts 10 digits, 0 + 10, 91 + 10, +91 + 10,
 * 0091 + 10, with spaces / hyphens / dots / brackets anywhere.
 * @returns {{ ok: true, countryCode: string, phoneNumber: string } | { ok: false, error: string }}
 */
function normalizeMobile(raw) {
  const original = String(raw ?? '').trim();
  if (!original) return { ok: false, error: 'Mobile is missing' };
  const compact = original.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false, error: 'Mobile contains invalid characters' };
  let digits = compact.replace(/^\+/, '');
  const hadPlus = compact.startsWith('+');
  if (hadPlus) {
    if (!digits.startsWith('91')) return { ok: false, error: 'Only Indian (+91) numbers are supported' };
    digits = digits.slice(2);
  } else if (digits.length === 14 && digits.startsWith('0091')) {
    digits = digits.slice(4);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return { ok: false, error: 'Mobile must have 10 digits' };
  if (!/^[6-9]/.test(digits)) return { ok: false, error: 'Indian mobile numbers start with 6, 7, 8 or 9' };
  return { ok: true, countryCode: INDIA, phoneNumber: digits };
}

/** Map header row → column descriptors, and find Name / Mobile. */
function resolveColumns(headerRow) {
  const columns = [];
  const seen = new Map();
  let nameIdx = -1;
  let mobileIdx = -1;
  headerRow.forEach((cell, idx) => {
    const label = sanitizeText(cell, 100);
    let key = normalizeHeader(label);
    if (!key) return;
    if (nameIdx === -1 && NAME_HEADERS.has(key)) { nameIdx = idx; key = 'name'; }
    else if (mobileIdx === -1 && MOBILE_HEADERS.has(key)) { mobileIdx = idx; key = 'mobile'; }
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    columns.push({ idx, label, key: n === 1 ? key : `${key}${n}` });
  });
  const missing = [];
  if (nameIdx === -1) missing.push('Name');
  if (mobileIdx === -1) missing.push('Mobile');
  if (missing.length) {
    const found = columns.map((c) => c.label).join(', ') || 'none';
    throw new ImportError(`Required column(s) missing: ${missing.join(', ')}. Columns found: ${found}`);
  }
  return { columns, nameIdx, mobileIdx };
}

/**
 * Classify every data row. Pure — no DB.
 * @param {string[][]} rows header row first
 * @param {{ bodyVariables?: object[] }} opts
 */
function validateRows(rows, { bodyVariables = [] } = {}) {
  const headerAt = rows.findIndex((r) => r.some((c) => String(c).trim()));
  if (headerAt === -1) throw new ImportError('The file has no header row');
  const { columns, nameIdx, mobileIdx } = resolveColumns(rows[headerAt]);

  const missing = missingColumns(bodyVariables, columns.map((c) => c.key));
  if (missing.length) {
    throw new ImportError(
      `The template variables use column(s) not in this file: ${missing.join(', ')}. `
      + `Columns found: ${columns.map((c) => c.label).join(', ')}`
    );
  }
  const requiredVarKeys = bodyVariables.filter((v) => v.source === 'column' && v.key !== 'name').map((v) => v.key);

  const dataRows = rows.slice(headerAt + 1);
  if (dataRows.length > MAX_ROWS) throw new ImportError(`The file has more than ${MAX_ROWS} rows`);

  const contacts = [];
  const byPhone = new Map();
  const byRow = new Map();
  const summary = { total: 0, valid: 0, invalid: 0, duplicate: 0, empty: 0 };

  dataRows.forEach((cells, i) => {
    const rowNumber = headerAt + i + 2; // 1-based spreadsheet row
    summary.total += 1;
    const variables = {};
    columns.forEach((c) => { variables[c.key] = sanitizeText(cells[c.idx]); });
    const originalMobile = sanitizeText(cells[mobileIdx], 100);
    const name = sanitizeText(cells[nameIdx], MAX_NAME_LENGTH);
    const contact = {
      rowNumber,
      name: name || null,
      countryCode: null,
      phoneNumber: null,
      originalMobile: originalMobile || null,
      variables,
      validationStatus: 'valid',
      validationError: null,
    };

    const isEmpty = Object.values(variables).every((v) => !v);
    if (isEmpty) {
      summary.empty += 1;
      summary.invalid += 1;
      contacts.push({ ...contact, validationStatus: 'invalid', validationError: 'Empty row' });
      return;
    }

    const errors = [];
    if (!name) errors.push('Name is missing');
    const phone = normalizeMobile(originalMobile);
    if (phone.ok) {
      contact.countryCode = phone.countryCode;
      contact.phoneNumber = phone.phoneNumber;
    } else {
      errors.push(phone.error);
    }
    requiredVarKeys.forEach((key) => {
      if (!variables[key]) {
        const label = columns.find((c) => c.key === key)?.label || key;
        errors.push(`${label} is empty (used in the template)`);
      }
    });
    if (errors.length) {
      summary.invalid += 1;
      contacts.push({ ...contact, validationStatus: 'invalid', validationError: errors.join('; ') });
      return;
    }

    const rowKey = columns.map((c) => variables[c.key].toLowerCase()).join('\u0001');
    const phoneKey = `${contact.countryCode}${contact.phoneNumber}`;
    if (byRow.has(rowKey)) {
      summary.duplicate += 1;
      contacts.push({ ...contact, validationStatus: 'duplicate', validationError: `Exact duplicate of row ${byRow.get(rowKey)}` });
      return;
    }
    byRow.set(rowKey, rowNumber);
    if (byPhone.has(phoneKey)) {
      summary.duplicate += 1;
      contacts.push({ ...contact, validationStatus: 'duplicate', validationError: `Duplicate number — already in row ${byPhone.get(phoneKey)}` });
      return;
    }
    byPhone.set(phoneKey, rowNumber);
    summary.valid += 1;
    contacts.push(contact);
  });

  return {
    columns: columns.map(({ key, label }) => ({ key, label })),
    contacts,
    summary,
  };
}

const INSERT_CHUNK = 2000;

/**
 * Replace a campaign's contacts with a freshly parsed file. Runs in one transaction
 * and only while the campaign is DRAFT or READY.
 */
async function importContacts(db, { campaignId, fileName, fileSize, buffer, userId }) {
  const kind = detectFileKind(buffer, fileName);
  const rows = parseRows(buffer, kind);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cRes = await client.query(
      'SELECT id, status, body_variables FROM whatsapp_campaigns WHERE id = $1 FOR UPDATE',
      [campaignId]
    );
    const campaign = cRes.rows[0];
    if (!campaign) {
      const e = new ImportError('Campaign not found');
      e.status = 404;
      throw e;
    }
    if (!['DRAFT', 'READY'].includes(campaign.status)) {
      const e = new ImportError(`Contacts cannot be changed once a campaign is ${campaign.status}`);
      e.status = 409;
      throw e;
    }

    const { columns, contacts, summary } = validateRows(rows, { bodyVariables: campaign.body_variables || [] });
    if (!summary.total) throw new ImportError('The file has a header row but no contacts');

    await client.query('DELETE FROM whatsapp_campaign_contacts WHERE campaign_id = $1', [campaignId]);
    const imp = await client.query(
      `INSERT INTO whatsapp_campaign_imports
         (campaign_id, file_name, file_size, total_rows, valid_rows, invalid_rows, duplicate_rows, empty_rows, columns, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       RETURNING *`,
      [campaignId, String(fileName).slice(0, 255), fileSize || null, summary.total, summary.valid,
        summary.invalid, summary.duplicate, summary.empty, JSON.stringify(columns), userId || null]
    );
    const importId = imp.rows[0].id;

    for (let i = 0; i < contacts.length; i += INSERT_CHUNK) {
      const chunk = contacts.slice(i, i + INSERT_CHUNK).map((c) => ({
        row_number: c.rowNumber,
        name: c.name,
        country_code: c.countryCode,
        phone_number: c.phoneNumber,
        original_mobile: c.originalMobile,
        variables: c.variables,
        validation_status: c.validationStatus,
        validation_error: c.validationError,
        status: c.validationStatus === 'valid' ? 'PENDING' : 'SKIPPED',
      }));
      await client.query(
        `INSERT INTO whatsapp_campaign_contacts
           (campaign_id, import_id, row_number, name, country_code, phone_number, original_mobile,
            variables, validation_status, validation_error, status)
         SELECT $1, $2, x.row_number, x.name, x.country_code, x.phone_number, x.original_mobile,
                x.variables, x.validation_status, x.validation_error, x.status
           FROM jsonb_to_recordset($3::jsonb) AS x(
             row_number int, name text, country_code text, phone_number text, original_mobile text,
             variables jsonb, validation_status text, validation_error text, status text)`,
        [campaignId, importId, JSON.stringify(chunk)]
      );
    }

    await client.query(
      `UPDATE whatsapp_campaigns
          SET total_contacts = $2::int, valid_contacts = $3::int, invalid_contacts = $4::int, duplicate_contacts = $5::int,
              skipped_count = $4::int + $5::int, queued_count = 0, sent_count = 0, failed_count = 0,
              delivered_count = 0, read_count = 0,
              status = CASE WHEN $3::int > 0 THEN 'READY' ELSE 'DRAFT' END,
              updated_at = NOW()
        WHERE id = $1`,
      [campaignId, summary.total, summary.valid, summary.invalid, summary.duplicate]
    );
    await client.query('COMMIT');
    return { import: imp.rows[0], summary, columns };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ImportError,
  MAX_ROWS,
  detectFileKind,
  parseRows,
  normalizeMobile,
  resolveColumns,
  validateRows,
  importContacts,
};
