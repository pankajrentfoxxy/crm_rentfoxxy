const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * Authenticate vendor portal JWT (type: vendor_portal).
 * Attaches req.vendor = { vendor_id, email }
 */
async function vendorPortalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'vendor_portal' || !decoded.vendor_id) {
      return res.status(401).json({ success: false, message: 'Invalid vendor token' });
    }

    const session = await pool.query(
      `SELECT session_id FROM vendor_portal_sessions
       WHERE token = $1 AND vendor_id = $2 AND expires_at > NOW()`,
      [token, decoded.vendor_id]
    );
    if (!session.rows.length) {
      return res.status(401).json({ success: false, message: 'Session expired or revoked' });
    }

    const vendor = await pool.query(
      `SELECT vendor_id, email, status, business_name, first_name, vendor_portal_enabled
       FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
      [decoded.vendor_id]
    );
    if (!vendor.rows.length) {
      return res.status(401).json({ success: false, message: 'Vendor not found' });
    }
    const v = vendor.rows[0];
    if (v.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Vendor account is not active' });
    }
    if (v.vendor_portal_enabled === false) {
      return res.status(403).json({ success: false, message: 'Vendor portal access is disabled' });
    }

    req.vendor = {
      vendor_id: v.vendor_id,
      email: v.email,
      business_name: v.business_name,
      first_name: v.first_name
    };
    req.vendorToken = token;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { vendorPortalAuth };
