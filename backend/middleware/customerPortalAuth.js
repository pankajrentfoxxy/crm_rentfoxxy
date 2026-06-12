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
    if (!session.portal_enabled) {
      return res.status(403).json({ success: false, message: 'Portal access disabled' });
    }

    req.customer = {
      customer_id: session.customer_id,
      name: session.name,
      company_name: session.company_name,
      email: session.email,
    };
    req.portalToken = token;
    next();
  } catch (err) {
    console.error('customerPortalAuth:', err);
    res.status(500).json({ success: false, message: 'Auth error' });
  }
}

module.exports = { customerPortalAuth };
