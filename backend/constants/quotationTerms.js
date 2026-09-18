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

module.exports = { QUOTATION_TERMS, QUOTATION_TAX_NOTE };
