'use strict';

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

let job = null;

function startDualRunWorker() {
  if (job) return job;
  job = cron.schedule('15 2 * * *', () => {
    const script = path.join(__dirname, '../scripts/dual-run-compare.js');
    spawn(process.execPath, [script], { stdio: 'ignore', detached: true }).unref();
  }, { timezone: 'Asia/Kolkata' });
  return job;
}

module.exports = { startDualRunWorker };
