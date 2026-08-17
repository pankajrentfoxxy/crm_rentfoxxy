'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { computePriority } = require('../services/supportPriorityService');
const { recalcTicketSla } = require('../services/supportSlaService');
const { logEvent } = require('../services/supportTicketStateService');
const { nextStkNumber, nextWoNumber, legacyTicketNumber } = require('../services/supportNumberService');
const { instantiateWoSteps, markStepDone } = require('../services/supportWorkOrderSteps');
const {
  resolvePickupType,
  mapItemStatus,
  mapTicketStatus,
  mapIssueCategory,
  LEGACY_PRIORITY,
} = require('../services/supportPickupMigration');

const DRY = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
const REPORT_PATH = path.join(__dirname, '../../docs/support-revamp/MIGRATION_RECONCILIATION.md');

if (DRY === APPLY) {
  console.error('Usage: node scripts/migrate-support-to-v2.js --dry-run | --apply');
  process.exit(1);
}

function cat(t) {
  return String(t.ticket_category || '').toLowerCase();
}

function clip(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

async function loadCatalog(db) {
  const r = await db.query('SELECT catalog_id, code, level, parent_id FROM support_issue_catalog');
  const byId = new Map(r.rows.map((x) => [x.catalog_id, x]));
  const byCode = new Map(r.rows.map((x) => [x.code, x]));
  function chainForSubtype(subtypeCode) {
    const uns = byCode.get(`${subtypeCode}-UNS`);
    const sub = byCode.get(subtypeCode);
    const typ = sub ? byId.get(sub.parent_id) : null;
    if (!uns || !sub || !typ) {
      throw new Error(`Catalogue missing chain for ${subtypeCode}`);
    }
    return { typeId: typ.catalog_id, subtypeId: sub.catalog_id, issueId: uns.catalog_id };
  }
  return { chainForSubtype };
}

async function resolveSerial(db, item) {
  const candidates = [item.unique_serial_number, item.serial_number].filter(Boolean);
  if (!candidates.length) return null;
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, current_customer_id
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (serial_number = ANY($1::text[]) OR inventory_asset_code = ANY($1::text[]))
      LIMIT 1`,
    [candidates]
  );
  return r.rows[0] || null;
}

async function pickupContext(db, item, ticket, serial) {
  const pickupAt = item.created_at || ticket.created_at || new Date();
  const cn = await db.query(
    `SELECT 1 FROM customer_credit_notes
      WHERE customer_id = $1
        AND created_at BETWEEN $2::timestamptz - INTERVAL '7 days'
                           AND $2::timestamptz + INTERVAL '7 days'
        AND (
          ($3::int IS NOT NULL AND serial_id = $3)
          OR ($4::text IS NOT NULL AND ttspl_ids @> to_jsonb($4::text))
          OR ($5::text IS NOT NULL AND (
               ttspl_ids::text ILIKE '%' || $5 || '%'
               OR description ILIKE '%' || $5 || '%'
             ))
        )
      LIMIT 1`,
    [
      ticket.customer_id,
      pickupAt,
      serial && serial.serial_id,
      serial && serial.inventory_asset_code,
      item.serial_number || (serial && serial.serial_number),
    ]
  );
  const repl = await db.query(
    `SELECT 1 FROM support_replacement_orders WHERE pickup_item_id = $1 LIMIT 1`,
    [item.id]
  );
  const hist = await db.query(
    `SELECT 1 FROM support_ticket_item_audit
      WHERE item_id = $1
        AND (action ILIKE '%awaiting_service_return%'
             OR COALESCE(detail::text, '') ILIKE '%awaiting_service_return%')
      LIMIT 1`,
    [item.id]
  );
  const status = String(item.status || '').toLowerCase();
  const inv = String((serial && serial.inventory_status) || '').toLowerCase();
  const notAssigned = !serial
    ? false
    : (inv === 'returned' || inv === 'in_stock')
      && Number(serial.current_customer_id || 0) !== Number(ticket.customer_id || 0);
  return {
    hasCreditNote: cn.rows.length > 0,
    hasReplacementPickup: repl.rows.length > 0,
    everAwaitingServiceReturn: hist.rows.length > 0 || status === 'awaiting_service_return',
    serialReturnedOrStockNotAssigned: notAssigned,
  };
}

function findComplaintAncestor(item, itemsById, ticketsById) {
  let cur = item;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const t = ticketsById.get(cur.ticket_id);
    if (t && cat(t) === 'complaint') return t;
    if (!cur.source_item_id) break;
    cur = itemsById.get(cur.source_item_id);
  }
  return null;
}

function findPickupParent(ticket, items, itemsById, ticketsById) {
  for (const item of items.filter((i) => i.ticket_id === ticket.id)) {
    const parent = findComplaintAncestor(item, itemsById, ticketsById);
    if (parent && parent.id !== ticket.id) return parent;
  }
  return null;
}

function findReplacementParent(ticket, orders, itemsById, ticketsById) {
  for (const o of orders.filter((o) => o.ticket_id === ticket.id)) {
    for (const id of [o.source_item_id, o.item_id]) {
      if (!id) continue;
      const item = itemsById.get(id);
      if (!item) continue;
      const t = ticketsById.get(item.ticket_id);
      if (t && t.id !== ticket.id && cat(t) === 'complaint') return t;
      const via = findComplaintAncestor(item, itemsById, ticketsById);
      if (via && via.id !== ticket.id) return via;
    }
  }
  return null;
}

function lineCode(i) {
  return `A${i + 1}`;
}

async function buildPlan(db) {
  const catalog = await loadCatalog(db);
  const cats = await db.query('SELECT id, name FROM support_issue_categories');
  const catName = new Map(cats.rows.map((r) => [r.id, r.name]));

  const tickets = (await db.query('SELECT * FROM support_tickets ORDER BY id')).rows;
  const items = (await db.query('SELECT * FROM support_ticket_items ORDER BY id')).rows;
  const orders = (await db.query(
    `SELECT * FROM support_replacement_orders ORDER BY id`
  ).catch(() => ({ rows: [] }))).rows;
  const audits = (await db.query('SELECT * FROM support_ticket_item_audit ORDER BY id')).rows;
  const comments = (await db.query('SELECT * FROM support_ticket_item_comments ORDER BY id')).rows;

  const ticketsById = new Map(tickets.map((t) => [t.id, t]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const itemsByTicket = new Map();
  for (const it of items) {
    if (!itemsByTicket.has(it.ticket_id)) itemsByTicket.set(it.ticket_id, []);
    itemsByTicket.get(it.ticket_id).push(it);
  }
  const ordersByTicket = new Map();
  for (const o of orders) {
    if (!ordersByTicket.has(o.ticket_id)) ordersByTicket.set(o.ticket_id, []);
    ordersByTicket.get(o.ticket_id).push(o);
  }

  const pickupDecisions = [];
  const jobsByLegacy = new Map();

  function ensureCreate(legacy, ticketClass, defaultSubtype) {
    if (jobsByLegacy.has(legacy.id)) return jobsByLegacy.get(legacy.id);
    const job = {
      kind: 'create',
      legacy,
      ticketClass,
      defaultSubtype,
      assets: [],
      workOrders: [],
      mergedFrom: [],
    };
    jobsByLegacy.set(legacy.id, job);
    return job;
  }

  function attachToParent(parentLegacy, childLegacy) {
    const parent = jobsByLegacy.get(parentLegacy.id);
    if (!parent) return null;
    parent.mergedFrom.push(childLegacy.id);
    return parent;
  }

  for (const t of tickets) {
    const kind = cat(t);
    if (kind === 'complaint' || !kind) {
      ensureCreate(t, 'INCIDENT', null);
    } else if (kind === 'pickup') {
      const parent = findPickupParent(t, itemsByTicket.get(t.id) || [], itemsById, ticketsById);
      if (parent) {
        // parent job created in complaint pass; if parent is later, create a stub
        ensureCreate(parent, 'INCIDENT', null);
        attachToParent(parent, t);
        jobsByLegacy.set(t.id, { kind: 'merge', legacy: t, parentId: parent.id, assets: [], workOrders: [], mergedFrom: [] });
      } else {
        ensureCreate(t, 'REQUEST', 'LOG-RET');
      }
    } else if (kind === 'replacement') {
      const parent = findReplacementParent(t, ordersByTicket.get(t.id) || [], itemsById, ticketsById);
      if (parent) {
        ensureCreate(parent, 'INCIDENT', null);
        attachToParent(parent, t);
        jobsByLegacy.set(t.id, { kind: 'merge', legacy: t, parentId: parent.id, assets: [], workOrders: [], mergedFrom: [] });
      } else {
        ensureCreate(t, 'REQUEST', 'SVC-OTH');
      }
    } else {
      ensureCreate(t, 'INCIDENT', null);
    }
  }

  const replacementGroupByOrder = new Map();
  for (const o of orders) {
    replacementGroupByOrder.set(o.id, `RG-LEGACY-${o.id}-${crypto.randomBytes(3).toString('hex')}`);
  }

  async function classifyItem(item, ticket) {
    const type = String(item.item_type || '').toLowerCase();
    const subtypeCode = mapIssueCategory(catName.get(item.issue_category_id) || item.issue_category_label);
    const chain = catalog.chainForSubtype(subtypeCode);
    const serial = await resolveSerial(db, item);
    if (type === 'complaint') {
      return { kind: 'asset', item, chain, serial, subtypeCode };
    }
    if (type === 'replacement') {
      const order = orders.find((o) => o.item_id === item.id || o.ticket_id === ticket.id);
      return {
        kind: 'wo',
        item,
        chain,
        serial,
        subtypeCode,
        wo_type: 'REPLACEMENT_DELIVERY',
        confidence: 'HIGH',
        rule: 'REPLACEMENT_ITEM',
        replacement_group_id: order ? replacementGroupByOrder.get(order.id) : `RG-ITEM-${item.id}`,
        statusMap: mapItemStatus(item.status),
      };
    }
    // pickup (and unknown treated as pickup when on a pickup ticket)
    const ctx = await pickupContext(db, item, ticket, serial);
    const decision = resolvePickupType(item, ctx);
    const order = orders.find((o) => o.pickup_item_id === item.id);
    pickupDecisions.push({
      item,
      ticket,
      serial,
      ...decision,
    });
    return {
      kind: 'wo',
      item,
      chain,
      serial,
      subtypeCode,
      ...decision,
      replacement_group_id: order ? replacementGroupByOrder.get(order.id) : null,
      statusMap: mapItemStatus(item.status),
    };
  }

  for (const t of tickets) {
    const job = jobsByLegacy.get(t.id);
    const target = job.kind === 'merge' ? jobsByLegacy.get(job.parentId) : job;
    if (!target) continue;
    for (const item of itemsByTicket.get(t.id) || []) {
      const classified = await classifyItem(item, t);
      if (classified.kind === 'asset') target.assets.push(classified);
      else target.workOrders.push(classified);
    }
    // Orphan pickup with no items: still one synthetic WO planned
    if (job.kind === 'create' && job.ticketClass === 'REQUEST' && job.defaultSubtype === 'LOG-RET'
        && !(itemsByTicket.get(t.id) || []).length) {
      const chain = catalog.chainForSubtype('LOG-RET');
      target.workOrders.push({
        kind: 'wo',
        item: { id: null, status: 'open', assigned_to: null, remarks: t.top_level_remarks },
        chain,
        serial: null,
        subtypeCode: 'LOG-RET',
        wo_type: 'RETURN_PICKUP',
        confidence: 'LOW',
        rule: 'ORPHAN_EMPTY',
        statusMap: { status: 'DRAFT' },
      });
    }
  }

  // Pair replacement collect/delivery groups onto existing pickup WOs
  for (const o of orders) {
    const group = replacementGroupByOrder.get(o.id);
    if (o.pickup_item_id) {
      for (const job of jobsByLegacy.values()) {
        if (job.kind !== 'create') continue;
        for (const wo of job.workOrders) {
          if (wo.item && wo.item.id === o.pickup_item_id) wo.replacement_group_id = group;
        }
      }
    }
  }

  const eventsByTicket = new Map();
  for (const a of audits) {
    if (!eventsByTicket.has(a.ticket_id)) eventsByTicket.set(a.ticket_id, []);
    eventsByTicket.get(a.ticket_id).push({
      type: 'LEGACY_AUDIT',
      actorId: a.user_id,
      summary: a.action,
      detail: { audit_id: a.id, item_id: a.item_id, detail: a.detail },
      at: a.created_at,
    });
  }
  for (const c of comments) {
    const item = itemsById.get(c.item_id);
    if (!item) continue;
    if (!eventsByTicket.has(item.ticket_id)) eventsByTicket.set(item.ticket_id, []);
    eventsByTicket.get(item.ticket_id).push({
      type: 'COMMENT',
      actorId: c.user_id,
      summary: c.body,
      detail: { comment_id: c.id, item_id: c.item_id, author_role: c.author_role },
      at: c.created_at,
    });
  }

  return {
    tickets,
    items,
    orders,
    jobs: [...jobsByLegacy.values()].filter((j) => j.kind === 'create'),
    merges: [...jobsByLegacy.values()].filter((j) => j.kind === 'merge'),
    pickupDecisions,
    eventsByTicket,
    catalog,
  };
}

function writeReport(plan, extras = {}) {
  const created = plan.jobs.length;
  const merged = plan.merges.length;
  const assetCount = plan.jobs.reduce((n, j) => n + j.assets.length, 0);
  const woCount = plan.jobs.reduce((n, j) => n + j.workOrders.length, 0);
  const ruleRows = {};
  for (const d of plan.pickupDecisions) {
    const key = `${d.rule}|${d.confidence}`;
    ruleRows[key] = (ruleRows[key] || 0) + 1;
  }
  const lows = plan.pickupDecisions.filter((d) => d.confidence === 'LOW');
  const lines = [];
  lines.push('# Support v2 migration — reconciliation');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()} (${DRY ? 'dry-run' : 'apply'})`);
  lines.push('');
  lines.push('## Counts');
  lines.push('| Legacy | Count | New | Count | Match |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| support_tickets (all) | ${plan.tickets.length} | support_tickets_v2 | ${created} | merged ${merged} pickups/replacements into parents |`);
  lines.push(`| support_ticket_items | ${plan.items.length} | assets + work orders | ${assetCount} + ${woCount} | ${assetCount + woCount === plan.items.length || plan.items.length === 0 ? '✓' : 'see notes'} |`);
  lines.push(`| support_replacement_orders | ${plan.orders.length} | replacement WO pairs | ${plan.orders.length} | ✓ |`);
  lines.push('');
  lines.push('## Pickup type resolution');
  lines.push('| Rule | Fired | Confidence |');
  lines.push('|---|---|---|');
  const ruleOrder = [
    ['SERVICE_DC', 'HIGH', '1 · has service_dc_number'],
    ['CREDIT_NOTE_7D', 'HIGH', '2 · credit note within 7 days'],
    ['REPLACEMENT_COLLECT', 'HIGH', '3 · replacement pickup_item_id'],
    ['EXPLICIT_PICKUP_TYPE', 'MEDIUM', '4 · explicit pickup_type'],
    ['AWAITING_SERVICE_RETURN', 'MEDIUM', '5 · awaiting_service_return history'],
    ['SERIAL_NOT_ASSIGNED', 'LOW', '6 · serial returned/in_stock, not assigned'],
    ['FALLBACK', 'LOW', '7 · fallback'],
    ['ORPHAN_EMPTY', 'LOW', 'orphan empty pickup ticket'],
  ];
  for (const [rule, conf, label] of ruleOrder) {
    lines.push(`| ${label} | ${ruleRows[`${rule}|${conf}`] || 0} | ${conf} |`);
  }
  lines.push('');
  lines.push(`## Needs human review (LOW confidence) — ${lows.length} rows`);
  lines.push('| Legacy item | Ticket | Customer | Serial | Assigned type | Why |');
  lines.push('|---|---|---|---|---|---|');
  for (const d of lows) {
    lines.push(`| ${d.item.id} | ${d.ticket.id} | ${d.ticket.customer_id || ''} | ${d.item.serial_number || ''} | ${d.wo_type} | ${d.rule} |`);
  }
  if (extras.note) {
    lines.push('');
    lines.push('## Notes');
    lines.push(extras.note);
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${REPORT_PATH}`);
}

async function validUser(db, userId) {
  if (!userId) return null;
  const r = await db.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
  return r.rows[0] ? r.rows[0].user_id : null;
}

async function validCustomer(db, customerId) {
  if (!customerId) return null;
  const r = await db.query('SELECT customer_id FROM customers WHERE customer_id = $1', [customerId]);
  return r.rows[0] ? r.rows[0].customer_id : null;
}

async function applyJob(db, job, plan, reviews) {
  const existing = await db.query(
    'SELECT ticket_id FROM support_tickets_v2 WHERE legacy_ticket_id = $1',
    [job.legacy.id]
  );
  if (existing.rows[0]) return { skipped: true, ticket_id: existing.rows[0].ticket_id };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const legacy = job.legacy;
    const anyAssigned = [...job.assets, ...job.workOrders].some((x) => x.item && x.item.assigned_to);
    const status = mapTicketStatus(legacy.status, anyAssigned);
    const computed = computePriority({ impact: 2, urgency: 2 });
    const mappedPri = LEGACY_PRIORITY[String(legacy.priority || '').toLowerCase()];
    const priority = mappedPri || computed.priority;
    const overridden = Boolean(mappedPri);
    const assignedTo = await validUser(client, (job.workOrders.find((w) => w.item && w.item.assigned_to) || {}).item?.assigned_to
      || (job.assets.find((a) => a.item && a.item.assigned_to) || {}).item?.assigned_to
      || null);
    const customerId = await validCustomer(client, legacy.customer_id);
    const number = await nextStkNumber(client);
    const chainDefault = job.defaultSubtype
      ? plan.catalog.chainForSubtype(job.defaultSubtype)
      : plan.catalog.chainForSubtype('SVC-OTH');

    const ins = await client.query(
      `INSERT INTO support_tickets_v2 (
         ticket_number, ticket_class, channel, channel_inferred, status,
         priority, priority_overridden, priority_override_reason, impact, urgency,
         customer_id, site_label, contact_name, contact_phone, contact_email,
         subject, assigned_to, created_by, created_at, updated_at,
         closed_at, legacy_ticket_id, legacy_ticket_number, migration_confidence
       ) VALUES (
         $1,$2,'PHONE',true,$3,
         $4,$5,$6,2,2,
         $7,$8,$9,$10,$11,
         $12,$13,$14,$15,NOW(),
         $16,$17,$18,$19
       ) RETURNING ticket_id`,
      [
        number,
        job.ticketClass,
        status,
        priority,
        overridden,
        overridden ? 'MIGRATED' : null,
        customerId,
        clip(legacy.ticket_address, 200),
        clip(legacy.customer_name, 120),
        clip(legacy.ticket_phone_override || legacy.customer_phone, 40),
        clip(legacy.ticket_email, 120),
        legacy.top_level_remarks || `Migrated ${legacyTicketNumber(legacy.id)}`,
        assignedTo,
        await validUser(client, legacy.created_by),
        legacy.created_at || new Date(),
        status === 'CLOSED' ? (legacy.closed_at || new Date()) : null,
        legacy.id,
        legacyTicketNumber(legacy.id),
        job.workOrders.some((w) => w.confidence === 'LOW') ? 'LOW'
          : job.workOrders.some((w) => w.confidence === 'MEDIUM') ? 'MEDIUM'
            : 'HIGH',
      ]
    );
    const ticketId = ins.rows[0].ticket_id;

    const lineByLegacyItem = new Map();
    const assetSources = [...job.assets];
    for (const w of job.workOrders) {
      const id = w.item && w.item.id;
      if (id && !assetSources.some((a) => a.item && a.item.id === id)) {
        assetSources.push({ ...w, kind: 'asset' });
      }
    }
    if (!assetSources.length) {
      assetSources.push({
        item: { id: null, remarks: legacy.top_level_remarks, serial_number: null },
        chain: chainDefault,
        serial: null,
      });
    }

    let lineIdx = 0;
    for (const a of assetSources) {
      const chain = a.chain || chainDefault;
      const serial = a.serial;
      const line = await client.query(
        `INSERT INTO support_ticket_assets (
           ticket_id, line_code, serial_id, ttspl_id, serial_number, asset_unknown,
           reported_type_id, reported_subtype_id, reported_issue_id, reported_description,
           impact, urgency, line_status, legacy_item_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,2,'OPEN',$11)
         RETURNING line_id`,
        [
          ticketId,
          lineCode(lineIdx),
          serial && serial.serial_id,
          clip(serial && serial.inventory_asset_code, 40),
          clip((a.item && (a.item.serial_number || a.item.unique_serial_number)) || (serial && serial.serial_number), 120),
          !(serial && serial.serial_id) && !(a.item && a.item.serial_number),
          chain.typeId,
          chain.subtypeId,
          chain.issueId,
          (a.item && a.item.remarks) || 'Migrated from legacy support',
          a.item && a.item.id,
        ]
      );
      if (a.item && a.item.id) lineByLegacyItem.set(a.item.id, line.rows[0].line_id);
      lineIdx += 1;
    }

    for (const w of job.workOrders) {
      let woType = w.wo_type;
      let confidence = w.confidence;
      let rule = w.rule;
      if (confidence === 'LOW' && w.item && w.item.id && reviews.has(w.item.id)) {
        const dec = reviews.get(w.item.id);
        woType = dec === 'repair' ? 'REPAIR_PICKUP' : 'RETURN_PICKUP';
        rule = 'REVIEWED';
      }
      if (w.item && w.item.id) {
        const already = await client.query(
          'SELECT wo_id FROM support_work_orders WHERE legacy_item_id = $1',
          [w.item.id]
        );
        if (already.rows[0]) continue;
      }
      const woNumber = await nextWoNumber(client);
      const sm = w.statusMap || { status: 'DRAFT' };
      const woAssigned = await validUser(client, w.item && w.item.assigned_to);
      const woIns = await client.query(
        `INSERT INTO support_work_orders (
           wo_number, ticket_id, wo_type, status, assigned_to, notes,
           failure_reason, replacement_group_id, legacy_item_id,
           migration_confidence, migration_rule, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING wo_id`,
        [
          woNumber,
          ticketId,
          woType,
          sm.status,
          woAssigned,
          w.item && w.item.remarks,
          clip(sm.failure_reason, 40),
          w.replacement_group_id || null,
          w.item && w.item.id,
          confidence,
          clip(rule, 40),
          (w.item && w.item.created_at) || legacy.created_at || new Date(),
        ]
      );
      const woId = woIns.rows[0].wo_id;
      await instantiateWoSteps(client, woId, woType);
      if (sm.otpDone) await markStepDone(client, woId, 'CUSTOMER_OTP');
      const lineId = (w.item && lineByLegacyItem.get(w.item.id)) || [...lineByLegacyItem.values()][0] || null;
      if (lineId) {
        await client.query(
          `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2)
           ON CONFLICT (wo_id, line_id) DO NOTHING`,
          [woId, lineId]
        );
      }
      if (sm.followOnServiceReturn) {
        const followNo = await nextWoNumber(client);
        const follow = await client.query(
          `INSERT INTO support_work_orders (
             wo_number, ticket_id, wo_type, status, previous_wo_id, replacement_group_id, created_at
           ) VALUES ($1,$2,'SERVICE_RETURN','PENDING_ASSIGNMENT',$3,$4,NOW())
           RETURNING wo_id`,
          [followNo, ticketId, woId, w.replacement_group_id || null]
        );
        await instantiateWoSteps(client, follow.rows[0].wo_id, 'SERVICE_RETURN');
        if (lineId) {
          await client.query(
            `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2)
             ON CONFLICT (wo_id, line_id) DO NOTHING`,
            [follow.rows[0].wo_id, lineId]
          );
        }
      }
    }

    await logEvent(client, {
      ticketId,
      eventType: 'TICKET_MIGRATED',
      actorKind: 'SYSTEM',
      summary: `Migrated from ${legacyTicketNumber(legacy.id)}`,
      detail: { legacy_ticket_id: legacy.id, merged_from: job.mergedFrom },
    });

    const evs = [];
    for (const id of [legacy.id, ...(job.mergedFrom || [])]) {
      evs.push(...(plan.eventsByTicket.get(id) || []));
    }
    evs.sort((a, b) => new Date(a.at) - new Date(b.at));
    for (const ev of evs) {
      await logEvent(client, {
        ticketId,
        eventType: ev.type,
        actorId: ev.actorId,
        actorKind: 'USER',
        summary: ev.summary,
        detail: ev.detail,
      });
    }

    if (status !== 'CLOSED' && status !== 'CANCELLED') {
      try {
        await recalcTicketSla(client, ticketId, {
          startedAt: new Date(),
          customerId,
          ticketClass: job.ticketClass,
          priority,
        });
        await logEvent(client, {
          ticketId,
          eventType: 'SLA_CLOCK_RESET_ON_MIGRATION',
          actorKind: 'SYSTEM',
          summary: 'SLA clock started from migration time, not original created_at',
        });
      } catch (e) {
        console.error(`SLA skip for legacy ${legacy.id}:`, e.message);
      }
    }

    await client.query('COMMIT');
    return { skipped: false, ticket_id: ticketId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const plan = await buildPlan(pool);
  writeReport(plan);

  if (DRY) {
    console.log(`Dry-run complete. ${plan.jobs.length} tickets would be created, ${plan.merges.length} merged.`);
    return;
  }

  const lows = plan.pickupDecisions.filter((d) => d.confidence === 'LOW' && d.item && d.item.id);
  const alreadyWo = lows.length
    ? (await pool.query(
      `SELECT legacy_item_id FROM support_work_orders WHERE legacy_item_id = ANY($1::int[])`,
      [lows.map((d) => d.item.id)]
    )).rows.map((r) => r.legacy_item_id)
    : [];
  const alreadySet = new Set(alreadyWo);
  const pendingLows = lows.filter((d) => !alreadySet.has(d.item.id));
  const reviews = new Map();
  if (pendingLows.length) {
    const rev = await pool.query(
      `SELECT legacy_item_id, decision FROM support_migration_review
        WHERE legacy_item_id = ANY($1::int[])`,
      [pendingLows.map((d) => d.item.id)]
    );
    for (const r of rev.rows) reviews.set(r.legacy_item_id, r.decision);
    const missing = pendingLows.filter((d) => !reviews.has(d.item.id));
    if (missing.length) {
      console.error(`--apply refused: ${missing.length} LOW-confidence pickup(s) are unreviewed.`);
      console.error('Run: node scripts/review-migration-lows.js --list');
      process.exitCode = 2;
      return;
    }
  }

  let created = 0;
  let skipped = 0;
  for (const job of plan.jobs) {
    const result = await applyJob(pool, job, plan, reviews);
    if (result.skipped) skipped += 1;
    else created += 1;
  }
  console.log(`Apply complete. created=${created} skipped=${skipped} (idempotent on legacy_ticket_id)`);
}

main()
  .catch((e) => {
    console.error('migrate-support-to-v2:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
