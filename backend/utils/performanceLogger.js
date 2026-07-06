/**
 * Lightweight request-scoped performance timers for API endpoints.
 * Enabled when NODE_ENV !== 'production' or PERF_LOG=1.
 */
function perfEnabled() {
  return process.env.PERF_LOG === '1' || process.env.NODE_ENV !== 'production';
}

function createPerfLogger(label) {
  const marks = new Map();
  const order = [];

  return {
    start(name) {
      if (!perfEnabled()) return;
      marks.set(name, process.hrtime.bigint());
      order.push(name);
    },
    end(name) {
      if (!perfEnabled()) return null;
      const start = marks.get(name);
      if (start == null) return null;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      marks.set(name, ms);
      return ms;
    },
    summary() {
      if (!perfEnabled()) return {};
      const out = {};
      for (const name of order) {
        const v = marks.get(name);
        if (typeof v === 'number') out[name] = Math.round(v * 100) / 100;
      }
      return out;
    },
    log(extra = {}) {
      if (!perfEnabled()) return;
      const parts = order
        .map((name) => {
          const v = marks.get(name);
          return typeof v === 'number' ? `${name}=${v.toFixed(1)}ms` : null;
        })
        .filter(Boolean);
      console.log(`[perf] ${label} ${parts.join(' ')}`, extra);
    },
  };
}

module.exports = { createPerfLogger, perfEnabled };
