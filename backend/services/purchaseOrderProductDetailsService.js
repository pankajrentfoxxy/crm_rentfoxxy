/**
 * Laravel PurchaseOrderController@store_purchase_order — product_details + line_items parity.
 */
const { normalizeAllowedConditions } = require('../constants/laptopConditions');

function parseJsonValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** Laravel assetsDetails: [{ "brand[]": "x", "Model[]": "y", ... }, ...] */
function parseLaravelAssetsDetailsPayload(raw) {
  const dataArray = parseJsonValue(raw);
  if (!Array.isArray(dataArray) || !dataArray.length) return [];

  const assetDetails = {};
  for (const item of dataArray) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      const cleanKey = String(key).replace(/\[\]$/, '');
      if (!assetDetails[cleanKey]) assetDetails[cleanKey] = [];
      assetDetails[cleanKey].push(value);
    }
  }

  const count = Math.max(
    ...(Object.values(assetDetails).map((arr) => (Array.isArray(arr) ? arr.length : 0))),
    0
  );
  if (!count) return [];

  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const get = (...keys) => {
      for (const k of keys) {
        const arr = assetDetails[k];
        if (Array.isArray(arr) && arr[i] !== undefined && arr[i] !== null && arr[i] !== '') {
          return arr[i];
        }
      }
      return '';
    };

    lines.push({
      brand: get('brand', 'Brand'),
      model: get('Model', 'model'),
      processor: get('Processor', 'processor'),
      generation: get('Generation', 'generation'),
      ram: get('RAM', 'Ram', 'ram'),
      storage: get('Storage', 'storage'),
      gpu: get('GPU', 'Gpu', 'gpu'),
      screen_size: get('Screen size', 'Screen_size', 'screen_size'),
      quantity: Number(get('quantity', 'Quantity')) || 1,
      rate: Number(get('rate', 'Rate')) || 0,
      locking_period: get('Locking Period( In Month )', 'locking_period', 'Locking period'),
      remarks: get('remarks', 'Remarks') || null
    });
  }
  return lines;
}

function normalizeIncomingLines(body) {
  if (Array.isArray(body.line_items) && body.line_items.length) {
    return body.line_items.filter((row) => !row?.draft_placeholder);
  }
  if (body.assetsDetails != null) {
    return parseLaravelAssetsDetailsPayload(body.assetsDetails);
  }
  if (body.assets_details != null) {
    const raw = body.assets_details;
    if (Array.isArray(raw)) return raw;
    const parsed = parseLaravelAssetsDetailsPayload(raw);
    if (parsed.length) return parsed;
    if (typeof raw === 'object' && raw.brand) {
      const count = Array.isArray(raw.brand) ? raw.brand.length : 0;
      const lines = [];
      for (let i = 0; i < count; i += 1) {
        const pick = (key) => (Array.isArray(raw[key]) ? raw[key][i] : raw[key]);
        lines.push({
          brand: pick('brand'),
          model: pick('Model') ?? pick('model'),
          processor: pick('Processor') ?? pick('processor'),
          generation: pick('Generation') ?? pick('generation'),
          ram: pick('RAM') ?? pick('ram'),
          storage: pick('Storage') ?? pick('storage'),
          gpu: pick('GPU') ?? pick('gpu'),
          screen_size: pick('Screen size') ?? pick('screen_size'),
          quantity: Number(pick('quantity')) || 1,
          rate: Number(pick('rate')) || 0,
          locking_period: pick('locking_period') ?? pick('Locking Period( In Month )'),
          remarks: pick('remarks') ?? null
        });
      }
      return lines;
    }
  }
  return [];
}

function mapLineForProductDetail(line, purchaseOrderType) {
  const poType = String(purchaseOrderType || '').toLowerCase();
  const qty = Number(line.quantity) || 1;
  const rate = Number(line.rate) || 0;
  const lockingRaw =
    line.vendor_locking_period ??
    line.warranty ??
    line.locking_period ??
    line.period_months ??
    null;

  const row = {
    category: line.category || 'Laptop',
    brand: line.brand || '',
    model: line.model ?? line.model_name ?? '',
    processor: line.processor || '',
    generation: line.generation || '',
    ram: line.ram || '',
    storage: line.storage || '',
    gpu: line.gpu || '',
    screen_size: line.screen_size || '',
    quantity: qty,
    rate,
    remarks: line.remarks ?? line.remark ?? null,
    total_amount: Math.round(qty * rate * 100) / 100,
    vendor_locking_period: null,
    warranty: null,
    parts: line.parts ?? null,
    status: line.status ?? null,
    allowed_conditions: normalizeAllowedConditions(line.allowed_conditions ?? line.conditions)
  };

  const locking = lockingRaw === '' || lockingRaw == null ? null : Number(lockingRaw);
  if (poType === 'rent_to_own' || poType === 'rental_purchase') {
    row.vendor_locking_period = Number.isFinite(locking) ? locking : null;
  } else if (poType === 'direct_purchase') {
    row.warranty = Number.isFinite(locking) ? locking : null;
  }

  return row;
}

function buildAssetsDetailsFromLines(lines) {
  return {
    brand: lines.map((l) => l.brand || ''),
    Model: lines.map((l) => l.model ?? l.model_name ?? ''),
    Processor: lines.map((l) => l.processor || ''),
    Generation: lines.map((l) => l.generation || ''),
    RAM: lines.map((l) => l.ram || ''),
    Storage: lines.map((l) => l.storage || ''),
    GPU: lines.map((l) => l.gpu || ''),
    'Screen size': lines.map((l) => l.screen_size || ''),
    quantity: lines.map((l) => Number(l.quantity) || 1),
    rate: lines.map((l) => Number(l.rate) || 0),
    locking_period: lines.map((l) => l.vendor_locking_period ?? l.warranty ?? l.locking_period ?? '')
  };
}

function lineSubtotalFromRows(rows) {
  let sub = 0;
  for (const row of rows) {
    sub += (Number(row.quantity) || 0) * (Number(row.rate) || 0);
  }
  return Math.round(sub * 100) / 100;
}

async function insertProductDetailsForPo(client, poId, rawLines, purchaseOrderType) {
  const insertedIds = [];
  const enrichedLines = [];

  for (const rawLine of rawLines) {
    const pd = mapLineForProductDetail(rawLine, purchaseOrderType);
    const ins = await client.query(
      `INSERT INTO vendor_product_details (
         po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size,
         quantity, rate, remarks, total_amount, vendor_locking_period, warranty, parts, status,
         allowed_conditions
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
       RETURNING product_detail_id`,
      [
        poId ?? null,
        pd.category,
        pd.brand,
        pd.model,
        pd.processor,
        pd.generation,
        pd.ram,
        pd.storage,
        pd.gpu,
        pd.screen_size,
        pd.quantity,
        pd.rate,
        pd.remarks,
        pd.total_amount,
        pd.vendor_locking_period,
        pd.warranty,
        pd.parts,
        pd.status,
        JSON.stringify(pd.allowed_conditions)
      ]
    );

    const productDetailId = ins.rows[0].product_detail_id;
    insertedIds.push(productDetailId);
    enrichedLines.push({
      ...rawLine,
      ...pd,
      product_detail_id: productDetailId,
      product_id: productDetailId,
      pro_id: productDetailId,
      id: productDetailId,
      model_name: pd.model
    });
  }

  if (poId != null && insertedIds.length) {
    await client.query(
      `UPDATE vendor_product_details SET po_id = $1, updated_at = NOW()
       WHERE product_detail_id = ANY($2::int[])`,
      [poId, insertedIds]
    );
  }

  return { insertedIds, enrichedLines };
}

module.exports = {
  normalizeIncomingLines,
  mapLineForProductDetail,
  buildAssetsDetailsFromLines,
  lineSubtotalFromRows,
  insertProductDetailsForPo,
  parseLaravelAssetsDetailsPayload
};
