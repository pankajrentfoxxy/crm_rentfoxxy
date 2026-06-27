/**
 * QC Management helpers — Laravel serial_numbers.status parity on vendor_serial_numbers.
 */

const VALID_STATUSES = new Set([
  'pending',
  'passed',
  'failed',
  'dead',
  'require_for_parts'
]);

const ROUTE_STATUS_MAP = {
  processing: 'pending',
  passed: 'passed',
  failed: 'failed',
  'dead-assets': 'dead',
  'require-for-parts': 'require_for_parts'
};

function parseExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseFilePaths(ex) {
  const raw = ex.file_path ?? ex.file_paths;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [raw];
    } catch {
      return [raw];
    }
  }
  return [];
}

function parseRequireParts(ex) {
  const raw = ex.require_parts ?? ex.serial_require_parts;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : raw ? [raw] : [];
    } catch {
      return raw.trim() ? [raw] : [];
    }
  }
  return [];
}

function effectiveQcStatus(row) {
  const col = row.qc_status != null ? String(row.qc_status).trim() : '';
  if (col) return col;
  const ex = parseExtra(row.extra);
  const fromExtra = ex.status != null ? String(ex.status).trim() : '';
  if (fromExtra) return fromExtra;
  return 'pending';
}

function resolveLineItem(lineItems, extraRaw, options = {}) {
  const lines = parseLineItems(lineItems);
  const ex = parseExtra(extraRaw);
  const idx =
    ex.line_index !== undefined && ex.line_index !== null ? Number(ex.line_index) : NaN;
  if (Number.isFinite(idx) && idx >= 0 && lines[idx]) return lines[idx];
  const pd = ex.product_detail_id ?? ex.pro_id ?? ex.product_id;
  if (pd !== undefined && pd !== null && String(pd).trim() !== '') {
    const k = String(pd);
    const found = lines.find(
      (l) =>
        String(l.product_detail_id ?? l.product_id ?? l.pro_id ?? l.id ?? '') === k
    );
    if (found) return found;

    const legacyIds = options.legacyProductIds ?? options.product_details_legacy_ids;
    if (Array.isArray(legacyIds) && legacyIds.length) {
      const legacyIdx = legacyIds.findIndex((id) => String(id) === k);
      if (legacyIdx >= 0 && lines[legacyIdx]) return lines[legacyIdx];
    }
  }
  if (lines.length === 1) return lines[0];
  return null;
}

function uniqueDisplay(row) {
  if (row.inventory_asset_code) return String(row.inventory_asset_code);
  const ex = parseExtra(row.extra);
  return ex.unique_product_serial || ex.unique_number || '';
}

function formatPoType(t) {
  if (!t) return '';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysBetween(fromDate, toDate) {
  const a = new Date(fromDate);
  const b = new Date(toDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function computeLockingPeriod(line, poType) {
  const months = Number(line?.vendor_locking_period ?? line?.locking_period ?? 0);
  const type = String(poType || '').toLowerCase();
  if (!Number.isFinite(months) || months <= 0) {
    if (type === 'direct_purchase') return { daysLeft: null, label: 'N/A' };
    return { daysLeft: null, label: '—' };
  }
  const start = line?.created_at ? new Date(line.created_at) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  const daysLeft = daysBetween(new Date(), end);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `${daysLeft} Days Left` };
  if (type === 'direct_purchase') return { daysLeft, label: 'N/A' };
  return { daysLeft, label: 'Expired' };
}

function computeAddedDate(updatedAt) {
  if (!updatedAt) return { label: 'Today', daysAgo: 0 };
  const daysAgo = Math.abs(daysBetween(new Date(updatedAt), new Date()));
  if (!daysAgo) return { label: 'Today', daysAgo: 0 };
  return { label: `${daysAgo} Days Ago`, daysAgo };
}

const BRAND_HINTS = ['Dell', 'HP', 'Lenovo', 'Apple', 'Acer', 'Asus', 'MSI', 'Razer'];

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function isNumericBrand(value) {
  const text = String(value ?? '').trim();
  return text !== '' && /^\d+$/.test(text);
}

function inferBrandFromModel(model) {
  const name = String(model || '').toLowerCase();
  for (const hint of BRAND_HINTS) {
    if (name.startsWith(hint.toLowerCase())) return hint;
  }
  return '';
}

function formatBrandDisplay(brand, model, brandMap) {
  const raw = String(brand ?? '').trim();
  if (!raw) return inferBrandFromModel(model) || '';
  if (!isNumericBrand(raw)) return raw;
  if (brandMap?.get(raw)) return brandMap.get(raw);
  return inferBrandFromModel(model) || '';
}

function lookupInventorySpec(row, ctx) {
  if (!ctx?.inventoryBySerial && !ctx?.inventoryByAsset && !ctx?.inventoryById) return null;
  const ex = parseExtra(row.extra);
  const bySerial = ctx.inventoryBySerial?.get(String(row.serial_number || '').toLowerCase());
  if (bySerial) return bySerial;
  const asset = row.inventory_asset_code ? String(row.inventory_asset_code) : '';
  if (asset && ctx.inventoryByAsset?.get(asset)) return ctx.inventoryByAsset.get(asset);
  for (const key of [ex.inventory_id, ex.product_id]) {
    if (key == null || String(key).trim() === '') continue;
    const hit = ctx.inventoryById?.get(String(key));
    if (hit) return hit;
  }
  return null;
}

function lookupVendorProductDetail(row, ctx) {
  if (!ctx?.vpdByOldId && !ctx?.vpdById) return null;
  const ex = parseExtra(row.extra);
  for (const key of [ex.product_detail_id, ex.pro_id]) {
    if (key == null || String(key).trim() === '') continue;
    const hit = ctx.vpdById?.get(String(key));
    if (hit) return hit;
  }
  for (const key of [ex.product_id, row.grn_product_id]) {
    if (key == null || String(key).trim() === '') continue;
    const hit = ctx.vpdByOldId?.get(String(key));
    if (hit) return hit;
  }
  return null;
}

function resolveItemDescription(row, ctx = {}) {
  const ex = parseExtra(row.extra);
  const line = resolveLineItem(row.line_items, row.extra, {
    legacyProductIds: row.product_details_legacy_ids
  });
  const inv = lookupInventorySpec(row, ctx);
  const vpd = lookupVendorProductDetail(row, ctx);
  // GRN-received config (VPD / inventory / serial extra) wins over PO line_items — legacy ERP PO rows are often wrong.
  const model = pickFirstNonEmpty(
    vpd?.model,
    inv?.model,
    ex.model,
    ex.model_name,
    ex.product_model_name,
    line?.product_name,
    line?.model
  );
  const brand = formatBrandDisplay(
    pickFirstNonEmpty(vpd?.brand, inv?.brand, ex.brand, line?.brand_name, line?.brand),
    model,
    ctx.brandMap
  );

  return {
    brand,
    model,
    screen_size: pickFirstNonEmpty(vpd?.screen_size, inv?.screen_size, ex.screen_size, line?.screen_size),
    processor: pickFirstNonEmpty(vpd?.processor, inv?.processor, ex.processor, line?.processor),
    generation: pickFirstNonEmpty(vpd?.generation, inv?.generation, ex.generation, line?.generation),
    ram: pickFirstNonEmpty(vpd?.ram, inv?.ram, ex.ram, line?.ram),
    storage: pickFirstNonEmpty(vpd?.storage, inv?.storage, ex.storage, line?.storage),
    gpu: pickFirstNonEmpty(vpd?.gpu, inv?.gpu, ex.gpu, line?.gpu)
  };
}

async function buildSerialSpecContext(pool, rows) {
  if (!rows?.length) {
    return {
      inventoryBySerial: new Map(),
      inventoryByAsset: new Map(),
      inventoryById: new Map(),
      vpdByOldId: new Map(),
      vpdById: new Map(),
      brandMap: new Map()
    };
  }

  const serialNumbers = [];
  const assetCodes = [];
  const inventoryIds = new Set();
  const oldProductIds = new Set();
  const productDetailIds = new Set();

  for (const row of rows) {
    const ex = parseExtra(row.extra);
    if (row.serial_number) serialNumbers.push(String(row.serial_number));
    if (row.inventory_asset_code) assetCodes.push(String(row.inventory_asset_code));
    for (const key of [ex.inventory_id, ex.product_id]) {
      if (key == null || String(key).trim() === '') continue;
      const n = Number(key);
      if (Number.isFinite(n) && n > 0) inventoryIds.add(n);
    }
    for (const key of [ex.product_id, row.grn_product_id]) {
      if (key == null || String(key).trim() === '') continue;
      const n = Number(key);
      if (Number.isFinite(n) && n > 0) oldProductIds.add(n);
    }
    for (const key of [ex.product_detail_id, ex.pro_id]) {
      if (key == null || String(key).trim() === '') continue;
      const n = Number(key);
      if (Number.isFinite(n) && n > 0) productDetailIds.add(n);
    }
  }

  const inventoryBySerial = new Map();
  const inventoryByAsset = new Map();
  const inventoryById = new Map();
  if (serialNumbers.length || assetCodes.length || inventoryIds.size) {
    const invR = await pool.query(
      `SELECT inventory_id, serial_number, machine_number, brand, model, processor,
              generation, ram, storage, gpu, screen_size
         FROM inventory
        WHERE serial_number = ANY($1::text[])
           OR machine_number = ANY($2::text[])
           OR inventory_id = ANY($3::int[])`,
      [serialNumbers, assetCodes, [...inventoryIds]]
    );
    for (const inv of invR.rows) {
      if (inv.serial_number) inventoryBySerial.set(String(inv.serial_number).toLowerCase(), inv);
      if (inv.machine_number) inventoryByAsset.set(String(inv.machine_number), inv);
      inventoryById.set(String(inv.inventory_id), inv);
    }
  }

  const vpdByOldId = new Map();
  const vpdById = new Map();
  if (oldProductIds.size || productDetailIds.size) {
    const vpdR = await pool.query(
      `SELECT product_detail_id, old_product_id, brand, model, processor, generation,
              ram, storage, gpu, screen_size
         FROM vendor_product_details
        WHERE old_product_id = ANY($1::int[])
           OR product_detail_id = ANY($2::int[])`,
      [[...oldProductIds], [...productDetailIds]]
    );
    for (const vpd of vpdR.rows) {
      if (vpd.old_product_id != null) vpdByOldId.set(String(vpd.old_product_id), vpd);
      vpdById.set(String(vpd.product_detail_id), vpd);
    }
  }

  const brandMap = new Map();
  try {
    const brandR = await pool.query(`SELECT id, name FROM asset_config_brands WHERE deleted_at IS NULL`);
    for (const brand of brandR.rows) brandMap.set(String(brand.id), brand.name);
  } catch {
    /* optional table */
  }

  return {
    inventoryBySerial,
    inventoryByAsset,
    inventoryById,
    vpdByOldId,
    vpdById,
    brandMap
  };
}

async function enrichSerialRowsBatch(pool, rows) {
  const ctx = await buildSerialSpecContext(pool, rows);
  return rows.map((row) => enrichSerialRow(row, ctx));
}

function computePoTypePeriod(row, line, poType) {
  const today = new Date();
  const type = String(poType || '').toLowerCase();

  if (type === 'direct_purchase') {
    const warrantyMonths = Number(line?.warranty_months ?? line?.product_warranty ?? 0);
    const start = row.serial_created_at || row.created_at;
    if (!start || !warrantyMonths) return { daysLeft: null, label: '—' };
    const startD = new Date(start);
    const endD = new Date(startD);
    endD.setDate(endD.getDate() + warrantyMonths * 30);
    const daysLeft = daysBetween(today, endD);
    if (daysLeft == null) return { daysLeft: null, label: '—' };
    if (daysLeft > 0) return { daysLeft, label: `Warranty Left in ${daysLeft} Days` };
    return { daysLeft, label: 'Expired' };
  }

  const rentalEnd = row.rental_start_date || line?.rental_period || line?.rental_end_date;
  if (!rentalEnd) return { daysLeft: null, label: '—' };
  const daysLeft = daysBetween(today, rentalEnd);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `Rent Starts in ${daysLeft} Days` };
  if (daysLeft === 0) return { daysLeft, label: 'Rent Starts Today' };
  const ago = Math.abs(daysLeft);
  return { daysLeft, label: `Rent Started ${ago} Days Ago` };
}

function enrichSerialRow(row, specContext = null) {
  const line = resolveLineItem(row.line_items, row.extra, {
    legacyProductIds: row.product_details_legacy_ids
  });
  const ex = parseExtra(row.extra);
  const itemDescription = resolveItemDescription(row, specContext || {});
  const poType = row.purchase_order_type;
  const actionStatus = ex.action_status ?? null;
  const cameFrom = ex.came_from ?? null;

  let receivedFrom = { type: 'vendor', label: 'Vendor' };
  if (actionStatus) {
    if (ex.customer_name) {
      receivedFrom = { type: 'customer', label: ex.customer_name, customer_id: ex.customer_id ?? null };
    } else if (cameFrom) {
      receivedFrom = { type: 'other', label: String(cameFrom) };
    } else {
      receivedFrom = { type: 'na', label: 'N/A' };
    }
  }

  const remark =
    row.remark ||
    ex.remark ||
    (actionStatus ? ex.action_remark : ex.status2 === 'qc_reject' ? ex.remark : '') ||
    '';

  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: uniqueDisplay(row),
    qc_status: effectiveQcStatus(row),
    remark,
    action_status: actionStatus,
    action_remark: ex.action_remark ?? null,
    status2: ex.status2 ?? row.inventory_status ?? null,
    serial_created_at: row.serial_created_at,
    serial_updated_at: row.serial_updated_at,
    added_date: computeAddedDate(row.serial_updated_at),
    po_id: row.po_id,
    grn_id: row.grn_id,
    grn_number:
      ex.grn_number ||
      (row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : ''),
    purchase_order_number: row.purchase_order_number,
    purchase_order_type: poType,
    purchase_order_type_label: formatPoType(poType),
    vendor_id: row.vendor_id,
    vendor_name:
      (actionStatus && ex.vendor_name) || row.vendor_name || row.business_name || '',
    product_id:
      line?.product_detail_id ??
      line?.product_id ??
      ex.product_detail_id ??
      ex.product_id ??
      null,
    item_description: itemDescription,
    locking_period: computeLockingPeriod(line, poType),
    po_type_period: computePoTypePeriod(row, line, poType),
    received_from: receivedFrom,
    file_paths: parseFilePaths(ex),
    hardware_action: ex.hardware_action ?? 'pending',
    hardware_remark: ex.hardware_remark ?? '',
    require_parts: parseRequireParts(ex),
    rental_period: row.rental_start_date || line?.rental_period || null,
    product_warranty: line?.warranty_months ?? line?.product_warranty ?? null,
    inventory_tag: ex.inventory_tag || null,
    ticket_id: row.ticket_id ?? null,
    active_floor_ticket_id: row.active_floor_ticket_id ?? null,
    extra: ex
  };
}

function normalizeRouteStatus(input) {
  const raw = String(input || '').trim();
  if (ROUTE_STATUS_MAP[raw]) return ROUTE_STATUS_MAP[raw];
  if (VALID_STATUSES.has(raw)) return raw;
  return null;
}

const EFFECTIVE_STATUS_SQL = `COALESCE(
  NULLIF(TRIM(s.qc_status), ''),
  NULLIF(TRIM(s.extra->>'status'), ''),
  'pending'
)`;

module.exports = {
  VALID_STATUSES,
  ROUTE_STATUS_MAP,
  EFFECTIVE_STATUS_SQL,
  parseExtra,
  parseLineItems,
  effectiveQcStatus,
  resolveLineItem,
  resolveItemDescription,
  buildSerialSpecContext,
  enrichSerialRowsBatch,
  enrichSerialRow,
  normalizeRouteStatus,
  formatPoType
};
