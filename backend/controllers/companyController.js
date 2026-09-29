/**
 * Company / legal-entity settings (Rentfoxxy, Gorefurbo).
 * Backs the entity separation — GSTIN, legal name, address, logo, number prefixes.
 *
 * Documents print from `companies` merged over utils/companyDefaults.js. When a
 * database has no row for an entity (QA, 29 Sep 2026: the table is empty) the
 * documents print the defaults, but Settings listed nothing and a save answered
 * 404 — the entity could not be edited at all. Now the list always shows both
 * entities (a missing one flagged `saved: false`, showing exactly what the
 * documents print today) and the first save creates the row from those same
 * values, so nothing printed changes until someone changes a field.
 *
 * GSTIN / PAN / state code / email are checked on the server: a typo here is
 * printed on every tax document and decides CGST+SGST vs IGST.
 */
const pool = require('../config/db');
const { validateIndianMobile, normalizeIndianMobile } = require('../utils/phoneValidation');
const { mergeCompany } = require('../utils/companyDefaults');

const ENTITY_CODES = ['rentfoxxy', 'gorefurbo'];
// Same prefixes migration 074 seeds; only used when the row does not exist yet.
const ENTITY_PREFIXES = {
  rentfoxxy: { dc_prefix: 'DC-', invoice_prefix: 'INV-' },
  gorefurbo: { dc_prefix: 'GDC-', invoice_prefix: 'GINV-' },
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_CODE_RE = /^[0-9]{2}$/;
const HSN_RE = /^[0-9]{4,8}$/;

const COLS = `company_id, code, legal_name, gstin, pan, email, phone, address, state_code,
              hsn_code, logo_url, dc_prefix, invoice_prefix, active`;

const up = (v) => (v == null ? v : String(v).trim().toUpperCase());
const trimOrNull = (v) => (v == null ? null : String(v).trim());

/** What a missing entity prints today (defaults), shaped like a row. */
function defaultRow(code) {
  const d = mergeCompany({ code });
  return {
    company_id: null,
    code,
    legal_name: d.legal_name || null,
    gstin: d.gstin || null,
    pan: null,
    email: d.email || null,
    phone: null,
    address: d.address || null,
    state_code: d.state_code || null,
    hsn_code: '84713000',
    logo_url: d.logo_url || null,
    ...ENTITY_PREFIXES[code],
    active: true,
  };
}

/**
 * Normalise + validate an update body. Returns { values } or { error }.
 * Only fields present in the body are checked; an empty string is not a value
 * (the update keeps what is stored — COALESCE), matching the old behaviour.
 */
function validateCompanyUpdate(body) {
  const b = body || {};
  const v = {
    legal_name: trimOrNull(b.legal_name),
    gstin: up(b.gstin),
    pan: up(b.pan),
    address: trimOrNull(b.address),
    state_code: trimOrNull(b.state_code),
    hsn_code: trimOrNull(b.hsn_code),
    logo_url: trimOrNull(b.logo_url),
    email: trimOrNull(b.email),
    phone: trimOrNull(b.phone),
    active: typeof b.active === 'boolean' ? b.active : null,
  };
  Object.keys(v).forEach((k) => { if (v[k] === '') v[k] = null; });

  if (b.legal_name != null && !v.legal_name) return { error: 'Legal name cannot be empty' };
  if (v.gstin && !GSTIN_RE.test(v.gstin)) return { error: 'GSTIN is not valid (15 characters, e.g. 06AAHCT0310N1ZG)' };
  if (v.pan && !PAN_RE.test(v.pan)) return { error: 'PAN is not valid (e.g. AAHCT0310N)' };
  if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan) return { error: 'PAN does not match the GSTIN (characters 3–12 of the GSTIN are the PAN)' };
  if (v.state_code && !STATE_CODE_RE.test(v.state_code)) return { error: 'State code is the two-digit GST state code (e.g. 06 for Haryana)' };
  if (v.gstin && v.state_code && v.gstin.slice(0, 2) !== v.state_code) return { error: `State code ${v.state_code} does not match the GSTIN (it starts ${v.gstin.slice(0, 2)})` };
  if (v.hsn_code && !HSN_RE.test(v.hsn_code)) return { error: 'HSN code is 4 to 8 digits' };
  if (v.email && !EMAIL_RE.test(v.email)) return { error: 'Email is not valid' };
  if (v.phone) {
    const phoneError = validateIndianMobile(v.phone, { label: 'Phone' });
    if (phoneError) return { error: phoneError };
    v.phone = normalizeIndianMobile(v.phone);
  }
  return { values: v };
}

exports.listCompanies = async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM companies ORDER BY company_id ASC`);
    const out = rows.map((r) => ({ ...r, saved: true }));
    ENTITY_CODES.forEach((code) => {
      if (!out.some((r) => r.code === code)) out.push({ ...defaultRow(code), saved: false });
    });
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('listCompanies:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCompany = async (req, res) => {
  const { code } = req.params;
  const { values: v, error } = validateCompanyUpdate(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // An entity with no row yet is created from what its documents print today.
    if (ENTITY_CODES.includes(code)) {
      const d = defaultRow(code);
      await client.query(
        `INSERT INTO companies (code, legal_name, gstin, email, address, state_code, hsn_code, logo_url, dc_prefix, invoice_prefix)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (code) DO NOTHING`,
        [code, d.legal_name, d.gstin, d.email, d.address, d.state_code, d.hsn_code, d.logo_url, d.dc_prefix, d.invoice_prefix]
      );
    }
    const { rows } = await client.query(
      `UPDATE companies SET
         legal_name = COALESCE($2, legal_name),
         gstin = COALESCE($3, gstin),
         pan = COALESCE($4, pan),
         address = COALESCE($5, address),
         state_code = COALESCE($6, state_code),
         hsn_code = COALESCE($7, hsn_code),
         logo_url = COALESCE($8, logo_url),
         active = COALESCE($9, active),
         email = COALESCE($10, email),
         phone = COALESCE($11, phone),
         updated_at = NOW()
       WHERE code = $1
       RETURNING ${COLS}`,
      [code, v.legal_name, v.gstin, v.pan, v.address, v.state_code, v.hsn_code, v.logo_url, v.active, v.email, v.phone]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    // The stored row as a whole must still be consistent (e.g. a new GSTIN
    // against the PAN / state code already saved).
    const r = rows[0];
    if (r.gstin && r.pan && String(r.gstin).slice(2, 12) !== String(r.pan)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `PAN ${r.pan} does not match GSTIN ${r.gstin} — change both together` });
    }
    if (r.gstin && r.state_code && STATE_CODE_RE.test(r.state_code) && String(r.gstin).slice(0, 2) !== r.state_code) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `State code ${r.state_code} does not match GSTIN ${r.gstin} — change both together` });
    }
    await client.query('COMMIT');
    res.json({ success: true, data: { ...r, saved: true } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateCompany:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

exports._test = { validateCompanyUpdate, defaultRow, ENTITY_CODES };
