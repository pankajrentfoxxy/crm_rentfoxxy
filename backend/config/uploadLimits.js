/**
 * Central upload size limits for all multer-based endpoints.
 * Override via env: UPLOAD_MAX_FILE_MB (default 50), UPLOAD_MAX_FILES (default 25).
 */
const UPLOAD_MAX_FILE_MB = Math.max(1, parseInt(process.env.UPLOAD_MAX_FILE_MB || '50', 10));
const UPLOAD_MAX_FILES = Math.max(1, parseInt(process.env.UPLOAD_MAX_FILES || '25', 10));
const UPLOAD_MAX_FILE_BYTES = UPLOAD_MAX_FILE_MB * 1024 * 1024;

/** Express JSON / urlencoded body parser limit (non-multipart payloads). */
const BODY_PARSER_LIMIT = process.env.BODY_PARSER_LIMIT || `${UPLOAD_MAX_FILE_MB}mb`;

function multerLimits(overrides = {}) {
  return {
    fileSize: UPLOAD_MAX_FILE_BYTES,
    files: UPLOAD_MAX_FILES,
    ...overrides,
  };
}

function multerErrorMessage(err) {
  if (!err) return 'Upload failed';
  if (err.code === 'LIMIT_FILE_SIZE') {
    return `File is too large. Maximum allowed size is ${UPLOAD_MAX_FILE_MB} MB per file.`;
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return `Too many files. Maximum is ${UPLOAD_MAX_FILES} files per request.`;
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Unexpected file field in upload request.';
  }
  if (err.type === 'entity.too.large') {
    return `Request body too large. Maximum is ${UPLOAD_MAX_FILE_MB} MB.`;
  }
  return err.message || 'Upload failed';
}

/** Wrap multer middleware so size/type errors return JSON 400 instead of 500. */
function wrapMulter(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) {
        const code = err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(code).json({
          success: false,
          message: multerErrorMessage(err),
        });
      }
      return next();
    });
  };
}

module.exports = {
  UPLOAD_MAX_FILE_MB,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILES,
  BODY_PARSER_LIMIT,
  multerLimits,
  multerErrorMessage,
  wrapMulter,
};
