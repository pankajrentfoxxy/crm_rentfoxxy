/**
 * Adaptive token-bucket limiter for outbound WhatsApp campaign sends.
 *
 * - Steady rate of `perMinute`, with a burst of at most one second's worth of tokens.
 * - acquire() calls are serialised, so concurrent senders queue fairly instead of
 *   all waking at once.
 * - On a 429 the rate is halved (floor: minFactor × perMinute) and every sender is held
 *   until Retry-After (or an exponential pause when the header is absent).
 * - After a quiet minute without a 429 the rate climbs back by 25% per minute.
 *
 * In-memory: correct because only one process sends at a time (the worker holds a
 * Postgres advisory lock for the whole send loop).
 */
class AdaptiveRateLimiter {
  constructor({
    perMinute = 200,
    minFactor = 0.1,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onChange = null,
  } = {}) {
    this.perMinute = Math.max(1, Number(perMinute) || 200);
    this.minFactor = minFactor;
    this.now = now;
    this.sleep = sleep;
    this.onChange = onChange;
    this.factor = 1;
    this.capacity = Math.max(1, Math.min(10, Math.ceil(this.perMinute / 60)));
    this.tokens = this.capacity;
    this.lastRefill = now();
    this.blockedUntil = 0;
    this.consecutive429 = 0;
    this.lastAdjustAt = 0;
    this.chain = Promise.resolve();
  }

  /** Current effective messages per minute. */
  currentRate() {
    return Math.max(1, Math.round(this.perMinute * this.factor));
  }

  refill() {
    const t = this.now();
    const elapsed = Math.max(0, t - this.lastRefill);
    this.lastRefill = t;
    const perMs = this.currentRate() / 60000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * perMs);
  }

  async acquireOne() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const t = this.now();
      if (t < this.blockedUntil) {
        await this.sleep(this.blockedUntil - t);
        this.lastRefill = this.now();
        continue;
      }
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const perMs = this.currentRate() / 60000;
      await this.sleep(Math.ceil((1 - this.tokens) / perMs));
    }
  }

  /** Resolves when the caller may send one message. */
  acquire() {
    const next = this.chain.then(() => this.acquireOne());
    this.chain = next.catch(() => {});
    return next;
  }

  /** Interakt answered 429. Returns how long sending is paused for (ms). */
  onRateLimited(retryAfterMs) {
    this.consecutive429 += 1;
    const before = this.currentRate();
    this.factor = Math.max(this.minFactor, this.factor / 2);
    const pause = retryAfterMs != null && retryAfterMs >= 0
      ? retryAfterMs
      : Math.min(60000, 5000 * 2 ** (this.consecutive429 - 1));
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + pause);
    this.tokens = 0;
    this.lastAdjustAt = this.now();
    if (this.onChange) this.onChange({ event: 'slowdown', fromRate: before, toRate: this.currentRate(), pauseMs: pause });
    return pause;
  }

  /** A send went through without a 429. */
  onSuccess() {
    this.consecutive429 = 0;
    if (this.factor >= 1) return;
    const t = this.now();
    if (t - this.lastAdjustAt < 60000) return;
    const before = this.currentRate();
    this.factor = Math.min(1, this.factor * 1.25);
    this.lastAdjustAt = t;
    if (this.onChange) this.onChange({ event: 'recover', fromRate: before, toRate: this.currentRate() });
  }
}

module.exports = { AdaptiveRateLimiter };
