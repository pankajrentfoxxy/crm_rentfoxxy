const express = require('express');
const cors = require('cors');
const path = require('path');
// Always load backend/.env (cwd may be repo root when starting via scripts/PM2)
require('dotenv').config({ path: path.join(__dirname, '.env') });
// Block all outbound email unless OUTBOUND_MESSAGING_ENABLED=true. Load before any mailer.
require('./services/outboundMessagingGuard');

const errorHandler = require('./middleware/errorHandler');
const { BODY_PARSER_LIMIT } = require('./config/uploadLimits');
const { startEmailQueueWorker } = require('./services/emailQueueService');
const { startInventorySyncWorker } = require('./services/inventoryErpSyncService');
const { startLeadEmailIngestionWorker, stopLeadEmailIngestionWorker } = require('./services/leadEmailIngestionService');
const { startCustomerInventorySyncWorker } = require('./services/customerInventoryErpSyncService');

const app = express();

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:5001',
  'http://127.0.0.2:5001',
  'http://127.0.0.2:3000',
  'https://rentfoxxy.vercel.app',
  'http://187.77.187.213',
  'https://187.77.187.213',
  'http://crm.rentfoxxy.com',
  'https://crm.rentfoxxy.com',
  'http://customer.rentfoxxy.com',
  'https://customer.rentfoxxy.com',
  'http://vendor.rentfoxxy.com',
  'https://vendor.rentfoxxy.com',
  'http://staging.rentfoxxy.com',
  'https://staging.rentfoxxy.com',
  'http://qa.rentfoxxy.com',
  'https://qa.rentfoxxy.com'
];

if (process.env.FRONTEND_URL) {
  try {
    // Support comma-separated URLs
    const urls = process.env.FRONTEND_URL.split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
    urls.forEach((url) => url && !allowedOrigins.includes(url) && allowedOrigins.push(url));
  } catch (e) {
    console.error('Invalid FRONTEND_URL:', e);
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
try {
  const compression = require('compression');
  app.use(compression());
} catch {
  console.warn('[server] compression middleware unavailable — run npm install in backend/');
}

// The app sits behind nginx, so without this req.ip is always 127.0.0.1: every IP
// in the audit trail (users.last_login_ip, the impersonation log, GRN access
// attempts) was wrong, and the rate limiter below would bucket the whole
// internet into one counter. 1 = trust exactly one proxy hop (nginx).
app.set('trust proxy', 1);

try {
  const helmet = require('helmet');
  // contentSecurityPolicy is off for now: the CRM is a CRA bundle served from the
  // same origin and a default-src policy would need auditing against every inline
  // style and third-party asset first. The rest of the headers cost nothing.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
} catch {
  console.warn('[server] helmet unavailable — run npm install in backend/');
}

app.use(express.json({ limit: BODY_PARSER_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_PARSER_LIMIT }));

// One request, one correlation id, on every event that request writes (Part
// 2.1). Mounted before the routes so no handler has to thread it through.
app.use(require('./middleware/correlationId'));

try {
  // Needed to read the /uploads access cookie. Nothing else uses cookies.
  app.use(require('cookie-parser')());
} catch {
  console.warn('[server] cookie-parser unavailable — /uploads cookie auth disabled. Run npm install in backend/');
}
// VRDC PDFs must be downloaded through the authenticated API (E-way lock enforced there).
app.use('/uploads/vendor-repair', (_req, res) => {
  res.status(403).json({
    success: false,
    message: 'Download this VRDC from the CRM using the Dispatch PDF button.',
  });
});
// P0-2: these two mounts served 14,433 files to anyone on the internet. Every
// request below now needs the uploads cookie, a bearer token, or a signed URL.
// Behaviour is controlled by UPLOADS_AUTH_MODE (off | grace | enforce).
app.use('/uploads', require('./middleware/uploadsAuth').uploadsAuth);
// Always serve from backend/uploads regardless of process cwd; fall back to repo-root/uploads for legacy files.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Test database connection
const pool = require('./config/db');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/role-permissions', require('./routes/rolePermissions'));
app.use('/api/permissions', require('./routes/permissionsLegacy'));
app.use('/api/user-permissions', require('./routes/userPermissions'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/sales-management', require('./routes/salesManagement'));
app.use('/api/bluedart-awb-tracking', require('./routes/bluedartAwbTracking'));
app.use('/api/dispatch-workflow', require('./routes/dispatchWorkflow'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/delivery-register-management', require('./routes/deliveryRegisterManagement'));
app.use('/api/technician-auth', require('./routes/technicianAuth'));
app.use('/api/technicians-bucket-list', require('./routes/techniciansBucketList'));
app.use('/api/customer-management', require('./routes/customerManagement'));
app.use('/api/procurement', require('./routes/procurement'));
app.use('/api/warehouse', require('./routes/warehouse'));
app.use('/api/stages', require('./routes/stages'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/part-requests', require('./routes/partRequests'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/diagnosis', require('./routes/diagnosis'));
app.use('/api/chip-repair', require('./routes/chipLevel'));
app.use('/api/quotation', require('./routes/quotationPublic'));
// Procure safety C: the public capture links and the 6-digit access-number
// lookup had no rate limit (captureLimiter was written for them and never
// mounted), so access numbers could be enumerated and each hit burned a real
// one. Only failed requests count, so a technician capturing normally is
// never slowed.
const { captureLimiter: publicCaptureLimiter } = require('./middleware/rateLimit');
app.use('/api/grn-capture', publicCaptureLimiter, require('./routes/grnCapturePublic'));
app.use('/api/qc2-capture', publicCaptureLimiter, require('./routes/qc2CapturePublic'));
app.use('/api/qc2', require('./routes/qc2'));
app.use('/api/dispatch-qc-capture', publicCaptureLimiter, require('./routes/dispatchQcCapturePublic'));
app.use('/api/vendor-return-capture', publicCaptureLimiter, require('./routes/vendorReturnCapturePublic'));
app.use('/api/rdc-capture', publicCaptureLimiter, require('./routes/rdcCapturePublic'));
app.use('/api/dispatch-qc', require('./routes/dispatchQc'));
app.use('/api/dispatch-chargers', require('./routes/dispatchCharger'));
app.use('/api/grn-access-public', publicCaptureLimiter, require('./routes/grnAccessPublic'));
app.use('/api/support-public', require('./routes/supportRequestPublic'));
app.use('/api/grn-access', require('./routes/grnAccess'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/customer-documents', require('./routes/customerDocuments'));
app.use('/api/customer-inventory', require('./routes/customerInventory'));
app.use('/api/support', require('./routes/support'));
app.use('/api/support-parts', require('./routes/supportParts'));
app.use('/api/vendor-management', require('./routes/vendorManagement'));
app.use('/api/vendor-portal', require('./routes/vendorPortal'));
app.use('/api/customer-portal', require('./routes/customerPortal'));
app.use('/api/qc-management', require('./routes/qcManagement'));
app.use('/api/inventory-management', require('./routes/inventoryManagement'));
app.use('/api/customer-billing', require('./routes/customerBilling'));
app.use('/api/vendor-billing', require('./routes/vendorBilling'));
app.use('/api/einvoice', require('./routes/einvoice'));
app.use('/api/finance-overview', require('./routes/financeOverview'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/asset-configuration', require('./routes/assetConfiguration'));
app.use('/api/production-assets', require('./routes/productionAssets'));
app.use('/api/vendor-repair', require('./routes/vendorRepair'));
app.use('/api/part-vendor-repair', require('./routes/partVendorRepair'));
  app.use('/api/scrap-challans', require('./routes/scrapChallan'));
  app.use('/api/physical-parts', require('./routes/physicalDeadParts'));
app.use('/api/utils', require('./routes/utils'));
app.use('/api/guard-gate', require('./routes/guardGate'));
app.use('/api/taskflow', require('./routes/taskflow'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// API health with DB check
app.get('/api/health', async (req, res) => {
  try {
    const pool = require('./config/db');
    await pool.query('SELECT 1');
    res.json({
      success: true,
      message: 'Server and database OK',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Laptop Refurbishment API',
    version: '1.1.0',
    status: 'Bulk Move Feature Active',
    endpoints: {
      auth: '/api/auth',
      tickets: '/api/tickets',
      stages: '/api/stages',
      teams: '/api/teams',
      parts: '/api/parts',
      analytics: '/api/analytics'
    }
  });
});
// Error handler (must be last)
app.use(errorHandler);
// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});
// Express 4 does not await async route handlers, so a rejected promise in one
// becomes an unhandledRejection — and Node 22 terminates the process by default.
// A single vendor-portal login against a null password hash was enough to take
// the whole CRM down and drop every in-flight request. Log and keep serving:
// one broken request must not be a site-wide outage. This is a safety net, not
// a licence to skip try/catch in handlers.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection (process kept alive):',
    reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception (process kept alive):', err?.stack || err);
});

const PORT = process.env.PORT || 5000;
const http = require('http');
const server = http.createServer(app);
const { initSocketServer } = require('./socket');
initSocketServer(server, { allowedOrigins });

server.listen(PORT, () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  }

  // Background workers — enable via env (default: on when configured).
  const workersOn = String(process.env.ENABLE_BACKGROUND_WORKERS || 'true').toLowerCase() !== 'false';
  if (workersOn) {
    startEmailQueueWorker().catch((err) => console.error('Email queue worker failed:', err.message));
    startLeadEmailIngestionWorker().catch((err) => console.error('Lead email ingestion worker failed:', err.message));
    const { startDispatchSlaWorker } = require('./services/dispatchSlaWorker');
    startDispatchSlaWorker();
    const { startBluedartAwbSyncWorker } = require('./services/bluedartAwbSyncWorker');
    startBluedartAwbSyncWorker();
    // Part 6.2 (BL9). Separate from the billing scheduler on purpose: that cron
    // defaults to OFF, and an invoice ageing past its due date is the passage of
    // time, not a generation event.
    const { startOverdueInvoiceWorker } = require('./services/overdueInvoiceWorker');
    startOverdueInvoiceWorker();
    // startInventorySyncWorker().catch((err) => console.error('ERP inventory sync worker failed:', err.message));
    // startCustomerInventorySyncWorker().catch((err) => console.error('Customer inventory ERP worker failed:', err.message));
  }
  const { ensureSupportSchema } = require('./controllers/supportController');
  const { ensureUserSchema } = require('./controllers/authController');
  const { ensureVendorManagementSchema, ensureVendorBillingSchema } = require('./controllers/vendorManagementSchema');
  const { ensureSalesManagementSchema } = require('./controllers/salesManagementController');
  const { ensureCustomerManagementSchema } = require('./controllers/customerManagementController');
  const { ensureBillingEngineSchema } = require('./controllers/customerBillingController');
  const { ensureLeadCrmSchema } = require('./controllers/leadController');
  const { startBillingScheduler } = require('./services/billingSchedulerService');
  const { ensureAssetConfigurationSchema } = require('./controllers/assetConfigurationController');
  const { ensureVendorRepairSchema } = require('./services/vendorRepairDcService');
  const { initCache } = require('./utils/cacheService');
  // Run schema checks one after another. Firing them all at once takes most of
  // the pool and their ALTER TABLEs queue behind any open transaction.
  (async () => {
    const jobs = [
      ['Support', ensureSupportSchema],
      ['User', ensureUserSchema],
      ['Vendor management', ensureVendorManagementSchema],
      ['Vendor billing', ensureVendorBillingSchema],
      ['Sales management', ensureSalesManagementSchema],
      ['Customer management', ensureCustomerManagementSchema],
      ['Billing engine', ensureBillingEngineSchema],
      ['Lead CRM', ensureLeadCrmSchema],
      ['Asset configuration', ensureAssetConfigurationSchema],
      ['Vendor repair', ensureVendorRepairSchema],
    ];
    for (const [name, fn] of jobs) {
      try {
        await fn();
      } catch (err) {
        console.error(`${name} schema ensure failed:`, err.message);
      }
    }
  })();
  initCache().catch((err) => console.error('Cache init failed:', err.message));
  startBillingScheduler();
});

const shutdownWorkers = async (signal) => {
  console.log(`${signal} received — shutting down background workers`);
  try {
    await stopLeadEmailIngestionWorker();
  } catch (err) {
    console.error('Lead email idle shutdown failed:', err.message);
  }
};

process.on('SIGTERM', () => {
  shutdownWorkers('SIGTERM').finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdownWorkers('SIGINT').finally(() => process.exit(0));
});

module.exports = app;