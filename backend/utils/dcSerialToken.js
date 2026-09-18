'use strict';

/**
 * DC serial tokens are `serialId|serialNumber|ttsplId` strings, but not every
 * element of delivery_challan_lines.serial_number follows that shape — part-return
 * RPDCs store a JSON object per element instead.
 *
 * The old idiom stripped every non-digit out of the first segment before casting
 * to int, which on a JSON element glued all its digits into one number and blew
 * past int4 ("value 20260917193820711613135 is out of range for type integer").
 * On a plain serial number in the first position it was quietly worse: `ABC123`
 * became serial_id 123 and joined to an unrelated asset.
 *
 * Treat the segment as a serial id only when it is already a plain integer that
 * fits int4; anything else is not an id.
 */
function serialIdFromToken(tokenExpr) {
  const part = `split_part(${tokenExpr}, '|', 1)`;
  return `(CASE WHEN ${part} ~ '^[0-9]{1,9}$' THEN ${part}::int END)`;
}

module.exports = { serialIdFromToken };
