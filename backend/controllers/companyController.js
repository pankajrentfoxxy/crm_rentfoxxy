/**
 * Company / legal-entity settings (Rentfoxxy, Gorefurbo).
 * Backs the entity separation — GSTIN, legal name, address, logo, number prefixes.
 */
const pool = require('../config/db');
const { validateIndianMobile, normalizeIndianMobile, parseIndianMobile } = require('../utils/phoneValidation');

exports.listCompanies = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT company_id, code, legal_name, gstin, pan, email, phone, address, state_code,
              hsn_code, logo_url, dc_prefix, invoice_prefix, active
         FROM companies ORDER BY company_id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listCompanies:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateCompany = async (req, res) => {
  try {
    const { code } = req.params;
    const b = req.body || {};
    if (b.phone != null && String(b.phone).trim()) {
      const phoneError = validateIndianMobile(b.phone, { label: 'Phone' });
      if (phoneError) return res.status(400).json({ success: false, message: phoneError });
      b.phone = normalizeIndianMobile(b.phone);
    }
    const { rows } = await pool.query(
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
       RETURNING company_id, code, legal_name, gstin, pan, email, phone, address, state_code, hsn_code, logo_url, dc_prefix, invoice_prefix, active`,
      [code, b.legal_name ?? null, b.gstin ?? null, b.pan ?? null, b.address ?? null,
       b.state_code ?? null, b.hsn_code ?? null, b.logo_url ?? null,
       typeof b.active === 'boolean' ? b.active : null, b.email ?? null, b.phone ?? null]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('updateCompany:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
