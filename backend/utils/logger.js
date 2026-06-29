/**
 * Structured logging — pino wrapper. Falls back to console when pino unavailable.
 */
let pino;
try {
  // eslint-disable-next-line global-require
  pino = require('pino');
} catch {
  pino = null;
}

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino
  ? pino({
      level,
      base: { service: 'crm-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
    })
  : {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
      debug: (...args) => console.debug(...args),
      child: () => logger,
    };

module.exports = logger;
