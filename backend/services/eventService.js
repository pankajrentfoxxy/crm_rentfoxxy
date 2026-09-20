/**
 * The write side of the event spine (Part 2.1, Decision 5).
 *
 * One request, one correlation id, on every event that request writes. That is
 * the whole point: today one delivery writes rows from up to five different
 * paths and nothing connects them. With a correlation id you can see that on
 * one screen, and once Part 3 has collapsed those paths you can assert that one
 * business action produces one correlated set.
 *
 * THE RULE THIS FILE EXISTS TO PROTECT:
 *   state lives in columns, history lives in events.
 * Nothing here reads current state, and nothing anywhere should read current
 * state out of `events`. qc_results, payment_records and sales_order_serials
 * keep holding business state.
 */
const crypto = require('crypto');
const pool = require('../config/db');

/** Entity types, so a typo does not create a second timeline nobody finds. */
const ENTITY = {
  ASSET: 'asset',
  TICKET: 'ticket',
  SO: 'so',
  DC: 'dc',
  INVOICE: 'invoice',
  SUPPORT_TICKET: 'support_ticket',
  PO: 'po',
  GRN: 'grn',
};

const ACTOR = {
  USER: 'user',
  SYSTEM: 'system',
  COURIER: 'courier',
  CUSTOMER: 'customer',
  MIGRATION: 'migration',
};

const newCorrelationId = () => crypto.randomUUID();

/**
 * Resolve the actor from whatever the caller has.
 *
 * `req.user` for a logged-in request, an explicit actor for a worker, and
 * `system` as the honest fallback — an event with no actor at all is the thing
 * the current audit trails do (finding U17 records no from/to pair and no
 * actor), and it is what makes them unreadable after the fact.
 */
function resolveActor(actor) {
  if (!actor) return { actor_type: ACTOR.SYSTEM, actor_id: null, actor_name: 'system' };
  if (actor.actor_type) {
    return {
      actor_type: actor.actor_type,
      actor_id: actor.actor_id ?? null,
      actor_name: actor.actor_name || 'system',
    };
  }
  // A req.user shape.
  return {
    actor_type: ACTOR.USER,
    actor_id: actor.user_id ?? null,
    actor_name: actor.name || actor.email || `user ${actor.user_id ?? '?'}`,
  };
}

/**
 * Append one event.
 *
 * `db` is the caller's client when there is a transaction, so the event commits
 * or rolls back WITH the change it describes. Passing the pool instead writes
 * it independently, which is right for a post-commit notification and wrong for
 * a state change — an event describing a rollback that happened is worse than
 * no event.
 *
 * Never throws. A failure to record history must not fail the business action
 * that succeeded; it is logged loudly instead. This is the one place that
 * trade-off is acceptable, and only because the alternative is that adding
 * audit coverage becomes a new way for writes to fail.
 */
async function recordEvent(db, {
  entityType, entityId, entityRef = null,
  eventType, fromState = null, toState = null,
  payload = {}, correlationId = null, source,
  actor = null,
}) {
  const client = db || pool;
  const who = resolveActor(actor);

  if (!entityType || !entityId || !eventType || !source) {
    console.error('[events] refusing to write an event missing entityType, entityId, eventType or source', {
      entityType, entityId, eventType, source,
    });
    return null;
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO events (
         actor_type, actor_id, actor_name,
         entity_type, entity_id, entity_ref,
         event_type, from_state, to_state,
         payload, correlation_id, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       RETURNING event_id`,
      [
        who.actor_type, who.actor_id, who.actor_name,
        entityType, String(entityId), entityRef,
        eventType, fromState, toState,
        JSON.stringify(payload || {}), correlationId, source,
      ]
    );
    return rows[0]?.event_id ?? null;
  } catch (err) {
    console.error(`[events] failed to record ${eventType} for ${entityType}:${entityId} —`, err.message);
    return null;
  }
}

/** Asset events, which are most of them. */
const recordAssetEvent = (db, { serialId, ttsplId, ...rest }) =>
  recordEvent(db, {
    entityType: ENTITY.ASSET,
    entityId: ttsplId || serialId,
    entityRef: ttsplId || null,
    ...rest,
    payload: { serial_id: serialId ?? null, ...(rest.payload || {}) },
  });

/**
 * Read one entity's timeline, newest first. Used by the Part 2.7 asset record.
 *
 * This is a READ of history. It is not, and must never become, a way to work
 * out what state something is in now.
 */
async function timelineFor(entityType, entityId, { limit = 500, db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT event_id, occurred_at, actor_type, actor_id, actor_name,
            entity_type, entity_id, entity_ref, event_type,
            from_state, to_state, payload, correlation_id, source
       FROM events
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT $3`,
    [entityType, String(entityId), limit]
  );
  return rows;
}

/** Every event one business action wrote. The proof that five paths became one. */
async function correlatedSet(correlationId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT event_id, occurred_at, entity_type, entity_id, entity_ref,
            event_type, from_state, to_state, actor_name, source
       FROM events
      WHERE correlation_id = $1
      ORDER BY occurred_at, event_id`,
    [correlationId]
  );
  return rows;
}

module.exports = {
  ENTITY,
  ACTOR,
  newCorrelationId,
  recordEvent,
  recordAssetEvent,
  timelineFor,
  correlatedSet,
};
