'use strict';

/** Open FIELD requests that keep an asset line on PENDING_PART. */
const OPEN_FIELD_PART_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'RESERVED',
  'ISSUED',
  'IN_TRANSIT',
  'DELIVERED',
  'ESCALATED_TO_PROCUREMENT',
];

const QUEUE_CHIPS = {
  awaiting: ['REQUESTED'],
  approved: ['APPROVED', 'RESERVED'],
  with_tech: ['ISSUED', 'IN_TRANSIT', 'DELIVERED'],
  old_return: null,
  out_of_stock: ['ESCALATED_TO_PROCUREMENT'],
};

function queueOrderSql(sort) {
  if (sort === 'oldest') return 'pr.created_at ASC, pr.request_id ASC';
  return `CASE WHEN t.sla_resolution_due_at < NOW() THEN 0 ELSE 1 END,
          t.priority ASC NULLS LAST,
          pr.created_at ASC`;
}

function comparePartQueueRows(a, b, now = new Date()) {
  const aB = a.sla_resolution_due_at && new Date(a.sla_resolution_due_at) < now ? 0 : 1;
  const bB = b.sla_resolution_due_at && new Date(b.sla_resolution_due_at) < now ? 0 : 1;
  if (aB !== bB) return aB - bB;
  const ap = a.priority == null ? 99 : Number(a.priority);
  const bp = b.priority == null ? 99 : Number(b.priority);
  if (ap !== bp) return ap - bp;
  return new Date(a.created_at) - new Date(b.created_at);
}

function sortPartQueue(rows, sort, now = new Date()) {
  const copy = [...rows];
  if (sort === 'oldest') {
    copy.sort((a, b) => {
      const t = new Date(a.created_at) - new Date(b.created_at);
      return t !== 0 ? t : Number(a.request_id) - Number(b.request_id);
    });
    return copy;
  }
  copy.sort((a, b) => comparePartQueueRows(a, b, now));
  return copy;
}

function filterCompatibleParts(catalogue, compatRows) {
  const total = catalogue.length;
  if (!compatRows.length) {
    return { rows: catalogue, warning: true, matched: 0, catalogue: total };
  }
  const ids = new Set(compatRows.map((c) => Number(c.part_id)));
  const rows = catalogue.filter((p) => ids.has(Number(p.part_id)));
  return { rows, warning: false, matched: rows.length, catalogue: total };
}

function assertPhotos(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) {
    throw Object.assign(new Error('At least one photo is required'), { status: 400 });
  }
  return list;
}

module.exports = {
  OPEN_FIELD_PART_STATUSES,
  QUEUE_CHIPS,
  queueOrderSql,
  comparePartQueueRows,
  sortPartQueue,
  filterCompatibleParts,
  assertPhotos,
};
