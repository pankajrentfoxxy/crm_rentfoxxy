/**
 * Sales Order Operations Report — live pipeline by processor + generation.
 * Rental and Sale scopes; date filters apply per-step timestamps for KPIs / table.
 */
const pool = require('../config/db');
const { compareKey } = require('../utils/assetConfigNormalize');
const { appleChipGeneration } = require('../utils/soInventorySpecMatch');
const { salesOrderScopeWhere } = require('./salesManagementService');

const DC_NOT_DELIVERED_STATUSES = new Set(['delivered', 'rejected', 'cancelled']);
const DC_CHALLAN_STATUSES = new Set(['pending', 'processing']);
const DC_TRANSIT_STATUSES = new Set(['pending', 'processing', 'in_transit', 'shipped', 'reached']);

function isChallanOnlyStatus(dcStatus) {
  return DC_CHALLAN_STATUSES.has(String(dcStatus || 'pending').toLowerCase());
}

function isInTransitStatus(dcStatus) {
  return DC_TRANSIT_STATUSES.has(String(dcStatus || 'pending').toLowerCase());
}

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
  if (preset === 'all') return { preset, from: null, to: null };
  const today = istDateString();
  if (preset === 'today') return { preset, from: today, to: today };
  if (preset === 'yesterday') {
    const y = addDays(today, -1);
    return { preset, from: y, to: y };
  }
  if (preset === 'last7') return { preset, from: addDays(today, -6), to: today };
  const from = query.from || query.date_from || null;
  const to = query.to || query.date_to || today;
  if (from) return { preset: 'custom', from, to };
  return { preset: 'all', from: null, to: null };
}

function inDateRange(ts, range) {
  if (!range.from || !ts) return !range.from;
  const day = istDateString(new Date(ts));
  return day >= range.from && day <= range.to;
}

function resolveGeneration(processor, generation) {
  return generation || appleChipGeneration(processor) || '—';
}

function specKey(processor, generation) {
  const gen = resolveGeneration(processor, generation);
  return `${compareKey('processors', processor || '—')}::${compareKey('generations', gen)}`;
}

function emptyRow(processor, generation) {
  const gen = resolveGeneration(processor, generation);
  return {
    key: specKey(processor, generation),
    processor: processor || '—',
    generation: gen,
    ordered: 0,
    attached: 0,
    challan_generated: 0,
    available: 0,
    qc_process: 0,
    dispatched: 0,
  };
}

function bumpRow(map, processor, generation, field, n = 1) {
  const key = specKey(processor, generation);
  if (!map.has(key)) map.set(key, emptyRow(processor, generation));
  map.get(key)[field] += n;
}

function rowsFromMap(map) {
  return [...map.values()]
    .filter((r) => r.ordered + r.attached + r.challan_generated + r.available + r.qc_process + r.dispatched > 0)
    .sort((a, b) => {
      const o = b.ordered - a.ordered;
      if (o) return o;
      return String(a.processor).localeCompare(String(b.processor));
    });
}

function isDeliveredDc(dcStatus) {
  return DC_NOT_DELIVERED_STATUSES.has(String(dcStatus || '').toLowerCase());
}

function scopeSql(scope, alias = 'sol') {
  const sql = salesOrderScopeWhere(scope, alias);
  return sql ? ` AND ${sql}` : '';
}

async function fetchSoLines(scope) {
  const res = await pool.query(
    `SELECT sol.id AS line_id, sol.sales_order_number, sol.processor, sol.generation,
            sol.brand, sol.model_name, sol.ram, sol.storage, sol.gpu, sol.screen_size,
            COALESCE(sol.main_qty, sol.quantity, 1)::int AS line_qty, sol.created_at
       FROM sales_order_lines sol
      WHERE LOWER(COALESCE(sol.status, '')) <> 'cancelled'
        ${scopeSql(scope, 'sol')}`
  );
  return res.rows;
}

async function fetchSoSerials(scope) {
  const res = await pool.query(
    `SELECT sos.allocation_id, sos.sales_order_number, sos.line_id, sos.serial_id,
            sos.ttspl_id, sos.serial_number, sos.status AS alloc_status, sos.qc_status,
            sos.dc_number, sos.created_at AS attached_at, sos.updated_at AS alloc_updated_at,
            sol.processor, sol.generation, sol.brand, sol.model_name, sol.ram, sol.storage,
            sol.gpu, sol.screen_size,
            dcl.status AS dc_status, dcl.dispatch_mode, dcl.ship_by, dcl.dispatched_at,
            dcl.delivered_at, dcl.created_at AS dc_created_at,
            dcl.delivery_person_id,
            u.name AS delivery_person_name
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
       LEFT JOIN delivery_challan_lines dcl ON dcl.dc_number = sos.dc_number
       LEFT JOIN users u ON u.user_id = dcl.delivery_person_id
      WHERE sos.status <> 'removed'
        ${scopeSql(scope, 'sol')}`
  );
  return res.rows;
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

function buildScopeTable(lines, serials, stock, qcUnits, range) {
  const map = new Map();
  const live = !range.from;

  const serialsByLine = serials.reduce((acc, s) => {
    const lid = Number(s.line_id);
    if (!acc[lid]) acc[lid] = [];
    acc[lid].push(s);
    return acc;
  }, {});

  for (const line of lines) {
    const lineSerials = serialsByLine[line.line_id] || [];
    let delivered = 0;
    let attached = 0;
    let dispatched = 0;
    let challan = 0;

    for (const s of lineSerials) {
      if (isDeliveredDc(s.dc_status)) {
        delivered += 1;
        continue;
      }
      if (s.alloc_status === 'attached') {
        if (!live && !inDateRange(s.attached_at, range)) continue;
        attached += 1;
      } else if (s.alloc_status === 'dispatched' && s.dc_number) {
        const challanOnly = isChallanOnlyStatus(s.dc_status);
        const inTransit = isInTransitStatus(s.dc_status);
        if (!live) {
          if (inTransit && inDateRange(s.dispatched_at || s.dc_created_at, range)) dispatched += 1;
          else if (challanOnly && inDateRange(s.dc_created_at, range)) challan += 1;
        } else if (isChallanOnlyStatus(s.dc_status)) {
          challan += 1;
        } else {
          dispatched += 1;
        }
      }
    }

    const pending = Math.max(0, Number(line.line_qty || 0) - delivered - attached - dispatched - challan);
    if (pending > 0) {
      if (live || inDateRange(line.created_at, range)) {
        bumpRow(map, line.processor, line.generation, 'ordered', pending);
      }
    }
    if (attached) bumpRow(map, line.processor, line.generation, 'attached', attached);
    if (challan) bumpRow(map, line.processor, line.generation, 'challan_generated', challan);
    if (dispatched) bumpRow(map, line.processor, line.generation, 'dispatched', dispatched);
  }

  for (const row of stock) {
    bumpRow(map, row.processor, row.generation, 'available', 1);
  }
  for (const row of qcUnits) {
    bumpRow(map, row.processor, row.generation, 'qc_process', 1);
  }

  return rowsFromMap(map);
}

function buildSummary(lines, serials, range) {
  const live = !range.from;

  if (live) {
    const serialsByLine = serials.reduce((acc, s) => {
      const lid = Number(s.line_id);
      if (!acc[lid]) acc[lid] = [];
      acc[lid].push(s);
      return acc;
    }, {});

    let ordered = 0;
    for (const line of lines) {
      const lineSerials = serialsByLine[line.line_id] || [];
      const delivered = lineSerials.filter((s) => isDeliveredDc(s.dc_status)).length;
      ordered += Math.max(0, Number(line.line_qty || 0) - delivered);
    }

    return {
      ordered,
      attached: serials.filter((s) => s.alloc_status === 'attached' && !isDeliveredDc(s.dc_status)).length,
      dispatch_qc: serials.filter((s) => s.qc_status === 'passed' && s.alloc_status === 'attached').length,
      challan_generated: serials.filter((s) => s.dc_number && !isDeliveredDc(s.dc_status)).length,
      in_transit: serials.filter((s) => s.alloc_status === 'dispatched' && s.dc_number && !isDeliveredDc(s.dc_status)).length,
      delivered: serials.filter((s) => isDeliveredDc(s.dc_status)).length,
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
    if (s.alloc_status === 'attached' && inDateRange(s.attached_at, range)) attached += 1;
    if (s.qc_status === 'passed' && inDateRange(s.alloc_updated_at, range)) dispatchQc += 1;
    if (s.dc_number && inDateRange(s.dc_created_at, range)) challanGenerated += 1;
    if (s.alloc_status === 'dispatched' && s.dc_number
      && inDateRange(s.dispatched_at || s.dc_created_at, range)) {
      inTransit += 1;
    }
    if (isDeliveredDc(s.dc_status) && inDateRange(s.delivered_at, range)) delivered += 1;
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

  return {
    summary: buildSummary(lines, serials, range),
    rows: buildScopeTable(lines, serials, stock, qcUnits, range),
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
    from: range.from,
    to: range.to,
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
    rental: { rows: rental.rows },
    sale: { rows: sale.rows },
  };
}

function matchesSpec(row, processor, generation) {
  return specKey(row.processor, row.generation) === specKey(processor, generation);
}

async function getSalesOrderReportDrilldown(query = {}) {
  const scope = query.scope === 'sale' ? 'sale' : 'rental';
  const bucket = String(query.bucket || 'ordered').toLowerCase();
  const processor = query.processor || '';
  const generation = query.generation || '';
  const range = parseDateRange(query);
  const live = !range.from;

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
      let delivered = 0;
      let active = 0;
      for (const s of lineSerials) {
        if (isDeliveredDc(s.dc_status)) delivered += 1;
        else active += 1;
      }
      const pending = Math.max(0, Number(line.line_qty || 0) - delivered - active);
      if (pending <= 0) continue;
      if (!live && !inDateRange(line.created_at, range)) continue;
      items.push({
        sales_order_number: line.sales_order_number,
        brand: line.brand,
        model_name: line.model_name,
        processor: line.processor,
        generation: resolveGeneration(line.processor, line.generation),
        ram: line.ram,
        storage: line.storage,
        gpu: line.gpu,
        screen_size: line.screen_size,
        quantity: pending,
        created_at: line.created_at,
        link_type: 'sales_order',
      });
    }
  } else if (bucket === 'attached') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (s.alloc_status !== 'attached' || isDeliveredDc(s.dc_status)) continue;
      if (!live && !inDateRange(s.attached_at, range)) continue;
      items.push({
        sales_order_number: s.sales_order_number,
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
  } else if (bucket === 'challan' || bucket === 'challan_generated') {
    for (const s of serials) {
      if (!matchesSpec(s, processor, generation)) continue;
      if (!s.dc_number || isDeliveredDc(s.dc_status)) continue;
      const challanOnly = ['pending', 'processing'].includes(String(s.dc_status || 'pending'));
      if (!challanOnly && bucket === 'challan_generated') continue;
      if (!live && !inDateRange(s.dc_created_at, range)) continue;
      items.push({
        dc_number: s.dc_number,
        sales_order_number: s.sales_order_number,
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
      if (s.alloc_status !== 'dispatched' || !s.dc_number || isDeliveredDc(s.dc_status)) continue;
      if (!live && !inDateRange(s.dispatched_at || s.dc_created_at, range)) continue;
      items.push({
        dc_number: s.dc_number,
        sales_order_number: s.sales_order_number,
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
    generation: resolveGeneration(processor, generation),
    count: items.length,
    items,
  };
}

module.exports = {
  getSalesOrderReport,
  getSalesOrderReportDrilldown,
  parseDateRange,
  specKey,
};
