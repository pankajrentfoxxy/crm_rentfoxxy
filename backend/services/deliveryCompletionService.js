/**
 * The ONE delivery completion path (Part 3.3, findings V1–V8).
 *
 * Five code paths wrote status='delivered'. Only four called
 * finalizeDeliveryInventory and only four set delivered_at, so *which screen
 * the user happened to use* decided whether the asset, the rent clock and the
 * invoice followed the challan. Part 0 made the worst of them safe; this
 * collapses the rest.
 *
 * Every caller now supplies the same two things: which MODE the delivery
 * happened in, and what PROOF they have. The rules below are stated once and
 * enforced here, so a path cannot quietly accept less than another.
 *
 *   By hand / in-house     customer OTP AND a POD (photo or e-sign)
 *   Courier, auto          a courier delivered scan
 *   Courier / porter, manual  POD photo, and an actor who is not a field role
 *   Admin override         POD photo and a reason, always logged
 *
 * markDcDelivered used to accept `pod_image_url` as a plain body string with no
 * OTP at all (finding V3). Under this service that is impossible: the mode
 * decides the proof, and no mode accepts a bare string.
 */
const { recordEvent, ENTITY } = require('./eventService');

const MODE = {
  BY_HAND: 'by_hand',
  COURIER_AUTO: 'courier_auto',
  COURIER_MANUAL: 'courier_manual',
  ADMIN_OVERRIDE: 'admin_override',
};

/** Roles that are IN THE FIELD and therefore cannot self-certify a manual courier delivery. */
const FIELD_ROLES = new Set(['technician', 'support_tech', 'delivery', 'driver']);

class ProofRejected extends Error {
  constructor({ mode, missing, dcNumber }) {
    super(`Delivery of ${dcNumber} cannot be completed: ${missing.join(' ')}`);
    this.name = 'ProofRejected';
    this.code = 'DELIVERY_PROOF_REJECTED';
    this.statusCode = 400;
    this.mode = mode;
    this.missing = missing;
    this.dcNumber = dcNumber;
  }
}

/**
 * The proof table, as code.
 *
 * Returns the list of what is missing rather than the first failure, so a
 * driver standing at a customer's door is told everything they need in one go.
 */
function checkProof(mode, proof = {}, actor = null) {
  const missing = [];
  const hasPod = Boolean(proof.podPhotoUrl || proof.esignUrl || proof.podImageUrl);

  switch (mode) {
    case MODE.BY_HAND:
      if (!proof.otpVerified) missing.push('The customer OTP has not been verified.');
      if (!hasPod) missing.push('A proof of delivery (photo or e-signature) is required.');
      break;

    case MODE.COURIER_AUTO:
      // The carrier's delivered scan IS the proof, by design (finding B2 notes
      // there is no per-customer way to demand more; that stays a Part 6 item).
      if (!proof.courierScan) missing.push('No courier delivered scan was supplied.');
      break;

    case MODE.COURIER_MANUAL:
      if (!hasPod) missing.push('A proof-of-delivery photo is required when marking a courier delivery by hand.');
      if (FIELD_ROLES.has(String(actor?.role || '').toLowerCase())) {
        // A field role marking a courier delivery complete is marking their own
        // homework — the courier delivered it, not them.
        missing.push('A courier delivery must be confirmed by someone who is not a field role.');
      }
      break;

    case MODE.ADMIN_OVERRIDE:
      if (!hasPod) missing.push('An override still needs a proof-of-delivery photo.');
      if (!String(proof.reason || '').trim()) missing.push('An override needs a reason.');
      break;

    default:
      missing.push(`Unknown delivery mode "${mode}".`);
  }

  return missing;
}

/**
 * Complete a delivery. The caller owns the transaction.
 *
 * Returns {ok:false, statusCode, message} for the expected refusals — an
 * already-delivered challan, a cancelled one — so each HTTP handler can shape
 * its own response. Throws ProofRejected when the proof rules are not met,
 * because that is a caller error rather than a state conflict.
 */
async function completeDelivery(client, {
  dcNumber,
  mode,
  proof = {},
  actor = null,
  correlationId = null,
  // The delivery register supplies these; nothing else does.
  deliveredSerialNumbers = null,
  rejectedSerialNumbers = null,
  submittedRemark = null,
  deliveryLocation = null,
  // The courier's delivered scan carries the REAL delivery time, which is not
  // the time the sweep happened to run. Defaults to now for the paths where
  // the two are the same moment.
  deliveredAt = null,
  source = 'deliveryCompletionService',
}) {
  const missing = checkProof(mode, proof, actor);
  if (missing.length) {
    // Recorded, not just refused. A delivery that could not be completed is
    // exactly the thing nobody can reconstruct afterwards today.
    await recordEvent(client, {
      entityType: ENTITY.DC,
      entityId: dcNumber,
      entityRef: dcNumber,
      eventType: 'delivery_proof_rejected',
      payload: { mode, missing, source },
      correlationId,
      source,
      actor,
    });
    throw new ProofRejected({ mode, missing, dcNumber });
  }

  // V8: only one of the five paths took a row lock, so two concurrent
  // submissions could both finalise inventory and both raise an invoice.
  const state = await client.query(
    `SELECT DISTINCT LOWER(COALESCE(status, '')) AS status
       FROM delivery_challan_lines WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  if (!state.rows.length) {
    return { ok: false, statusCode: 404, message: 'Delivery challan not found' };
  }
  const states = state.rows.map((r) => r.status);
  if (states.includes('cancelled')) {
    return { ok: false, statusCode: 409, message: 'This delivery challan is cancelled and cannot be delivered.' };
  }
  if (states.every((s) => s === 'delivered')) {
    return { ok: false, statusCode: 409, message: 'This delivery challan is already marked delivered.' };
  }

  const writesRegister = deliveredSerialNumbers !== null || rejectedSerialNumbers !== null;
  const upd = await client.query(
    `UPDATE delivery_challan_lines SET
        status = 'delivered',
        delivered_at = COALESCE($13::timestamptz, NOW()),
        delivery_completed_at = COALESCE($13::timestamptz, NOW()),
        delivered_by = $1,
        delivery_location = COALESCE($2, delivery_location),
        pod_type = COALESCE($3, pod_type),
        pod_photo_url = COALESCE($4, pod_photo_url),
        esign_url = COALESCE($5, esign_url),
        pod_submitted_at = COALESCE(pod_submitted_at, NOW()),
        pod_submitted_by = COALESCE(pod_submitted_by, $1),
        otp_verified_at = CASE WHEN $6::boolean THEN COALESCE(otp_verified_at, NOW()) ELSE otp_verified_at END,
        delivery_notes = COALESCE($7, delivery_notes),
        delivered_serial_numbers = CASE WHEN $9::boolean THEN $10::jsonb ELSE delivered_serial_numbers END,
        rejected_serial_numbers  = CASE WHEN $9::boolean THEN $11::jsonb ELSE rejected_serial_numbers END,
        submitted_remark = COALESCE($12, submitted_remark),
        updated_at = NOW()
      WHERE dc_number = $8
        AND LOWER(COALESCE(status, '')) NOT IN ('delivered', 'cancelled')`,
    [
      actor?.user_id || actor?.actor_id || null,
      deliveryLocation,
      proof.podType || (proof.esignUrl ? 'esign' : (proof.podPhotoUrl || proof.podImageUrl) ? 'photo' : null),
      proof.podPhotoUrl || proof.podImageUrl || null,
      proof.esignUrl || null,
      Boolean(proof.otpVerified),
      proof.notes || null,
      dcNumber,
      writesRegister,
      JSON.stringify(deliveredSerialNumbers || []),
      JSON.stringify(rejectedSerialNumbers || []),
      submittedRemark,
      deliveredAt,
    ]
  );
  if (!upd.rowCount) {
    return { ok: false, statusCode: 409, message: 'No deliverable lines on this challan — nothing was changed.' };
  }

  // The step three of the five paths skipped: move the serials out of
  // in_transit and set rent_start_date.
  const sm = require('../controllers/salesManagementController');
  await sm.finalizeDeliveryInventory(client, dcNumber, actor);

  await recordEvent(client, {
    entityType: ENTITY.DC,
    entityId: dcNumber,
    entityRef: dcNumber,
    eventType: 'delivered',
    toState: 'delivered',
    payload: {
      mode,
      proof: {
        otp_verified: Boolean(proof.otpVerified),
        pod: Boolean(proof.podPhotoUrl || proof.esignUrl || proof.podImageUrl),
        courier_scan: Boolean(proof.courierScan),
        reason: proof.reason || null,
      },
      source,
    },
    correlationId,
    source,
    actor,
  });

  return { ok: true, mode };
}

module.exports = {
  MODE,
  FIELD_ROLES,
  ProofRejected,
  checkProof,
  completeDelivery,
};
