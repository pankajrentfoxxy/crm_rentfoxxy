/** Normalize SO line config fields for dispatch pending-order UI. */

export function formatSoLineConfig(line) {
  if (!line) return '—';
  return [line.brand, line.model_name, line.processor, line.generation, line.ram, line.storage]
    .filter(Boolean)
    .join(' · ') || '—';
}

export function getOrderLines(row) {
  if (Array.isArray(row?.lines) && row.lines.length) return row.lines;
  if (row?.brand || row?.model_name || row?.processor) {
    return [{
      line_id: row.line_id,
      brand: row.brand,
      model_name: row.model_name,
      processor: row.processor,
      generation: row.generation,
      ram: row.ram,
      storage: row.storage,
      quantity: row.quantity,
      quotation_type: row.order_type || row.quotation_type,
    }];
  }
  return [];
}

export function getTotalQuantity(lines) {
  return (lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}
