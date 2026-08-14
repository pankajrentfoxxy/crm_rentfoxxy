'use strict';

const axios = require('axios');

const DEFAULT_TRACKING_URL = 'https://api.bluedart.com/servlet/RoutingServlet';
const TIMEOUT_MS = 30000;
const DEFAULT_BATCH_SIZE = 15;

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

function allShipmentNodes(xml) {
  const re = /<Shipment\b[^>]*>[\s\S]*?<\/Shipment>/gi;
  return String(xml || '').match(re) || [];
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
    received_by: tagText(shipmentBlock, 'ReceivedBy') || null,
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

function parseMultiShipmentXml(xml) {
  const nodes = allShipmentNodes(xml);
  if (!nodes.length) {
    const single = parseShipmentXml(xml);
    return single.awb_number || single.status || single.status_type ? [single] : [];
  }
  return nodes.map((node) => parseShipmentXml(node));
}

function isDeliveredShipment(shipment) {
  const type = String(shipment?.status_type || '').trim().toUpperCase();
  const status = String(shipment?.status || '').trim().toUpperCase();
  return type === 'DL' || status.includes('DELIVERED');
}

function getConfig() {
  const loginId = String(process.env.BLUEDART_LOGIN_ID || '').trim();
  const licenseKey = String(process.env.BLUEDART_LICENSE_KEY || '').trim();
  const baseUrl = String(process.env.BLUEDART_TRACKING_URL || DEFAULT_TRACKING_URL).trim();
  const version = String(process.env.BLUEDART_TRACKING_VERSION || '1').trim() || '1';
  const batchSize = Math.min(
    20,
    Math.max(1, parseInt(process.env.BLUEDART_TRACKING_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10) || DEFAULT_BATCH_SIZE)
  );
  return { loginId, licenseKey, baseUrl, version, batchSize };
}

function isConfigured() {
  const { loginId, licenseKey } = getConfig();
  return Boolean(loginId && licenseKey);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Track one or more AWBs via BlueDart TNT RoutingServlet (custawbquery XML).
 * Pass up to ~15–20 AWBs; numbers are sent comma-separated.
 */
async function trackAwbs(awbNumbers) {
  const list = [...new Set(
    (Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers])
      .map((n) => String(n || '').trim())
      .filter(Boolean)
  )];
  if (!list.length) {
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
      numbers: list.join(','),
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

  const shipments = parseMultiShipmentXml(body);
  const byAwb = new Map();
  for (const shipment of shipments) {
    const key = String(shipment.awb_number || '').trim();
    if (!key) continue;
    const statusType = String(shipment.status_type || '').toUpperCase();
    const statusText = String(shipment.status || '');
    const notFound =
      statusType === 'NF' ||
      /incorrect waybill|no information/i.test(statusText);
    byAwb.set(key, {
      carrier: 'bluedart',
      awb_number: key,
      found: !notFound,
      ...shipment,
    });
  }

  // Preserve request order; include missing AWBs as not-found stubs
  return list.map((awb) => {
    if (byAwb.has(awb)) return byAwb.get(awb);
    return {
      carrier: 'bluedart',
      awb_number: awb,
      found: false,
      status: 'No information in response',
      status_type: 'NF',
      status_date: null,
      status_time: null,
      received_by: null,
      scans: [],
    };
  });
}

async function trackAwb(awbNumber) {
  const [one] = await trackAwbs([awbNumber]);
  return one;
}

/**
 * Parse BlueDart StatusDate + StatusTime into a Date (IST wall clock → Date).
 * Accepts DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYYMMDD + HHMM / HH:MM[:SS].
 */
function parseStatusTimestamp(statusDate, statusTime) {
  const dRaw = String(statusDate || '').trim();
  const tRaw = String(statusTime || '').trim();
  if (!dRaw) return null;

  let y;
  let m;
  let day;
  const dmy = dRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  const ymd = dRaw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  const compact = dRaw.replace(/\D/g, '');
  if (dmy) {
    day = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else if (ymd) {
    y = Number(ymd[1]);
    m = Number(ymd[2]);
    day = Number(ymd[3]);
  } else if (compact.length === 8) {
    y = Number(compact.slice(0, 4));
    m = Number(compact.slice(4, 6));
    day = Number(compact.slice(6, 8));
  } else {
    return null;
  }

  let hh = 0;
  let mm = 0;
  let ss = 0;
  const tDigits = tRaw.replace(/\D/g, '');
  if (tDigits.length >= 4) {
    hh = Number(tDigits.slice(0, 2));
    mm = Number(tDigits.slice(2, 4));
    ss = tDigits.length >= 6 ? Number(tDigits.slice(4, 6)) : 0;
  }

  // Interpret as IST (UTC+5:30)
  const utcMs = Date.UTC(y, m - 1, day, hh, mm, ss) - (5.5 * 60 * 60 * 1000);
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

module.exports = {
  trackAwb,
  trackAwbs,
  isConfigured,
  isDeliveredShipment,
  parseShipmentXml,
  parseMultiShipmentXml,
  parseStatusTimestamp,
  getConfig,
  chunk,
};
