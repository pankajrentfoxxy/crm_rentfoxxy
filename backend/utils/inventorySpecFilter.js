const SPEC_QUERY_KEYS = [
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

const { normalizeSpecFilterValue } = require('./specFilterNormalize');

function parseMultiSpecValues(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  return parts.map((v) => String(v || '').trim()).filter(Boolean);
}

function pickSpecFilters(query = {}) {
  const out = {};
  for (const key of SPEC_QUERY_KEYS) {
    const v = (query[key] || '').trim();
    if (!v) continue;
    out[key] = normalizeSpecFilterValue(key, v);
  }
  return out;
}

/** Comma-separated (or repeated) query values → array per spec key. */
function pickMultiSpecFilters(query = {}) {
  const out = {};
  for (const key of SPEC_QUERY_KEYS) {
    const raw = query[key];
    if (raw == null || raw === '') continue;
    const vals = parseMultiSpecValues(raw).map((v) => normalizeSpecFilterValue(key, v));
    if (vals.length) out[key] = vals;
  }
  return out;
}

function hasSpecFilters(filters) {
  return SPEC_QUERY_KEYS.some((k) => Boolean(filters[k]));
}

function hasMultiSpecFilters(filters) {
  return SPEC_QUERY_KEYS.some((k) => Array.isArray(filters[k]) && filters[k].length > 0);
}

/** Extract leading digits for loose RAM/SSD/generation matching ("10" ↔ "10TH", "16" ↔ "16 GB"). */
function numericPrefixSql(expr) {
  return `NULLIF(regexp_replace(LOWER(TRIM(COALESCE(${expr}, ''))), '[^0-9].*', ''), '')`;
}

/** Build a WHERE clause that matches display-style spec values, not just exact master names. */
function buildSpecMatchClause(expr, val, params, field, bindOffset = 0) {
  params.push(val);
  const i = bindOffset + params.length;
  const e = `LOWER(TRIM(COALESCE(${expr}, '')))`;
  const p = `LOWER(TRIM($${i}))`;
  const exact = `${e} = ${p}`;

  if (field === 'generation') {
    const eNum = numericPrefixSql(expr);
    const pNum = numericPrefixSql(`$${i}`);
    return `(
      ${exact}
      OR (${eNum} IS NOT NULL AND ${pNum} IS NOT NULL AND ${eNum} = ${pNum})
    )`;
  }

  if (field === 'ram' || field === 'storage') {
    const eNum = numericPrefixSql(expr);
    const pNum = numericPrefixSql(`$${i}`);
    return `(
      ${exact}
      OR (${eNum} IS NOT NULL AND ${pNum} IS NOT NULL AND ${eNum} = ${pNum})
    )`;
  }

  if (field === 'processor') {
    return `(
      ${exact}
      OR ${e} LIKE '%' || ${p} || '%'
      OR ${p} LIKE '%' || ${e} || '%'
    )`;
  }

  if (field === 'screen_size') {
    return `(
      ${exact}
      OR regexp_replace(${e}, '[^0-9.].*', '') = regexp_replace(${p}, '[^0-9.].*', '')
    )`;
  }

  if (field === 'gpu') {
    return `(${exact} OR ${e} LIKE '%' || ${p} || '%' OR ${p} LIKE '%' || ${e} || '%')`;
  }

  if (field === 'model') {
    return `(${exact} OR ${e} LIKE '%' || ${p} || '%')`;
  }

  return exact;
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

function poLineItemFieldExpr(field) {
  const lineFields = {
    brand: `COALESCE(NULLIF(TRIM(li.elem->>'brand_name'), ''), NULLIF(TRIM(li.elem->>'brand'), ''))`,
    model: `COALESCE(NULLIF(TRIM(li.elem->>'model'), ''), NULLIF(TRIM(li.elem->>'product_name'), ''), NULLIF(TRIM(li.elem->>'model_name'), ''))`,
    processor: `NULLIF(TRIM(li.elem->>'processor'), '')`,
    generation: `NULLIF(TRIM(li.elem->>'generation'), '')`,
    ram: `NULLIF(TRIM(li.elem->>'ram'), '')`,
    storage: `NULLIF(TRIM(li.elem->>'storage'), '')`,
    screen_size: `NULLIF(TRIM(li.elem->>'screen_size'), '')`,
    gpu: `NULLIF(TRIM(li.elem->>'gpu'), '')`,
  };
  return lineFields[field] || 'NULL';
}

function poLineItemResolutionSql(sAlias = 's', pAlias = 'p') {
  return `(
    (
      NULLIF(TRIM(${sAlias}.extra->>'line_index'), '') IS NOT NULL
      AND (li.ord - 1) = (NULLIF(TRIM(${sAlias}.extra->>'line_index'), '')::int)
    )
    OR (
      NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '') IS NOT NULL
      AND (
        NULLIF(TRIM(li.elem->>'product_detail_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')
        OR NULLIF(TRIM(li.elem->>'pro_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')
      )
    )
    OR (
      NULLIF(TRIM(${sAlias}.extra->>'pro_id'), '') IS NOT NULL
      AND NULLIF(TRIM(li.elem->>'pro_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'pro_id'), '')
    )
    OR (
      NULLIF(TRIM(${sAlias}.extra->>'product_id'), '') IS NOT NULL
      AND NULLIF(TRIM(li.elem->>'product_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'product_id'), '')
    )
    OR (
      NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '') IS NOT NULL
      AND jsonb_typeof(${pAlias}.product_details_legacy_ids) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${pAlias}.product_details_legacy_ids) WITH ORDINALITY AS leg(lid, lord)
        WHERE leg.lid = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')
          AND (li.ord - 1) = (leg.lord - 1)
      )
    )
    OR jsonb_array_length(COALESCE(${pAlias}.line_items, '[]'::jsonb)) = 1
  )`;
}

/** EXISTS form for PO line spec filter — avoids per-row scalar subquery in WHERE. */
function poLineItemFilterExists(field, paramIdx, sAlias = 's', pAlias = 'p') {
  const pick = poLineItemFieldExpr(field);
  const e = `LOWER(TRIM(COALESCE(${pick}, '')))`;
  const p = `LOWER(TRIM($${paramIdx}))`;
  const match = buildSpecMatchClauseWithParam(field, e, p);
  return `EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(${pAlias}.line_items, '[]'::jsonb)) WITH ORDINALITY AS li(elem, ord)
    WHERE NULLIF(TRIM(${pick}), '') IS NOT NULL
      AND ${match}
      AND ${poLineItemResolutionSql(sAlias, pAlias)}
  )`;
}

function isBlankSql(expr) {
  return `NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`;
}

function isPresentSql(expr) {
  return `NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NOT NULL`;
}

function buildSpecMatchClauseWithParam(field, eExpr, pExpr) {
  const exact = `${eExpr} = ${pExpr}`;
  if (field === 'generation' || field === 'ram' || field === 'storage') {
    const eNum = `NULLIF(regexp_replace(${eExpr}, '[^0-9].*', ''), '')`;
    const pNum = `NULLIF(regexp_replace(${pExpr}, '[^0-9].*', ''), '')`;
    return `(${exact} OR (${eNum} IS NOT NULL AND ${pNum} IS NOT NULL AND ${eNum} = ${pNum}))`;
  }
  if (field === 'processor' || field === 'gpu') {
    return `(${exact} OR ${eExpr} LIKE '%' || ${pExpr} || '%' OR ${pExpr} LIKE '%' || ${eExpr} || '%')`;
  }
  if (field === 'screen_size') {
    return `(${exact} OR regexp_replace(${eExpr}, '[^0-9.].*', '') = regexp_replace(${pExpr}, '[^0-9.].*', ''))`;
  }
  if (field === 'model') {
    return `(${exact} OR ${eExpr} LIKE '%' || ${pExpr} || '%')`;
  }
  return exact;
}

function fieldSourceChain(field, sAlias = 's') {
  const po = { type: 'po_line', field };
  const chains = {
    brand: [
      { type: 'col', expr: `acb_spec.name`, join: 'acb' },
      { type: 'col', expr: `${sAlias}.extra->>'brand_name'` },
      { type: 'col', expr: `${sAlias}.extra->>'brand'` },
      po,
      { type: 'col', expr: 'vpd_spec.brand', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.brand', join: 'inv' },
    ],
    model: [
      { type: 'col', expr: `${sAlias}.extra->>'model'` },
      { type: 'col', expr: `${sAlias}.extra->>'model_name'` },
      po,
      { type: 'col', expr: 'vpd_spec.model', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.model', join: 'inv' },
    ],
    processor: [
      { type: 'col', expr: `${sAlias}.extra->>'processor'` },
      po,
      { type: 'col', expr: 'vpd_spec.processor', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.processor', join: 'inv' },
    ],
    generation: [
      { type: 'col', expr: `${sAlias}.extra->>'generation'` },
      po,
      { type: 'col', expr: 'vpd_spec.generation', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.generation', join: 'inv' },
    ],
    ram: [
      { type: 'col', expr: `${sAlias}.extra->>'ram'` },
      po,
      { type: 'col', expr: 'vpd_spec.ram', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.ram', join: 'inv' },
    ],
    storage: [
      { type: 'col', expr: `${sAlias}.extra->>'storage'` },
      po,
      { type: 'col', expr: 'vpd_spec.storage', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.storage', join: 'inv' },
    ],
    screen_size: [
      { type: 'col', expr: `${sAlias}.extra->>'screen_size'` },
      po,
      { type: 'col', expr: 'vpd_spec.screen_size', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.screen_size', join: 'inv' },
    ],
    gpu: [
      { type: 'col', expr: `${sAlias}.extra->>'gpu'` },
      po,
      { type: 'col', expr: 'vpd_spec.gpu', join: 'vpd' },
      { type: 'col', expr: 'inv_spec.gpu', join: 'inv' },
    ],
  };
  return chains[field] || [];
}

/** COALESCE-order-preserving filter: first non-blank source must match (fast path on extra JSON). */
function buildCascadeSerialSpecClause(field, val, params, sAlias = 's', pAlias = 'p') {
  params.push(val);
  const paramIdx = params.length;
  const p = `LOWER(TRIM($${paramIdx}))`;
  const chain = fieldSourceChain(field, sAlias);
  const branches = [];
  const priorBlanks = [];

  for (const src of chain) {
    if (src.type === 'po_line') {
      const prefix = priorBlanks.length ? `${priorBlanks.join(' AND ')} AND ` : '';
      branches.push(`(${prefix}${poLineItemFilterExists(field, paramIdx, sAlias, pAlias)})`);
      continue;
    }
    const e = `LOWER(TRIM(COALESCE(${src.expr}, '')))`;
    const match = buildSpecMatchClauseWithParam(field, e, p);
    const present = isPresentSql(src.expr);
    const prefix = priorBlanks.length ? `${priorBlanks.join(' AND ')} AND ` : '';
    branches.push(`(${prefix}${present} AND ${match})`);
    priorBlanks.push(isBlankSql(src.expr));
  }

  return `(${branches.join(' OR ')})`;
}

function minimalSpecJoinSql(activeFields, sAlias = 's') {
  const joins = new Set(['vpd', 'inv']);
  for (const field of activeFields) {
    for (const src of fieldSourceChain(field, sAlias)) {
      if (src.join) joins.add(src.join);
    }
  }

  let sql = '';
  if (joins.has('acb')) {
    sql += `
    LEFT JOIN asset_config_brands acb_spec
      ON acb_spec.deleted_at IS NULL
      AND (
        acb_spec.id::text = NULLIF(TRIM(${sAlias}.extra->>'brand'), '')
        OR LOWER(acb_spec.name) = LOWER(NULLIF(TRIM(${sAlias}.extra->>'brand'), ''))
      )`;
  }
  if (joins.has('vpd')) {
    sql += `
    LEFT JOIN vendor_product_details vpd_spec
      ON vpd_spec.product_detail_id = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')::int`;
  }
  if (joins.has('inv')) {
    sql += `
    LEFT JOIN inventory inv_spec
      ON LOWER(TRIM(inv_spec.serial_number)) = LOWER(TRIM(${sAlias}.serial_number))
      OR TRIM(inv_spec.machine_number) = TRIM(COALESCE(${sAlias}.inventory_asset_code, ''))`;
  }
  return sql;
}

/** PO line_items JSON — same sources as resolveItemDescription in qcManagementService. */
function poLineItemSpecSubquery(field, sAlias = 's', pAlias = 'p') {
  const pick = poLineItemFieldExpr(field);
  if (pick === 'NULL') return 'NULL';

  return `(
    SELECT ${pick}
    FROM jsonb_array_elements(COALESCE(${pAlias}.line_items, '[]'::jsonb)) WITH ORDINALITY AS li(elem, ord)
    WHERE NULLIF(TRIM(${pick}), '') IS NOT NULL
      AND ${poLineItemResolutionSql(sAlias, pAlias)}
    ORDER BY
      CASE
        WHEN NULLIF(TRIM(${sAlias}.extra->>'line_index'), '') IS NOT NULL
          AND (li.ord - 1) = (NULLIF(TRIM(${sAlias}.extra->>'line_index'), '')::int) THEN 0
        WHEN NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '') IS NOT NULL
          AND (
            NULLIF(TRIM(li.elem->>'product_detail_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')
            OR NULLIF(TRIM(li.elem->>'pro_id'), '') = NULLIF(TRIM(${sAlias}.extra->>'product_detail_id'), '')
          ) THEN 1
        ELSE 2
      END
    LIMIT 1
  )`;
}

function serialSpecExpr(field, sAlias = 's', pAlias = 'p') {
  const poLine = poLineItemSpecSubquery(field, sAlias, pAlias);
  const map = {
    brand: `COALESCE(acb_spec.name, NULLIF(TRIM(${sAlias}.extra->>'brand_name'), ''), NULLIF(TRIM(${sAlias}.extra->>'brand'), ''), ${poLine}, vpd_spec.brand, inv_spec.brand)`,
    model: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'model'), ''), NULLIF(TRIM(${sAlias}.extra->>'model_name'), ''), ${poLine}, vpd_spec.model, inv_spec.model)`,
    processor: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'processor'), ''), ${poLine}, vpd_spec.processor, inv_spec.processor)`,
    generation: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'generation'), ''), ${poLine}, vpd_spec.generation, inv_spec.generation)`,
    ram: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'ram'), ''), ${poLine}, vpd_spec.ram, inv_spec.ram)`,
    storage: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'storage'), ''), ${poLine}, vpd_spec.storage, inv_spec.storage)`,
    screen_size: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'screen_size'), ''), ${poLine}, vpd_spec.screen_size, inv_spec.screen_size)`,
    gpu: `COALESCE(NULLIF(TRIM(${sAlias}.extra->>'gpu'), ''), ${poLine}, vpd_spec.gpu, inv_spec.gpu)`,
  };
  return map[field];
}

/** Append AND clauses for vendor_serial_numbers lists. Requires PO alias `p` in FROM. */
function buildSerialSpecFilter(filters, params, sAlias = 's', pAlias = 'p') {
  const normalized = {};
  for (const key of SPEC_QUERY_KEYS) {
    const raw = filters[key];
    if (raw == null || raw === '') continue;
    if (Array.isArray(raw)) {
      const vals = raw.map((v) => String(v || '').trim()).filter(Boolean);
      if (vals.length) normalized[key] = vals;
    } else {
      const vals = parseMultiSpecValues(raw);
      if (vals.length) normalized[key] = vals;
    }
  }
  if (!hasMultiSpecFilters(normalized) && !hasSpecFilters(normalized)) {
    return { joinSql: '', whereSql: '' };
  }
  const activeFields = SPEC_QUERY_KEYS.filter((k) => normalized[k]);
  const clauses = activeFields.map((key) => {
    const vals = Array.isArray(normalized[key]) ? normalized[key] : [normalized[key]];
    if (vals.length === 1) {
      return buildCascadeSerialSpecClause(key, vals[0], params, sAlias, pAlias);
    }
    return `(${vals.map((val) => buildCascadeSerialSpecClause(key, val, params, sAlias, pAlias)).join(' OR ')})`;
  });
  return {
    joinSql: minimalSpecJoinSql(activeFields, sAlias),
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

function appendRepairSpecClauses(filters, params, exprFn, bindOffset = 0) {
  const clauses = [];
  for (const key of SPEC_QUERY_KEYS) {
    const val = filters[key];
    if (!val) continue;
    clauses.push(buildSpecMatchClause(exprFn(key), val, params, key, bindOffset));
  }
  return clauses;
}

function appendMultiSpecClauses(filters, params, exprFn, bindOffset = 0) {
  const clauses = [];
  for (const key of SPEC_QUERY_KEYS) {
    const vals = filters[key];
    if (!Array.isArray(vals) || !vals.length) continue;
    const orParts = vals.map((val) => buildSpecMatchClause(exprFn(key), val, params, key, bindOffset));
    clauses.push(`(${orParts.join(' OR ')})`);
  }
  return clauses;
}

function reportRowSpecExpr(field) {
  const map = {
    brand: 'r.brand',
    model: 'r.model',
    processor: 'r.processor',
    generation: 'r.generation',
    ram: 'r.ram_size',
    storage: 'r.storage_type',
    screen_size: 'r.screen_size',
    gpu: 'r.gpu',
  };
  return map[field];
}

function ticketSpecExpr(field) {
  const map = {
    brand: `COALESCE(NULLIF(TRIM(vsn.extra->>'brand_name'), ''), NULLIF(TRIM(vsn.extra->>'brand'), ''), t.brand, inv.brand)`,
    model: `COALESCE(NULLIF(TRIM(vsn.extra->>'model'), ''), NULLIF(TRIM(vsn.extra->>'model_name'), ''), t.model, inv.model)`,
    processor: `COALESCE(NULLIF(TRIM(vsn.extra->>'processor'), ''), t.processor, inv.processor)`,
    generation: `COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), inv.generation)`,
    ram: `COALESCE(NULLIF(TRIM(vsn.extra->>'ram'), ''), t.ram, inv.ram)`,
    storage: `COALESCE(NULLIF(TRIM(vsn.extra->>'storage'), ''), t.storage, inv.storage)`,
    screen_size: `COALESCE(NULLIF(TRIM(vsn.extra->>'screen_size'), ''), inv.screen_size)`,
    gpu: `COALESCE(NULLIF(TRIM(vsn.extra->>'gpu'), ''), inv.gpu)`,
  };
  return map[field];
}

function buildTicketSpecFilter(filters, params, tAlias = 't') {
  if (!hasSpecFilters(filters)) {
    return { joinSql: '', whereSql: '' };
  }
  const clauses = appendRepairSpecClauses(filters, params, ticketSpecExpr);
  return {
    joinSql: `
      LEFT JOIN vendor_serial_numbers vsn
        ON vsn.serial_id = ${tAlias}.vendor_serial_id AND vsn.deleted_at IS NULL
      LEFT JOIN inventory inv
        ON LOWER(TRIM(inv.serial_number)) = LOWER(TRIM(${tAlias}.serial_number))
    `,
    whereSql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
  };
}

function productionAssetPendingSpecExpr(field) {
  const map = {
    brand: `COALESCE(NULLIF(TRIM(pa.brand), ''), NULLIF(TRIM(t.brand), ''), NULLIF(TRIM(vsn.extra->>'brand_name'), ''), NULLIF(TRIM(vsn.extra->>'brand'), ''))`,
    model: `COALESCE(NULLIF(TRIM(pa.model), ''), NULLIF(TRIM(t.model), ''), NULLIF(TRIM(vsn.extra->>'model'), ''), NULLIF(TRIM(vsn.extra->>'model_name'), ''))`,
    processor: `COALESCE(NULLIF(TRIM(pa.processor), ''), NULLIF(TRIM(t.processor), ''), NULLIF(TRIM(vsn.extra->>'processor'), ''))`,
    generation: `COALESCE(NULLIF(TRIM(pa.generation), ''), NULLIF(TRIM(vsn.extra->>'generation'), ''))`,
    ram: `COALESCE(NULLIF(TRIM(pa.ram), ''), NULLIF(TRIM(t.ram), ''), NULLIF(TRIM(vsn.extra->>'ram'), ''))`,
    storage: `COALESCE(NULLIF(TRIM(pa.ssd), ''), NULLIF(TRIM(t.storage), ''), NULLIF(TRIM(vsn.extra->>'storage'), ''))`,
    screen_size: `COALESCE(NULLIF(TRIM(pa.screen_size), ''), NULLIF(TRIM(vsn.extra->>'screen_size'), ''))`,
    gpu: `COALESCE(NULLIF(TRIM(pa.gpu), ''), NULLIF(TRIM(vsn.extra->>'gpu'), ''))`,
  };
  return map[field];
}

/** Spec filters for QC Ready / pending-inventory list (production_assets + ticket + serial). */
function buildProductionAssetPendingSpecFilter(filters, params) {
  if (!hasSpecFilters(filters)) {
    return { whereSql: '' };
  }
  const clauses = appendRepairSpecClauses(filters, params, productionAssetPendingSpecExpr);
  return { whereSql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '' };
}

module.exports = {
  SPEC_QUERY_KEYS,
  parseMultiSpecValues,
  pickSpecFilters,
  pickMultiSpecFilters,
  hasSpecFilters,
  hasMultiSpecFilters,
  buildSerialSpecFilter,
  buildTicketSpecFilter,
  buildProductionAssetPendingSpecFilter,
  appendRepairSpecClauses,
  appendMultiSpecClauses,
  reportRowSpecExpr,
  vendorRepairSpecExpr,
  erpRepairSpecExpr,
  ticketSpecExpr,
  buildSpecMatchClause,
  serialSpecExpr,
};
