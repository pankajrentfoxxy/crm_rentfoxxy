const { multerErrorMessage } = require('../config/uploadLimits');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);

  if (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ success: false, message: multerErrorMessage(err) });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: multerErrorMessage(err) });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
