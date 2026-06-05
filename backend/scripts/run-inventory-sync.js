#!/usr/bin/env node
/**
 * Trigger ERP inventory sync (run inside backend container)
 * Usage: node scripts/run-inventory-sync.js
 * Or from host: docker exec laptop-erp-backend node /app/scripts/run-inventory-sync.js
 */
require('dotenv').config();
const { syncInventoryFromErp } = require('../services/inventoryErpSyncService');

const bulkEnabled =
  process.env.ERP_INVENTORY_BULK_SYNC_ENABLED === '1' ||
  process.env.ERP_INVENTORY_BULK_SYNC_ENABLED === 'true';
if (!bulkEnabled) {
  console.error(
    'Bulk ERP sync is disabled. Set ERP_INVENTORY_BULK_SYNC_ENABLED=true or use POST /api/inventory/sync/:identifier'
  );
  process.exit(1);
}

syncInventoryFromErp()
  .then((result) => {
    console.log('ERP inventory sync completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('ERP sync failed:', err.message);
    process.exit(1);
  });
