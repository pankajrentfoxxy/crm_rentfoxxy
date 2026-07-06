const SPEC_QUERY_KEYS = [
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

const { normalizeSpecFilterValue } = require('./specFilterNormalize');

function pickSpecFilters(query = {}) {
  const out = {};
  for (const key of SPEC_QUERY_KEYS) {
    const v = (query[key] || '').trim();
    if (!v) continue;
    out[key] = normalizeSpecFilterValue(key, v);
  }
  return out;
}

function hasSpecFilters(filters) {
  return SPEC_QUERY_KEYS.some((k) => Boolean(filters[k]));
}

/** Extract leading digits for loose RAM/SSD/generation matching ("10" ↔ "10TH", "16" ↔ "16 GB"). */
function numericPrefixSql(expr) {
  return `NULLIF(regexp_replace(LOWER(TRIM(COALESCE(${expr}, ''))), '[^0-9].*', ''), '')`;
}

/** Build a WHERE clause that matches display-style spec values, not just exact master names. */
function buildSpecMatchClause(expr, val, params, field) {
  params.push(val);
  const i = params.length;
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

/** PO line_items JSON — same sources as resolveItemDescription in qcManagementService. */
function poLineItemSpecSubquery(field, sAlias = 's', pAlias = 'p') {
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
  const pick = lineFields[field];
  if (!pick) return 'NULL';

  return `(
    SELECT ${pick}
    FROM jsonb_array_elements(COALESCE(${pAlias}.line_items, '[]'::jsonb)) WITH ORDINALITY AS li(elem, ord)
    WHERE NULLIF(TRIM(${pick}), '') IS NOT NULL
      AND (
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
      )
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
  if (!hasSpecFilters(filters)) {
    return { joinSql: '', whereSql: '' };
  }
  const clauses = [];
  for (const key of SPEC_QUERY_KEYS) {
    const val = filters[key];
    if (!val) continue;
    clauses.push(buildSpecMatchClause(serialSpecExpr(key, sAlias, pAlias), val, params, key));
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
    clauses.push(buildSpecMatchClause(exprFn(key), val, params, key));
  }
  return clauses;
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

module.exports = {
  SPEC_QUERY_KEYS,
  pickSpecFilters,
  hasSpecFilters,
  buildSerialSpecFilter,
  buildTicketSpecFilter,
  appendRepairSpecClauses,
  vendorRepairSpecExpr,
  erpRepairSpecExpr,
  ticketSpecExpr,
  buildSpecMatchClause,
  serialSpecExpr,
};
