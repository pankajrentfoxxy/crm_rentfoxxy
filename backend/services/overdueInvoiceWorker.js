/**
 * Part 6.2 (finding BL9) — the job that moves sent invoices to overdue.
 *
 * "Nothing ever moves an invoice from sent to overdue. There is no job and no
 * endpoint. The overdue total on the finance screen is permanently zero unless
 * someone sets the status by hand."
 *
 * This is the job. It is deliberately small and deliberately not part of the
 * billing scheduler: the billing cron defaults to OFF (BL22), and an invoice
 * ageing past its due date is not a generation event — it is the passage of
 * time, which happens whether or not anybody chose to generate anything.
 *
 * In-process with no leader election, like every other worker here. That is only
 * safe because PM2 is pinned to one fork (see CLAUDE.md); the sweep is
 * idempotent anyway, so a second runner would move nothing.
 */
const { sweepOverdueInvoices } = require('./invoiceLifecycleService');

/** Once an hour. A due date changes at midnight, so anything finer is noise. */
const INTERVAL_MS = 60 * 60 * 1000;

let timer = null;

async function runOnce() {
  try {
    const { moved } = await sweepOverdueInvoices(undefined, {
      actor: { actor_type: 'system', actor_id: null, actor_name: 'overdue sweep' },
    });
    if (moved) console.log(`[overdue] ${moved} invoice(s) moved to overdue`);
    return moved;
  } catch (err) {
    // Never throw out of a worker tick: a failed sweep must not take the process
    // down, and the next tick is an hour away.
    console.error('[overdue] sweep failed:', err.message);
    return 0;
  }
}

function startOverdueInvoiceWorker() {
  if (timer) return timer;
  // A short delay on boot so the sweep does not contend with the schema-ensure
  // pass for the connection pool.
  setTimeout(runOnce, 60 * 1000);
  timer = setInterval(runOnce, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[overdue] invoice overdue sweep started (hourly)');
  return timer;
}

function stopOverdueInvoiceWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startOverdueInvoiceWorker, stopOverdueInvoiceWorker, runOnce, INTERVAL_MS };
