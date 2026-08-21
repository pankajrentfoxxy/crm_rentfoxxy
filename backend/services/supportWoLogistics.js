'use strict';

const METHOD_TYPES = {
  TECHNICIAN: [
    'FIELD_VISIT', 'REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN',
    'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN',
  ],
  COURIER: [
    'REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN',
    'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN',
  ],
  REMOTE: ['REMOTE_FIX', 'FIELD_VISIT'],
};

const PICKUP_TYPES = new Set(['REPAIR_PICKUP', 'RETURN_PICKUP', 'PART_RETURN']);
const DELIVER_TYPES = new Set(['SERVICE_RETURN', 'REPLACEMENT_DELIVERY', 'PART_DELIVERY']);

function normalizeMethod(raw) {
  if (raw == null || raw === '') return null;
  return String(raw).toUpperCase();
}

function courierDirectionFor(woType) {
  if (PICKUP_TYPES.has(woType)) return 'PICKUP_FROM_CUSTOMER';
  if (DELIVER_TYPES.has(woType)) return 'DELIVER_TO_CUSTOMER';
  return null;
}

function assertMethodForType(woType, method) {
  const m = normalizeMethod(method);
  if (!m) return null;
  const allowed = METHOD_TYPES[m];
  if (!allowed) {
    throw Object.assign(new Error(`Invalid method ${m}`), { status: 400 });
  }
  if (!allowed.includes(woType)) {
    throw Object.assign(
      new Error(`${m} is not allowed for ${woType}`),
      { status: 400 }
    );
  }
  return m;
}

function istParts(iso) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function slotsToScheduled(slots) {
  if (!slots || !slots.length) return { start: null, end: null };
  const sorted = [...slots].sort((a, b) => {
    const ka = `${a.date} ${a.start}`;
    const kb = `${b.date} ${b.start}`;
    return ka.localeCompare(kb);
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    start: new Date(`${first.date}T${first.start}:00+05:30`),
    end: new Date(`${last.date}T${last.end}:00+05:30`),
  };
}

async function assertSlotsFree(client, userId, slots, excludeWoId) {
  if (!userId || !slots || !slots.length) return;
  for (const s of slots) {
    const hit = await client.query(
      `SELECT wo_id FROM support_wo_slots
        WHERE user_id = $1 AND slot_date = $2::date AND slot_start = $3::time
          AND ($4::int IS NULL OR wo_id <> $4)
        LIMIT 1`,
      [userId, s.date, s.start, excludeWoId || null]
    );
    if (hit.rows[0]) {
      throw Object.assign(
        new Error(`Already booked ${s.date} ${s.start}–${s.end}. Pick another slot or another technician.`),
        { status: 409 }
      );
    }
    const leave = await client.query(
      `SELECT 1 FROM user_leaves WHERE user_id = $1 AND leave_date = $2::date`,
      [userId, s.date]
    );
    if (leave.rows[0]) {
      throw Object.assign(new Error(`${s.date} is a leave day for this technician.`), { status: 400 });
    }
  }
}

async function writeSlots(client, woId, userId, slots) {
  if (!slots || !slots.length) return;
  for (const s of slots) {
    await client.query(
      `INSERT INTO support_wo_slots (wo_id, slot_date, slot_start, slot_end, user_id)
       VALUES ($1,$2::date,$3::time,$4::time,$5)
       ON CONFLICT (wo_id, slot_date, slot_start) DO UPDATE
         SET slot_end = EXCLUDED.slot_end, user_id = EXCLUDED.user_id`,
      [woId, s.date, s.start, s.end, userId || null]
    );
  }
}

module.exports = {
  METHOD_TYPES,
  normalizeMethod,
  courierDirectionFor,
  assertMethodForType,
  istParts,
  slotsToScheduled,
  assertSlotsFree,
  writeSlots,
};
