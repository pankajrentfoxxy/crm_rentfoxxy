/**
 * Production QC Report — read-only reporting over qc_results_history.
 * Maps stored checklist keys to the report component list and normalizes results.
 */
const pool = require('../config/db');

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

function buildListFilters(query = {}) {
  const params = [];
  const conditions = [];

  if (query.date_from) {
    params.push(query.date_from);
    conditions.push(`h.submitted_at::date >= $${params.length}::date`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    conditions.push(`h.submitted_at::date <= $${params.length}::date`);
  }
  const techId = parseInt(query.technician_id, 10);
  if (Number.isFinite(techId) && techId > 0) {
    params.push(techId);
    conditions.push(`(h.tested_by = $${params.length} OR h.checked_by = $${params.length})`);
  }
  if (query.stage || query.qc_stage) {
    params.push(String(query.stage || query.qc_stage).trim());
    conditions.push(`h.qc_stage = $${params.length}`);
  }
  if (query.qc_status || query.status) {
    params.push(String(query.qc_status || query.status).trim().toUpperCase());
    conditions.push(`UPPER(COALESCE(h.qc_result, '')) = $${params.length}`);
  }
  if (query.ttspl) {
    params.push(`%${String(query.ttspl).trim()}%`);
    conditions.push(`COALESCE(t.ttspl_id, vsn.inventory_asset_code, '') ILIKE $${params.length}`);
  }
  if (query.serial || query.serial_number) {
    params.push(`%${String(query.serial || query.serial_number).trim()}%`);
    conditions.push(`COALESCE(t.serial_number, vsn.serial_number, '') ILIKE $${params.length}`);
  }
  if (query.brand) {
    params.push(`%${String(query.brand).trim()}%`);
    conditions.push(`COALESCE(t.brand, vsn.extra->>'brand', '') ILIKE $${params.length}`);
  }
  if (query.model) {
    params.push(`%${String(query.model).trim()}%`);
    conditions.push(`COALESCE(t.model, vsn.extra->>'model', vsn.extra->>'model_name', '') ILIKE $${params.length}`);
  }
  if (query.customer) {
    params.push(`%${String(query.customer).trim()}%`);
    conditions.push(`(
      COALESCE(c.company_name, c.name, '') ILIKE $${params.length}
      OR COALESCE(v.business_name, '') ILIKE $${params.length}
    )`);
  }
  if (query.ticket_id) {
    const tid = parseInt(query.ticket_id, 10);
    if (Number.isFinite(tid)) {
      params.push(tid);
      conditions.push(`h.ticket_id = $${params.length}`);
    }
  }

  return {
    params,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
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

async function listProductionQcReport(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const maxLimit = query.for_export ? 2000 : 100;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const { params, where } = buildListFilters(query);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     ${ticketJoinSql()}
     ${where}`,
    params
  );

  const listParams = [...params, limit, offset];
  const listRes = await pool.query(
    `SELECT
       h.history_id, h.qc_id, h.ticket_id, h.attempt_no, h.qc_stage,
       h.qc_result, h.remarks, h.final_grade, h.qc_date, h.submitted_at,
       h.processor, h.generation, h.storage_type, h.ram_size,
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
     ${where}
     ORDER BY h.submitted_at DESC NULLS LAST, h.history_id DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

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

async function getProductionQcReportDetail(historyId) {
  const id = parseInt(historyId, 10);
  if (!Number.isFinite(id)) return null;

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
  const row = res.rows[0];
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

  // Sibling attempts for same ticket+stage
  const attemptsRes = await pool.query(
    `SELECT history_id, attempt_no, qc_result, submitted_at
       FROM qc_results_history
      WHERE ticket_id = $1 AND qc_stage = $2
      ORDER BY attempt_no DESC`,
    [row.ticket_id, row.qc_stage]
  );

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
    attempts: attemptsRes.rows,
  };
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
    stages: stageRes.rows.map((r) => r.qc_stage),
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
  return insertRes.rows[0] || null;
}

module.exports = {
  REPORT_COMPONENTS,
  listProductionQcReport,
  getProductionQcReportDetail,
  getProductionQcReportFilters,
  snapshotQcResultToHistory,
  buildComponentChecks,
  buildListFilters,
};
