const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim().replace(/^["']|["']$/g, '');
  try {
    const parsed = new URL(cleaned.replace(/^postgresql:/, 'http:'));
    const database = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (!database) return null;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
      database,
    };
  } catch {
    return null;
  }
}

const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);

const config = {
  erp: {
    host: process.env.ERP_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.ERP_MYSQL_PORT || 3306),
    user: process.env.ERP_MYSQL_USER || 'root',
    password: process.env.ERP_MYSQL_PASSWORD || '',
    database: process.env.ERP_MYSQL_DATABASE || 'erp_rentfoxxy',
  },
  crm: fromUrl || {
    host: process.env.CRM_PG_HOST || '127.0.0.1',
    port: Number(process.env.CRM_PG_PORT || 5432),
    user: process.env.CRM_PG_USER || 'postgres',
    password: process.env.CRM_PG_PASSWORD || '',
    database: process.env.CRM_PG_DATABASE || 'crm_rentfoxxy',
  },
  batchSize: Number(process.env.MIGRATION_BATCH_SIZE || 500),
  logDir: process.env.MIGRATION_LOG_DIR || require('path').join(__dirname, '..', 'logs'),
  approved: String(process.env.MIGRATION_APPROVED || 'false').toLowerCase() === 'true',
  erpStorageRoot: process.env.ERP_STORAGE_ROOT
    ? path.isAbsolute(process.env.ERP_STORAGE_ROOT)
      ? process.env.ERP_STORAGE_ROOT
      : path.join(__dirname, '..', process.env.ERP_STORAGE_ROOT)
    : '',
  crmUploadRoot: process.env.CRM_UPLOAD_ROOT
    ? path.isAbsolute(process.env.CRM_UPLOAD_ROOT)
      ? process.env.CRM_UPLOAD_ROOT
      : path.join(__dirname, '..', process.env.CRM_UPLOAD_ROOT)
    : path.join(__dirname, '..', '..', 'backend', 'uploads'),
};

module.exports = config;
