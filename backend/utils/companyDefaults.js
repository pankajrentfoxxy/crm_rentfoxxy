/** Default TRUETECH / Rentfoxxy seller details when DB row is missing fields. */
const TRUETECH = {
  code: 'rentfoxxy',
  legal_name: 'TRUETECH SERVICES PRIVATE LIMITED',
  email: 'accounts@truetechservices.in',
  gstin: '06AAHCT0310N1ZG',
  address: '429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06',
  state_code: '06',
  logo_url: 'assets/rentfoxxy-logo.png',
};

function mergeCompany(row) {
  if (!row) return { ...TRUETECH };
  return {
    ...TRUETECH,
    ...row,
    legal_name: row.legal_name || TRUETECH.legal_name,
    email: row.email || TRUETECH.email,
    gstin: row.gstin || TRUETECH.gstin,
    address: row.address || TRUETECH.address,
    logo_url: row.logo_url || TRUETECH.logo_url,
  };
}

function formatCompanyBlock(company) {
  const co = mergeCompany(company);
  const lines = [co.legal_name];
  if (co.email) lines.push(`Email: ${co.email}`);
  if (co.gstin) lines.push(`GSTIN: ${co.gstin}`);
  if (co.address) lines.push(`Address: ${co.address}`);
  return lines.join('\n');
}

module.exports = { TRUETECH, mergeCompany, formatCompanyBlock };
