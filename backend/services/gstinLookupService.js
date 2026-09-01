/**
 * GSTIN lookup via Zoho Books (India).
 *
 * Temporary mode (working browser session — use for now):
 *   ZOHO_BOOKS_COOKIE
 *   ZOHO_BOOKS_CSRF_TOKEN   (full value, e.g. zbcsparam=...)
 *   ZOHO_BOOKS_ORGANIZATION_ID
 *   ZOHO_BOOKS_SESSION_URL  (optional, default https://books.zoho.in/api/v3/search/gstin)
 *
 * Later (OAuth — leave unset until ready):
 *   ZOHO_BOOKS_CLIENT_ID / SECRET / REFRESH_TOKEN
 */
const path = require('path');
const axios = require('axios');

// Re-load backend/.env so cookie/CSRF updates apply without always restarting.
function reloadEnv() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });
  } catch {
    // ignore
  }
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

let _tokenCache = { access_token: null, expires_at: 0 };

function sanitizeGstin(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
}

function isValidGstin(gstin) {
  return GSTIN_RE.test(sanitizeGstin(gstin));
}

function hasSessionAuth() {
  return Boolean(
    String(process.env.ZOHO_BOOKS_COOKIE || '').trim()
    && String(process.env.ZOHO_BOOKS_CSRF_TOKEN || '').trim()
    && String(process.env.ZOHO_BOOKS_ORGANIZATION_ID || '').trim()
  );
}

function hasOAuthAuth() {
  return Boolean(
    process.env.ZOHO_BOOKS_CLIENT_ID
    && process.env.ZOHO_BOOKS_CLIENT_SECRET
    && process.env.ZOHO_BOOKS_REFRESH_TOKEN
    && process.env.ZOHO_BOOKS_ORGANIZATION_ID
    && !String(process.env.ZOHO_BOOKS_CLIENT_ID).includes('...')
    && !String(process.env.ZOHO_BOOKS_REFRESH_TOKEN).includes('...')
  );
}

function isConfigured() {
  reloadEnv();
  return hasSessionAuth() || hasOAuthAuth();
}

function panFromGstin(gstin) {
  const g = sanitizeGstin(gstin);
  return g.length === 15 ? g.slice(2, 12) : '';
}

function joinAddressParts(addr = {}) {
  const parts = [
    addr.flno,
    addr.bno,
    addr.bnm,
    addr.st,
    addr.locality,
    addr.loc,
    addr.dst,
    addr.stcd,
    addr.pncd,
  ].map((p) => String(p || '').trim()).filter(Boolean);
  return parts.join(', ');
}

function mapConstitutionToCompanyType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('private')) return 'Pvt Ltd';
  if (raw.includes('llp') || raw.includes('limited liability')) return 'LLP';
  if (raw.includes('partnership')) return 'Partnership';
  if (raw.includes('propriet')) return 'Proprietorship';
  if (raw.includes('public') || raw.includes('government')) return 'Government';
  if (raw.includes('ngo') || raw.includes('trust') || raw.includes('society')) return 'NGO';
  return 'Other';
}

function normalizeGstPayload(raw, gstin) {
  const data = raw?.data || raw || {};
  const primary = data.pradr?.addr || data.adadr?.[0]?.addr || {};
  const companyName = data.business_name || data.lgnm || data.legal_name || data.tradeNam || '';
  const tradeName = String(data.tradeNam || data.trade_name || '').trim();
  return {
    gstin: data.gstin || gstin,
    status: data.status || null,
    company_name: companyName,
    trade_name: tradeName,
    company_type: mapConstitutionToCompanyType(data.constitution_of_business),
    address: joinAddressParts(primary),
    city: primary.dst || primary.loc || '',
    state: primary.stcd || '',
    pincode: String(primary.pncd || '').replace(/\D/g, '').slice(0, 6),
    pan_number: panFromGstin(data.gstin || gstin),
    taxpayer_type: data.taxpayer_type || null,
    registered_date: data.registered_date || null,
    is_einvoice_enabled: data.is_einvoice_enabled === true || data.einvoiceStatus === 'Yes',
  };
}

async function getAccessToken() {
  if (_tokenCache.access_token && Date.now() < _tokenCache.expires_at - 60000) {
    return _tokenCache.access_token;
  }

  const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.ZOHO_BOOKS_REFRESH_TOKEN,
    client_id: process.env.ZOHO_BOOKS_CLIENT_ID,
    client_secret: process.env.ZOHO_BOOKS_CLIENT_SECRET,
  });

  const res = await axios.post(`${accountsUrl}/oauth/v2/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });

  if (!res.data?.access_token) {
    const err = new Error(res.data?.error || 'Failed to refresh Zoho Books access token');
    err.status = 502;
    throw err;
  }

  _tokenCache.access_token = res.data.access_token;
  _tokenCache.expires_at = Date.now() + (Number(res.data.expires_in) || 3600) * 1000;
  return _tokenCache.access_token;
}

/** Exact Zoho Books web API used by the working browser curl (cookie + CSRF). */
async function lookupViaSession(gstin) {
  const orgId = String(process.env.ZOHO_BOOKS_ORGANIZATION_ID || '').trim();
  const cookie = String(process.env.ZOHO_BOOKS_COOKIE || '').trim();
  let csrf = String(process.env.ZOHO_BOOKS_CSRF_TOKEN || '').trim();
  // Accept raw token or full "zbcsparam=..." header value
  if (csrf && !csrf.toLowerCase().startsWith('zbcsparam=')) {
    csrf = `zbcsparam=${csrf}`;
  }
  const url = String(
    process.env.ZOHO_BOOKS_SESSION_URL || 'https://books.zoho.in/api/v3/search/gstin'
  ).trim();
  const roleId = String(process.env.ZOHO_BOOKS_ROLE_ID || '967576000000000777').trim();
  const assetVersion = String(process.env.ZOHO_BOOKS_ASSET_VERSION || 'Aug_04_2026_3_18762').trim();

  const { data, status } = await axios.get(url, {
    params: { gstin, organization_id: orgId },
    headers: {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      Referer: `https://books.zoho.in/app/${orgId}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'X-ROLE-ID': roleId,
      'X-ZB-Asset-Version': assetVersion,
      'X-ZB-SOURCE': 'zbclient',
      'X-ZCSRF-TOKEN': csrf,
      'X-ZOHO-Include-Formatted': 'true',
      Cookie: cookie,
    },
    timeout: 25000,
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (status === 401 || status === 403) {
    const err = new Error(
      `Zoho Books session rejected (${status}) — update ZOHO_BOOKS_COOKIE and ZOHO_BOOKS_CSRF_TOKEN from a fresh working browser curl`
    );
    err.status = 401;
    throw err;
  }

  return data;
}

async function lookupViaOAuth(gstin) {
  const token = await getAccessToken();
  const base = (process.env.ZOHO_BOOKS_API_BASE || 'https://www.zohoapis.in/books/v3').replace(/\/$/, '');
  const orgId = process.env.ZOHO_BOOKS_ORGANIZATION_ID;

  const { data } = await axios.get(`${base}/search/gstin`, {
    params: { gstin, organization_id: orgId },
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/json',
    },
    timeout: 25000,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return data;
}

async function lookupGstin(rawGstin) {
  reloadEnv();
  const gstin = sanitizeGstin(rawGstin);
  if (!isValidGstin(gstin)) {
    const err = new Error('Invalid GSTIN format');
    err.status = 400;
    throw err;
  }
  if (!hasSessionAuth() && !hasOAuthAuth()) {
    const err = new Error(
      'GSTIN lookup is not configured (set ZOHO_BOOKS_COOKIE + ZOHO_BOOKS_CSRF_TOKEN + ZOHO_BOOKS_ORGANIZATION_ID)'
    );
    err.status = 503;
    throw err;
  }

  // Prefer the working session curl for now; OAuth later when ready.
  const data = hasSessionAuth()
    ? await lookupViaSession(gstin)
    : await lookupViaOAuth(gstin);

  if (data?.code && Number(data.code) !== 0) {
    const err = new Error(data.message || 'GSTIN lookup failed');
    err.status = 404;
    throw err;
  }

  const normalized = normalizeGstPayload(data, gstin);
  if (!normalized.company_name && !normalized.address) {
    const err = new Error(data?.message || 'No GST details found for this GSTIN');
    err.status = 404;
    throw err;
  }
  return normalized;
}

module.exports = {
  lookupGstin,
  sanitizeGstin,
  isValidGstin,
  isConfigured,
  normalizeGstPayload,
  panFromGstin,
};
