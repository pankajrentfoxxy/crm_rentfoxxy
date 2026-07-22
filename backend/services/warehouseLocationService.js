/**
 * Physical warehouse carret layout: Carret 1–30, 17 slots each (ascending slot order).
 */
const CARRET_MIN = 1;
const CARRET_MAX = 30;
const SLOTS_PER_CARRET = 17;

const INVENTORY_TAGS = ['rental', 'sale', 'both'];

function isValidCarret(n) {
  const v = Number(n);
  return Number.isInteger(v) && v >= CARRET_MIN && v <= CARRET_MAX;
}

function isValidSlot(n) {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= SLOTS_PER_CARRET;
}

function formatLocation(carret, slot) {
  if (!carret || !slot) return null;
  return `Carret ${carret} / Slot ${slot}`;
}

async function getCarretOccupancy(db, carret = null) {
  const params = [];
  let carretFilter = '';
  if (carret != null) {
    params.push(Number(carret));
    carretFilter = ` AND warehouse_carret = $${params.length}`;
  }

  const r = await db.query(
    `SELECT warehouse_carret AS carret,
            warehouse_carret_slot AS slot,
            serial_id,
            serial_number,
            inventory_asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND warehouse_carret IS NOT NULL
        AND warehouse_carret_slot IS NOT NULL
        ${carretFilter}
      ORDER BY warehouse_carret ASC, warehouse_carret_slot ASC`,
    params
  );

  const byCarret = {};
  for (let c = CARRET_MIN; c <= CARRET_MAX; c += 1) {
    byCarret[c] = { carret: c, count: 0, slots: [], full: false };
  }

  for (const row of r.rows) {
    const c = Number(row.carret);
    if (!byCarret[c]) continue;
    byCarret[c].slots.push({
      slot: Number(row.slot),
      serial_id: row.serial_id,
      serial_number: row.serial_number,
      ttspl_id: row.inventory_asset_code,
    });
    byCarret[c].count += 1;
    byCarret[c].full = byCarret[c].count >= SLOTS_PER_CARRET;
  }

  if (carret != null) {
    const c = Number(carret);
    return { carret: c, ...(byCarret[c] || { count: 0, slots: [], full: false }) };
  }

  return Object.values(byCarret);
}

function findNextAvailableSlot(occupancy) {
  const used = new Set((occupancy?.slots || []).map((s) => Number(s.slot)));
  for (let slot = 1; slot <= SLOTS_PER_CARRET; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

async function assertSlotAvailable(db, carret, slot, serialId = null) {
  if (!isValidCarret(carret)) {
    const err = new Error(`Carret must be between ${CARRET_MIN} and ${CARRET_MAX}`);
    err.status = 400;
    throw err;
  }
  if (!isValidSlot(slot)) {
    const err = new Error(`Slot must be between 1 and ${SLOTS_PER_CARRET}`);
    err.status = 400;
    throw err;
  }

  const occ = await getCarretOccupancy(db, carret);
  const occupiedSlots = new Set((occ.slots || []).map((s) => Number(s.slot)));
  const serialAlreadyHere = serialId
    && (occ.slots || []).some((s) => Number(s.serial_id) === Number(serialId));

  if (occupiedSlots.size >= SLOTS_PER_CARRET
    && !occupiedSlots.has(Number(slot))
    && !serialAlreadyHere) {
    const err = new Error(
      `Carret ${carret} is full (${SLOTS_PER_CARRET} laptops). Choose another carret.`
    );
    err.status = 409;
    throw err;
  }

  const conflict = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND warehouse_carret = $1
        AND warehouse_carret_slot = $2
        AND ($3::int IS NULL OR serial_id <> $3::int)
      LIMIT 1`,
    [Number(carret), Number(slot), serialId || null]
  );

  if (conflict.rows.length) {
    const row = conflict.rows[0];
    const err = new Error(
      `Carret ${carret} slot ${slot} is occupied by ${row.inventory_asset_code || row.serial_number}`
    );
    err.status = 409;
    throw err;
  }
}

async function assignWarehouseLocation(db, serialId, carret, slot) {
  await assertSlotAvailable(db, carret, slot, serialId);
  await db.query(
    `UPDATE vendor_serial_numbers
        SET warehouse_carret = $2,
            warehouse_carret_slot = $3,
            updated_at = NOW()
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId, Number(carret), Number(slot)]
  );
  return { carret: Number(carret), slot: Number(slot), label: formatLocation(carret, slot) };
}

async function vacateWarehouseLocation(db, serialId) {
  if (!serialId) return { vacated: false };
  const r = await db.query(
    `UPDATE vendor_serial_numbers
        SET warehouse_carret = NULL,
            warehouse_carret_slot = NULL,
            updated_at = NOW()
      WHERE serial_id = $1
        AND deleted_at IS NULL
        AND (warehouse_carret IS NOT NULL OR warehouse_carret_slot IS NOT NULL)
      RETURNING serial_id, warehouse_carret, warehouse_carret_slot`,
    [serialId]
  );
  return { vacated: r.rows.length > 0, previous: r.rows[0] || null };
}

module.exports = {
  CARRET_MIN,
  CARRET_MAX,
  SLOTS_PER_CARRET,
  INVENTORY_TAGS,
  isValidCarret,
  isValidSlot,
  formatLocation,
  getCarretOccupancy,
  findNextAvailableSlot,
  assertSlotAvailable,
  assignWarehouseLocation,
  vacateWarehouseLocation,
};
