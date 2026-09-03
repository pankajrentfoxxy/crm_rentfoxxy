/**
 * Production QC Report — read-only reporting over qc_results_history.
 * Maps stored checklist keys to the report component list and normalizes results.
 */
const pool = require('../config/db');
const {
  buildListCacheKey,
  buildDetailCacheKey,
  getCachedList,
  setCachedList,
  getCachedDetail,
  setCachedDetail,
  invalidateProductionQcReportCachesFireAndForget,
} = require('./productionQcReportCache');
const {
  pickMultiSpecFilters,
  appendMultiSpecClauses,
  reportRowSpecExpr,
} = require('../utils/inventorySpecFilter');

/** Synthetic history_id for vendor-serial supplemental rows: -(VSN_SUPPLEMENTAL_BASE + serial_id). */
const VSN_SUPPLEMENTAL_BASE = 1000000000;
const SUPPLEMENTAL_STAGE = 'GRN QC';

function canViewProductionQcCustomerVendor(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

function redactProductionQcCustomerVendor(data) {
  if (data == null) return data;
  if (Array.isArray(data)) return data.map(redactProductionQcCustomerVendor);
  if (typeof data !== 'object') return data;
  const { customer_vendor, ...rest } = data;
  return rest;
}

/** Canonical report components requested for Production QC Report. */
const REPORT_COMPONENTS = [
  { key: 'display', label: 'Display', sources: ['screen_resolution', 'refresh_rate', 'touch_screen'] },
  { key: 'keyboard', label: 'Keyboard', sources: ['keyboard', 'keyboard_light'] },
  { key: 'touchpad', label: 'Touchpad', sources: ['touchpad', 'cursor_speed', 'left_click', 'right_click', 'scrolling'] },
  { key: 'battery', label: 'Battery', sources: ['battery_health'] },
  { key: 'charger', label: 'Charger', sources: ['power_adapter'] },
  { key: 'camera', label: 'Camera', sources: ['camera_recording'] },
  { key: 'speaker', label: 'Speaker', sources: ['speaker'] },
  { key: 'microphone', label: 'Microphone', sources: [] },
  { key: 'wifi', label: 'WiFi', sources: ['wifi_test'] },
  { key: 'bluetooth', label: 'Bluetooth', sources: ['bluetooth'] },
  { key: 'usb_ports', label: 'USB Ports', sources: ['usb_ports'] },
  { key: 'hdmi', label: 'HDMI', sources: ['vga_hdmi'] },
  { key: 'audio_jack', label: 'Audio Jack', sources: ['audio_jack'] },
  { key: 'lan', label: 'LAN', sources: ['lan_port'] },
  { key: 'trackpad', label: 'Trackpad', sources: ['touchpad'] },
  { key: 'ssd', label: 'SSD', sources: ['ssd_health'] },
  { key: 'ram', label: 'RAM', sources: ['expandability'] },
  { key: 'processor', label: 'Processor', sources: [] },
  { key: 'graphics', label: 'Graphics', sources: [] },
  { key: 'body_condition', label: 'Body Condition', sources: ['body_scratches', 'physical_damage', 'body_screws', 'body_hinge', 'ttspl_id'] },
  { key: 'other_components', label: 'Other Components', sources: ['motherboard_cleaning', 'heating_test', 'bios_check', 'required_drivers', 'ms_office', 'chrome', 'ultra_viewer', 'virtual_memory', 'parts_replaced'] },
];

const WORKING_VALUES = new Set(['WORKING', 'YES', 'PASS', 'GOOD', 'INSTALLED', 'AVERAGE']);
const NOT_WORKING_VALUES = new Set(['NOT WORKING', 'NO', 'FAIL', 'BAD', 'NOT INSTALLED']);

function normalizeCheckResult(raw) {
  if (raw == null || String(raw).trim() === '') return 'Not Checked';
  const v = String(raw).trim().toUpperCase();
  if (WORKING_VALUES.has(v)) return 'Working';
  if (NOT_WORKING_VALUES.has(v)) return 'Not Working';
  return String(raw).trim();
}

function worstResult(results) {
  if (!results.length) return 'Not Checked';
  if (results.some((r) => r === 'Not Working')) return 'Not Working';
  if (results.every((r) => r === 'Not Checked')) return 'Not Checked';
  if (results.some((r) => r === 'Working')) return 'Working';
  return results[0];
}

function buildComponentChecks(checklistData = {}, meta = {}) {
  const data = checklistData && typeof checklistData === 'object' ? checklistData : {};
  return REPORT_COMPONENTS.map((comp) => {
    let rawValues = [];
    if (comp.key === 'processor' && meta.processor) {
      rawValues = ['YES'];
    } else if (comp.key === 'ram' && meta.ram_size && !comp.sources.some((k) => data[k] != null && data[k] !== '')) {
      rawValues = ['YES'];
    } else {
      rawValues = comp.sources.map((k) => data[k]).filter((v) => v != null && String(v).trim() !== '');
    }
    const normalized = rawValues.map(normalizeCheckResult);
    const sourceDetails = comp.sources
      .filter((k) => data[k] != null && String(data[k]).trim() !== '')
      .map((k) => ({ key: k, value: data[k], result: normalizeCheckResult(data[k]) }));

    return {
      component_key: comp.key,
      component: comp.label,
      check_result: worstResult(normalized),
      raw_values: rawValues,
      source_details: sourceDetails,
      technician_remark: null,
      checked_by: meta.checked_by_name || meta.tested_by_name || null,
      checked_at: meta.submitted_at || null,
    };
  });
}

function ticketJoinSql() {
  return `
    FROM qc_results_history h
    JOIN tickets t ON t.ticket_id = h.ticket_id
    LEFT JOIN stages st ON st.stage_id = t.current_stage_id
    LEFT JOIN users ut ON ut.user_id = h.tested_by
    LEFT JOIN users uc ON uc.user_id = h.checked_by
    LEFT JOIN vendor_serial_numbers vsn
      ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
    LEFT JOIN vendor_purchase_orders vpo
      ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
    LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
    LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
  `;
}

/** Laptops already represented by floor QC history snapshots. */
function historyTtsplKeysCte() {
  return `
    history_in_report AS (
      SELECT DISTINCT UPPER(
        COALESCE(NULLIF(TRIM(t.ttspl_id), ''), vsn.inventory_asset_code)
      ) AS ttspl_key
      FROM qc_results_history h
      JOIN tickets t ON t.ticket_id = h.ticket_id
      LEFT JOIN vendor_serial_numbers vsn
        ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
      WHERE COALESCE(NULLIF(TRIM(t.ttspl_id), ''), vsn.inventory_asset_code) IS NOT NULL
    ),
  `;
}

/** TTSPL IDs that appear on delivered / dispatched DC lines. */
function deliveredTtsplCte(searchParam = null) {
  const searchClause = searchParam
    ? `AND split_part(elem, '|', 3) ILIKE ${searchParam}`
    : '';
  return `
    delivered_ttspl AS (
      SELECT
        UPPER(split_part(elem, '|', 3)) AS ttspl_key,
        MAX(dcl.customer_name) AS dc_customer_name,
        MAX(COALESCE(dcl.delivery_completed_at, dcl.created_at)) AS last_delivery_at
      FROM delivery_challan_lines dcl,
      LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb)) = 'array'
            THEN COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE split_part(elem, '|', 3) <> ''
        AND dcl.status IN ('delivered', 'dispatched', 'in_transit', 'completed', 'closed')
        ${searchClause}
      GROUP BY 1
    ),
  `;
}

function supplementalEligibilitySql(ttsplExpr) {
  return `(
    EXISTS (SELECT 1 FROM delivered_ttspl dt WHERE dt.ttspl_key = UPPER(${ttsplExpr}))
    OR vsn.current_customer_id IS NOT NULL
    OR vsn.inventory_status IN ('with_customer', 'returned', 'dispatched', 'delivered', 'out_for_delivery')
    OR NULLIF(TRIM(al.customer_name), '') IS NOT NULL
    OR NULLIF(TRIM(al.vendor_name), '') IS NOT NULL
  )`;
}

function customerVendorExpr() {
  return `COALESCE(
    NULLIF(TRIM(dt.dc_customer_name), ''),
    NULLIF(TRIM(c.company_name), ''),
    NULLIF(TRIM(c.name), ''),
    NULLIF(TRIM(al.customer_name), ''),
    NULLIF(TRIM(al.vendor_name), ''),
    NULLIF(TRIM(v.business_name), '')
  )`;
}

/** Unified report dataset: floor QC history + legacy allocation/vendor QC units sent to customer/vendor. */
function unifiedReportRowsCte(searchParam = null) {
  const allocSearchClause = searchParam
    ? `AND (al.unique_id ILIKE ${searchParam} OR al.serial_number ILIKE ${searchParam})`
    : '';
  const vsnSearchClause = searchParam
    ? `AND (vsn.inventory_asset_code ILIKE ${searchParam} OR vsn.serial_number ILIKE ${searchParam})`
    : '';
  const historySearchWhere = searchParam
    ? `WHERE (
      COALESCE(NULLIF(TRIM(t.ttspl_id), ''), vsn.inventory_asset_code, '') ILIKE ${searchParam}
      OR COALESCE(NULLIF(TRIM(t.serial_number), ''), vsn.serial_number, '') ILIKE ${searchParam}
      OR COALESCE(t.brand, vsn.extra->>'brand', '') ILIKE ${searchParam}
      OR COALESCE(t.model, vsn.extra->>'model', vsn.extra->>'model_name', '') ILIKE ${searchParam}
      OR COALESCE(ut.name, ut.email, '') ILIKE ${searchParam}
      OR COALESCE(uc.name, uc.email, '') ILIKE ${searchParam}
      OR COALESCE(c.company_name, c.name, v.business_name, '') ILIKE ${searchParam}
      OR h.qc_stage ILIKE ${searchParam}
      OR COALESCE(h.qc_result, '') ILIKE ${searchParam}
    )`
    : '';

  return `
    WITH ${historyTtsplKeysCte()}
    ${deliveredTtsplCte(searchParam)}
    latest_alloc_qc AS (
      SELECT DISTINCT ON (UPPER(al.unique_id))
        al.*
      FROM allocation_logs al
      WHERE al.unique_id IS NOT NULL
        AND TRIM(al.unique_id) <> ''
        AND (al.qc_status ILIKE 'pass%' OR al.action_taken ILIKE 'pass%')
        ${allocSearchClause}
      ORDER BY UPPER(al.unique_id), al.added_date DESC NULLS LAST, al.id DESC
    ),
    report_rows AS (
      SELECT
        h.history_id,
        h.qc_id,
        h.ticket_id,
        h.attempt_no,
        h.qc_stage,
        h.qc_result,
        h.remarks,
        h.final_grade,
        h.qc_date,
        h.submitted_at,
        h.processor,
        h.generation,
        h.storage_type,
        h.ram_size,
        vsn.extra->>'screen_size' AS screen_size,
        vsn.extra->>'gpu' AS gpu,
        h.tested_by,
        h.checked_by,
        COALESCE(NULLIF(TRIM(t.ttspl_id), ''), vsn.inventory_asset_code) AS ttspl_id,
        COALESCE(NULLIF(TRIM(t.serial_number), ''), vsn.serial_number) AS serial_number,
        COALESCE(ut.name, ut.email) AS technician_name,
        COALESCE(uc.name, uc.email) AS checked_by_name,
        COALESCE(
          NULLIF(TRIM(c.company_name), ''),
          NULLIF(TRIM(c.name), ''),
          NULLIF(TRIM(v.business_name), '')
        ) AS customer_vendor,
        COALESCE(t.brand, vsn.extra->>'brand') AS brand,
        COALESCE(t.model, vsn.extra->>'model', vsn.extra->>'model_name') AS model,
        st.stage_name AS current_stage
      ${ticketJoinSql()}
      ${historySearchWhere}

      UNION ALL

      SELECT
        (-al.id)::int AS history_id,
        NULL::int AS qc_id,
        bt.ticket_id,
        1 AS attempt_no,
        '${SUPPLEMENTAL_STAGE}' AS qc_stage,
        'PASS' AS qc_result,
        COALESCE(NULLIF(TRIM(al.remarks), ''), 'QC passed via allocation log') AS remarks,
        NULL::varchar AS final_grade,
        al.added_date::date AS qc_date,
        COALESCE(al.created_at, al.added_date::timestamptz) AS submitted_at,
        vsn.extra->>'processor' AS processor,
        vsn.extra->>'generation' AS generation,
        vsn.extra->>'storage' AS storage_type,
        vsn.extra->>'ram' AS ram_size,
        vsn.extra->>'screen_size' AS screen_size,
        vsn.extra->>'gpu' AS gpu,
        NULL::int AS tested_by,
        al.checked_by AS checked_by,
        al.unique_id AS ttspl_id,
        COALESCE(vsn.serial_number, al.serial_number) AS serial_number,
        NULL::text AS technician_name,
        NULL::text AS checked_by_name,
        ${customerVendorExpr()} AS customer_vendor,
        vsn.extra->>'brand' AS brand,
        COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', al.model_name) AS model,
        st.stage_name AS current_stage
      FROM latest_alloc_qc al
      LEFT JOIN vendor_serial_numbers vsn
        ON vsn.deleted_at IS NULL
       AND UPPER(vsn.inventory_asset_code) = UPPER(al.unique_id)
      LEFT JOIN LATERAL (
        SELECT t.ticket_id, t.current_stage_id
          FROM tickets t
         WHERE UPPER(COALESCE(t.ttspl_id, '')) = UPPER(al.unique_id)
            OR (vsn.serial_id IS NOT NULL AND t.vendor_serial_id = vsn.serial_id)
         ORDER BY CASE WHEN t.status = 'completed' THEN 0 ELSE 1 END,
                  t.completed_at DESC NULLS LAST,
                  t.created_at DESC
         LIMIT 1
      ) bt ON TRUE
      LEFT JOIN stages st ON st.stage_id = bt.current_stage_id
      LEFT JOIN delivered_ttspl dt ON dt.ttspl_key = UPPER(al.unique_id)
      LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      LEFT JOIN vendor_purchase_orders vpo
        ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
      LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM history_in_report hir WHERE hir.ttspl_key = UPPER(al.unique_id)
      )
        AND ${supplementalEligibilitySql('al.unique_id')}

      UNION ALL

      SELECT
        (-(${VSN_SUPPLEMENTAL_BASE} + vsn.serial_id))::int AS history_id,
        NULL::int AS qc_id,
        bt.ticket_id,
        1 AS attempt_no,
        '${SUPPLEMENTAL_STAGE}' AS qc_stage,
        'PASS' AS qc_result,
        'QC passed on inventory unit' AS remarks,
        NULL::varchar AS final_grade,
        COALESCE(vsn.updated_at, vsn.created_at)::date AS qc_date,
        COALESCE(vsn.updated_at, vsn.created_at) AS submitted_at,
        vsn.extra->>'processor' AS processor,
        vsn.extra->>'generation' AS generation,
        vsn.extra->>'storage' AS storage_type,
        vsn.extra->>'ram' AS ram_size,
        vsn.extra->>'screen_size' AS screen_size,
        vsn.extra->>'gpu' AS gpu,
        NULL::int AS tested_by,
        NULL::int AS checked_by,
        vsn.inventory_asset_code AS ttspl_id,
        vsn.serial_number,
        NULL::text AS technician_name,
        NULL::text AS checked_by_name,
        ${customerVendorExpr()} AS customer_vendor,
        vsn.extra->>'brand' AS brand,
        COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model,
        st.stage_name AS current_stage
      FROM vendor_serial_numbers vsn
      LEFT JOIN LATERAL (
        SELECT t.ticket_id, t.current_stage_id
          FROM tickets t
         WHERE UPPER(COALESCE(t.ttspl_id, '')) = UPPER(vsn.inventory_asset_code)
            OR t.vendor_serial_id = vsn.serial_id
         ORDER BY CASE WHEN t.status = 'completed' THEN 0 ELSE 1 END,
                  t.completed_at DESC NULLS LAST,
                  t.created_at DESC
         LIMIT 1
      ) bt ON TRUE
      LEFT JOIN stages st ON st.stage_id = bt.current_stage_id
      LEFT JOIN delivered_ttspl dt ON dt.ttspl_key = UPPER(vsn.inventory_asset_code)
      LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      LEFT JOIN vendor_purchase_orders vpo
        ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
      LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN latest_alloc_qc al ON UPPER(al.unique_id) = UPPER(vsn.inventory_asset_code)
      WHERE vsn.deleted_at IS NULL
        AND vsn.inventory_asset_code IS NOT NULL
        AND TRIM(vsn.inventory_asset_code) <> ''
        AND COALESCE(vsn.qc_status, vsn.extra->>'status', '') ILIKE 'pass%'
        AND al.id IS NULL
        ${vsnSearchClause}
        AND NOT EXISTS (
          SELECT 1 FROM history_in_report hir WHERE hir.ttspl_key = UPPER(vsn.inventory_asset_code)
        )
        AND (
          EXISTS (SELECT 1 FROM delivered_ttspl dt2 WHERE dt2.ttspl_key = UPPER(vsn.inventory_asset_code))
          OR vsn.current_customer_id IS NOT NULL
          OR vsn.inventory_status IN ('with_customer', 'returned', 'dispatched', 'delivered', 'out_for_delivery')
        )
    )
  `;
}

function normalizeMasterSearch(query = {}) {
  return String(query.search || query.q || query.ttspl || '').trim();
}

function queryDateFrom(query = {}) {
  return String(query.date_from || query.dateFrom || '').trim();
}

function queryDateTo(query = {}) {
  return String(query.date_to || query.dateTo || '').trim();
}

function nextBind(params, searchBindIndex = 0) {
  return searchBindIndex + params.length;
}

function buildListFilters(query = {}, { searchBindIndex = 0, includeCustomerVendorInSearch = true } = {}) {
  const params = [];
  const conditions = [];
  const search = normalizeMasterSearch(query);

  if (search) {
    const bind = searchBindIndex || params.length + 1;
    if (!searchBindIndex) {
      params.push(`%${search}%`);
    }
    const p = `$${bind}`;
    const searchFields = [
      `COALESCE(r.ttspl_id, '') ILIKE ${p}`,
      `COALESCE(r.serial_number, '') ILIKE ${p}`,
      `COALESCE(r.brand, '') ILIKE ${p}`,
      `COALESCE(r.model, '') ILIKE ${p}`,
      `COALESCE(r.technician_name, '') ILIKE ${p}`,
      `COALESCE(r.checked_by_name, '') ILIKE ${p}`,
      `COALESCE(r.qc_stage, '') ILIKE ${p}`,
      `COALESCE(r.qc_result, '') ILIKE ${p}`,
    ];
    if (includeCustomerVendorInSearch) {
      searchFields.splice(4, 0, `COALESCE(r.customer_vendor, '') ILIKE ${p}`);
    }
    conditions.push(`(${searchFields.join('\n      OR ')})`);
  }

  const dateFrom = queryDateFrom(query);
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`r.submitted_at::date >= $${nextBind(params, searchBindIndex)}::date`);
  }
  const dateTo = queryDateTo(query);
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`r.submitted_at::date <= $${nextBind(params, searchBindIndex)}::date`);
  }

  const techId = parseInt(query.technician_id || query.technicianId, 10);
  if (Number.isFinite(techId) && techId > 0) {
    params.push(techId);
    const p = `$${nextBind(params, searchBindIndex)}`;
    conditions.push(`(r.tested_by = ${p} OR r.checked_by = ${p})`);
  }

  const stage = String(query.stage || query.qc_stage || '').trim();
  if (stage) {
    params.push(stage);
    conditions.push(`r.qc_stage = $${nextBind(params, searchBindIndex)}`);
  }

  const qcStatus = String(query.qc_status || query.qcStatus || query.status || '').trim();
  if (qcStatus) {
    params.push(qcStatus.toUpperCase());
    conditions.push(`UPPER(COALESCE(r.qc_result, '')) = $${nextBind(params, searchBindIndex)}`);
  }

  const specFilters = pickMultiSpecFilters(query);
  conditions.push(...appendMultiSpecClauses(specFilters, params, reportRowSpecExpr, searchBindIndex));

  if (query.ticket_id) {
    const tid = parseInt(query.ticket_id, 10);
    if (Number.isFinite(tid)) {
      params.push(tid);
      conditions.push(`r.ticket_id = $${nextBind(params, searchBindIndex)}`);
    }
  }

  return {
    params,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    search,
  };
}

function mapListRow(row) {
  return {
    history_id: row.history_id,
    qc_id: row.qc_id,
    ticket_id: row.ticket_id,
    attempt_no: row.attempt_no,
    ttspl_id: row.ttspl_id || null,
    serial_number: row.serial_number || null,
    technician_name: row.technician_name || null,
    checked_by_name: row.checked_by_name || null,
    customer_vendor: row.customer_vendor || null,
    brand: row.brand || null,
    model: row.model || null,
    current_stage: row.current_stage || null,
    qc_stage: row.qc_stage,
    qc_date: row.qc_date,
    submitted_at: row.submitted_at,
    qc_status: row.qc_result || null,
    qc_remarks: row.remarks || null,
    final_grade: row.final_grade || null,
    processor: row.processor || null,
    generation: row.generation || null,
  };
}

async function listProductionQcReportUncached(query = {}, options = {}) {
  const includeCustomerVendor = options.includeCustomerVendor !== false;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const maxLimit = query.for_export ? 2000 : 100;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const search = normalizeMasterSearch(query);
  const queryParams = search ? [`%${search}%`] : [];
  const searchParam = search ? '$1' : null;
  const { params, where } = buildListFilters(query, {
    searchBindIndex: search ? 1 : 0,
    includeCustomerVendorInSearch: includeCustomerVendor,
  });
  const allParams = [...queryParams, ...params];
  const baseSql = unifiedReportRowsCte(searchParam);

  const countSql = `${baseSql}
     SELECT COUNT(*)::int AS total
     FROM report_rows r
     ${where}`;
  const listSql = `${baseSql}
     SELECT
       r.history_id, r.qc_id, r.ticket_id, r.attempt_no, r.qc_stage,
       r.qc_result, r.remarks, r.final_grade, r.qc_date, r.submitted_at,
       r.processor, r.generation, r.storage_type, r.ram_size,
       r.ttspl_id, r.serial_number, r.technician_name, r.checked_by_name,
       r.customer_vendor, r.brand, r.model, r.current_stage
     FROM report_rows r
     ${where}
     ORDER BY r.submitted_at DESC NULLS LAST, r.history_id DESC
     LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}`;
  const listParams = [...allParams, limit, offset];

  const [countRes, listRes] = await Promise.all([
    pool.query(countSql, allParams),
    pool.query(listSql, listParams),
  ]);

  const total = countRes.rows[0]?.total || 0;
  return {
    rows: listRes.rows.map(mapListRow),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listProductionQcReport(query = {}, options = {}) {
  const cacheKey = buildListCacheKey(query);
  const cached = await getCachedList(cacheKey);
  const result = cached || await listProductionQcReportUncached(query, options);
  if (!cached) await setCachedList(cacheKey, result);

  if (options.includeCustomerVendor === false) {
    return {
      ...result,
      rows: redactProductionQcCustomerVendor(result.rows || []),
    };
  }
  return result;
}

async function getSupplementalProductionQcDetail(historyId) {
  if (historyId < 0 && historyId > -VSN_SUPPLEMENTAL_BASE) {
    const allocId = -historyId;
    const res = await pool.query(
      `WITH ${deliveredTtsplCte().replace(/,\s*$/, '')}
       SELECT
         (-al.id)::int AS history_id,
         NULL::int AS qc_id,
         bt.ticket_id,
         1 AS attempt_no,
         '${SUPPLEMENTAL_STAGE}' AS qc_stage,
         'PASS' AS qc_result,
         COALESCE(NULLIF(TRIM(al.remarks), ''), 'QC passed via allocation log') AS remarks,
         NULL::varchar AS final_grade,
         NULL::text AS grade_notes,
         ARRAY[]::text[] AS failure_reasons,
         FALSE AS parts_replaced,
         NULL::jsonb AS replaced_parts,
         al.added_date::date AS qc_date,
         COALESCE(al.created_at, al.added_date::timestamptz) AS submitted_at,
         vsn.extra->>'processor' AS processor,
         vsn.extra->>'generation' AS generation,
         vsn.extra->>'storage' AS storage_type,
         vsn.extra->>'ram' AS ram_size,
         al.unique_id AS ttspl_id,
         COALESCE(vsn.serial_number, al.serial_number) AS serial_number,
         NULL::text AS technician_name,
         NULL::text AS checked_by_name,
         ${customerVendorExpr()} AS customer_vendor,
         vsn.extra->>'brand' AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', al.model_name) AS model,
         st.stage_name AS current_stage
       FROM allocation_logs al
       LEFT JOIN vendor_serial_numbers vsn
         ON vsn.deleted_at IS NULL
        AND UPPER(vsn.inventory_asset_code) = UPPER(al.unique_id)
       LEFT JOIN LATERAL (
         SELECT t.ticket_id, t.current_stage_id
           FROM tickets t
          WHERE UPPER(COALESCE(t.ttspl_id, '')) = UPPER(al.unique_id)
             OR (vsn.serial_id IS NOT NULL AND t.vendor_serial_id = vsn.serial_id)
          ORDER BY CASE WHEN t.status = 'completed' THEN 0 ELSE 1 END,
                   t.completed_at DESC NULLS LAST,
                   t.created_at DESC
          LIMIT 1
       ) bt ON TRUE
       LEFT JOIN stages st ON st.stage_id = bt.current_stage_id
       LEFT JOIN delivered_ttspl dt ON dt.ttspl_key = UPPER(al.unique_id)
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN vendor_purchase_orders vpo
         ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
       LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
       WHERE al.id = $1
       LIMIT 1`,
      [allocId]
    );
    return res.rows[0] || null;
  }

  if (historyId <= -VSN_SUPPLEMENTAL_BASE) {
    const serialId = -(historyId + VSN_SUPPLEMENTAL_BASE);
    const res = await pool.query(
      `WITH ${deliveredTtsplCte().replace(/,\s*$/, '')}
       SELECT
         (-(${VSN_SUPPLEMENTAL_BASE} + vsn.serial_id))::int AS history_id,
         NULL::int AS qc_id,
         bt.ticket_id,
         1 AS attempt_no,
         '${SUPPLEMENTAL_STAGE}' AS qc_stage,
         'PASS' AS qc_result,
         'QC passed on inventory unit' AS remarks,
         NULL::varchar AS final_grade,
         NULL::text AS grade_notes,
         ARRAY[]::text[] AS failure_reasons,
         FALSE AS parts_replaced,
         NULL::jsonb AS replaced_parts,
         COALESCE(vsn.updated_at, vsn.created_at)::date AS qc_date,
         COALESCE(vsn.updated_at, vsn.created_at) AS submitted_at,
         vsn.extra->>'processor' AS processor,
         vsn.extra->>'generation' AS generation,
         vsn.extra->>'storage' AS storage_type,
         vsn.extra->>'ram' AS ram_size,
         vsn.inventory_asset_code AS ttspl_id,
         vsn.serial_number,
         NULL::text AS technician_name,
         NULL::text AS checked_by_name,
         ${customerVendorExpr()} AS customer_vendor,
         vsn.extra->>'brand' AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model,
         st.stage_name AS current_stage
       FROM vendor_serial_numbers vsn
       LEFT JOIN LATERAL (
         SELECT t.ticket_id, t.current_stage_id
           FROM tickets t
          WHERE UPPER(COALESCE(t.ttspl_id, '')) = UPPER(vsn.inventory_asset_code)
             OR t.vendor_serial_id = vsn.serial_id
          ORDER BY CASE WHEN t.status = 'completed' THEN 0 ELSE 1 END,
                   t.completed_at DESC NULLS LAST,
                   t.created_at DESC
          LIMIT 1
       ) bt ON TRUE
       LEFT JOIN stages st ON st.stage_id = bt.current_stage_id
       LEFT JOIN delivered_ttspl dt ON dt.ttspl_key = UPPER(vsn.inventory_asset_code)
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
       LEFT JOIN vendor_purchase_orders vpo
         ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
       LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN allocation_logs al ON UPPER(al.unique_id) = UPPER(vsn.inventory_asset_code)
       WHERE vsn.serial_id = $1
         AND vsn.deleted_at IS NULL
       LIMIT 1`,
      [serialId]
    );
    return res.rows[0] || null;
  }

  return null;
}

async function getProductionQcReportDetailUncached(historyId) {
  const id = parseInt(historyId, 10);
  if (!Number.isFinite(id)) return null;

  let row;
  if (id < 0) {
    row = await getSupplementalProductionQcDetail(id);
  } else {
  const res = await pool.query(
    `SELECT
       h.*,
       COALESCE(NULLIF(TRIM(t.ttspl_id), ''), vsn.inventory_asset_code) AS ttspl_id,
       COALESCE(NULLIF(TRIM(t.serial_number), ''), vsn.serial_number) AS serial_number,
       COALESCE(ut.name, ut.email) AS technician_name,
       COALESCE(uc.name, uc.email) AS checked_by_name,
       COALESCE(
         NULLIF(TRIM(c.company_name), ''),
         NULLIF(TRIM(c.name), ''),
         NULLIF(TRIM(v.business_name), '')
       ) AS customer_vendor,
       COALESCE(t.brand, vsn.extra->>'brand') AS brand,
       COALESCE(t.model, vsn.extra->>'model', vsn.extra->>'model_name') AS model,
       st.stage_name AS current_stage,
       t.ticket_id
     ${ticketJoinSql()}
     WHERE h.history_id = $1
     LIMIT 1`,
    [id]
  );
    row = res.rows[0];
  }
  if (!row) return null;

  const checklist = typeof row.checklist_data === 'string'
    ? JSON.parse(row.checklist_data)
    : (row.checklist_data || {});

  const components = buildComponentChecks(checklist, {
    processor: row.processor,
    ram_size: row.ram_size,
    checked_by_name: row.checked_by_name,
    tested_by_name: row.technician_name,
    submitted_at: row.submitted_at,
  });

  let attempts = [{ history_id: row.history_id, attempt_no: row.attempt_no, qc_result: row.qc_result, submitted_at: row.submitted_at }];
  if (id > 0 && row.ticket_id) {
  const attemptsRes = await pool.query(
    `SELECT history_id, attempt_no, qc_result, submitted_at
       FROM qc_results_history
      WHERE ticket_id = $1 AND qc_stage = $2
      ORDER BY attempt_no DESC`,
    [row.ticket_id, row.qc_stage]
  );
    if (attemptsRes.rows.length) attempts = attemptsRes.rows;
  }

  return {
    ...mapListRow(row),
    grade_notes: row.grade_notes || null,
    failure_reasons: row.failure_reasons || [],
    parts_replaced: row.parts_replaced || false,
    replaced_parts: row.replaced_parts || [],
    storage_type: row.storage_type || null,
    ram_size: row.ram_size || null,
    checklist_data: checklist,
    components,
    attempts,
    is_supplemental: id < 0,
  };
}

async function getProductionQcReportDetail(historyId) {
  const cacheKey = buildDetailCacheKey(historyId);
  const cached = await getCachedDetail(cacheKey);
  if (cached) return cached;

  const detail = await getProductionQcReportDetailUncached(historyId);
  if (detail) await setCachedDetail(cacheKey, detail);
  return detail;
}

async function getProductionQcReportFilters() {
  const [techRes, stageRes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT u.user_id, COALESCE(u.name, u.email) AS name
         FROM qc_results_history h
         JOIN users u ON u.user_id = COALESCE(h.tested_by, h.checked_by)
        WHERE u.user_id IS NOT NULL
        ORDER BY name ASC
        LIMIT 500`
    ),
    pool.query(
      `SELECT DISTINCT qc_stage
         FROM qc_results_history
        WHERE qc_stage IS NOT NULL
        ORDER BY qc_stage ASC`
    ),
  ]);
  return {
    technicians: techRes.rows,
    stages: [...new Set([...stageRes.rows.map((r) => r.qc_stage), SUPPLEMENTAL_STAGE])].sort(),
    qc_statuses: ['PASS', 'FAIL'],
  };
}

/**
 * Snapshot current qc_results row into history after a successful submit.
 * Safe to call inside an open transaction (pass client).
 */
async function snapshotQcResultToHistory(db, qcId) {
  const client = db || pool;
  const existing = await client.query(
    `SELECT qc_id, ticket_id, qc_stage FROM qc_results WHERE qc_id = $1`,
    [qcId]
  );
  if (!existing.rows.length) return null;
  const { ticket_id: ticketId, qc_stage: qcStage } = existing.rows[0];

  const attemptRes = await client.query(
    `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_attempt
       FROM qc_results_history
      WHERE ticket_id = $1 AND qc_stage = $2`,
    [ticketId, qcStage]
  );
  const attemptNo = attemptRes.rows[0]?.next_attempt || 1;

  const insertRes = await client.query(
    `INSERT INTO qc_results_history (
       qc_id, ticket_id, qc_stage, attempt_no,
       processor, generation, storage_type, ram_size,
       checklist_data, parts_replaced, replaced_parts,
       qc_result, failure_reasons, remarks, final_grade, grade_notes,
       tested_by, checked_by, qc_date, submitted_at, created_at
     )
     SELECT
       qr.qc_id, qr.ticket_id, qr.qc_stage, $2,
       qr.processor, qr.generation, qr.storage_type, qr.ram_size,
       COALESCE(qr.checklist_data, '{}'::jsonb),
       COALESCE(qr.parts_replaced, FALSE), qr.replaced_parts,
       qr.qc_result, qr.failure_reasons, qr.remarks, qr.final_grade, qr.grade_notes,
       qr.tested_by, qr.checked_by, qr.qc_date,
       COALESCE(qr.submitted_at, NOW()), NOW()
     FROM qc_results qr
     WHERE qr.qc_id = $1
     RETURNING history_id, attempt_no`,
    [qcId, attemptNo]
  );
  invalidateProductionQcReportCachesFireAndForget();
  return insertRes.rows[0] || null;
}

module.exports = {
  REPORT_COMPONENTS,
  canViewProductionQcCustomerVendor,
  redactProductionQcCustomerVendor,
  listProductionQcReport,
  getProductionQcReportDetail,
  getProductionQcReportFilters,
  snapshotQcResultToHistory,
  buildComponentChecks,
  buildListFilters,
};
