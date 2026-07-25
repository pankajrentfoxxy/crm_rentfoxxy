#!/usr/bin/env node
/**
 * DISABLED — bulk fix was reverted on 2026-07-25.
 *
 * Do NOT run without per-unit verification. A return pickup from customer A
 * can pre-date a new outbound DC to customer B; matching only on TTSPL + open
 * in_transit DC produces false positives (e.g. TTSPL4371 / RDC001652 vs DC/26-27/0880).
 *
 * Use manual, case-by-case fixes after Zoho / ticket / DC timeline review.
 */
console.error('This script is disabled. See file header.');
process.exit(1);
