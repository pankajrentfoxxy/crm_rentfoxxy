const SPEC_QUERY_KEYS = [
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

function pickSpecFilters(query = {}) {
  const out = {};
  for (const key of SPEC_QUERY_KEYS) {
    const v = (query[key] || '').trim();
    if (v) out[key] = v;
  }
  return out;
}

function hasSpecFilters(filters) {
  return SPEC_QUERY_KEYS.some((k) => Boolean(filters[k]));
}

function serialSpecJoinSql(sAlias = 's') {
  return `
    LEFT JOIN asset_config_brands acb_spec
      ON acb_spec.deleted_at IS NULL
      AND (
        acb_spec.id::text = NULLIF(TRIM(${sAlias}.extra->>'brand'), '')
        OR LOWER(acb_spec.name) = LOWER(NULLIF(TRIM(${sAlias}.extra->>'brand'), ''))
      )
    LEFT JOIN vendor_product_details vpd_spec
      ON vpd_spec.product_detail_id = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')::int
    LEFT JOIN inventory inv_spec
      ON LOWER(TRIM(inv_spec.serial_number)) = LOWER(TRIM(${sAlias}.serial_number))
      OR TRIM(inv_spec.machine_number) = TRIM(COALESCE(${sAlias}.inventory_asset_code, ''))
  `;
}

function serialSpecExpr(field, sAlias = 's') {
  const map = {
    brand: `COALESCE(acb_spec.name, NULLIF(TRIM(${sAlias}.extra->>'brand_name'), ''), NULLIF(TRIM(${sAlias}.extra->>'brand'), ''), vpd_spec.brand, inv_spec.brand)`,
    model: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'model'), ''), NULLIF(TRIM(${sAlias}.extra->>'model_name'), ''), vpd_spec.model, inv_spec.model)`,
    processor: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'processor'), ''), vpd_spec.processor, inv_spec.processor)`,
    generation: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'generation'), ''), vpd_spec.generation, inv_spec.generation)`,
    ram: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'ram'), ''), vpd_spec.ram, inv_spec.ram)`,
    storage: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'storage'), ''), vpd_spec.storage, inv_spec.storage)`,
    screen_size: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'screen_size'), ''), vpd_spec.screen_size, inv_spec.screen_size)`,
    gpu: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'gpu'), ''), vpd_spec.gpu, inv_spec.gpu)`,
  };
  return map[field];
}

/** Append AND clauses for vendor_serial_numbers lists. Returns { joinSql, whereSql }. */
function buildSerialSpecFilter(filters, params, sAlias = 's') {
  if (!hasSpecFilters(filters)) {
    return { joinSql: '', whereSql: '' };
  }
  const clauses = [];
  for (const key of SPEC_QUERY_KEYS) {
    const val = filters[key];
    if (!val) continue;
    params.push(val);
    clauses.push(`LOWER(TRIM(${serialSpecExpr(key, sAlias)})) = LOWER(TRIM($${params.length}))`);
  }
  return {
    joinSql: serialSpecJoinSql(sAlias),
    whereSql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
  };
}

function vendorRepairSpecExpr(field) {
  const map = {
    brand: `COALESCE(NULLIF(TRIM(vsn.extra->>'brand'), ''), t.brand)`,
    model: `COALESCE(NULLIF(TRIM(vsn.extra->>'model'), ''), t.model)`,
    processor: `COALESCE(NULLIF(TRIM(vsn.extra->>'processor'), ''), t.processor)`,
    generation: `COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), t.generation)`,
    ram: `COALESCE(NULLIF(TRIM(vsn.extra->>'ram'), ''), t.ram)`,
    storage: `COALESCE(NULLIF(TRIM(vsn.extra->>'storage'), ''), t.storage)`,
    screen_size: `COALESCE(NULLIF(TRIM(vsn.extra->>'screen_size'), ''))`,
    gpu: `COALESCE(NULLIF(TRIM(vsn.extra->>'gpu'), ''))`,
  };
  return map[field];
}

function erpRepairSpecExpr(field) {
  const map = {
    brand: `COALESCE(NULLIF(TRIM(vsn.extra->>'brand'), ''), vpd.brand)`,
    model: `COALESCE(NULLIF(TRIM(vsn.extra->>'model'), ''), vpd.model)`,
    processor: `COALESCE(NULLIF(TRIM(vsn.extra->>'processor'), ''), vpd.processor)`,
    generation: `COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), vpd.generation)`,
    ram: `COALESCE(NULLIF(TRIM(vsn.extra->>'ram'), ''), vpd.ram)`,
    storage: `COALESCE(NULLIF(TRIM(vsn.extra->>'storage'), ''), vpd.storage)`,
    screen_size: `COALESCE(NULLIF(TRIM(vsn.extra->>'screen_size'), ''), vpd.screen_size)`,
    gpu: `COALESCE(NULLIF(TRIM(vsn.extra->>'gpu'), ''), vpd.gpu)`,
  };
  return map[field];
}

function appendRepairSpecClauses(filters, params, exprFn) {
  const clauses = [];
  for (const key of SPEC_QUERY_KEYS) {
    const val = filters[key];
    if (!val) continue;
    params.push(val);
    clauses.push(`LOWER(TRIM(${exprFn(key)})) = LOWER(TRIM($${params.length}))`);
  }
  return clauses;
}

module.exports = {
  SPEC_QUERY_KEYS,
  pickSpecFilters,
  hasSpecFilters,
  buildSerialSpecFilter,
  appendRepairSpecClauses,
  vendorRepairSpecExpr,
  erpRepairSpecExpr,
};
