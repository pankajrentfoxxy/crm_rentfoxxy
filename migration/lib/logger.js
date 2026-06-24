const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureLogDir() {
  fs.mkdirSync(config.logDir, { recursive: true });
}

function logFile(name) {
  ensureLogDir();
  return path.join(config.logDir, `${name}.log`);
}

function writeLog(name, line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}\n`;
  fs.appendFileSync(logFile(name), msg);
  process.stdout.write(msg);
}

function progress(label, current, total) {
  writeLog('migration', `${label}: ${current}/${total} completed`);
}

module.exports = { writeLog, progress, logFile, ensureLogDir };
