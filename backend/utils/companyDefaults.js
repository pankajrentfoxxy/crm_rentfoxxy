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

const GOREFURBO = {
  ...TRUETECH,
  code: 'gorefurbo',
  logo_url: 'assets/gorefurbo-logo.png',
};

function defaultsForCode(code) {
  return code === 'gorefurbo' ? GOREFURBO : TRUETECH;
}

function mergeCompany(row) {
  const code = row?.code === 'gorefurbo' ? 'gorefurbo' : (row?.code || 'rentfoxxy');
  const defaults = defaultsForCode(code);
  if (!row) return { ...defaults };
  return {
    ...defaults,
    ...row,
    code,
    legal_name: row.legal_name || defaults.legal_name,
    email: row.email || defaults.email,
    gstin: row.gstin || defaults.gstin,
    address: row.address || defaults.address,
    logo_url: row.logo_url || defaults.logo_url,
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

module.exports = { TRUETECH, GOREFURBO, mergeCompany, formatCompanyBlock };
