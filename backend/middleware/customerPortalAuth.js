const pool = require('../config/db');

async function customerPortalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    const sessionRes = await pool.query(
      `SELECT s.*, c.customer_id, c.name, c.company_name, c.email, c.portal_enabled
       FROM customer_portal_sessions s
       JOIN customers c ON c.customer_id = s.customer_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (!sessionRes.rows.length) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid' });
    }

    const session = sessionRes.rows[0];
    // Sessions minted by a super admin from the CRM. Undefined on databases that
    // predate the impersonation migration, which correctly reads as "not impersonated".
    const impersonatedBy = session.impersonated_by ?? null;

    // A super admin is allowed to preview a portal that is switched off — that is
    // precisely when previewing is useful. The customer themselves still cannot
    // log in, because /login checks portal_enabled before issuing a session.
    if (!session.portal_enabled && !impersonatedBy) {
      return res.status(403).json({ success: false, message: 'Portal access disabled' });
    }

    req.customer = {
      customer_id: session.customer_id,
      name: session.name,
      company_name: session.company_name,
      email: session.email,
    };
    req.portalToken = token;
    req.portalImpersonatedBy = impersonatedBy;
    next();
  } catch (err) {
    console.error('customerPortalAuth:', err);
    res.status(500).json({ success: false, message: 'Auth error' });
  }
}

/**
 * Impersonated sessions are strictly read-only: an admin looking at the portal
 * must not be able to raise tickets or change the password as the customer.
 * Those actions belong in the CRM, under the admin's own identity.
 */
function blockImpersonatedWrites(req, res, next) {
  if (req.portalImpersonatedBy) {
    return res.status(403).json({
      success: false,
      message: 'This is a read-only admin preview of the customer portal. Perform this action from the CRM instead.',
      read_only: true,
    });
  }
  next();
}

module.exports = { customerPortalAuth, blockImpersonatedWrites };
