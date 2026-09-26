/**
 * One way to name an Indian state, whatever form it was stored in.
 *
 * Vendor and PO states are stored as names ("Haryana"), slugs ("haryana"),
 * two-letter codes ("HR") or GST state codes ("06"). Comparing them as text
 * treated a Haryana vendor ("HR") delivering to Haryana ("haryana") as
 * inter-state, so the PO charged IGST where CGST+SGST was due.
 */
const STATES = [
  ['01', 'JK', 'jammu_and_kashmir'], ['02', 'HP', 'himachal_pradesh'], ['03', 'PB', 'punjab'],
  ['04', 'CH', 'chandigarh'], ['05', 'UK', 'uttarakhand'], ['06', 'HR', 'haryana'], ['07', 'DL', 'delhi'],
  ['08', 'RJ', 'rajasthan'], ['09', 'UP', 'uttar_pradesh'], ['10', 'BR', 'bihar'], ['11', 'SK', 'sikkim'],
  ['12', 'AR', 'arunachal_pradesh'], ['13', 'NL', 'nagaland'], ['14', 'MN', 'manipur'], ['15', 'MZ', 'mizoram'],
  ['16', 'TR', 'tripura'], ['17', 'ML', 'meghalaya'], ['18', 'AS', 'assam'], ['19', 'WB', 'west_bengal'],
  ['20', 'JH', 'jharkhand'], ['21', 'OD', 'odisha'], ['22', 'CG', 'chhattisgarh'], ['23', 'MP', 'madhya_pradesh'],
  ['24', 'GJ', 'gujarat'], ['26', 'DN', 'dadra_and_nagar_haveli_and_daman_and_diu'], ['27', 'MH', 'maharashtra'],
  ['29', 'KA', 'karnataka'], ['30', 'GA', 'goa'], ['31', 'LD', 'lakshadweep'], ['32', 'KL', 'kerala'],
  ['33', 'TN', 'tamil_nadu'], ['34', 'PY', 'puducherry'], ['35', 'AN', 'andaman_and_nicobar_islands'],
  ['36', 'TS', 'telangana'], ['37', 'AP', 'andhra_pradesh'], ['38', 'LA', 'ladakh'],
];
const ALIASES = {
  or: 'odisha', orissa: 'odisha', ct: 'chhattisgarh', uttaranchal: 'uttarakhand', tg: 'telangana',
  new_delhi: 'delhi', nct_of_delhi: 'delhi', pondicherry: 'puducherry', 'jammu_&_kashmir': 'jammu_and_kashmir',
};
const LOOKUP = new Map();
for (const [num, code, slug] of STATES) {
  LOOKUP.set(num, slug);
  LOOKUP.set(code.toLowerCase(), slug);
  LOOKUP.set(slug, slug);
}
Object.entries(ALIASES).forEach(([k, v]) => LOOKUP.set(k, v));

/** Canonical slug ("haryana"), or the cleaned input when unknown, or '' when empty. */
function canonicalState(s) {
  const k = String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!k) return '';
  return LOOKUP.get(k) || LOOKUP.get(k.replace(/_/g, '')) || k;
}

/** State from a GSTIN's first two digits, or ''. */
function stateFromGstin(gstin) {
  const m = /^(\d{2})[A-Z]/i.exec(String(gstin || '').trim());
  return m ? (LOOKUP.get(m[1]) || '') : '';
}

/** A vendor's state for GST: its GSTIN wins, then its stored state. */
function vendorGstState(vendor) {
  return stateFromGstin(vendor?.gst_number) || canonicalState(vendor?.state);
}

module.exports = { canonicalState, stateFromGstin, vendorGstState };
