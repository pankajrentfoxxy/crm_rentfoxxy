/**
 * Sales Order Operations Report — pipeline by processor (+ generation drill-down).
 * CRM operations counted from 2026-07-01 only (excludes legacy ERP migration noise).
 */
const pool = require('../config/db');
const { compareKey } = require('../utils/assetConfigNormalize');
const { appleChipGeneration } = require('../utils/soInventorySpecMatch');
const { salesOrderScopeWhere } = require('./salesManagementService');

const CRM_START_DATE = '2026-07-01';

const DC_TERMINAL_STATUSES = new Set(['delivered', 'rejected', 'cancelled']);
const DC_CHALLAN_STATUSES = new Set(['pending', 'processing']);
const DC_DISPATCHED_STATUSES = new Set(['in_transit', 'shipped', 'reached']);
const DEPLOYED_INVENTORY = new Set(['rented', 'sold', 'on_demo']);

const COUNT_FIELDS = [
  'ordered', 'attached', 'dispatch_qc_done', 'challan_generated',
  'dispatched', 'available', 'qc_process',
];

function istDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return istDateString(d);
}

function parseDateRange(query = {}) {
  const preset = String(query.preset || 'all').toLowerCase();
  const today = istDateString();

  if (preset === 'all') {
    return { preset, from: CRM_START_DATE, to: today, live: true };
  }
  if (preset === 'today') return { preset, from: today, to: today, live: false };
  if (preset === 'yesterday') {
    const y = addDays(today, -1);
    return { preset, from: y, to: y, live: false };
  }
  if (preset === 'last7') return { preset, from: addDays(today, -6), to: today, live: false };
  const from = query.from || query.date_from || CRM_START_DATE;
  const to = query.to || query.date_to || today;
  return { preset: 'custom', from, to, live: false };
}

function effectiveFrom(range) {
  const from = range.from || CRM_START_DATE;
  return from < CRM_START_DATE ? CRM_START_DATE : from;
}

function inDateRange(ts, range) {
  if (!ts) return false;
  const day = istDateString(new Date(ts));
  const from = effectiveFrom(range);
  const to = range.to || istDateString();
  return day >= from && day <= to;
}

function onOrAfterCrmStart(ts) {
  if (!ts) return false;
  return istDateString(new Date(ts)) >= CRM_START_DATE;
}

function resolveGeneration(processor, generation) {
  return generation || appleChipGeneration(processor) || '—';
}

function processorKey(processor) {
  return compareKey('processors', processor || '—');
}

function specKey(processor, generation) {
  const gen = resolveGeneration(processor, generation);
  return `${processorKey(processor)}::${compareKey('generations', gen)}`;
}

function emptyRow(processor, generation = null) {
  const gen = generation != null ? resolveGeneration(processor, generation) : null;
  return {
    key: generation != null ? specKey(processor, generation) : processorKey(processor),
    processor: processor || '—',
    generation: gen,
    is_group: generation == null,
    ordered: 0,
    attached: 0,
    dispatch_qc_done: 0,
    challan_generated: 0,
    dispatched: 0,
    available: 0,
    qc_process: 0,
  };
}

function bumpRow(map, processor, generation, field, n = 1) {
  const key = specKey(processor, generation);
  if (!map.has(key)) map.set(key, emptyRow(processor, generation));
  map.get(key)[field] += n;
}

function sumFields(target, source) {
  for (const f of COUNT_FIELDS) target[f] += source[f] || 0;
}

function groupByProcessor(detailRows) {
  const map = new Map();
  for (const row of detailRows) {
    const pk = processorKey(row.processor);
    if (!map.has(pk)) {
      map.set(pk, { ...emptyRow(row.processor, null), generations: [] });
    }
    const group = map.get(pk);
    sumFields(group, row);
    group.generations.push(row);
  }

  return [...map.values()]
    .filter((g) => g.generations.length > 0)
    .map((g) => ({
      ...g,
      generations: g.generations.sort((a, b) => b.ordered - a.ordered || String(a.generation).localeCompare(String(b.generation))),
    }))
    .sort((a, b) => b.ordered - a.ordered || String(a.processor).localeCompare(String(b.processor)));
}

function detailRowsFromMap(map, orderConfigKeys) {
  return [...map.values()]
    .filter((r) => orderConfigKeys.has(r.key))
    .sort((a, b) => b.ordered - a.ordered || String(a.processor).localeCompare(String(b.processor)));
}

function isDeliveredDc(dcStatus) {
  return DC_TERMINAL_STATUSES.has(String(dcStatus || '').toLowerCase());
}

function isSerialDelivered(s) {
  if (isDeliveredDc(s.dc_status)) return true;
  if (s.delivered_at) return true;
  const inv = String(s.inventory_status || '').toLowerCase();
  return DEPLOYED_INVENTORY.has(inv) && s.alloc_status === 'dispatched';
}

function isDispatchQcPending(s) {
  return s.alloc_status === 'attached' && String(s.qc_status || 'pending').toLowerCase() !== 'passed';
}

function isDispatchQcDone(s) {
  return s.alloc_status === 'attached' && String(s.qc_status || '').toLowerCase() === 'passed';
}

function isChallanGenerated(s) {
  if (s.alloc_status !== 'dispatched' || !s.dc_number || isSerialDelivered(s)) return false;
  return DC_CHALLAN_STATUSES.has(String(s.dc_status || 'pending').toLowerCase());
}

function isDispatchedInTransit(s) {
  if (s.alloc_status !== 'dispatched' || !s.dc_number || isSerialDelivered(s)) return false;
  return DC_DISPATCHED_STATUSES.has(String(s.dc_status || '').toLowerCase());
}

function scopeSql(scope, alias = 'sol') {
  const sql = salesOrderScopeWhere(scope, alias);
  return sql ? ` AND ${sql}` : '';
}

const CRM_DATE_FILTER = `AND sol.created_at >= ($1::date AT TIME ZONE 'Asia/Kolkata')`;

async function fetchSoLines(scope) {
  const res = await pool.query(
    `SELECT sol.id AS line_id, sol.sales_order_number, sol.processor, sol.generation,
            sol.brand, sol.model_name, sol.ram, sol.storage, sol.gpu, sol.screen_size,
            COALESCE(sol.main_qty, sol.quantity, 1)::int AS line_qty, sol.created_at
       FROM sales_order_lines sol
      WHERE LOWER(COALESCE(sol.status, '')) <> 'cancelled'
        ${CRM_DATE_FILTER}
        ${scopeSql(scope, 'sol')}`,
    [CRM_START_DATE]
  );
  return res.rows.filter((l) => onOrAfterCrmStart(l.created_at));
}

async function fetchSoSerials(scope) {
  const res = await pool.query(
    `SELECT sos.allocation_id, sos.sales_order_number, sos.line_id, sos.serial_id,
            sos.ttspl_id, sos.serial_number, sos.status AS alloc_status, sos.qc_status,
            sos.dc_number, sos.created_at AS attached_at, sos.updated_at AS alloc_updated_at,
            sol.processor, sol.generation, sol.brand, sol.model_name, sol.ram, sol.storage,
            sol.gpu, sol.screen_size, sol.created_at AS so_line_created_at,
            dcl.status AS dc_status, dcl.dispatch_mode, dcl.ship_by, dcl.dispatched_at,
            dcl.delivered_at, dcl.created_at AS dc_created_at,
            dcl.delivery_person_id,
            u.name AS delivery_person_name,
            vsn.inventory_status
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
       LEFT JOIN delivery_challan_lines dcl ON dcl.dc_number = sos.dc_number
       LEFT JOIN users u ON u.user_id = dcl.delivery_person_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
      WHERE sos.status <> 'removed'
        ${CRM_DATE_FILTER}
        ${scopeSql(scope, 'sol')}`,
    [CRM_START_DATE]
  );
  return res.rows.filter((s) => onOrAfterCrmStart(s.so_line_created_at || s.attached_at));
}

async function fetchAvailableStock() {
  const res = await pool.query(
    `SELECT s.serial_id, s.inventory_asset_code, s.serial_number,
            COALESCE(NULLIF(TRIM(s.extra->>'processor'), ''), vpd.processor) AS processor,
            COALESCE(NULLIF(TRIM(s.extra->>'generation'), ''), vpd.generation) AS generation,
            COALESCE(NULLIF(TRIM(s.extra->>'ram'), ''), vpd.ram) AS ram,
            COALESCE(NULLIF(TRIM(s.extra->>'storage'), ''), vpd.storage) AS storage,
            COALESCE(NULLIF(TRIM(s.extra->>'gpu'), ''), vpd.gpu) AS gpu,
            COALESCE(NULLIF(TRIM(s.extra->>'screen_size'), ''), vpd.screen_size) AS screen_size,
            COALESCE(vpd.brand, s.extra->>'brand') AS brand,
            COALESCE(vpd.model, s.extra->>'model') AS model
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(s.extra->>'product_detail_id', '')::int
      WHERE s.deleted_at IS NULL
        AND s.po_id IS NOT NULL
        AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed'
        AND COALESCE(s.inventory_status, 'in_stock') NOT IN (
          'in_transit', 'rented', 'on_demo', 'sold', 'returned', 'scrapped'
        )`
  );
  return res.rows;
}

async function fetchQcProcessUnits() {
  const res = await pool.query(
    `SELECT s.serial_id, s.inventory_asset_code, s.serial_number,
            COALESCE(NULLIF(TRIM(s.extra->>'processor'), ''), vpd.processor) AS processor,
            COALESCE(NULLIF(TRIM(s.extra->>'generation'), ''), vpd.generation) AS generation,
            COALESCE(NULLIF(TRIM(s.extra->>'ram'), ''), vpd.ram) AS ram,
            COALESCE(NULLIF(TRIM(s.extra->>'storage'), ''), vpd.storage) AS storage,
            COALESCE(NULLIF(TRIM(s.extra->>'gpu'), ''), vpd.gpu) AS gpu,
            COALESCE(NULLIF(TRIM(s.extra->>'screen_size'), ''), vpd.screen_size) AS screen_size,
            COALESCE(vpd.brand, s.extra->>'brand') AS brand,
            COALESCE(vpd.model, s.extra->>'model') AS model,
            tk.ticket_id, st.stage_name AS ticket_stage
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(s.extra->>'product_detail_id', '')::int
       JOIN tickets tk ON tk.vendor_serial_id = s.serial_id
         AND tk.status IN ('in_progress', 'on_hold')
       JOIN stages st ON st.stage_id = tk.current_stage_id
         AND st.stage_name IN ('QC1', 'QC2')
      WHERE s.deleted_at IS NULL
        AND s.po_id IS NOT NULL`
  );
  return res.rows;
}

function classifyLineSerials(lineSerials, range) {
  let delivered = 0;
  let attachedPending = 0;
  let dispatchQcDone = 0;
  let challan = 0;
  let dispatched = 0;

  for (const s of lineSerials) {
    if (isSerialDelivered(s)) {
      delivered += 1;
      continue;
    }
    if (isDispatchQcPending(s)) {
      if (range.live || inDateRange(s.attached_at, range)) attachedPending += 1;
    } else if (isDispatchQcDone(s)) {
      if (range.live || inDateRange(s.alloc_updated_at, range)) dispatchQcDone += 1;
    } else if (isChallanGenerated(s)) {
      if (range.live || inDateRange(s.dc_created_at, range)) challan += 1;
    } else if (isDispatchedInTransit(s)) {
      if (range.live || inDateRange(s.dispatched_at || s.dc_created_at, range)) dispatched += 1;
    }
  }

  return { delivered, attachedPending, dispatchQcDone, challan, dispatched };
}

function buildScopeTable(lines, serials, stock, qcUnits, range) {
  const map = new Map();
  const orderConfigKeys = new Set();
  const serialsByLine = serials.reduce((acc, s) => {
    const lid = Number(s.line_id);
    if (!acc[lid]) acc[lid] = [];
    acc[lid].push(s);
    return acc;
  }, {});

  for (const line of lines) {
    const lineSerials = serialsByLine[line.line_id] || [];
    const counts = classifyLineSerials(lineSerials, range);
    const activeSerials = lineSerials.filter((s) => !isSerialDelivered(s)).length;
    const pending = Math.max(0, Number(line.line_qty || 0) - counts.delivered - activeSerials);
    const showOrdered = pending > 0 && (range.live || inDateRange(line.created_at, range));

    const hasPipeline = showOrdered || counts.attachedPending || counts.dispatchQcDone
      || counts.challan || counts.dispatched;
    if (!hasPipeline) continue;

    const cfgKey = specKey(line.processor, line.generation);
    orderConfigKeys.add(cfgKey);

    if (showOrdered) {
      bumpRow(map, line.processor, line.generation, 'ordered', pending);
    }
    if (counts.attachedPending) bumpRow(map, line.processor, line.generation, 'attached', counts.attachedPending);
    if (counts.dispatchQcDone) bumpRow(map, line.processor, line.generation, 'dispatch_qc_done', counts.dispatchQcDone);
    if (counts.challan) bumpRow(map, line.processor, line.generation, 'challan_generated', counts.challan);
    if (counts.dispatched) bumpRow(map, line.processor, line.generation, 'dispatched', counts.dispatched);
  }

  for (const row of stock) {
    const key = specKey(row.processor, row.generation);
    if (!orderConfigKeys.has(key)) continue;
    bumpRow(map, row.processor, row.generation, 'available', 1);
  }
  for (const row of qcUnits) {
    const key = specKey(row.processor, row.generation);
    if (!orderConfigKeys.has(key)) continue;
    bumpRow(map, row.processor, row.generation, 'qc_process', 1);
  }

  const detailRows = detailRowsFromMap(map, orderConfigKeys);
  return {
    detail_rows: detailRows,
    processors: groupByProcessor(detailRows),
  };
}

function buildSummary(lines, serials, range) {
  if (range.live) {
    const serialsByLine = serials.reduce((acc, s) => {
      const lid = Number(s.line_id);
      if (!acc[lid]) acc[lid] = [];
      acc[lid].push(s);
      return acc;
    }, {});

    let ordered = 0;
    for (const line of lines) {
      const lineSerials = serialsByLine[line.line_id] || [];
      const delivered = lineSerials.filter((s) => isSerialDelivered(s)).length;
      const active = lineSerials.filter((s) => !isSerialDelivered(s)).length;
      ordered += Math.max(0, Number(line.line_qty || 0) - delivered);
    }

    return {
      ordered,
      attached: serials.filter((s) => isDispatchQcPending(s)).length,
      dispatch_qc: serials.filter((s) => isDispatchQcDone(s)).length,
      challan_generated: serials.filter((s) => isChallanGenerated(s)).length,
      in_transit: serials.filter((s) => isDispatchedInTransit(s)).length,
      delivered: serials.filter((s) => isSerialDelivered(s)).length,
    };
  }

  let ordered = 0;
  let attached = 0;
  let dispatchQc = 0;
  let challanGenerated = 0;
  let inTransit = 0;
  let delivered = 0;

  for (const line of lines) {
    if (inDateRange(line.created_at, range)) {
      ordered += Number(line.line_qty || 0);
    }
  }

  for (const s of serials) {
    if (isDispatchQcPending(s) && inDateRange(s.attached_at, range)) attached += 1;
    if (isDispatchQcDone(s) && inDateRange(s.alloc_updated_at, range)) dispatchQc += 1;
    if (isChallanGenerated(s) && inDateRange(s.dc_created_at, range)) challanGenerated += 1;
    if (isDispatchedInTransit(s) && inDateRange(s.dispatched_at || s.dc_created_at, range)) inTransit += 1;
    if (isSerialDelivered(s) && inDateRange(s.delivered_at || s.dc_created_at, range)) delivered += 1;
  }

  return {
    ordered,
    attached,
    dispatch_qc: dispatchQc,
    challan_generated: challanGenerated,
    in_transit: inTransit,
    delivered,
  };
}

async function buildScopeReport(scope, range) {
  const [lines, serials, stock, qcUnits] = await Promise.all([
    fetchSoLines(scope),
    fetchSoSerials(scope),
    fetchAvailableStock(),
    fetchQcProcessUnits(),
  ]);

  const table = buildScopeTable(lines, serials, stock, qcUnits, range);

  return {
    summary: buildSummary(lines, serials, range),
    processors: table.processors,
    rows: table.detail_rows,
  };
}

async function getSalesOrderReport(query = {}) {
  const range = parseDateRange(query);
  const [rental, sale] = await Promise.all([
    buildScopeReport('rental', range),
    buildScopeReport('sale', range),
  ]);

  return {
    preset: range.preset,
    from: effectiveFrom(range),
    to: range.to,
    crm_start_date: CRM_START_DATE,
    generated_at: new Date().toISOString(),
    summary: {
      rental: rental.summary,
      sale: sale.summary,
      combined: {
        ordered: rental.summary.ordered + sale.summary.ordered,
        attached: rental.summary.attached + sale.summary.attached,
        dispatch_qc: rental.summary.dispatch_qc + sale.summary.dispatch_qc,
        challan_generated: rental.summary.challan_generated + sale.summary.challan_generated,
        in_transit: rental.summary.in_transit + sale.summary.in_transit,
        delivered: rental.summary.delivered + sale.summary.delivered,
      },
    },
    rental: { processors: rental.processors, rows: rental.rows },
    sale: { processors: sale.processors, rows: sale.rows },
  };
}

function matchesProcessor(row, processor) {
  return processorKey(row.processor) === processorKey(processor);
}

function matchesSpec(row, processor, generation) {
  if (!matchesProcessor(row, processor)) return false;
  if (!generation || generation === '*' || generation === 'all') return true;
  return specKey(row.processor, row.generation) === specKey(processor, generation);
}

async function getSalesOrderReportDrilldown(query = {}) {
  const scope = query.scope === 'sale' ? 'sale' : 'rental';
  const bucket = String(query.bucket || 'ordered').toLowerCase();
  const processor = query.processor || '';
  const generation = query.generation || '';
  const range = parseDateRange(query);

  const [lines, serials, stock, qcUnits] = await Promise.all([
    fetchSoLines(scope),
    fetchSoSerials(scope),
    fetchAvailableStock(),
    fetchQcProcessUnits(),
  ]);

  const items = [];

  if (bucket === 'ordered') {
    const serialsByLine = serials.reduce((acc, s) => {
      const lid = Number(s.line_id);
      if (!acc[lid]) acc[lid] = [];
      acc[lid].push(s);
      return acc;
    }, {});

    for (const line of lines) {
      if (!matchesSpec(line, processor, generation)) continue;
      const lineSerials = serialsByLine[line.line_id] || [];
      const delivered = lineSerials.filter((s) => isSerialDelivered(s)).length;
      const active = lineSerials.filter((s) => !isSerialDelivered(s)).length;
      const pending = Math.max(0, Number(line.line_qty || 0) - delivered - active);
      if (pending <= 0) continue;
      if (!range.live && !inDateRange(line.created_at, range)) continue;
      items.push({
        sales_order_number: line.sales_order_number,
        sales_order_date: line.created_at,
        brand: line.brand,
        model_name: line.model_name,
        processor: line.processor,
        generation: resolveGeneration(line.processor, line.generation),
        ram: line.ram,
        storage: line.storage,
        gpu: line.gpu,
        screen_size: line.screen_size,
        quantity: pending,
        link_type: 'sales_order',
      });
    }
  } else if (bucket === 'attached') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (!isDispatchQcPending(s)) continue;
      if (!range.live && !inDateRange(s.attached_at, range)) continue;
      items.push({
        sales_order_number: s.sales_order_number,
        sales_order_date: s.so_line_created_at,
        allocation_id: s.allocation_id,
        ttspl_id: s.ttspl_id,
        serial_number: s.serial_number,
        brand: s.brand,
        model_name: s.model_name,
        processor: s.processor,
        generation: resolveGeneration(s.processor, s.generation),
        ram: s.ram,
        storage: s.storage,
        gpu: s.gpu,
        screen_size: s.screen_size,
        qc_status: s.qc_status,
        attached_at: s.attached_at,
        link_type: 'sales_order',
      });
    }
  } else if (bucket === 'dispatch_qc' || bucket === 'dispatch_qc_done') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (!isDispatchQcDone(s)) continue;
      if (!range.live && !inDateRange(s.alloc_updated_at, range)) continue;
      items.push({
        sales_order_number: s.sales_order_number,
        sales_order_date: s.so_line_created_at,
        allocation_id: s.allocation_id,
        ttspl_id: s.ttspl_id,
        serial_number: s.serial_number,
        brand: s.brand,
        model_name: s.model_name,
        processor: s.processor,
        generation: resolveGeneration(s.processor, s.generation),
        ram: s.ram,
        storage: s.storage,
        gpu: s.gpu,
        screen_size: s.screen_size,
        qc_status: s.qc_status,
        qc_passed_at: s.alloc_updated_at,
        link_type: 'sales_order',
      });
    }
  } else if (bucket === 'challan' || bucket === 'challan_generated') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (!isChallanGenerated(s)) continue;
      if (!range.live && !inDateRange(s.dc_created_at, range)) continue;
      items.push({
        dc_number: s.dc_number,
        sales_order_number: s.sales_order_number,
        sales_order_date: s.so_line_created_at,
        ttspl_id: s.ttspl_id,
        serial_number: s.serial_number,
        brand: s.brand,
        model_name: s.model_name,
        processor: s.processor,
        generation: resolveGeneration(s.processor, s.generation),
        ram: s.ram,
        storage: s.storage,
        gpu: s.gpu,
        screen_size: s.screen_size,
        dispatch_mode: s.dispatch_mode,
        ship_by: s.ship_by,
        delivery_person_name: s.delivery_person_name,
        dc_status: s.dc_status,
        dc_created_at: s.dc_created_at,
        link_type: 'delivery_challan',
      });
    }
  } else if (bucket === 'dispatched') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (!isDispatchedInTransit(s)) continue;
      if (!range.live && !inDateRange(s.dispatched_at || s.dc_created_at, range)) continue;
      items.push({
        dc_number: s.dc_number,
        sales_order_number: s.sales_order_number,
        sales_order_date: s.so_line_created_at,
        ttspl_id: s.ttspl_id,
        serial_number: s.serial_number,
        brand: s.brand,
        model_name: s.model_name,
        processor: s.processor,
        generation: resolveGeneration(s.processor, s.generation),
        ram: s.ram,
        storage: s.storage,
        gpu: s.gpu,
        screen_size: s.screen_size,
        dispatch_mode: s.dispatch_mode,
        ship_by: s.ship_by,
        delivery_person_name: s.delivery_person_name,
        dispatched_at: s.dispatched_at,
        dc_status: s.dc_status,
        link_type: 'delivery_register',
      });
    }
  } else if (bucket === 'available') {
    for (const row of stock) {
      if (!matchesSpec(row, processor, generation)) continue;
      items.push({
        serial_id: row.serial_id,
        ttspl_id: row.inventory_asset_code,
        serial_number: row.serial_number,
        brand: row.brand,
        model: row.model,
        processor: row.processor,
        generation: resolveGeneration(row.processor, row.generation),
        ram: row.ram,
        storage: row.storage,
        gpu: row.gpu,
        screen_size: row.screen_size,
        link_type: 'inventory',
      });
    }
  } else if (bucket === 'qc' || bucket === 'qc_process') {
    for (const row of qcUnits) {
      if (!matchesSpec(row, processor, generation)) continue;
      items.push({
        serial_id: row.serial_id,
        ticket_id: row.ticket_id,
        ttspl_id: row.inventory_asset_code,
        serial_number: row.serial_number,
        brand: row.brand,
        model: row.model,
        processor: row.processor,
        generation: resolveGeneration(row.processor, row.generation),
        ram: row.ram,
        storage: row.storage,
        gpu: row.gpu,
        screen_size: row.screen_size,
        ticket_stage: row.ticket_stage,
        link_type: 'floor_ticket',
      });
    }
  }

  return {
    scope,
    bucket,
    processor,
    generation: generation && generation !== 'all' ? resolveGeneration(processor, generation) : 'All',
    count: items.length,
    items,
  };
}

module.exports = {
  CRM_START_DATE,
  getSalesOrderReport,
  getSalesOrderReportDrilldown,
  parseDateRange,
  specKey,
  processorKey,
};
