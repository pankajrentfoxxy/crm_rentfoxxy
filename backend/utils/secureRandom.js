/**
 * Cryptographically secure random values for anything a user must not be able to
 * predict: OTPs, generated passwords, and the public capture access numbers.
 *
 * Math.random() is a fast non-cryptographic PRNG. V8 seeds it per context and
 * its output is predictable from a short run of observed values, so an OTP or
 * access number drawn from it is guessable by anyone who has seen a few — which,
 * for the public capture flows, is anyone who has ever been sent one. Use these
 * helpers instead. Cosmetic randomness (temp filenames, list shuffles) does not
 * need them.
 */
const crypto = require('crypto');

/** Uniform integer in [min, max] inclusive, free of modulo bias. */
function secureInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (!(hi > lo)) throw new Error(`secureInt: bad range ${min}..${max}`);
  return crypto.randomInt(lo, hi + 1);
}

/** Zero-padded numeric string, e.g. secureDigits(6) -> "004217". */
function secureDigits(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(crypto.randomInt(0, 10));
  return out;
}

/** 6-digit OTP. Leading zeros are preserved — it is a string, never a number. */
const secureOtp = () => secureDigits(6);

/**
 * Numeric access number in [100000, 999999], matching the shape the public
 * capture flows already use so existing validators keep working.
 */
const secureAccessNumber = () => String(secureInt(100000, 999999));

/** Password drawn uniformly from `chars`. */
function securePassword(length = 12, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%') {
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

module.exports = { secureInt, secureDigits, secureOtp, secureAccessNumber, securePassword };
