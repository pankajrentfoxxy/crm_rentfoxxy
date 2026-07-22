/**
 * 014 — ERP inventory (+ product_details, brands) → CRM inventory
 * Additive: idempotent via erp_id_map; dedupe by machine_number / serial_number.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  bumpInventorySequence,
} = require('../lib/helpers');

const BRAND_HINTS = ['Dell', 'HP', 'Lenovo', 'Apple', 'Acer', 'Asus', 'MSI', 'Razer'];

function inferBrand(brandRaw, brandMap, modelName) {
  const key = String(brandRaw ?? '').trim();
  if (key && brandMap[key]) return brandMap[key];
  if (key && key !== '1' && !/^\d+$/.test(key)) return key.slice(0, 100);

  const model = str(modelName, 200, '');
  for (const hint of BRAND_HINTS) {
    if (model.toLowerCase().startsWith(hint.toLowerCase())) return hint;
  }
  return 'Unknown';
}

function inferDeviceType(modelName) {
  const m = String(modelName || '').toLowerCase();
  return m.includes('desktop') ? 'Desktop' : 'Laptop';
}

function mapInventoryBuckets(erpStatus) {
  if (String(erpStatus || '').toLowerCase() === 'in_stock') {
    return { status: 'In Stock', stock_type: 'Cooling Period' };
  }
  return { status: 'Outward', stock_type: 'Ready' };
}

function resolveMachineNumber(row) {
  const ttspl = str(row.unique_product_serial, 100, '');
  if (ttspl) return ttspl;
  const sn = str(row.serial_number, 100, '');
  if (sn && sn !== '-' && sn.toUpperCase() !== 'NO S/N') return sn;
  return `ERP-INV-${row.id}`;
}

function resolveSerialNumber(row, machineNumber) {
  const sn = str(row.serial_number, 100, '');
  if (sn && sn !== '-' && sn.toUpperCase() !== 'NO S/N') return sn;
  return machineNumber;
}

async function findExistingInventory(crm, machineNumber, serialNumber) {
  const { rows } = await crm.query(
    `SELECT inventory_id FROM inventory
      WHERE machine_number = $1 OR serial_number = $2
      LIMIT 1`,
    [machineNumber, serialNumber]
  );
  return rows[0]?.inventory_id ?? null;
}

async function loadBrandMap(erp) {
  const map = {};
  try {
    const [brands] = await erp.query('SELECT id, name FROM `brands`');
    for (const b of brands) {
      map[String(b.id)] = str(b.name, 100, 'Unknown');
    }
  } catch {
    /* brands table optional */
  }
  return map;
}

module.exports = {
  id: '014',
  name: 'inventory',
  async run({ erp, crm, batchSize }) {
    const brandMap = await loadBrandMap(erp);

    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `inventory`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let mapped = 0;
    const usedMachineNumbers = new Set();

    const [rows] = await erp.query(
      `SELECT i.id, i.product_id, i.serial_id, i.serial_number, i.unique_product_serial,
              i.product_model_name, i.status, i.created_at, i.updated_at,
              pd.brand, pd.model, pd.processor, pd.generation, pd.ram, pd.storage, pd.gpu, pd.screen_size
         FROM \`inventory\` i
         LEFT JOIN \`product_details\` pd ON pd.id = i.product_id
        ORDER BY i.id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'inventory', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) progress('inventory', processed, total);
        continue;
      }

      let machineNumber = resolveMachineNumber(row);
      let serialNumber = resolveSerialNumber(row, machineNumber);

      if (usedMachineNumbers.has(machineNumber)) {
        machineNumber = `${machineNumber.slice(0, 85)}-erp${row.id}`;
      }
      usedMachineNumbers.add(machineNumber);

      let crmInventoryId = await findExistingInventory(crm, machineNumber, serialNumber);
      if (crmInventoryId) {
        await setCrmId(crm, {
          entity: 'inventory',
          erpId: row.id,
          crmId: crmInventoryId,
          erpTable: 'inventory',
          crmTable: 'inventory',
        });
        mapped += 1;
      } else {
        const modelName = str(row.model, 100, '') || str(row.product_model_name, 100, 'Unknown');
        const brand = inferBrand(row.brand, brandMap, modelName);
        const { status, stock_type: stockType } = mapInventoryBuckets(row.status);

        const { rows: ins } = await crm.query(
          `INSERT INTO inventory (
             stock_type, device_type, machine_number, serial_number,
             brand, model, processor, generation, ram, storage, gpu, screen_size,
             status, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING inventory_id`,
          [
            stockType,
            inferDeviceType(modelName),
            machineNumber,
            serialNumber,
            brand,
            modelName,
            str(row.processor, 100, null),
            str(row.generation, 80, null),
            str(row.ram, 50, null),
            str(row.storage, 50, null),
            str(row.gpu, 120, null),
            str(row.screen_size, 40, null),
            status,
            row.created_at || new Date(),
            row.updated_at || new Date(),
          ]
        );

        crmInventoryId = ins[0].inventory_id;
        await setCrmId(crm, {
          entity: 'inventory',
          erpId: row.id,
          crmId: crmInventoryId,
          erpTable: 'inventory',
          crmTable: 'inventory',
        });
        inserted += 1;
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('inventory', processed, total);
      }
    }

    await bumpInventorySequence(crm);
    writeLog('migration', `014 complete: inserted=${inserted} mapped=${mapped} total=${total}`);
    return inserted + mapped;
  },
};
