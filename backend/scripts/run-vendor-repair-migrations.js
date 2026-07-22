#!/usr/bin/env node
/**
 * Applies all vendor-repair VRDC migrations (121, 124, 125, 129, 130, 131).
 * Safe to re-run — SQL uses IF NOT EXISTS.
 */
require('dotenv').config();
const svc = require('../services/vendorRepairDcService');

svc.ensureVendorRepairSchema()
  .then(() => {
    console.log('All vendor repair migrations applied.');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
