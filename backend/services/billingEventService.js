/**
 * Part 6.2 (finding BL11) — billing writes to the event spine.
 *
 * The audit's line was: "Zero audit rows from either billing controller. For the
 * one module where every action is a financial fact, there is no trail."
 *
 * Generation, send, mark-paid, payment recording, credit-note approval,
 * vendor-bill approval, debit-note approval and cancellation all wrote nothing.
 * So there was no way to answer "who sent this invoice", "who approved this
 * bill", or "why was this one cancelled" — the last of which mattered most,
 * because cancellation was a direct UPDATE against the database (BL13).
 *
 * This is a thin wrapper over eventService, not a second audit system. The
 * events table from Part 2.1 is the one trail; billing is simply joining it, and
 * the invoice timeline in Part 6.4 reads it back.
 */
const { recordEvent, ENTITY } = require('./eventService');

/** Vendor bills are not invoices, and a shared entity type would merge two
 *  timelines that belong to different counterparties. */
const VENDOR_BILL = 'vendor_bill';
const CREDIT_NOTE = 'credit_note';

/**
 * One invoice event.
 *
 * `db` is the caller's client when there is a transaction, so the event commits
 * with the change it describes. recordEvent never throws: a failure to record
 * history must not fail a financial action that already succeeded.
 */
function invoiceEvent(db, {
  invoiceId, invoiceNumber, eventType, fromState = null, toState = null,
  payload = {}, actor = null, correlationId = null, source,
}) {
  return recordEvent(db, {
    entityType: ENTITY.INVOICE,
    entityId: invoiceId,
    entityRef: invoiceNumber || null,
    eventType,
    fromState,
    toState,
    payload,
    correlationId,
    source: source || 'billing',
    actor,
  });
}

function vendorBillEvent(db, {
  billId, billNumber, eventType, fromState = null, toState = null,
  payload = {}, actor = null, correlationId = null, source,
}) {
  return recordEvent(db, {
    entityType: VENDOR_BILL,
    entityId: billId,
    entityRef: billNumber || null,
    eventType,
    fromState,
    toState,
    payload,
    correlationId,
    source: source || 'billing',
    actor,
  });
}

function creditNoteEvent(db, {
  creditNoteId, creditNoteNumber, eventType, fromState = null, toState = null,
  payload = {}, actor = null, correlationId = null, source,
}) {
  return recordEvent(db, {
    entityType: CREDIT_NOTE,
    entityId: creditNoteId,
    entityRef: creditNoteNumber || null,
    eventType,
    fromState,
    toState,
    payload,
    correlationId,
    source: source || 'billing',
    actor,
  });
}

/** The vocabulary, in one place, so a typo cannot create a second timeline. */
const BILLING_EVENTS = Object.freeze({
  INVOICE_GENERATED: 'invoice_generated',
  INVOICE_SENT: 'invoice_sent',
  INVOICE_PAID: 'invoice_paid',
  INVOICE_PAYMENT_RECORDED: 'invoice_payment_recorded',
  INVOICE_OVERDUE: 'invoice_overdue',
  INVOICE_CANCELLED: 'invoice_cancelled',
  BILL_GENERATED: 'vendor_bill_generated',
  BILL_APPROVED: 'vendor_bill_approved',
  BILL_PAID: 'vendor_bill_paid',
  BILL_PAYMENT_RECORDED: 'vendor_bill_payment_recorded',
  BILL_CANCELLED: 'vendor_bill_cancelled',
  CREDIT_NOTE_CREATED: 'credit_note_created',
  CREDIT_NOTE_APPROVED: 'credit_note_approved',
});

module.exports = {
  VENDOR_BILL,
  CREDIT_NOTE,
  BILLING_EVENTS,
  invoiceEvent,
  vendorBillEvent,
  creditNoteEvent,
};
