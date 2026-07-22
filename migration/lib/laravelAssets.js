/**
 * Laravel PO assets_details → CRM line_items (parity with purchaseOrderProductDetailsService).
 */
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

/** Laravel assetsDetails: [{ "brand[]": "x", "Model[]": "y", ... }, ...] or flat object */
function parseLaravelAssetsDetailsPayload(raw) {
  const dataArray = parseJsonValue(raw);
  if (!dataArray) return [];

  if (!Array.isArray(dataArray) && typeof dataArray === 'object' && dataArray.brand) {
    const count = Array.isArray(dataArray.brand) ? dataArray.brand.length : 0;
    const lines = [];
    for (let i = 0; i < count; i += 1) {
      const pick = (key) => (Array.isArray(dataArray[key]) ? dataArray[key][i] : dataArray[key]);
      lines.push(buildLineFromFields(pick));
    }
    return lines;
  }

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
    lines.push(buildLineFromFields(get));
  }
  return lines;
}

function buildLineFromFields(get) {
  return {
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
    remarks: get('remarks', 'Remarks') || null,
  };
}

module.exports = { parseLaravelAssetsDetailsPayload, parseJsonValue };
