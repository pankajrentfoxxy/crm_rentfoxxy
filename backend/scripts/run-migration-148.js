require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const svc = require('../services/vendorRepairDcService');

(async () => {
  await svc.ensureVendorRepairSchema();
  console.log('Migration 148 applied via ensureVendorRepairSchema');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
