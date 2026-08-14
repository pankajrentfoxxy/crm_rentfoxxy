'use strict';

/**
 * Cron worker: BlueDart TNT AWB status → CRM delivery sync.
 * Default: every 20 minutes (IST). Toggle with BLUEDART_AWB_SYNC_ENABLED.
 */

const bluedartTracking = require('./bluedartTrackingService');
const { syncUndeliveredAwbs } = require('./bluedartAwbSyncService');

let cronJob = null;

function syncEnabled() {
  const raw = String(process.env.BLUEDART_AWB_SYNC_ENABLED || 'true').toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  return bluedartTracking.isConfigured();
}

function cronExpression() {
  // Every 20 minutes by default (15–30 min range per product ask)
  return String(process.env.BLUEDART_AWB_SYNC_CRON || '*/20 * * * *').trim() || '*/20 * * * *';
}

async function runSyncSweep() {
  try {
    const summary = await syncUndeliveredAwbs();
    if (summary?.skipped) {
      console.log('[BlueDartAwbSyncWorker] skipped:', summary.reason);
    }
  } catch (err) {
    console.error('[BlueDartAwbSyncWorker] sweep failed:', err.message);
  }
}

function startBluedartAwbSyncWorker() {
  if (cronJob) return;
  if (!syncEnabled()) {
    console.log('BlueDart AWB sync worker not started (disabled or tracking not configured)');
    return;
  }

  const cron = require('node-cron');
  const expr = cronExpression();
  if (!cron.validate(expr)) {
    console.error(`[BlueDartAwbSyncWorker] Invalid cron "${expr}" — worker not started`);
    return;
  }

  cronJob = cron.schedule(expr, runSyncSweep, { timezone: 'Asia/Kolkata' });
  console.log(`BlueDart AWB sync worker started (cron: ${expr} IST)`);

  // Optional kick shortly after boot so in-transit AWBs catch up without waiting a full cycle
  const bootDelayMs = Math.max(0, parseInt(process.env.BLUEDART_AWB_SYNC_BOOT_DELAY_MS || '45000', 10) || 45000);
  if (bootDelayMs > 0) {
    setTimeout(() => {
      runSyncSweep();
    }, bootDelayMs);
  }
}

function stopBluedartAwbSyncWorker() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = {
  startBluedartAwbSyncWorker,
  stopBluedartAwbSyncWorker,
  runSyncSweep,
};
