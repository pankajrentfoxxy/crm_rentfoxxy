'use strict';

/**
 * Quotation terms — shown on the quotation PDF and in the quotation email, so
 * they live in one place rather than drifting between the two.
 */
const QUOTATION_TERMS = [
  '1. The quotation is valid for 10 days from the date of issuance.',
  '2. Delivery within 3-4 working days after order confirmation.',
  '3. In case of damage or non-return by employees, rent continues until full payment or recovery.',
  '4. Hidden damages will be assessed upon technical inspection after return.',
  '5. Clients will be updated on every item post-return.',
  '6. All rented equipment remains the property of Rentfoxxy.',
  '7. All disputes are subject to the jurisdiction of Gurgaon courts only.',
];

/** Printed above the terms; the quoted rates never include GST. */
const QUOTATION_TAX_NOTE = 'Note: Prices are exclusive of taxes.';

/**
 * The terms for one quotation. When it carries its own validity date, term 1
 * states that date instead of the generic "10 days", so the PDF never says two
 * different things about how long the offer stands.
 * validTill: an already-formatted date string, or null.
 */
function quotationTermsFor(validTill) {
  if (!validTill) return QUOTATION_TERMS;
  return QUOTATION_TERMS.map((t) => (/^1\.\s.*valid for/i.test(t) ? `1. The quotation is valid until ${validTill}.` : t));
}

module.exports = { QUOTATION_TERMS, QUOTATION_TAX_NOTE, quotationTermsFor };
