function stripSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** Public customer portal origin. Production must never fall back to localhost. */
function getCustomerPortalUrl() {
  const fromEnv = stripSlash(process.env.CUSTOMER_PORTAL_URL);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return 'https://customer.rentfoxxy.com';
  return 'http://localhost:3002';
}

module.exports = { getCustomerPortalUrl };
