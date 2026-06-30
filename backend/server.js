const express = require('express');
const cors = require('cors');
require('dotenv').config();

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
  'https://rentfoxxy.vercel.app',
  'http://187.77.187.213',
  'https://187.77.187.213',
  'http://crm.rentfoxxy.com',
  'https://crm.rentfoxxy.com',
  'http://staging.rentfoxxy.com',
  'https://staging.rentfoxxy.com'
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
app.use(express.json({ limit: BODY_PARSER_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_PARSER_LIMIT }));
app.use('/uploads', express.static('uploads'));

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
app.use('/api/grn-capture', require('./routes/grnCapturePublic'));
app.use('/api/grn-access-public', require('./routes/grnAccessPublic'));
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
app.use('/api/vendor-repair', require('./routes/vendorRepair'));

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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  }

  // Background workers — enable via env (default: on when configured).
  const workersOn = String(process.env.ENABLE_BACKGROUND_WORKERS || 'true').toLowerCase() !== 'false';
  if (workersOn) {
    startEmailQueueWorker().catch((err) => console.error('Email queue worker failed:', err.message));
    // startLeadEmailIngestionWorker().catch((err) => console.error('Lead email ingestion worker failed:', err.message));
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
  ensureSupportSchema().catch((err) => console.error('Support schema ensure failed:', err.message));
  ensureUserSchema().catch((err) => console.error('User schema ensure failed:', err.message));
  ensureVendorManagementSchema().catch((err) => console.error('Vendor management schema failed:', err.message));
  ensureVendorBillingSchema().catch((err) => console.error('Vendor billing schema failed:', err.message));
  ensureSalesManagementSchema().catch((err) => console.error('Sales management schema failed:', err.message));
  ensureCustomerManagementSchema().catch((err) => console.error('Customer management schema failed:', err.message));
  ensureBillingEngineSchema().catch((err) => console.error('Billing engine schema failed:', err.message));
  ensureLeadCrmSchema().catch((err) => console.error('Lead CRM schema ensure failed:', err.message));
  const { ensureVendorRepairSchema } = require('./services/vendorRepairDcService');
  ensureVendorRepairSchema().catch((err) => console.error('Vendor repair schema ensure failed:', err.message));
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