#!/usr/bin/env node
/**
 * Legacy: mounts salesPipeline on /api. Pipeline handlers are registered on routes/sales.js
 * (GET /qc-pipeline-orders, /dispatch-pipeline-orders) so they run before the 404 handler.
 * If injecting here, the block must be placed BEFORE app.use(errorHandler), not before app.listen.
 *
 * Usage:
 *   node deploy/inject-sales-pipeline-routes.cjs [path/to/server.js]
 *
 * Default server path: ../backend/server.js relative to this script's directory.
 * Safe to run on every deploy; skips if marker SALES_PIPELINE_ROUTES_AUTO is already present.
 */

const fs = require('fs');
const path = require('path');

const MARKER_START = 'SALES_PIPELINE_ROUTES_AUTO';
const serverPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backend', 'server.js'));

if (!fs.existsSync(serverPath)) {
    console.log('[inject-sales-pipeline] No file at', serverPath, '- skipping (nothing to patch).');
    process.exit(0);
}

let src = fs.readFileSync(serverPath, 'utf8');

if (src.includes(MARKER_START)) {
    console.log('[inject-sales-pipeline] Already registered in', serverPath);
    process.exit(0);
}

const block = `
// ${MARKER_START} — QC/Dispatch paginated APIs (managed by deploy/inject-sales-pipeline-routes.cjs)
try {
  app.use('/api', require('./routes/salesPipeline'));
} catch (_injectErr) {
  console.error('[${MARKER_START}] mount failed:', _injectErr && _injectErr.message);
}
// END ${MARKER_START}
`;

const errHandlerComment = src.match(/\n\/\/ Error handler\b/);
const errHandlerUse = src.match(/\napp\.use\(errorHandler\)/);
const listenMatch = src.match(/\bapp\.listen\s*\(/);
let idx;
if (errHandlerComment && errHandlerComment.index !== undefined) {
    idx = errHandlerComment.index + 1;
} else if (errHandlerUse && errHandlerUse.index !== undefined) {
    idx = errHandlerUse.index + 1;
} else if (listenMatch && listenMatch.index !== undefined) {
    idx = listenMatch.index;
    console.warn('[inject-sales-pipeline] Warning: inserting before app.listen( — prefer // Error handler anchor so routes run before 404.');
} else {
    console.error('[inject-sales-pipeline] Could not find // Error handler, app.use(errorHandler), or app.listen( in', serverPath);
    console.error('Add this block before the error handler / 404 middleware:\n');
    console.error(block);
    process.exit(1);
}

src = src.slice(0, idx) + block + '\n' + src.slice(idx);
fs.writeFileSync(serverPath, src, 'utf8');
console.log('[inject-sales-pipeline] Patched', serverPath);
