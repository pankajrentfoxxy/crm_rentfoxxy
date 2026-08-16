export const SUPPORT_V2_BASE = '/support';
export const SUPPORT_LEGACY_BASE = '/support-legacy';

export function supportPath(rel = '') {
  const tail = String(rel || '').replace(/^\//, '');
  return tail ? `${SUPPORT_V2_BASE}/${tail}` : SUPPORT_V2_BASE;
}

export function formatSupportId(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

const MATRIX = {
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 4 },
};

/** Client preview only — server recomputes and wins. */
export function previewTicketPriority(state, supportTier, fleetSize) {
  const pris = (state.lines || []).map((l) => computePriority({
    impact: Number(l.impact) || 2,
    urgency: Number(l.urgency) || 2,
    supportTier,
    isSafety: Boolean(l.is_safety),
    isRepeat: Boolean(l.repeat),
    contactIsVip: state.contact_is_vip,
    isSlaComplaint: l.type_code === 'SVC' && l.subtype_code === 'SVC-SLA',
    fleetSize,
    affectedUnits: (state.lines || []).length,
  }));
  if (!pris.length) return { priority: 4, reasons: [] };
  const best = Math.min(...pris.map((p) => p.priority));
  const reasons = pris.flatMap((p) => p.reasons);
  reasons.unshift(`Highest of ${pris.length} line(s) → P${best}`);
  return { priority: best, reasons };
}

export function computePriority(p) {
  const reasons = [];
  let priority = MATRIX[p.impact]?.[p.urgency];
  if (!priority) return { priority: 4, reasons: ['Invalid impact/urgency'] };
  reasons.push(`Impact ${p.impact} × Urgency ${p.urgency} → P${priority}`);
  const bump = (label) => {
    if (priority > 1) { priority -= 1; reasons.push(`${label}: −1 → P${priority}`); }
    else reasons.push(`${label}: already P1`);
  };
  if (p.supportTier === 'PLATINUM') bump('Platinum customer');
  else if (p.supportTier === 'GOLD' && priority >= 3) bump('Gold customer');
  if (p.isRepeat) bump('Repeat complaint');
  if (p.isReopen) bump('Reopened ticket');
  if (p.contactIsVip) bump('VIP contact');
  if (p.isSafety) { priority = 1; reasons.push('Safety issue: forced P1'); }
  if (p.isSlaComplaint) { priority = 1; reasons.push('SLA breach complaint: forced P1'); }
  if ((p.fleetSize || 0) >= 200 && (p.affectedUnits || 0) >= 10) {
    priority = 1; reasons.push('Large fleet, ≥10 units affected: forced P1');
  }
  return { priority, reasons };
}

export function indianMobile(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export function looksLikeTicketQuery(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (/^#?\d{3,}$/.test(s)) return true;
  if (/^STK[- ]/i.test(s)) return true;
  if (/^T-\d+/i.test(s)) return true;
  return false;
}

export function classifyLineErrors(line) {
  const e = [];
  if (!line.reported_issue_id) e.push('reported_issue_id is required');
  if (!line.reported_description || String(line.reported_description).trim().length < 15) {
    e.push('reported_description too short');
  }
  if (line.requires_photo && !(line.attachment_ids || []).length) e.push('photo required');
  return e;
}

export function woTypeLabel(code) {
  return String(code || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const WO_TYPE_SECTION = {
  FIELD_VISIT: 'support_field_visit',
  REMOTE_FIX: 'support_field_visit',
  REPAIR_PICKUP: 'support_pickup_repair',
  SERVICE_RETURN: 'support_pickup_repair',
  RETURN_PICKUP: 'support_pickup_return',
  REPLACEMENT_DELIVERY: 'support_replacement',
  PART_DELIVERY: 'support_parts_request',
  PART_RETURN: 'support_parts_request',
};

export const WO_TYPES = Object.keys(WO_TYPE_SECTION);

export function newIdempotencyKey() {
  return `wo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
