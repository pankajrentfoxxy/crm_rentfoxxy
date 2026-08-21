export function normalizeScan(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '');
}

export function matchesAsset(value, asset) {
  const n = normalizeScan(value);
  if (!n || !asset) return false;
  return [asset.ttspl_id, asset.serial_number, asset.inventory_asset_code, asset.serial_id]
    .some((v) => v != null && normalizeScan(v) === n);
}
