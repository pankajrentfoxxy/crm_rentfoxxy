#!/usr/bin/env node
/**
 * Idempotent sync: propagate GRN hardware config (vendor_serial_numbers.extra)
 * to inventory rows and linked floor tickets.
 *
 * GRN serial extra is the source of truth. Matching uses, in order:
 *   extra.inventory_id → inventory.inventory_id
 *   inventory_asset_code (TTSPL) → inventory.machine_number
 *   serial_number → inventory.serial_number / machine_number
 *   tickets.vendor_serial_id → vendor_serial_numbers.serial_id
 *
 * Prerequisites: GRN serial extra should already contain hardware config
 * (run migration/tools/backfill-grn-config-from-erp.js first if needed).
 *
 * Usage:
 *   node migration/tools/sync-inventory-config-from-grn.js
 *   node migration/tools/sync-inventory-config-from-grn.js --dry-run
 *   node migration/tools/sync-inventory-config-from-grn.js --po-id 9
 *   node migration/tools/sync-inventory-config-from-grn.js --ttspl TTSPL6214
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const {
  configFieldsFromSerialExtra,
  configPatchFromSerialExtra,
  fieldMapsEqual,
  hasHardwareConfig,
  mergeGrnConfigIntoExtra,
  mergeInventoryWithConfigPatch,
  mergeTicketWithConfigPatch,
  parseSerialExtra,
} = require('../lib/erpProductConfig');

const dryRun = process.argv.includes('--dry-run');
const poFilter = (() => {
  const idx = process.argv.indexOf('--po-id');
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return null;
})();
const ttsplFilter = (() => {
  const idx = process.argv.indexOf('--ttspl');
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim().toUpperCase();
  return null;
})();

function patchKeysForInventory(patch) {
  const keys = [];
  if (patch.brand != null && String(patch.brand).trim()) keys.push('brand');
  if ((patch.model != null && String(patch.model).trim()) ||
      (patch.model_name != null && String(patch.model_name).trim())) {
    keys.push('model');
  }
  for (const k of ['processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size']) {
    if (patch[k] != null && String(patch[k]).trim()) keys.push(k);
  }
  return keys;
}

function patchKeysForTickets(patch) {
  const keys = [];
  if (patch.brand != null && String(patch.brand).trim()) keys.push('brand');
  if ((patch.model != null && String(patch.model).trim()) ||
      (patch.model_name != null && String(patch.model_name).trim())) {
    keys.push('model');
  }
  for (const k of ['processor', 'ram', 'storage']) {
    if (patch[k] != null && String(patch[k]).trim()) keys.push(k);
  }
  return keys;
}

function stableJson(obj) {
  const normalize = (value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        const v = normalize(value[key]);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(normalize(obj));
}

async function loadGrnSerials(crm) {
  const params = [];
  const clauses = ['s.deleted_at IS NULL', 's.grn_id IS NOT NULL'];
  if (poFilter != null) {
    params.push(poFilter);
    clauses.push(`s.po_id = $${params.length}`);
  }
  if (ttsplFilter) {
    params.push(ttsplFilter);
    clauses.push(`UPPER(COALESCE(s.inventory_asset_code, '')) = $${params.length}`);
  }
  const { rows } = await crm.query(
    `SELECT s.serial_id, s.po_id, s.grn_id, s.serial_number, s.inventory_asset_code, s.extra
       FROM vendor_serial_numbers s
      WHERE ${clauses.join(' AND ')}
      ORDER BY s.serial_id`,
    params
  );
  return rows;
}

async function resolveInventoryRow(crm, serial) {
  const ex = parseSerialExtra(serial.extra);
  const ttspl = serial.inventory_asset_code ? String(serial.inventory_asset_code).trim() : '';
  if (ttspl) {
    const r = await crm.query(`SELECT * FROM inventory WHERE machine_number = $1 LIMIT 1`, [ttspl]);
    if (r.rows.length) return r.rows[0];
  }
  const invId = ex.inventory_id != null ? Number(ex.inventory_id) : null;
  if (Number.isFinite(invId) && invId > 0) {
    const r = await crm.query(`SELECT * FROM inventory WHERE inventory_id = $1`, [invId]);
    if (r.rows.length) return r.rows[0];
  }
  const sn = serial.serial_number ? String(serial.serial_number).trim() : '';
  if (sn) {
    const r = await crm.query(
      `SELECT * FROM inventory
        WHERE serial_number = $1 OR machine_number = $1
        ORDER BY inventory_id
        LIMIT 1`,
      [sn]
    );
    if (r.rows.length) return r.rows[0];
  }
  return null;
}

async function syncInventoryRow(crm, serial, patch) {
  const inv = await resolveInventoryRow(crm, serial);
  if (!inv) return { status: 'inventory_not_found' };

  const current = {
    brand: inv.brand,
    model: inv.model,
    processor: inv.processor,
    generation: inv.generation,
    ram: inv.ram,
    storage: inv.storage,
    gpu: inv.gpu,
    screen_size: inv.screen_size,
  };
  const next = mergeInventoryWithConfigPatch(current, patch);
  const patchKeys = patchKeysForInventory(patch);
  if (!patchKeys.length || fieldMapsEqual(current, next, patchKeys)) {
    return { status: 'inventory_unchanged', inventory_id: inv.inventory_id };
  }

  if (dryRun) {
    return { status: 'inventory_would_update', inventory_id: inv.inventory_id };
  }

  await crm.query(
    `UPDATE inventory
        SET brand = $2,
            model = $3,
            processor = $4,
            generation = $5,
            ram = $6,
            storage = $7,
            gpu = $8,
            screen_size = $9,
            updated_at = NOW()
      WHERE inventory_id = $1`,
    [
      inv.inventory_id,
      next.brand,
      next.model,
      next.processor,
      next.generation,
      next.ram,
      next.storage,
      next.gpu,
      next.screen_size,
    ]
  );

  const ex = parseSerialExtra(serial.extra);
  if (String(ex.inventory_id || '') !== String(inv.inventory_id)) {
    const merged = mergeGrnConfigIntoExtra(serial.extra, patch);
    merged.inventory_id = inv.inventory_id;
    await crm.query(
      `UPDATE vendor_serial_numbers SET extra = $2::jsonb, updated_at = NOW() WHERE serial_id = $1`,
      [serial.serial_id, JSON.stringify(merged)]
    );
  }

  return { status: 'inventory_updated', inventory_id: inv.inventory_id };
}

async function syncTicketsForSerial(crm, serial, patch) {
  const { rows } = await crm.query(
    `SELECT ticket_id, brand, model, processor, ram, storage
       FROM tickets
      WHERE vendor_serial_id = $1
         OR ($2::text IS NOT NULL AND (ttspl_id = $2 OR machine_number = $2))
         OR serial_number = $3
      ORDER BY ticket_id`,
    [serial.serial_id, serial.inventory_asset_code || null, serial.serial_number]
  );

  if (!rows.length) return { status: 'no_tickets', updated: 0 };

  const patchKeys = patchKeysForTickets(patch);
  if (!patchKeys.length) return { status: 'tickets_unchanged', updated: 0 };

  let updated = 0;
  for (const t of rows) {
    const current = {
      brand: t.brand,
      model: t.model,
      processor: t.processor,
      ram: t.ram,
      storage: t.storage,
    };
    const next = mergeTicketWithConfigPatch(current, patch);
    if (fieldMapsEqual(current, next, patchKeys)) continue;

    if (dryRun) {
      updated += 1;
      continue;
    }

    await crm.query(
      `UPDATE tickets
          SET brand = $2,
              model = $3,
              processor = $4,
              ram = $5,
              storage = $6,
              updated_at = NOW()
        WHERE ticket_id = $1`,
      [t.ticket_id, next.brand, next.model, next.processor, next.ram, next.storage]
    );
    updated += 1;
  }

  return { status: updated ? 'tickets_updated' : 'tickets_unchanged', updated };
}

async function ensureSerialExtraConfig(crm, serial, patch) {
  const merged = mergeGrnConfigIntoExtra(serial.extra, patch);
  if (stableJson(parseSerialExtra(serial.extra)) === stableJson(merged)) {
    return { status: 'serial_unchanged' };
  }
  if (dryRun) return { status: 'serial_would_update' };

  await crm.query(
    `UPDATE vendor_serial_numbers SET extra = $2::jsonb, updated_at = NOW() WHERE serial_id = $1`,
    [serial.serial_id, JSON.stringify(merged)]
  );
  return { status: 'serial_updated' };
}

async function syncSerial(crm, serial) {
  const patch = configPatchFromSerialExtra(serial.extra);
  if (!hasHardwareConfig(patch)) return { serial_id: serial.serial_id, status: 'no_grn_config' };

  const extraRes = await ensureSerialExtraConfig(crm, serial, patch);
  const invRes = await syncInventoryRow(crm, serial, patch);
  const ticketRes = await syncTicketsForSerial(crm, serial, patch);

  return {
    serial_id: serial.serial_id,
    ttspl: serial.inventory_asset_code,
    extra: extraRes.status,
    inventory: invRes.status,
    tickets: ticketRes.status,
    tickets_updated: ticketRes.updated || 0,
  };
}

(async () => {
  const crm = getCrmPool();
  const stats = {
    serials: 0,
    no_config: 0,
    inventory_updated: 0,
    inventory_unchanged: 0,
    inventory_missing: 0,
    tickets_updated: 0,
    serial_extra_updated: 0,
  };

  try {
    if (dryRun) console.log('Dry run — no CRM writes.');
    const serials = await loadGrnSerials(crm);
    console.log(`GRN serials to process: ${serials.length}`);

    for (const serial of serials) {
      stats.serials += 1;
      const result = await syncSerial(crm, serial);
      if (result.status === 'no_grn_config') {
        stats.no_config += 1;
        continue;
      }
      if (result.inventory === 'inventory_updated' || result.inventory === 'inventory_would_update') {
        stats.inventory_updated += 1;
      } else if (result.inventory === 'inventory_unchanged') {
        stats.inventory_unchanged += 1;
      } else if (result.inventory === 'inventory_not_found') {
        stats.inventory_missing += 1;
      }
      stats.tickets_updated += result.tickets_updated || 0;
      if (result.extra === 'serial_updated' || result.extra === 'serial_would_update') {
        stats.serial_extra_updated += 1;
      }
    }

    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await closePools();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
