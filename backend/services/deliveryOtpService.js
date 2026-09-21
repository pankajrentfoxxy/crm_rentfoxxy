/**
 * The delivery OTP (Part 3.4, finding V6).
 *
 * What it replaces: six digits in plaintext, compared as a bare string, with no
 * expiry, no attempt limit, and written to every line of the challan so one
 * code opened all of them. Six digits with unlimited retries is not a second
 * factor — it is about 500,000 guesses, and nothing counted them.
 *
 * Four changes, and each closes a different half of the finding:
 *   hash      the database no longer stores something that can be read and used
 *   expiry    15 minutes, so a code from last month is not still live
 *   attempts  5 then re-issue, so guessing is bounded
 *   scope     one issue per CHALLAN, so verifying is about the consignment
 *
 * The legacy plaintext columns (otp_code, d_otp, delivery_otp — V7 is that
 * there are three families) are still written for one release so older screens
 * keep working. They are retired separately, once every reader has moved.
 */
const crypto = require('crypto');
const { recordEvent, ENTITY } = require('./eventService');

const OTP_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

/**
 * Salted with the challan number so the same six digits on two challans do not
 * produce the same hash — without that, a leaked hash from one delivery would
 * identify the code on another.
 *
 * JWT_SECRET is reused as the key rather than adding a new secret to rotate.
 */
function hashOtp(dcNumber, code) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'insecure-dev-secret')
    .update(`${dcNumber}:${String(code).trim()}`)
    .digest('hex');
}

/** Six digits, from a CSPRNG rather than Math.random. */
function generateOtp() {
  // randomInt is uniform; `% 1000000` on a random byte string is not.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issue one code for the whole challan.
 *
 * Returns the plaintext ONCE, for sending. It is never returned again and
 * never read back from the database.
 */
async function issueOtp(client, { dcNumber, actor = null, correlationId = null }) {
  const code = generateOtp();
  const issueId = crypto.randomUUID();
  const hash = hashOtp(dcNumber, code);

  const { rowCount } = await client.query(
    `UPDATE delivery_challan_lines
        SET otp_hash = $2,
            otp_issue_id = $3,
            otp_expires_at = NOW() + ($4 || ' minutes')::interval,
            otp_attempts = 0,
            otp_last_attempt_at = NULL,
            otp_sent_at = NOW(),
            -- Legacy families, written for one release so older screens still
            -- work. New code must read otp_hash.
            otp_code = $5,
            d_otp = $5,
            updated_at = NOW()
      WHERE dc_number = $1
        AND LOWER(COALESCE(status, '')) NOT IN ('delivered', 'cancelled', 'rejected')`,
    [dcNumber, hash, issueId, String(OTP_TTL_MINUTES), code]
  );

  if (!rowCount) {
    return { ok: false, statusCode: 409, message: 'This challan cannot be issued an OTP in its current state.' };
  }

  await recordEvent(client, {
    entityType: ENTITY.DC,
    entityId: dcNumber,
    entityRef: dcNumber,
    eventType: 'delivery_otp_issued',
    // The code itself is NOT in the payload. An event log that records the
    // secret is the plaintext column with extra steps.
    payload: { issue_id: issueId, ttl_minutes: OTP_TTL_MINUTES, lines: rowCount },
    correlationId,
    source: 'deliveryOtpService.issueOtp',
    actor,
  });

  return { ok: true, code, issueId, expiresInMinutes: OTP_TTL_MINUTES, lines: rowCount };
}

/**
 * Verify a code against the challan.
 *
 * Every outcome is a distinct, named reason, because "wrong code" and "expired"
 * and "too many tries" need different things from the person at the door.
 */
async function verifyOtp(client, { dcNumber, code, actor = null, correlationId = null }) {
  const { rows } = await client.query(
    `SELECT otp_hash, otp_issue_id, otp_attempts,
            otp_expires_at,
            (otp_expires_at IS NOT NULL AND otp_expires_at < NOW()) AS expired,
            otp_verified_at
       FROM delivery_challan_lines
      WHERE dc_number = $1
      ORDER BY id
      LIMIT 1
      FOR UPDATE`,
    [dcNumber]
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found', message: 'Delivery challan not found.' };
  if (row.otp_verified_at) return { ok: true, alreadyVerified: true };
  if (!row.otp_hash) {
    return { ok: false, reason: 'not_issued', message: 'No OTP has been issued for this challan. Send one first.' };
  }
  if (row.expired) {
    return { ok: false, reason: 'expired', message: `That code has expired. Codes are valid for ${OTP_TTL_MINUTES} minutes — send a new one.` };
  }
  if (Number(row.otp_attempts) >= MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: 'locked',
      message: `Too many incorrect attempts. Send a new code to try again.`,
    };
  }

  const supplied = hashOtp(dcNumber, code);
  // Constant-time compare. A plain === leaks the matching prefix length through
  // timing, which matters far more now the value is only six digits.
  const matches = row.otp_hash.length === supplied.length
    && crypto.timingSafeEqual(Buffer.from(row.otp_hash), Buffer.from(supplied));

  if (!matches) {
    const { rows: after } = await client.query(
      `UPDATE delivery_challan_lines
          SET otp_attempts = otp_attempts + 1,
              otp_last_attempt_at = NOW(),
              updated_at = NOW()
        WHERE dc_number = $1
        RETURNING otp_attempts`,
      [dcNumber]
    );
    const attempts = Number(after[0]?.otp_attempts || 0);

    await recordEvent(client, {
      entityType: ENTITY.DC,
      entityId: dcNumber,
      entityRef: dcNumber,
      eventType: 'delivery_otp_failed',
      payload: { attempts, remaining: Math.max(0, MAX_ATTEMPTS - attempts), issue_id: row.otp_issue_id },
      correlationId,
      source: 'deliveryOtpService.verifyOtp',
      actor,
    });

    return {
      ok: false,
      reason: attempts >= MAX_ATTEMPTS ? 'locked' : 'mismatch',
      attempts,
      remaining: Math.max(0, MAX_ATTEMPTS - attempts),
      message: attempts >= MAX_ATTEMPTS
        ? 'Too many incorrect attempts. Send a new code to try again.'
        : `That code is not right. ${MAX_ATTEMPTS - attempts} attempt(s) left.`,
    };
  }

  // Verified for the CHALLAN, which is the scope change: one code, one
  // consignment, every line.
  await client.query(
    `UPDATE delivery_challan_lines
        SET otp_verified_at = NOW(),
            d_otp_verified_at = NOW(),
            updated_at = NOW()
      WHERE dc_number = $1 AND otp_verified_at IS NULL`,
    [dcNumber]
  );

  await recordEvent(client, {
    entityType: ENTITY.DC,
    entityId: dcNumber,
    entityRef: dcNumber,
    eventType: 'delivery_otp_verified',
    payload: { issue_id: row.otp_issue_id, attempts: Number(row.otp_attempts) },
    correlationId,
    source: 'deliveryOtpService.verifyOtp',
    actor,
  });

  return { ok: true, issueId: row.otp_issue_id };
}

module.exports = {
  OTP_TTL_MINUTES,
  MAX_ATTEMPTS,
  hashOtp,
  generateOtp,
  issueOtp,
  verifyOtp,
};
