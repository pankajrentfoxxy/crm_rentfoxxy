const axios = require('axios');

const DEFAULT_TRACKING_URL = 'https://api.bluedart.com/servlet/RoutingServlet';
const TIMEOUT_MS = 20000;

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(xml || '').match(re);
  return m ? decodeXmlEntities(m[1]) : '';
}

function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'i');
  const m = String(xml || '').match(re);
  if (!m) return '';
  const attrRe = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const am = m[1].match(attrRe);
  return am ? decodeXmlEntities(am[1]) : '';
}

function allBlocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    out.push(m[1]);
  }
  return out;
}

function formatScanTime(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.length >= 6) {
    return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  }
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  return String(raw || '').trim();
}

function parseShipmentXml(xml) {
  const shipmentBlock = tagText(xml, 'Shipment') || xml;
  const scans = allBlocks(shipmentBlock, 'ScanDetail').map((block) => ({
    code: tagText(block, 'ScanCode') || null,
    status: tagText(block, 'Scan') || null,
    group_type: tagText(block, 'ScanGroupType') || null,
    date: tagText(block, 'ScanDate') || null,
    time: formatScanTime(tagText(block, 'ScanTime')),
    location: tagText(block, 'ScannedLocation') || null,
  }));

  const awb =
    tagAttr(xml, 'Shipment', 'WaybillNo') ||
    tagText(shipmentBlock, 'AWBNo') ||
    tagText(shipmentBlock, 'WaybillNo') ||
    null;

  return {
    awb_number: awb,
    status: tagText(shipmentBlock, 'Status') || null,
    status_type: tagText(shipmentBlock, 'StatusType') || null,
    status_date: tagText(shipmentBlock, 'StatusDate') || null,
    status_time: formatScanTime(tagText(shipmentBlock, 'StatusTime')),
    origin: tagText(shipmentBlock, 'Origin') || null,
    destination: tagText(shipmentBlock, 'Destination') || null,
    pickup_date: tagText(shipmentBlock, 'PickUpDate') || null,
    expected_delivery: tagText(shipmentBlock, 'ExpectedDelivery') || null,
    product_code: tagText(shipmentBlock, 'ProductCode') || null,
    service: tagText(shipmentBlock, 'Service') || null,
    weight: tagText(shipmentBlock, 'Weight') || null,
    scans,
  };
}

function getConfig() {
  const loginId = String(process.env.BLUEDART_LOGIN_ID || '').trim();
  const licenseKey = String(process.env.BLUEDART_LICENSE_KEY || '').trim();
  const baseUrl = String(process.env.BLUEDART_TRACKING_URL || DEFAULT_TRACKING_URL).trim();
  const version = String(process.env.BLUEDART_TRACKING_VERSION || '1').trim() || '1';
  return { loginId, licenseKey, baseUrl, version };
}

function isConfigured() {
  const { loginId, licenseKey } = getConfig();
  return Boolean(loginId && licenseKey);
}

/**
 * Track one AWB via BlueDart TNT RoutingServlet (custawbquery XML).
 * Credentials stay server-side (BLUEDART_LOGIN_ID / BLUEDART_LICENSE_KEY).
 */
async function trackAwb(awbNumber) {
  const awb = String(awbNumber || '').trim();
  if (!awb) {
    const err = new Error('AWB number is required');
    err.status = 400;
    throw err;
  }

  const { loginId, licenseKey, baseUrl, version } = getConfig();
  if (!loginId || !licenseKey) {
    const err = new Error('BlueDart tracking is not configured (set BLUEDART_LOGIN_ID and BLUEDART_LICENSE_KEY)');
    err.status = 503;
    throw err;
  }

  const { data: xml } = await axios.get(baseUrl, {
    params: {
      handler: 'tnt',
      action: 'custawbquery',
      loginid: loginId,
      awb: 'awb',
      numbers: awb,
      format: 'xml',
      lickey: licenseKey,
      verno: version,
      scan: '1',
    },
    timeout: TIMEOUT_MS,
    responseType: 'text',
    headers: { Accept: 'application/xml, text/xml, */*' },
    validateStatus: (s) => s >= 200 && s < 500,
  });

  const body = String(xml || '').trim();
  if (!body) {
    const err = new Error('Empty response from BlueDart');
    err.status = 502;
    throw err;
  }

  const shipment = parseShipmentXml(body);
  const statusType = String(shipment.status_type || '').toUpperCase();
  const statusText = String(shipment.status || '');
  const notFound =
    statusType === 'NF' ||
    /incorrect waybill|no information/i.test(statusText);

  return {
    carrier: 'bluedart',
    awb_number: shipment.awb_number || awb,
    found: !notFound,
    ...shipment,
  };
}

module.exports = {
  trackAwb,
  isConfigured,
  parseShipmentXml,
};
