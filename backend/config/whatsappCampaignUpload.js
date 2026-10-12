/**
 * Upload rules for WhatsApp campaign contact files. Kept in memory (never written to
 * disk) and capped well below the global UPLOAD_MAX_FILE_MB.
 */
const path = require('path');
const multer = require('multer');
const { wrapMulter } = require('./uploadLimits');

const WHATSAPP_IMPORT_MAX_FILE_MB = Math.max(1, parseInt(process.env.WHATSAPP_IMPORT_MAX_FILE_MB || '5', 10));

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream', // some browsers send this for .csv/.xls
]);

const contactFileUpload = wrapMulter(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WHATSAPP_IMPORT_MAX_FILE_MB * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase())) {
      const err = new Error('Only .xlsx, .xls and .csv files are allowed');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
}).single('file'));

module.exports = { WHATSAPP_IMPORT_MAX_FILE_MB, contactFileUpload };
