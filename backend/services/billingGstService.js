/**
 * Part 6.2 (finding BL7) — the CGST/SGST versus IGST split on billing documents.
 *
 * Billing computed `subtotal * gst_percent / 100` and wrote one number called
 * gst_amount. No place of supply, no split, and no columns to hold one — so
 * every inter-state supply this company has ever invoiced said "GST 18%" where
 * it should have said IGST 18%. That is not a display problem: it decides which
 * government is paid and whether the customer can claim the credit.
 *
 * services/salesManagementService.js has known how to do this since the sales
 * documents were built. computeGstBreakdown and isIntraState take a place of
 * supply and return the split. Billing simply never asked them, and per CLAUDE.md
 * this module is the one that gets it right — so this file asks them rather than
 * hand-rolling a second rate table.
 *
 * Applied as a separate write after the existing gst_amount write, deliberately.
 * The alternative was rewriting seven INSERT and UPDATE statements that each
 * compute totals slightly differently, in a module where a mistake is a wrong
 * invoice. This way gst_amount keeps its existing meaning (the total), the three
 * new columns always sum to it, and the classification is one function.
 */
const pool = require('../config/db');
const { computeGstBreakdown } = require('./salesManagementService');

/** Where the supply is made to, for a customer invoice. */
async function customerPlaceOfSupply(db, customerId) {
  if (!customerId) return null;
  const { rows } = await (db || pool).query(
    `SELECT NULLIF(TRIM(COALESCE(shipping_state, billing_state)), '') AS state
       FROM customers WHERE customer_id = $1`,
    [customerId]
  );
  return rows[0]?.state || null;
}

/** And for a vendor bill, where the vendor supplies from. */
async function vendorPlaceOfSupply(db, vendorId) {
  if (!vendorId) return null;
  const { rows } = await (db || pool).query(
    `SELECT NULLIF(TRIM(COALESCE(state, shipping_state)), '') AS state
       FROM vendors WHERE vendor_id = $1`,
    [vendorId]
  );
  return rows[0]?.state || null;
}

/**
 * Split one GST total into its heads.
 *
 * Returns the three amounts plus the classification, so a caller can persist
 * "we decided this was inter-state, on this place of supply" rather than just a
 * number. `is_intra_state` is the fact worth keeping: a NULL means nobody
 * worked it out, which is what every invoice raised before today is.
 */
function splitGst({ subtotal = 0, gstPercent = 18, supplyState = null }) {
  const b = computeGstBreakdown({
    subtotal: Number(subtotal || 0),
    supplyState: supplyState || '',
    gstRate: Number(gstPercent != null ? gstPercent : 18),
  });
  return {
    cgst: b.cgst,
    sgst: b.sgst,
    igst: b.igst,
    gst_total: b.gst_total,
    is_intra_state: b.gst_type === 'intra',
    place_of_supply: supplyState || null,
  };
}

/**
 * Classify and persist the split for one already-written invoice.
 *
 * Reads the invoice's own subtotal and gst_percent, so it cannot disagree with
 * the row it is describing, and scales the split to the gst_amount actually
 * stored — some paths apply their own rounding, and three heads that do not sum
 * to the total on the document would be worse than no split at all.
 */
async function applyInvoiceGstSplit(db, invoiceId) {
  const client = db || pool;
  const { rows } = await client.query(
    `SELECT invoice_id, customer_id, subtotal, gst_percent, gst_amount
       FROM customer_invoices WHERE invoice_id = $1`,
    [invoiceId]
  );
  const inv = rows[0];
  if (!inv) return null;

  const state = await customerPlaceOfSupply(client, inv.customer_id);
  const split = splitGst({
    subtotal: inv.subtotal,
    gstPercent: inv.gst_percent != null ? inv.gst_percent : 18,
    supplyState: state,
  });

  const stored = Number(inv.gst_amount || 0);
  const scaled = reconcileToStored(split, stored);

  await client.query(
    `UPDATE customer_invoices
        SET cgst_amount = $2, sgst_amount = $3, igst_amount = $4,
            place_of_supply = $5, is_intra_state = $6, updated_at = NOW()
      WHERE invoice_id = $1`,
    [invoiceId, scaled.cgst, scaled.sgst, scaled.igst, split.place_of_supply, split.is_intra_state]
  );
  return { ...split, ...scaled };
}

/** The same for a vendor bill. */
async function applyVendorBillGstSplit(db, billId) {
  const client = db || pool;
  const { rows } = await client.query(
    `SELECT bill_id, vendor_id, subtotal, gst_amount FROM vendor_monthly_bills WHERE bill_id = $1`,
    [billId]
  );
  const bill = rows[0];
  if (!bill) return null;

  const state = await vendorPlaceOfSupply(client, bill.vendor_id);
  const split = splitGst({ subtotal: bill.subtotal, gstPercent: 18, supplyState: state });
  const scaled = reconcileToStored(split, Number(bill.gst_amount || 0));

  await client.query(
    `UPDATE vendor_monthly_bills
        SET cgst_amount = $2, sgst_amount = $3, igst_amount = $4,
            place_of_supply = $5, is_intra_state = $6, updated_at = NOW()
      WHERE bill_id = $1`,
    [billId, scaled.cgst, scaled.sgst, scaled.igst, split.place_of_supply, split.is_intra_state]
  );
  return { ...split, ...scaled };
}

/**
 * Make the three heads sum to the total the document actually carries.
 *
 * The split is computed from subtotal × rate; the stored gst_amount may differ
 * by a paisa or two because a caller rounded differently. The document is the
 * authority, so the heads bend to it — the residue lands on SGST for an
 * intra-state supply, which is the convention every Indian accounting package
 * uses, and on IGST otherwise.
 */
function reconcileToStored(split, storedTotal) {
  const total = +Number(storedTotal || 0).toFixed(2);
  if (!total) return { cgst: 0, sgst: 0, igst: 0 };
  if (split.is_intra_state) {
    const cgst = +(total / 2).toFixed(2);
    return { cgst, sgst: +(total - cgst).toFixed(2), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: total };
}

module.exports = {
  splitGst,
  reconcileToStored,
  customerPlaceOfSupply,
  vendorPlaceOfSupply,
  applyInvoiceGstSplit,
  applyVendorBillGstSplit,
};
