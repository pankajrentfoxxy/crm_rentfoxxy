/**
 * Laptop lifecycle (Stock → Laptop Lifecycle): one laptop's whole life on one
 * page — what it is, where it came from, every recorded event, the major
 * milestones, each rental period and what it has earned against what it cost.
 *
 * Read-only. It writes nothing and changes no status.
 *
 * Sources (each normalised into one activity row shape, then merged):
 *   inventory_status_transitions  status changes written by the state machine
 *   ttspl_audit_log               the TTSPL audit trail (GRN, floor, parts,
 *                                 charger, gate, vendor repair, corrections)
 *   events                        the event spine — only rows NOT backfilled
 *                                 from the two logs above (those would repeat)
 *   production_ticket_history     floor tickets: who passed diagnosis / QC2 /
 *                                 dispatch QC and who received it into stock
 *   delivery_challan_lines        outbound DCs (attached / dispatched /
 *                                 delivered) and return DCs (pickup raised /
 *                                 back at the warehouse) — the only history
 *                                 the ERP-era laptops have
 *   support_tickets + items       complaints and pickups
 *   vendor_repair_dc_items        sent to a vendor for repair / back
 *   vendor_return_dc_items        returned to the vendor for good
 *   customer_invoice_lines        rent invoiced per month
 *   vendor_purchase_orders, vendor_goods_received_notes  purchase + GRN
 *
 * Money reuses laptopCostService (its own PO line, parts fitted at unit cost,
 * old parts credited back) and adds invoiced / received rent, credit notes,
 * sale value and vendor rent paid. Every figure says whether it is exact or
 * estimated.
 */
const pool = require('../config/db');
const { getLaptopCost, rentAccrued } = require('./laptopCostService');

const RENTAL_PO_TYPES = ['rental_purchase', 'rent_to_own'];
const WITH_CUSTOMER = ['rented', 'on_demo', 'sold'];
const DAY_MS = 86400000;
const IST_MS = 330 * 60000;

const fail = (message, status = 400) => Object.assign(new Error(message), { status, statusCode: status });
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const toMs = (v) => { if (!v) return null; const t = new Date(v).getTime(); return Number.isNaN(t) ? null : t; };
const iso = (v) => { const t = toMs(v); return t == null ? null : new Date(t).toISOString(); };
/** Calendar day in India for a timestamp ('YYYY-MM-DD'). Date-only strings pass through. */
function istDay(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = toMs(v);
  return t == null ? null : new Date(t + IST_MS).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const s = toMs(`${a}T00:00:00Z`);
  const e = toMs(`${b}T00:00:00Z`);
  if (s == null || e == null) return null;
  return Math.round((e - s) / DAY_MS);
}
const human = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ================================================================ labels */

const STATUS_LABEL = {
  in_stock: 'Into stock',
  reserved: 'Attached to sales order',
  dispatch_ready: 'Attached to challan',
  at_gate: 'At the gate',
  in_transit: 'Dispatched',
  rented: 'Delivered — rent starts',
  on_demo: 'Delivered on demo',
  sold: 'Sold',
  returned: 'Returned to warehouse',
  in_repair: 'In repair',
  qc_failed: 'QC failed',
  scrapped: 'Scrapped',
  returned_to_vendor: 'Returned to vendor',
};

/** Milestone key for a status a laptop moved INTO. */
const STATUS_MILESTONE = {
  in_stock: 'into_stock',
  reserved: 'so_attached',
  dispatch_ready: 'dc_attached',
  in_transit: 'dispatched',
  rented: 'delivered',
  on_demo: 'delivered',
  sold: 'sold',
  returned: 'warehouse_in',
  in_repair: 'in_repair',
  scrapped: 'scrapped',
  returned_to_vendor: 'returned_to_vendor',
};

const MILESTONE_LABEL = {
  purchased: 'Purchased',
  grn_received: 'Warehouse in (GRN)',
  diagnosis_passed: 'Diagnosis passed',
  qc2_passed: 'QC2 passed',
  into_stock: 'Into stock',
  carret_placed: 'Placed in carret',
  so_attached: 'Attached to sales order',
  dispatch_qc_passed: 'Dispatch QC passed',
  dispatch_qc_failed: 'Dispatch QC failed',
  dc_attached: 'Attached to challan',
  dispatched: 'Sent to customer',
  delivered: 'Delivered — rental starts',
  delivered_demo: 'Delivered on demo',
  sold: 'Sold',
  support_ticket: 'Support complaint',
  return_pickup: 'Return / repair pickup',
  warehouse_in: 'Warehouse in',
  in_repair: 'In repair',
  vendor_repair_out: 'Sent to vendor for repair',
  vendor_repair_in: 'Back from vendor repair',
  returned_to_vendor: 'Returned to vendor',
  scrapped: 'Scrapped',
};

const AUDIT_LABEL = {
  received: 'Received on GRN',
  ticket_created: 'Floor ticket created',
  stage_changed: 'Floor stage changed',
  qc2_passed: 'QC2 passed',
  qc1_failed: 'QC1 failed',
  qc2_failed: 'QC2 failed',
  inventory_ready: 'Ready to rent / sell',
  part_requested: 'Part requested',
  part_approved: 'Part approved',
  part_attached: 'Part fitted',
  part_detached: 'Part removed',
  part_removed: 'Part removed',
  parts_used: 'Parts used',
  diagnosis_failed: 'Diagnosis failed',
  dispatch_qc_failed: 'Dispatch QC failed',
  dispatch_charger_requested: 'Charger requested',
  dispatch_charger_handed_over: 'Charger handed over by warehouse',
  dispatch_charger_attached: 'Charger attached',
  dispatch_charger_qc_scanned: 'Charger scanned at dispatch QC',
  dispatch_charger_cancelled: 'Charger request cancelled',
  dispatch_charger_returned: 'Charger returned',
  dispatch_charger_return_scanned: 'Charger scanned on return',
  gate_outward: 'Left through the gate',
  gate_inward: 'Came in through the gate',
  warehouse_location_changed: 'Carret slot changed',
  inventory_tagged: 'Tagged rent / sell',
  item_description_updated: 'Configuration corrected',
  config_updated: 'Configuration updated',
  vendor_assigned: 'Vendor assigned for repair',
  vendor_dc_generated: 'Vendor repair challan made',
  dispatched_to_vendor: 'Sent to vendor',
  delivered_to_vendor: 'Delivered to vendor',
  returned_from_vendor: 'Back from vendor',
  vendor_replacement_received: 'Vendor replacement received',
  vendor_replaced: 'Replaced by vendor',
  vendor_return_dc_created: 'Vendor return challan made',
  vendor_return_dispatched: 'Returned to vendor',
  esign_completed: 'E-sign completed',
  support_return_pickup_in_transit: 'Return pickup in transit',
};

/** Audit events that are data corrections, not things that happened to the laptop. */
const MINOR_AUDIT = new Set([
  'customer_asset_updated', 'brand_model_erp_correction', 'item_description_updated', 'config_updated',
  'support_cancel_preserve', 'dates_corrected', 'ttspl_corrected', 'serial_corrected', 'serial_number_corrected',
  'lost_found_rental_restore', 'lost_found_entity_dispatch_fix', 'customer_deployment_backfill', 'delivery_backfill',
  'historical_so_dc_backfill', 'historical_deployment_backfill', 'deployment_restored', 'active_asset_restore',
  'asset_movement', 'status_override', 'delivery_date_corrected', 'config_corrected', 'asset_renamed',
  'asset_code_reassigned', 'customer_reassigned',
]);

const AUDIT_MILESTONE = {
  received: 'grn_received',
  qc2_passed: 'qc2_passed',
  inventory_ready: 'into_stock',
  warehouse_location_changed: 'carret_placed',
  gate_inward: 'warehouse_in',
  dispatch_qc_failed: 'dispatch_qc_failed',
  dispatched_to_vendor: 'vendor_repair_out',
  returned_from_vendor: 'vendor_repair_in',
  vendor_return_dispatched: 'returned_to_vendor',
};

/** Source preference when two rows describe the same thing (higher wins). */
const PRIORITY = { transition: 6, floor: 6, dc: 5, support: 5, vendor_repair: 5, vendor_return: 5, purchase: 5, audit: 4, invoice: 4, events: 2 };

/* =========================================================== normalisers */

/** Rows written by the transitionConcurrency unit test when it ran against a real DB. */
function isTestNoise(t) {
  const r = String(t?.reason || '').trim();
  return /^concurrency test/i.test(r) || (r === 'setup' && !t.actor_user_id && !t.dc_number);
}

function statusDedupe(to, dc) {
  if (dc) {
    if (to === 'dispatch_ready') return { key: `dc_attached:${dc}`, window: null };
    if (to === 'in_transit') return { key: `dispatched:${dc}`, window: null };
    if (['rented', 'on_demo', 'sold'].includes(to)) return { key: `delivered:${dc}`, window: null };
    if (to === 'returned') return { key: `returned:${dc}`, window: null };
  }
  return { key: `status:${to}`, window: 120000 };
}

function fromTransition(t) {
  const to = t.to_status;
  const dd = statusDedupe(to, t.dc_number);
  const reason = String(t.reason || '');
  const isArtefact = /^(canonicalisation|canonicalization|backfill|erp_)/i.test(reason);
  return {
    id: `ist:${t.transition_id}`,
    at: iso(t.created_at),
    by_id: t.actor_user_id || null,
    type: `status:${to}`,
    label: STATUS_LABEL[to] || human(to),
    ref: t.dc_number || null,
    ref_kind: t.dc_number ? (/^RDC/i.test(t.dc_number) ? 'rdc' : 'dc') : null,
    detail: [t.from_status ? `${human(t.from_status)} → ${human(to)}` : null, reason || null].filter(Boolean).join(' · ') || null,
    source: 'transition',
    minor: isArtefact,
    // A data clean-up (canonicalisation, ERP resolution) is not when it happened.
    milestone: isArtefact ? null : (STATUS_MILESTONE[to] === 'delivered' && to === 'on_demo' ? 'delivered_demo' : STATUS_MILESTONE[to] || null),
    customer_id: t.customer_id || null,
    dedupe: dd.key,
    window: dd.window,
  };
}

function auditRef(m, desc) {
  if (m?.dc_number) return { ref: m.dc_number, ref_kind: /^RDC/i.test(m.dc_number) ? 'rdc' : 'dc' };
  if (m?.po) return { ref: m.po, ref_kind: 'po' };
  if (m?.request_number) return { ref: m.request_number, ref_kind: 'charger' };
  if (m?.ticket_id) return { ref: `Ticket #${m.ticket_id}`, ref_kind: 'floor_ticket', ref_id: m.ticket_id };
  if (m?.prt_id) return { ref: m.prt_id, ref_kind: 'part' };
  const dc = String(desc || '').match(/\b(R?DC[/-][\w/-]+|RDC\d+)\b/);
  if (dc) return { ref: dc[1], ref_kind: /^RDC/i.test(dc[1]) ? 'rdc' : 'dc' };
  return { ref: null, ref_kind: null };
}

function fromAudit(a) {
  const m = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const type = String(a.event_type || '');
  if (type.startsWith('status_')) {
    const to = m.to || type.slice(7);
    const dd = statusDedupe(to, m.dc_number);
    return {
      id: `log:${a.log_id}`,
      at: iso(a.created_at),
      by_id: a.actor_user_id || null,
      by_name: a.actor_name || null,
      type: `status:${to}`,
      label: STATUS_LABEL[to] || human(to),
      ref: m.dc_number || null,
      ref_kind: m.dc_number ? 'dc' : null,
      detail: a.description || null,
      source: 'audit',
      minor: false,
      milestone: to === 'on_demo' ? 'delivered_demo' : STATUS_MILESTONE[to] || null,
      dedupe: dd.key,
      window: dd.window,
    };
  }
  const r = auditRef(m, a.description);
  return {
    id: `log:${a.log_id}`,
    at: iso(a.created_at),
    by_id: a.actor_user_id || null,
    by_name: a.actor_name || null,
    type,
    label: AUDIT_LABEL[type] || human(type),
    ref: r.ref,
    ref_kind: r.ref_kind,
    ref_id: r.ref_id || null,
    detail: a.description || null,
    source: 'audit',
    minor: MINOR_AUDIT.has(type),
    milestone: AUDIT_MILESTONE[type] || null,
    dedupe: type === 'received' ? 'grn_received' : null,
    window: type === 'received' ? null : undefined,
  };
}

/** Event-spine rows that are not backfills of the two logs read directly. */
function fromEvent(e) {
  if (String(e.source || '').startsWith('backfill:')) return null;
  const p = e.payload && typeof e.payload === 'object' ? e.payload : {};
  const type = String(e.event_type || '');
  if ((type === 'status_changed' || type === 'delivered') && (e.to_state || type === 'delivered')) {
    const to = e.to_state || 'rented';
    const dc = p.dc_number || (type === 'delivered' ? e.entity_ref : null);
    const dd = statusDedupe(to, dc);
    return {
      id: `ev:${e.event_id}`,
      at: iso(e.occurred_at),
      by_id: e.actor_id || null,
      by_name: e.actor_name && !['unknown', 'system'].includes(e.actor_name) ? e.actor_name : null,
      type: `status:${to}`,
      label: STATUS_LABEL[to] || human(to),
      ref: dc || null,
      ref_kind: dc ? 'dc' : null,
      detail: p.reason || null,
      source: 'events',
      minor: false,
      milestone: to === 'on_demo' ? 'delivered_demo' : STATUS_MILESTONE[to] || null,
      dedupe: dd.key,
      window: dd.window,
    };
  }
  return {
    id: `ev:${e.event_id}`,
    at: iso(e.occurred_at),
    by_id: e.actor_id || null,
    by_name: e.actor_name && !['unknown', 'system'].includes(e.actor_name) ? e.actor_name : null,
    type,
    label: human(type),
    ref: e.entity_ref && !/^TTSPL/i.test(e.entity_ref) ? e.entity_ref : null,
    ref_kind: null,
    detail: p.reason || p.description || (e.from_state || e.to_state ? `${e.from_state || '—'} → ${e.to_state || '—'}` : null),
    source: 'events',
    minor: ['status_canonicalised', 'status_corrected', 'inventory_status_backfilled', 'ticket_stage_changed'].includes(type),
    milestone: null,
    dedupe: null,
  };
}

const DISPATCH_TICKET_TYPES = new Set(['sales_order_qc', 'dispatch_qc', 'pre_dispatch_qc']);

/** Which milestone a floor-ticket history row is, if any. Pure. */
function classifyFloor(h) {
  const action = String(h.action || '');
  const src = String(h.source || '');
  const prev = String(h.previous_stage || '');
  const cur = String(h.current_stage || '');
  const dispatchTicket = DISPATCH_TICKET_TYPES.has(String(h.ticket_type || '')) || prev === 'Dispatch QC';
  if (/dispatch qc failed/i.test(action)) return 'dispatch_qc_failed';
  if (/diagnosis failed/i.test(action)) return null;
  if (src === 'submitDiagnosis' && prev === 'Diagnosis' && !/fail/i.test(action)) return 'diagnosis_passed';
  if (/received into inventory/i.test(action)) return 'into_stock';
  if (dispatchTicket && /pass/i.test(action)) return 'dispatch_qc_passed';
  if (prev === 'QC2' && ['Pending Inventory', 'Inventory'].includes(cur) && !/fail/i.test(action)) return 'qc2_passed';
  return null;
}

function fromFloor(h) {
  const action = String(h.action || '');
  const mk = classifyFloor(h);
  return {
    id: `pth:${h.id}`,
    at: iso(h.created_at),
    by_id: h.performed_by || null,
    by_name: h.performed_by_name && !['System', 'GRN Receive', 'Sales Order QC'].includes(h.performed_by_name) ? h.performed_by_name : null,
    type: `floor:${h.source || 'stage'}`,
    label: mk ? MILESTONE_LABEL[mk] : action || 'Floor update',
    ref: `Ticket #${h.ticket_id}`,
    ref_kind: 'floor_ticket',
    ref_id: h.ticket_id,
    detail: [
      h.previous_stage && h.current_stage && h.previous_stage !== h.current_stage ? `${h.previous_stage} → ${h.current_stage}` : (h.current_stage || null),
      h.current_technician ? `technician ${h.current_technician}` : null,
      h.remarks && !/^(pass|Pass)$/.test(h.remarks) ? h.remarks : null,
      h.failure_reason || null,
    ].filter(Boolean).join(' · ') || null,
    source: 'floor',
    minor: /started$|technician assigned|technician unassigned/i.test(action),
    milestone: mk,
    dedupe: null,
  };
}

/** A DC line → up to four rows (attached, dispatched, delivered / rejected). `deal` = sales_order_lines.quotation_type. */
function fromDcLine(d, deal) {
  const rows = [];
  const dc = d.dc_number;
  const isReturn = d.movement_type === 'return' || /^RDC/i.test(dc || '');
  const cust = d.customer_name || null;
  if (String(d.status || '').toLowerCase() === 'cancelled') return rows;
  if (isReturn) {
    rows.push({
      id: `dc:${d.id}:raised`, at: iso(d.created_at), by_id: d.created_by || null, type: 'return_raised',
      label: 'Return pickup raised', ref: dc, ref_kind: 'rdc',
      detail: [cust, d.original_dc_number ? `against ${d.original_dc_number}` : null].filter(Boolean).join(' · ') || null,
      source: 'dc', milestone: 'return_pickup', customer_id: d.customer_id || null, dedupe: `return_raised:${dc}`, window: null,
    });
    const back = d.warehouse_received_at || (String(d.status).toLowerCase() === 'delivered' ? d.delivered_at : null);
    if (back) {
      rows.push({
        id: `dc:${d.id}:back`, at: iso(back), by_id: d.warehouse_received_by || d.delivered_by || null,
        by_name: d.warehouse_receiver_name || null, type: 'return_received',
        label: 'Back at the warehouse', ref: dc, ref_kind: 'rdc', detail: cust,
        source: 'dc', milestone: 'warehouse_in', customer_id: d.customer_id || null, dedupe: `returned:${dc}`, window: null,
      });
    }
    return rows;
  }
  rows.push({
    id: `dc:${d.id}:made`, at: iso(d.created_at), by_id: d.created_by || null, type: 'dc_created',
    label: 'Attached to challan', ref: dc, ref_kind: 'dc',
    detail: [cust, d.sales_order_number].filter(Boolean).join(' · ') || null,
    source: 'dc', milestone: 'dc_attached', customer_id: d.customer_id || null, dedupe: `dc_attached:${dc}`, window: null,
  });
  if (d.dispatched_at) {
    rows.push({
      id: `dc:${d.id}:out`, at: iso(d.dispatched_at), by_id: null, type: 'dc_dispatched',
      label: 'Sent to customer', ref: dc, ref_kind: 'dc',
      detail: [cust, d.courier_name || d.ship_by || null].filter(Boolean).join(' · ') || null,
      source: 'dc', milestone: 'dispatched', customer_id: d.customer_id || null, dedupe: `dispatched:${dc}`, window: null,
    });
  }
  const st = String(d.status || '').toLowerCase();
  if (st === 'rejected' && d.rejected_at) {
    rows.push({
      id: `dc:${d.id}:rej`, at: iso(d.rejected_at), by_id: d.rejected_by || null, type: 'dc_rejected',
      label: 'Rejected at delivery', ref: dc, ref_kind: 'dc', detail: d.rejection_reason || cust,
      source: 'dc', milestone: null, customer_id: d.customer_id || null, dedupe: null,
    });
  } else if (d.delivered_at && st === 'delivered') {
    const kind = deal === 'sale' ? 'sold' : deal === 'demo' ? 'delivered_demo' : 'delivered';
    rows.push({
      id: `dc:${d.id}:in`, at: iso(d.delivered_at), by_id: d.delivered_by || null, type: 'dc_delivered',
      label: kind === 'sold' ? 'Delivered — sold' : kind === 'delivered_demo' ? 'Delivered on demo' : 'Delivered — rent starts',
      ref: dc, ref_kind: 'dc', detail: cust,
      source: 'dc', milestone: kind, customer_id: d.customer_id || null, dedupe: `delivered:${dc}`, window: null,
    });
  }
  return rows;
}

function fromSupport(s) {
  const rows = [];
  const tid = s.ticket_id;
  const ref = `Ticket #${tid}`;
  const rdc = s.item_return_dc || s.return_dc_number || null;
  const pickup = /pickup|return/i.test(`${s.ticket_category || ''} ${s.complaint_type || ''}`);
  rows.push({
    id: `st:${s.item_id}:open`, at: iso(s.created_at), by_id: s.created_by || null, by_name: s.created_by_name || null,
    type: 'support_ticket', label: pickup ? 'Pickup requested' : 'Support complaint raised',
    ref, ref_kind: 'support_ticket', ref_id: tid,
    detail: [s.customer_name, human(s.ticket_category), s.complaint_type && s.complaint_type !== s.ticket_category ? human(s.complaint_type) : null, s.issue_category_label && !/^\[/.test(s.issue_category_label) ? s.issue_category_label : null, s.remarks].filter(Boolean).join(' · ') || null,
    source: 'support', milestone: pickup ? 'return_pickup' : 'support_ticket', customer_id: s.customer_id || null,
    dedupe: pickup && rdc ? `return_raised:${rdc}` : null, window: null,
    also: rdc ? [{ ref: rdc, ref_kind: 'rdc' }] : undefined,
  });
  if (s.picked_up_at) {
    rows.push({
      id: `st:${s.item_id}:picked`, at: iso(s.picked_up_at), by_id: s.pickup_assigned_to || null, type: 'support_picked_up',
      label: 'Picked up from customer', ref, ref_kind: 'support_ticket', ref_id: tid, detail: s.customer_name || null,
      source: 'support', milestone: null, dedupe: null,
    });
  }
  if (s.warehouse_received_at) {
    rows.push({
      id: `st:${s.item_id}:wh`, at: iso(s.warehouse_received_at), by_id: s.warehouse_received_by || null, type: 'support_warehouse_in',
      label: 'Back at the warehouse', ref, ref_kind: 'support_ticket', ref_id: tid, detail: s.customer_name || null,
      source: 'support', milestone: 'warehouse_in', dedupe: rdc ? `returned:${rdc}` : null, window: null,
      also: rdc ? [{ ref: rdc, ref_kind: 'rdc' }] : undefined,
    });
  }
  const closed = s.cancelled_at || s.closed_at;
  if (closed) {
    rows.push({
      id: `st:${s.item_id}:closed`, at: iso(closed), by_id: s.closed_by || null, type: 'support_closed',
      label: s.cancelled_at ? 'Support ticket cancelled' : 'Support ticket closed', ref, ref_kind: 'support_ticket', ref_id: tid,
      detail: s.outcome ? human(s.outcome) : null, source: 'support', milestone: null, minor: true, dedupe: null,
    });
  }
  return rows;
}

function fromVendorRepair(v) {
  const rows = [];
  const out = v.gate_outward_at || v.dispatched_at || v.created_at;
  rows.push({
    id: `vr:${v.id}:out`, at: iso(out), by_id: null, type: 'vendor_repair_out', label: 'Sent to vendor for repair',
    ref: v.dc_number, ref_kind: 'vrdc', detail: [v.vendor_name, v.issue_type, v.item_remarks].filter(Boolean).join(' · ') || null,
    source: 'vendor_repair', milestone: 'vendor_repair_out', dedupe: null,
  });
  const back = v.gate_inward_at || v.returned_at;
  if (back) {
    rows.push({
      id: `vr:${v.id}:in`, at: iso(back), by_id: null, by_name: v.receive_wh_signer_name || null, type: 'vendor_repair_in',
      label: v.replacement_ttspl_id ? `Vendor sent a replacement (${v.replacement_ttspl_id})` : 'Back from vendor repair',
      ref: v.receive_dc_number || v.dc_number, ref_kind: 'vrdc', detail: v.receive_laptop_condition ? human(v.receive_laptop_condition) : null,
      source: 'vendor_repair', milestone: 'vendor_repair_in', dedupe: null,
    });
  }
  return rows;
}

function fromVendorReturn(v) {
  return [{
    id: `vrt:${v.id}`, at: iso(v.created_at), by_id: null, type: 'vendor_return', label: 'Returned to vendor',
    ref: v.dc_number, ref_kind: 'vrtdc', detail: v.return_reason || null,
    source: 'vendor_return', milestone: 'returned_to_vendor', dedupe: null,
  }];
}

function fromInvoiceLine(l) {
  return {
    id: `inv:${l.line_id}`, at: iso(l.invoice_date || l.created_at), by_id: null, type: 'invoiced',
    label: `Rent invoiced${l.period_label ? ` for ${l.period_label}` : ''}`,
    ref: l.invoice_number, ref_kind: 'invoice', ref_id: l.invoice_id,
    detail: [`${l.days_billed || '?'} days at ${num(l.monthly_rate) ?? '?'}/month = ${round2(l.amount)}`, l.status ? human(l.status) : null].filter(Boolean).join(' · '),
    source: 'invoice', milestone: null, minor: false, amount: round2(l.amount), dedupe: null,
  };
}

/* ================================================================ merge */

/**
 * Merge rows from every source into one ascending list. Rows with the same
 * dedupe key (and, for time-bound keys, within the window) collapse into one:
 * the highest-priority source supplies the row, the earliest time wins (a
 * clean-up that re-stated a delivery months later is not when it happened),
 * and gaps — person, reference, detail, milestone — are filled from the rest.
 * Pure.
 */
function mergeActivity(rows) {
  const list = (rows || []).filter((r) => r && r.at).map((r) => ({ ...r, priority: r.priority ?? PRIORITY[r.source] ?? 1 }));
  list.sort((a, b) => toMs(a.at) - toMs(b.at) || b.priority - a.priority);
  const out = [];
  const open = new Map(); // dedupe key → merged rows carrying that key
  for (const r of list) {
    if (!r.dedupe) { out.push(r); continue; }
    const groups = open.get(r.dedupe) || [];
    const hit = groups.find((g) => (r.window == null && g.window == null) || (Math.abs(toMs(g.at) - toMs(r.at)) <= (r.window || g.window || 0)));
    if (!hit) {
      const fresh = { ...r, merged_from: [r.id] };
      groups.push(fresh);
      open.set(r.dedupe, groups);
      out.push(fresh);
      continue;
    }
    const keepNew = r.priority > hit.priority;
    const base = keepNew ? { ...r } : { ...hit };
    const other = keepNew ? hit : r;
    for (const k of ['by_id', 'by_name', 'detail', 'milestone', 'customer_id']) {
      if (base[k] == null || base[k] === '') base[k] = other[k] ?? base[k];
    }
    // A reference is (ref, kind, id) together — never mix one row's id into another's ref.
    if (!base.ref && other.ref) { base.ref = other.ref; base.ref_kind = other.ref_kind; base.ref_id = other.ref_id ?? null; }
    base.at = toMs(hit.at) <= toMs(r.at) ? hit.at : r.at;
    base.merged_from = [...(hit.merged_from || [hit.id]), r.id];
    const also = [...(hit.also || []), ...(r.also || [])];
    if (other.ref && other.ref !== base.ref) also.push({ ref: other.ref, ref_kind: other.ref_kind, ref_id: other.ref_id || null });
    const seen = new Set([base.ref]);
    base.also = also.filter((x) => x && x.ref && !seen.has(x.ref) && seen.add(x.ref));
    if (!base.also.length) delete base.also;
    base.minor = Boolean(hit.minor && r.minor);
    Object.assign(hit, base);
  }
  out.sort((a, b) => toMs(a.at) - toMs(b.at));
  return out.map((r) => {
    const { priority, window, dedupe, ...rest } = r;
    return rest;
  });
}

/**
 * Milestones from the merged activity: every row that carries a milestone
 * key, with repeats of one key inside `windowMs` collapsed to the best-sourced
 * row (QC2 passed is recorded by the floor at 10:33 and again by the audit
 * log at 11:42 when the laptop is received — one milestone, the floor's).
 * Pure; returns rows with `activity_index` pointing into `activity`.
 */
function deriveMilestones(activity, { windowMs = 12 * 3600000 } = {}) {
  const out = [];
  const lastByKey = new Map();
  (activity || []).forEach((a, idx) => {
    if (!a.milestone) return;
    const key = a.milestone;
    const prev = lastByKey.get(key);
    const p = PRIORITY[a.source] ?? 1;
    if (prev && toMs(a.at) - toMs(prev.at) <= windowMs) {
      // Same milestone again within the window: keep the better source, fill the person.
      if (p > (PRIORITY[prev.source] ?? 1)) {
        const keepBy = prev.by || null;
        Object.assign(prev, toMilestone(a, idx));
        if (!prev.by) prev.by = keepBy;
      } else if (!prev.by && a.by) {
        prev.by = a.by;
      }
      return;
    }
    const m = toMilestone(a, idx);
    out.push(m);
    lastByKey.set(key, m);
  });
  return out.sort((x, y) => x.activity_index - y.activity_index);
}

function toMilestone(a, idx) {
  return {
    key: a.milestone,
    label: MILESTONE_LABEL[a.milestone] || a.label,
    at: a.at,
    by: a.by || null,
    ref: a.ref || null,
    ref_kind: a.ref_kind || null,
    ref_id: a.ref_id || null,
    also: a.also,
    detail: a.detail || null,
    source: a.source,
    activity_id: a.id,
    activity_index: idx,
  };
}

/* ============================================================== rentals */

/**
 * One row per deployment (outbound challan delivered to a customer), with the
 * return that ended it and the rent invoiced for this laptop in that window.
 *
 *   deployments  [{ dc_number, sales_order_number, deal, customer_id, customer_name, delivered_at, rate }]
 *   returns      [{ dc_number, original_dc_number, customer_id, created_at, received_at }]
 *   invoiceLines [{ line_id, customer_id, rent_start, rent_end, amount, monthly_rate, cancelled }]
 *   current      { status, dc_number, rate }
 *   today        'YYYY-MM-DD' (IST)
 * Pure.
 */
function buildRentals({ deployments = [], returns = [], invoiceLines = [], current = {}, today }) {
  const deps = deployments.filter((d) => d.delivered_at).slice().sort((a, b) => toMs(a.delivered_at) - toMs(b.delivered_at));
  const rets = returns.slice().sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
  const usedRet = new Set();
  const usedLine = new Set();
  const lines = invoiceLines.filter((l) => !l.cancelled);
  const rows = deps.map((d, i) => {
    const next = deps[i + 1];
    const start = istDay(d.delivered_at);
    const kind = d.deal === 'sale' ? 'sale' : d.deal === 'demo' ? 'demo' : 'rental';
    let ret = rets.find((r) => !usedRet.has(r) && r.original_dc_number && r.original_dc_number === d.dc_number
      && toMs(r.created_at) >= toMs(d.delivered_at) - DAY_MS);
    if (!ret) {
      ret = rets.find((r) => !usedRet.has(r) && toMs(r.created_at) >= toMs(d.delivered_at) - DAY_MS
        && (!next || toMs(r.created_at) <= toMs(next.delivered_at))
        && (!r.customer_id || !d.customer_id || Number(r.customer_id) === Number(d.customer_id)));
    }
    if (ret) usedRet.add(ret);
    let end = null;
    let endBasis = null;
    let ongoing = false;
    if (kind === 'sale') {
      endBasis = 'sold';
    } else if (ret && ret.received_at) {
      end = istDay(ret.received_at); endBasis = 'returned';
    } else if (ret) {
      endBasis = 'return_pending'; ongoing = true;
    } else if (next) {
      end = istDay(next.delivered_at); endBasis = 'next_deployment';
    } else if (WITH_CUSTOMER.includes(current.status) && current.status !== 'sold') {
      ongoing = true; endBasis = 'ongoing';
    } else {
      endBasis = 'unknown';
    }
    const until = end || (ongoing ? today : null);
    const days = kind === 'sale' || !until ? null : Math.max(0, daysBetween(start, until) + 1);
    const mine = kind === 'sale' ? [] : lines.filter((l) => !usedLine.has(l.line_id)
      && (!l.customer_id || !d.customer_id || Number(l.customer_id) === Number(d.customer_id))
      && istDay(l.rent_end || l.rent_start) >= start && (!until || istDay(l.rent_start) <= until));
    mine.forEach((l) => usedLine.add(l.line_id));
    const rate = num(d.rate) ?? (mine.length ? num(mine[mine.length - 1].monthly_rate) : null)
      ?? (ongoing && current.dc_number === d.dc_number ? num(current.rate) : null);
    return {
      kind,
      customer_id: d.customer_id || null,
      customer_name: d.customer_name || null,
      sales_order_number: d.sales_order_number || null,
      dc_number: d.dc_number,
      return_dc_number: ret ? ret.dc_number : null,
      delivered_on: start,
      returned_on: end,
      end_basis: endBasis,
      ongoing,
      days,
      monthly_rate: rate,
      sale_amount: kind === 'sale' ? num(d.rate) : null,
      // Rough: rate × days / 30. For periods billed before CRM invoicing existed.
      rent_at_rate: kind === 'rental' && rate != null && days != null ? round2((rate * days) / 30) : null,
      invoiced: round2(mine.reduce((s, l) => s + (num(l.amount) || 0), 0)),
      invoice_lines: mine.length,
    };
  });
  const unassigned = lines.filter((l) => !usedLine.has(l.line_id));
  return {
    rows,
    unassigned_invoiced: round2(unassigned.reduce((s, l) => s + (num(l.amount) || 0), 0)),
    unassigned_lines: unassigned.length,
  };
}

/* ================================================================ money */

/** Share of an invoice that has been paid: 1 when marked paid, else amount_paid / grand_total (0..1). Pure. */
function invoicePaidFraction(inv) {
  if (!inv) return 0;
  if (String(inv.status || '').toLowerCase() === 'paid' || inv.paid_at) return 1;
  const total = num(inv.grand_total);
  const paid = num(inv.amount_paid) || 0;
  if (!total || total <= 0 || paid <= 0) return 0;
  return Math.min(1, paid / total);
}

/** This laptop's share of credit notes: its own line where the note has lines, else the whole note when it names only this laptop. Pure. */
function creditForLaptop(notes, { serialId, ttspl }) {
  let amount = 0;
  let estimated = false;
  const list = [];
  const T = String(ttspl || '').toUpperCase();
  for (const n of notes || []) {
    const items = Array.isArray(n.line_items) ? n.line_items : [];
    let mine = 0;
    if (items.length) {
      mine = items
        .filter((li) => String(li?.serial_id ?? '') === String(serialId) || (T && String(li?.ttspl_id || '').toUpperCase() === T))
        .reduce((s, li) => s + (num(li.amount) || 0), 0);
    } else {
      const ids = Array.isArray(n.ttspl_ids) ? n.ttspl_ids : [];
      if (ids.length > 1) { mine = (num(n.amount) || 0) / ids.length; estimated = true; } else mine = num(n.amount) || 0;
    }
    if (mine > 0) {
      amount += mine;
      list.push({ credit_note_id: n.credit_note_id, credit_note_number: n.credit_note_number, status: n.status, reason: n.reason, amount: round2(mine) });
    }
  }
  return { amount: round2(amount), estimated, notes: list };
}

/**
 * The money picture. All inputs already resolved; pure.
 *   ownership        'owned' | 'vendor_rented' | 'bought_out'
 *   purchase         { amount, source }            (owned: PO line rate)
 *   buyout           { amount } | null             (vendor-rented laptop bought out)
 *   purchaseEquivalent { amount, source } | null   (vendor-rented: info only)
 *   parts, credits   numbers (laptopCostService)
 *   invoiceLines     [{ amount, cancelled, draft, paid_fraction }]
 *   credit           { amount, estimated }
 *   saleValue        number | null
 *   vendorRent       { amount, basis } | null
 *   rentAtRate       number | null   (sum of rental periods at their rate)
 */
function computeMoney({
  ownership = 'owned', purchase = null, buyout = null, purchaseEquivalent = null, parts = 0, credits = 0,
  invoiceLines = [], credit = { amount: 0, estimated: false }, saleValue = null, vendorRent = null, rentAtRate = null,
}) {
  const live = invoiceLines.filter((l) => !l.cancelled);
  const invoiced = round2(live.reduce((s, l) => s + (num(l.amount) || 0), 0));
  const draft = round2(live.filter((l) => l.draft).reduce((s, l) => s + (num(l.amount) || 0), 0));
  const received = round2(live.reduce((s, l) => s + (num(l.amount) || 0) * (num(l.paid_fraction) || 0), 0));
  const anyPayment = live.some((l) => (num(l.paid_fraction) || 0) > 0);
  const receivedEstimated = live.some((l) => { const f = num(l.paid_fraction) || 0; return f > 0 && f < 1; });
  const creditAmt = round2(credit?.amount || 0);
  const rentInvoicedNet = round2(invoiced - creditAmt);

  const purchaseValue = ownership === 'vendor_rented' ? 0 : round2(ownership === 'bought_out' ? (buyout?.amount || 0) : (purchase?.amount || 0));
  const partsValue = round2(parts || 0);
  const creditsValue = round2(credits || 0);
  const vendorPaid = round2(vendorRent?.amount || 0);
  const sale = round2(saleValue || 0);
  const invested = round2(purchaseValue + partsValue - creditsValue + vendorPaid);
  const netOnInvoiced = round2(rentInvoicedNet + sale - invested);
  const netOnReceived = round2(received + sale - invested);
  return {
    ownership,
    purchase_value: purchaseValue,
    purchase_source: ownership === 'vendor_rented' ? 'not_bought' : (ownership === 'bought_out' ? 'vendor_buyout' : (purchase?.source || null)),
    purchase_equivalent: ownership !== 'owned' ? (purchaseEquivalent || null) : null,
    parts_value: partsValue,
    parts_credits: creditsValue,
    rent_invoiced: invoiced,
    rent_invoiced_draft: draft,
    credit_notes: creditAmt,
    credit_notes_estimated: Boolean(credit?.estimated),
    rent_invoiced_net: rentInvoicedNet,
    rent_received: received,
    received_is_estimated: receivedEstimated,
    payments_tracked: anyPayment,
    rent_at_rate: rentAtRate == null ? null : round2(rentAtRate),
    sale_value: saleValue == null ? null : sale,
    vendor_rent_paid: ownership === 'owned' ? null : vendorPaid,
    vendor_rent_basis: ownership === 'owned' ? null : (vendorRent?.basis || null),
    invested,
    net_on_invoiced: netOnInvoiced,
    net_on_received: netOnReceived,
    // No payment is recorded against any of this laptop's invoices: "received"
    // would read as a confident zero, so the headline net uses invoiced rent.
    net: anyPayment ? netOnReceived : netOnInvoiced,
    net_basis: anyPayment ? 'received' : 'invoiced',
  };
}

/** Vendor rent paid: exact bill lines, plus rent accrued after the last billed day. */
function vendorRentPaid({ billLines = [], monthlyRate, start, end, pauses = [], accrue = rentAccrued }) {
  const live = billLines.filter((l) => !l.cancelled);
  const billed = round2(live.reduce((s, l) => s + (num(l.amount) || 0), 0));
  const lastBilled = live.map((l) => istDay(l.rent_end)).filter(Boolean).sort().pop() || null;
  let accrued = { amount: 0, days: 0 };
  let from = start;
  if (lastBilled) {
    const d = new Date(`${lastBilled}T00:00:00`);
    from = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  if (monthlyRate > 0 && from && end && new Date(from) <= new Date(end)) {
    accrued = accrue({ start: from, end, monthlyRate, pauses });
  }
  const basis = live.length ? (accrued.amount > 0 ? 'vendor_bills_plus_accrued' : 'vendor_bills') : 'accrued';
  return { amount: round2(billed + accrued.amount), billed, billed_lines: live.length, last_billed_day: lastBilled, accrued: accrued.amount, accrued_days: accrued.days, basis };
}

/* ============================================================== loaders */

function parseFiles(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { list = raw.trim() ? [raw] : []; }
  }
  if (!Array.isArray(list)) list = list ? [list] : [];
  return list.map((f) => {
    if (!f) return null;
    if (typeof f === 'string') return { path: f, name: f.split('/').pop() };
    const p = f.path || f.url || f.file_path || f.filePath || f.location;
    return p ? { path: p, name: f.name || f.original_name || f.originalname || f.filename || String(p).split('/').pop() } : null;
  }).filter(Boolean);
}

async function resolveLaptop(db, code) {
  const key = String(code || '').trim();
  if (!key) return null;
  const { rows } = await db.query(
    `SELECT v.*, COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
            COALESCE(c.company_name, c.name) AS customer_name
       FROM vendor_serial_numbers v
       LEFT JOIN customers c ON c.customer_id = v.current_customer_id
      WHERE v.deleted_at IS NULL AND v.po_id IS NOT NULL AND v.spo_id IS NULL
        AND (UPPER(COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', '')) = UPPER($1)
             OR UPPER(v.serial_number) = UPPER($1)
             OR ($2::int IS NOT NULL AND v.serial_id = $2::int))
      ORDER BY (UPPER(COALESCE(v.inventory_asset_code, '')) = UPPER($1)) DESC, v.serial_id DESC
      LIMIT 1`,
    [key, /^\d{1,9}$/.test(key) ? Number(key) : null]
  );
  return rows[0] || null;
}

const safe = (p) => p.then((r) => r.rows).catch((e) => {
  // A table missing on one database must not blank the whole page.
  if (e && ['42P01', '42703'].includes(e.code)) return [];
  throw e;
});

async function getLifecycle(code, { db = pool, today = istDay(new Date()) } = {}) {
  const v = await resolveLaptop(db, code);
  if (!v) return null;
  const sid = v.serial_id;
  const ttspl = v.ttspl_id || null;
  const serial = v.serial_number;
  const x = v.extra && typeof v.extra === 'object' ? v.extra : {};

  const [poRows, grnRows, transitions, audit, events, tickets, dcLines, support, vrepair, vreturn, invLines, creditNotes, billLines, pauses, chargers] = await Promise.all([
    safe(db.query(
      `SELECT p.po_id, p.purchase_order_number, to_char(p.purchase_order_date, 'YYYY-MM-DD') AS po_date, p.purchase_order_type,
              p.status, p.vendor_id, vd.business_name AS vendor_name, p.bill_files, p.bill_name, p.vendor_invoice_number,
              p.vendor_invoice_file, p.invoice_path, p.rental_period, p.status_updated_by_name, p.approved_at, p.created_at
         FROM vendor_purchase_orders p LEFT JOIN vendors vd ON vd.vendor_id = p.vendor_id WHERE p.po_id = $1`, [v.po_id])),
    safe(db.query(
      `SELECT grn_id, po_id, meta, created_at, bill_status, bill_files, bill_name, vendor_challan_no, vendor_invoice_no
         FROM vendor_goods_received_notes WHERE grn_id = $1`, [v.grn_id])),
    safe(db.query(`SELECT * FROM inventory_status_transitions WHERE serial_id = $1 ORDER BY created_at, transition_id`, [sid])),
    safe(db.query(
      `SELECT log_id, ttspl_id, vendor_serial_id, event_type, description, metadata, actor_user_id, actor_name, created_at
         FROM ttspl_audit_log WHERE vendor_serial_id = $1 OR ($2::text IS NOT NULL AND ttspl_id = $2) ORDER BY created_at, log_id`,
      [sid, ttspl])),
    safe(db.query(
      `SELECT event_id, occurred_at, actor_type, actor_id, actor_name, entity_ref, event_type, from_state, to_state, payload, source
         FROM events WHERE entity_type = 'asset' AND entity_id = ANY($1::text[]) AND source NOT LIKE 'backfill:%'
        ORDER BY occurred_at LIMIT 1000`,
      [[ttspl, String(sid)].filter(Boolean)])),
    safe(db.query(
      `SELECT h.*, t.ticket_type
         FROM production_ticket_history h
         JOIN tickets t ON t.ticket_id = h.ticket_id
        WHERE t.vendor_serial_id = $1 OR ($2::text IS NOT NULL AND UPPER(t.ttspl_id) = UPPER($2))
        ORDER BY h.created_at, h.id`,
      [sid, ttspl])),
    safe(db.query(
      `SELECT d.id, d.dc_number, d.sales_order_number, d.customer_id, d.customer_name, d.status, d.movement_type, d.dc_purpose,
              d.created_at, d.created_by, d.dispatched_at, d.delivered_at, d.delivered_by, d.delivery_completed_at,
              d.rejected_at, d.rejected_by, d.rejection_reason, d.warehouse_received_at, d.warehouse_received_by,
              d.warehouse_receiver_name, d.original_dc_number, d.support_ticket_id, d.courier_name, d.ship_by,
              d.pod_image_url, d.pod_photo_url, d.esign_url, d.warehouse_esign_url, d.einvoice_pdf_path, d.eway_bill_pdf_path,
              l.quotation_type AS deal, l.rate AS so_rate
         FROM delivery_challan_lines d
         LEFT JOIN LATERAL (
           SELECT sl.quotation_type, sl.rate
             FROM sales_order_serials s JOIN sales_order_lines sl ON sl.id = s.line_id
            WHERE s.serial_id = $1 AND (s.dc_number = d.dc_number OR (s.dc_number IS NULL AND s.sales_order_number = d.sales_order_number))
            ORDER BY s.allocation_id DESC LIMIT 1
         ) l ON TRUE
        WHERE jsonb_typeof(d.serial_number) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(d.serial_number) tok
             WHERE split_part(tok, '|', 1) = $1::text
                OR UPPER(split_part(tok, '|', 2)) = UPPER($2)
                OR ($3::text IS NOT NULL AND UPPER(split_part(tok, '|', 3)) = UPPER($3))
                OR UPPER(tok) = UPPER($2))
        ORDER BY d.created_at, d.id`,
      [sid, serial, ttspl])),
    safe(db.query(
      `SELECT i.id AS item_id, i.ticket_id, i.status AS item_status, i.issue_category_label, i.remarks, i.picked_up_at,
              i.pickup_assigned_to, i.warehouse_received_at, i.warehouse_received_by, i.outcome, i.return_dc_number AS item_return_dc,
              t.customer_id, t.customer_name, t.status, t.ticket_category, t.complaint_type, t.created_at, t.created_by,
              t.created_by_name, t.closed_at, t.closed_by, t.cancelled_at, t.return_dc_number
         FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
        WHERE ($1::text IS NOT NULL AND (UPPER(i.ttspl_id) = UPPER($1) OR UPPER(i.unique_serial_number) = UPPER($1)
               OR UPPER(i.ttspl_id) LIKE '%/' || UPPER($1)))
           OR UPPER(i.serial_number) = UPPER($2)
        ORDER BY t.created_at, i.id`,
      [ttspl, serial])),
    safe(db.query(
      `SELECT i.*, c.vendor_name, c.dispatched_at
         FROM vendor_repair_dc_items i LEFT JOIN vendor_repair_delivery_challans c ON c.dc_number = i.dc_number
        WHERE (i.serial_id = $1 OR ($2::text IS NOT NULL AND UPPER(i.ttspl_id) = UPPER($2))) AND c.cancelled_at IS NULL
        ORDER BY i.created_at`,
      [sid, ttspl])),
    safe(db.query(
      `SELECT i.* FROM vendor_return_dc_items i
         LEFT JOIN vendor_return_delivery_challans c ON c.dc_number = i.dc_number
        WHERE i.serial_id = $1 AND COALESCE(c.status, '') <> 'cancelled' ORDER BY i.created_at`,
      [sid])),
    safe(db.query(
      `SELECT l.line_id, l.invoice_id, l.period_label, l.rent_start, l.rent_end, l.days_billed, l.monthly_rate, l.amount,
              l.line_type, l.created_at, i.invoice_number, i.invoice_date, i.customer_id, i.status, i.amount_paid,
              i.grand_total, i.paid_at, i.cancelled_at
         FROM customer_invoice_lines l JOIN customer_invoices i ON i.invoice_id = l.invoice_id
        WHERE (l.serial_id = $1 OR ($2::text IS NOT NULL AND UPPER(l.ttspl_id) = UPPER($2)))
          AND COALESCE(l.line_type, 'rental') <> 'security'
        ORDER BY l.rent_start, l.line_id`,
      [sid, ttspl])),
    safe(db.query(
      `SELECT credit_note_id, credit_note_number, status, reason, amount, ttspl_ids, line_items, serial_id
         FROM customer_credit_notes
        WHERE status <> 'cancelled' AND cancelled_at IS NULL
          AND (serial_id = $1
               OR ($2::text IS NOT NULL AND jsonb_typeof(ttspl_ids) = 'array' AND ttspl_ids ? $2)
               OR (jsonb_typeof(line_items) = 'array' AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(line_items) li
                      WHERE li->>'serial_id' = $1::text OR ($2::text IS NOT NULL AND UPPER(li->>'ttspl_id') = UPPER($2)))))`,
      [sid, ttspl])),
    safe(db.query(
      `SELECT l.*, b.bill_number, b.status AS bill_status, b.cancelled_at
         FROM vendor_bill_lines l JOIN vendor_monthly_bills b ON b.bill_id = l.bill_id
        WHERE l.serial_id = $1 ORDER BY l.rent_start`,
      [sid])),
    safe(db.query(
      `SELECT paused_from, resumed_on FROM vendor_rent_pauses WHERE serial_id = $1 AND COALESCE(closed_reason, '') <> 'cancelled'`,
      [sid])),
    safe(db.query(
      `SELECT r.*, (SELECT json_agg(json_build_object('kit_role', u.kit_role, 'prt_id', u.prt_id, 'asset_code', u.asset_code,
                    'serial_number', u.serial_number, 'part_name', u.part_name) ORDER BY u.unit_id)
                      FROM dispatch_charger_units u WHERE u.request_id = r.request_id) AS units,
              (SELECT json_agg(json_build_object('return_dc_number', s.return_dc_number, 'charger_scanned', s.charger_scanned,
                    'matched', s.matched, 'scanned_by', s.scanned_by, 'scanned_at', s.scanned_at) ORDER BY s.scan_id)
                      FROM dispatch_charger_return_scans s WHERE s.request_id = r.request_id) AS return_scans,
              pi.unit_cost AS charger_cost
         FROM dispatch_charger_requests r
         LEFT JOIN part_instances pi ON pi.instance_id = r.part_instance_id
        WHERE r.serial_id = $1 OR ($2::text IS NOT NULL AND UPPER(r.ttspl_id) = UPPER($2))
        ORDER BY r.created_at`,
      [sid, ttspl])),
  ]);

  const po = poRows[0] || null;
  const grn = grnRows[0] || null;

  /* ---- activity */
  const raw = [];
  if (po?.po_date) {
    raw.push({
      id: `po:${po.po_id}`, at: iso(`${po.po_date}T00:00:00+05:30`), by_id: null, by_name: po.status_updated_by_name || null,
      type: 'purchased', label: 'Purchase order raised', ref: po.purchase_order_number, ref_kind: 'po', ref_id: po.po_id,
      detail: [po.vendor_name, RENTAL_PO_TYPES.includes(po.purchase_order_type) ? 'rented from vendor' : 'bought'].filter(Boolean).join(' · '),
      source: 'purchase', milestone: 'purchased', dedupe: null,
    });
  }
  if (grn) {
    const grnNo = grn.meta?.grn_number || `GRN-${String(grn.grn_id).padStart(4, '0')}`;
    raw.push({
      id: `grn:${grn.grn_id}`, at: iso(v.created_at || grn.created_at), by_id: null, type: 'received',
      label: 'Received on GRN', ref: grnNo, ref_kind: 'grn', ref_id: grn.grn_id,
      detail: [po?.purchase_order_number, v.received_condition && v.received_condition !== 'on' ? `received ${human(v.received_condition)}` : null].filter(Boolean).join(' · ') || null,
      source: 'purchase', milestone: 'grn_received', dedupe: 'grn_received', window: null,
    });
  }
  const cleanTransitions = transitions.filter((t) => !isTestNoise(t));
  cleanTransitions.forEach((t) => raw.push(fromTransition(t)));
  const cleanAudit = audit.filter((a) => !(String(a.event_type || '').startsWith('status_')
    && isTestNoise({ reason: a.description, actor_user_id: a.actor_user_id, dc_number: a.metadata?.dc_number })));
  const cleanEvents = events.filter((e) => !(e.event_type === 'status_changed'
    && isTestNoise({ reason: e.payload?.reason, actor_user_id: e.actor_id, dc_number: e.payload?.dc_number })));
  cleanAudit.forEach((a) => raw.push(fromAudit(a)));
  cleanEvents.forEach((e) => { const r = fromEvent(e); if (r) raw.push(r); });
  tickets.forEach((h) => raw.push(fromFloor(h)));
  dcLines.forEach((d) => fromDcLine(d, d.deal).forEach((r) => raw.push(r)));
  support.forEach((s) => fromSupport(s).forEach((r) => raw.push(r)));
  vrepair.forEach((r) => fromVendorRepair(r).forEach((row) => raw.push(row)));
  vreturn.forEach((r) => fromVendorReturn(r).forEach((row) => raw.push(row)));
  invLines.filter((l) => !l.cancelled_at && String(l.status || '').toLowerCase() !== 'cancelled').forEach((l) => raw.push(fromInvoiceLine(l)));

  // Names for everyone mentioned.
  const ids = new Set();
  raw.forEach((r) => { if (r.by_id) ids.add(Number(r.by_id)); });
  chargers.forEach((c) => ['requested_by', 'handed_over_by', 'attached_by', 'qc_scanned_by', 'cancelled_by'].forEach((k) => c[k] && ids.add(Number(c[k]))));
  const names = new Map();
  if (ids.size) {
    const us = await safe(db.query(`SELECT user_id, name, email FROM users WHERE user_id = ANY($1::int[])`, [[...ids].filter(Number.isFinite)]));
    us.forEach((u) => names.set(Number(u.user_id), u.name || u.email || null));
  }
  const nameOf = (id) => (id ? names.get(Number(id)) || null : null);
  raw.forEach((r) => { r.by = nameOf(r.by_id) || r.by_name || null; });

  const activity = mergeActivity(raw).map((r) => {
    const { by_name, ...rest } = r;
    return rest;
  });
  const milestones = deriveMilestones(activity);

  /* ---- rentals */
  const outbound = dcLines.filter((d) => d.movement_type !== 'return' && !/^RDC/i.test(d.dc_number || '') && String(d.status).toLowerCase() === 'delivered');
  const returnDcs = dcLines.filter((d) => (d.movement_type === 'return' || /^RDC/i.test(d.dc_number || '')) && String(d.status).toLowerCase() !== 'cancelled');
  const invForRent = invLines.map((l) => ({
    line_id: l.line_id, customer_id: l.customer_id, rent_start: istDay(l.rent_start), rent_end: istDay(l.rent_end),
    amount: num(l.amount), monthly_rate: num(l.monthly_rate),
    cancelled: Boolean(l.cancelled_at) || String(l.status || '').toLowerCase() === 'cancelled',
  }));
  const rentals = buildRentals({
    deployments: outbound.map((d) => ({
      dc_number: d.dc_number, sales_order_number: d.sales_order_number, deal: d.deal, customer_id: d.customer_id,
      customer_name: d.customer_name, delivered_at: d.delivered_at || d.delivery_completed_at, rate: num(d.so_rate),
    })),
    returns: returnDcs.map((d) => ({
      dc_number: d.dc_number, original_dc_number: d.original_dc_number, customer_id: d.customer_id, created_at: d.created_at,
      received_at: d.warehouse_received_at || (String(d.status).toLowerCase() === 'delivered' ? d.delivered_at : null),
    })),
    invoiceLines: invForRent,
    current: { status: v.inventory_status, dc_number: v.current_dc_number, rate: num(v.rent_monthly_rate) },
    today,
  });

  /* ---- money */
  const cost = await getLaptopCost(db, { serialId: sid }).catch(() => null);
  const rentedPo = RENTAL_PO_TYPES.includes(po?.purchase_order_type) || ['rental_purchase', 'rent_to_own'].includes(v.acquisition_type);
  const boughtOut = rentedPo && num(v.vendor_buyout_amount) > 0;
  const ownership = !rentedPo ? 'owned' : boughtOut ? 'bought_out' : 'vendor_rented';

  let vendorRent = null;
  let vendorRentStart = null;
  if (rentedPo) {
    const monthly = cost?.base?.kind === 'monthly_rent' ? num(cost.base.amount) : null;
    let start = istDay(x.received_at) || istDay(v.rental_start_date) || istDay(v.created_at);
    let startFixed = null;
    if (start && start > today) {
      // The ERP import put 2027-02-07 on most rented laptops; the GRN is when we started holding it.
      start = istDay(grn?.created_at) || istDay(v.created_at);
      startFixed = 'grn_date';
    }
    const ends = [istDay(v.vendor_rent_end_date), istDay(v.vendor_buyout_at), vreturn[0] ? istDay(vreturn[0].created_at) : null, today].filter(Boolean).sort();
    const end = ends[0];
    vendorRentStart = { start, end, start_fixed_from: startFixed, monthly_rate: monthly };
    vendorRent = vendorRentPaid({
      billLines: billLines.map((l) => ({ amount: num(l.amount), rent_end: l.rent_end, cancelled: Boolean(l.cancelled_at) || String(l.bill_status || '').toLowerCase() === 'cancelled' })),
      monthlyRate: monthly,
      start: start ? new Date(`${start}T00:00:00`) : null,
      end: end ? new Date(`${end}T00:00:00`) : null,
      pauses: pauses.map((p) => ({
        from: p.paused_from,
        to: p.resumed_on ? new Date(new Date(p.resumed_on).getFullYear(), new Date(p.resumed_on).getMonth(), new Date(p.resumed_on).getDate() - 1) : null,
      })),
    });
  }

  const credit = creditForLaptop(creditNotes, { serialId: sid, ttspl });
  const saleRows = rentals.rows.filter((r) => r.kind === 'sale');
  const saleValue = saleRows.length ? round2(saleRows.reduce((s, r) => s + (num(r.sale_amount) || 0), 0)) : null;
  const rentAtRate = rentals.rows.some((r) => r.rent_at_rate != null)
    ? rentals.rows.reduce((s, r) => s + (r.rent_at_rate || 0), 0) : null;
  const money = computeMoney({
    ownership,
    purchase: cost?.base?.kind === 'purchase' ? { amount: num(cost.base.amount), source: cost.base.source } : null,
    buyout: boughtOut ? { amount: num(v.vendor_buyout_amount) } : null,
    purchaseEquivalent: cost?.base?.purchase_equivalent || null,
    parts: cost?.parts || 0,
    credits: cost?.credits || 0,
    invoiceLines: invLines.map((l) => ({
      amount: num(l.amount),
      cancelled: Boolean(l.cancelled_at) || String(l.status || '').toLowerCase() === 'cancelled',
      draft: String(l.status || '').toLowerCase() === 'draft',
      paid_fraction: invoicePaidFraction(l),
    })),
    credit,
    saleValue,
    vendorRent,
    rentAtRate,
  });
  money.parts = (cost?.lines || []).map((l) => ({ ...l, when: iso(l.when) }));
  money.credit_note_list = credit.notes;
  money.vendor_rent = vendorRent ? { ...vendorRent, ...vendorRentStart } : null;
  money.purchase_unresolved = ownership === 'owned' && !(money.purchase_value > 0);
  money.rental_days = rentals.rows.reduce((s, r) => s + (r.kind !== 'sale' && r.days ? r.days : 0), 0);
  money.unassigned_invoiced = rentals.unassigned_invoiced;

  /* ---- purchase + attachments */
  const attachments = [];
  const add = (kind, label, files) => parseFiles(files).forEach((f, i, arr) => attachments.push({ kind, label: arr.length > 1 ? `${label} ${i + 1}` : label, path: f.path, name: f.name }));
  if (po) {
    add('po_bill', 'PO bill', po.bill_files);
    add('vendor_invoice', `Vendor invoice${po.vendor_invoice_number ? ` ${po.vendor_invoice_number}` : ''}`, po.vendor_invoice_file);
    add('po_document', 'Purchase order PDF', po.invoice_path);
  }
  if (grn) add('grn_bill', 'GRN bill', grn.bill_files);
  dcLines.forEach((d) => {
    add('pod', `Delivery proof ${d.dc_number}`, d.pod_photo_url || d.pod_image_url);
    add('esign', `Customer e-sign ${d.dc_number}`, d.esign_url);
    add('esign', `Warehouse e-sign ${d.dc_number}`, d.warehouse_esign_url);
    add('einvoice', `E-invoice ${d.dc_number}`, d.einvoice_pdf_path);
    add('eway', `E-way bill ${d.dc_number}`, d.eway_bill_pdf_path);
  });
  const purchaseRate = cost?.base || null;
  const grnNo = grn ? (grn.meta?.grn_number || `GRN-${String(grn.grn_id).padStart(4, '0')}`) : null;
  const purchase = po ? {
    po_id: po.po_id,
    po_number: po.purchase_order_number,
    po_date: po.po_date,
    po_type: po.purchase_order_type,
    po_status: po.status,
    vendor_id: po.vendor_id,
    vendor_name: po.vendor_name,
    grn_id: grn?.grn_id || null,
    grn_number: grnNo,
    grn_date: grn ? iso(grn.created_at) : null,
    received_at: iso(v.created_at),
    vendor_invoice_number: grn?.vendor_invoice_no || po.vendor_invoice_number || null,
    vendor_challan_number: grn?.vendor_challan_no || null,
    purchase_rate: purchaseRate && purchaseRate.kind === 'purchase' ? num(purchaseRate.amount) : null,
    vendor_monthly_rent: purchaseRate && purchaseRate.kind === 'monthly_rent' ? num(purchaseRate.amount) : null,
    rate_source: purchaseRate?.source || null,
    po_line_index: purchaseRate?.line_index ?? null,
    received_condition: v.received_condition,
    missing_parts: v.missing_parts || [],
    attachments,
  } : null;

  /* ---- charger */
  const charger = chargers.map((c) => ({
    request_id: c.request_id,
    request_number: c.request_number,
    status: c.status,
    disposition: c.disposition,
    sales_order_number: c.sales_order_number,
    dc_number: dcLines.find((d) => d.sales_order_number && d.sales_order_number === c.sales_order_number && d.movement_type !== 'return')?.dc_number || null,
    kit_type: c.extra?.kit_type || null,
    part_name: c.charger_part_name,
    prt_id: c.prt_id,
    asset_code: c.charger_asset_code,
    serial_number: c.charger_serial,
    cost: num(c.charger_cost),
    units: c.units || [],
    requested_at: iso(c.requested_at), requested_by: nameOf(c.requested_by),
    handed_over_at: iso(c.handed_over_at), handed_over_by: nameOf(c.handed_over_by),
    attached_at: iso(c.attached_at), attached_by: nameOf(c.attached_by),
    qc_scanned_at: iso(c.qc_scanned_at), qc_scanned_by: nameOf(c.qc_scanned_by), qc_scan_matched: c.qc_scan_matched,
    dispatched_at: iso(c.dispatched_at),
    returned_at: iso(c.returned_at),
    cancelled_at: iso(c.cancelled_at), cancelled_by: nameOf(c.cancelled_by),
    return_scans: c.return_scans || [],
    remarks: c.remarks,
  }));
  const withCustomer = WITH_CUSTOMER.includes(v.inventory_status) || ['in_transit', 'dispatch_ready', 'at_gate'].includes(v.inventory_status);
  const activeCharger = charger.filter((c) => !c.cancelled_at && !c.returned_at && ['attached', 'handed_over', 'dispatched'].includes(c.status)).pop() || null;

  /* ---- asset header */
  // ERP rows often say brand "Dell" with model "Lenovo Thinkpad X-13": a model that names its own brand wins.
  const rawModel = String(x.model || x.model_name || '').trim();
  const model = /^(dell|hp|lenovo|apple|acer|asus|microsoft|samsung|toshiba|msi|fujitsu)\b/i.test(rawModel) || !x.brand
    ? rawModel
    : `${x.brand} ${rawModel}`.trim();
  const config = [x.processor, x.generation && x.generation !== '-' ? x.generation : null, x.ram, x.storage || x.ssd, x.screen_size].filter(Boolean).join(' · ');
  const location = (() => {
    if (WITH_CUSTOMER.includes(v.inventory_status)) return v.customer_name ? `With ${v.customer_name}` : 'With a customer';
    if (v.inventory_status === 'in_transit') return v.customer_name ? `On the way to ${v.customer_name}` : 'In transit';
    if (v.warehouse_carret) return `Carret ${v.warehouse_carret} / Slot ${v.warehouse_carret_slot}`;
    if (v.inventory_status === 'returned_to_vendor') return 'Returned to vendor';
    if (v.inventory_status === 'scrapped') return 'Scrapped';
    if (['in_repair', 'qc_failed', 'returned'].includes(v.inventory_status)) return 'On the floor';
    return v.inventory_status ? 'In the warehouse' : null;
  })();

  return {
    asset: {
      serial_id: sid,
      ttspl_id: ttspl,
      serial_number: serial,
      brand: x.brand || null,
      model: x.model || x.model_name || null,
      model_name: model || null,
      processor: x.processor || null,
      generation: x.generation || null,
      ram: x.ram || null,
      storage: x.storage || x.ssd || null,
      screen_size: x.screen_size || null,
      gpu: x.gpu || null,
      config: config || null,
      grn_received_config: v.grn_received_config || null,
      status: v.inventory_status,
      qc_status: v.qc_status || x.status || null,
      tag: x.inventory_tag || null,
      entity: v.current_entity || null,
      customer_id: v.current_customer_id,
      customer_name: v.customer_name || null,
      current_dc_number: v.current_dc_number,
      rent_monthly_rate: num(v.rent_monthly_rate),
      rent_start_date: istDay(v.rent_start_date),
      lock_in_end_date: istDay(v.lock_in_end_date),
      warranty_end_date: istDay(v.warranty_end_date),
      carret: v.warehouse_carret,
      slot: v.warehouse_carret_slot,
      location,
      ownership,
      acquisition_type: v.acquisition_type || null,
      vendor_rent_end_date: istDay(v.vendor_rent_end_date),
      vendor_buyout: boughtOut ? { amount: num(v.vendor_buyout_amount), at: iso(v.vendor_buyout_at), bill_no: v.vendor_buyout_bill_no } : null,
    },
    purchase,
    charger: { current: withCustomer ? activeCharger : null, history: charger },
    milestones,
    activity,
    rentals: rentals.rows,
    money,
    notes: {
      // Rows the transitionConcurrency unit test wrote when it ran against this database.
      test_noise_rows: (transitions.length - cleanTransitions.length) + (audit.length - cleanAudit.length) + (events.length - cleanEvents.length),
      invoices_from: invLines.length ? istDay(invLines[0].rent_start) : null,
    },
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getLifecycle,
  // pure helpers (unit-tested)
  fromTransition, fromAudit, fromEvent, fromFloor, fromDcLine, fromSupport, fromInvoiceLine,
  classifyFloor, isTestNoise, mergeActivity, deriveMilestones, buildRentals,
  invoicePaidFraction, creditForLaptop, computeMoney, vendorRentPaid, parseFiles, istDay,
  MILESTONE_LABEL,
  _fail: fail,
};
