'use strict';

function legacyWritesAllowed() {
  return String(process.env.SUPPORT_LEGACY_WRITES || '').toLowerCase() === 'true';
}

function supportLegacyGone(_req, res) {
  return res.status(410).json({
    success: false,
    message: 'This endpoint has moved. Use /api/support/v2. See docs/support-revamp/API_MIGRATION.md',
  });
}

function freezeLegacyWrites(req, res, next) {
  if (legacyWritesAllowed()) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return supportLegacyGone(req, res);
}

module.exports = { freezeLegacyWrites, supportLegacyGone, legacyWritesAllowed };
