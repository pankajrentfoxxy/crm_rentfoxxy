/**
 * BlueDart GenerateWayBill (API Gateway).
 *
 * Env:
 *   BLUEDART_LOGIN_ID / BLUEDART_LICENSE_KEY  (or BLUEDART_WAYBILL_LICENSE_KEY)
 *   BLUEDART_CUSTOMER_CODE, BLUEDART_ORIGIN_AREA
 *   BLUEDART_SHIPPER_* (name, address, pincode, mobile)
 *   Optional JWT: BLUEDART_CLIENT_ID + BLUEDART_CLIENT_SECRET
 *                 or BLUEDART_JWT_TOKEN
 *   BLUEDART_WAYBILL_URL, BLUEDART_TOKEN_URL, BLUEDART_CANCEL_WAYBILL_URL
 *   BLUEDART_UPDATE_EWAYBILL_URL (UpdateEwayBill)
 *   BLUEDART_SELLER_GST_NO or COMPANY_GSTIN
 *   BLUEDART_PRODUCT_CODE (default A), BLUEDART_SUB_PRODUCT_CODE (default P)
 */
const axios = require('axios');

const DEFAULT_WAYBILL_URL =
  'https://apigateway.bluedart.com/in/transportation/waybill/v1/GenerateWayBill';
const DEFAULT_TOKEN_URL =
  'https://apigateway.bluedart.com/in/transportation/token/v1/login';
const TIMEOUT_MS = 45000;

let cachedJwt = { token: null, expiresAt: 0 };

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function getWaybillConfig() {
  const loginId = env('BLUEDART_LOGIN_ID');
  const licenceKey = env('BLUEDART_WAYBILL_LICENSE_KEY') || env('BLUEDART_LICENSE_KEY');
  return {
    loginId,
    licenceKey,
    customerCode: env('BLUEDART_CUSTOMER_CODE'),
    originArea: env('BLUEDART_ORIGIN_AREA', 'GGN'),
    shipperName: env('BLUEDART_SHIPPER_NAME', 'TRUETECH SERVICES P LTD'),
    shipperAddress: env('BLUEDART_SHIPPER_ADDRESS', 'B-12 OMAXE CITY CENTRE, SOHNA ROAD GURGAON'),
    shipperPincode: env('BLUEDART_SHIPPER_PINCODE', '122018'),
    shipperMobile: env('BLUEDART_SHIPPER_MOBILE', ''),
    productCode: env('BLUEDART_PRODUCT_CODE', 'A'),
    subProductCode: env('BLUEDART_SUB_PRODUCT_CODE', 'P'),
    waybillUrl: env('BLUEDART_WAYBILL_URL', DEFAULT_WAYBILL_URL),
    cancelWaybillUrl: env(
      'BLUEDART_CANCEL_WAYBILL_URL',
      env('BLUEDART_WAYBILL_URL', DEFAULT_WAYBILL_URL).replace(/GenerateWayBill\/?$/i, 'CancelWaybill')
    ),
    updateEwayBillUrl: env(
      'BLUEDART_UPDATE_EWAYBILL_URL',
      env('BLUEDART_WAYBILL_URL', DEFAULT_WAYBILL_URL).replace(/GenerateWayBill\/?$/i, 'UpdateEwayBill')
    ),
    sellerGstNo: env('BLUEDART_SELLER_GST_NO') || env('COMPANY_GSTIN'),
    tokenUrl: env('BLUEDART_TOKEN_URL', DEFAULT_TOKEN_URL),
    clientId: env('BLUEDART_CLIENT_ID'),
    clientSecret: env('BLUEDART_CLIENT_SECRET'),
    staticJwt: env('BLUEDART_JWT_TOKEN'),
  };
}

function isWaybillConfigured() {
  const c = getWaybillConfig();
  return Boolean(
    c.loginId
    && c.licenceKey
    && c.customerCode
    && (c.clientId && c.clientSecret || c.staticJwt)
  );
}

/**
 * BlueDart /Date(ms)/ helper (date-only fields like e-waybill invoice date).
 * Uses noon IST so the calendar day is stable across UTC/IST.
 */
function toDotNetDate(date = new Date()) {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const src = date instanceof Date ? date : new Date(date);
  const d = Number.isNaN(src.getTime()) ? new Date() : src;
  const ist = new Date(d.getTime() + IST_MS);
  const noonUtcMs = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
    12,
    0,
    0
  ) - IST_MS;
  return `/Date(${noonUtcMs})/`;
}

/**
 * Resolve PickupDate + PickupTime for GenerateWayBill.
 *
 * BlueDart often leaves Pickup Date blank on AWBPrintContent when the slot
 * is already in the past. We previously sent UTC midnight + "1530", which is
 * usually already past by afternoon IST — so the label printed blank.
 */
function resolvePickupSlot(servicesIn = {}) {
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const now = new Date();

  let hhmm = String(servicesIn.pickupTime || servicesIn.PickupTime || '1530')
    .replace(/\D/g, '')
    .padStart(4, '0')
    .slice(0, 4);
  if (hhmm.length !== 4) hhmm = '1530';
  let hour = Number(hhmm.slice(0, 2));
  let minute = Number(hhmm.slice(2, 4));
  if (!Number.isFinite(hour) || hour > 23) hour = 15;
  if (!Number.isFinite(minute) || minute > 59) minute = 30;
  hhmm = `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;

  let baseMs = now.getTime();
  const rawDate = servicesIn.pickupDate || servicesIn.PickupDate;
  if (typeof rawDate === 'string' && rawDate.startsWith('/Date(')) {
    const m = rawDate.match(/\/Date\((-?\d+)/);
    if (m) baseMs = Number(m[1]);
  } else if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) baseMs = parsed.getTime();
  }

  const ist = new Date(baseMs + IST_MS);
  let y = ist.getUTCFullYear();
  let mo = ist.getUTCMonth();
  let day = ist.getUTCDate();

  const istWallToUtcMs = (Y, M, D, H, Min) => Date.UTC(Y, M, D, H, Min) - IST_MS;

  let slotMs = istWallToUtcMs(y, mo, day, hour, minute);
  // If slot already passed (or within 5 minutes), use tomorrow same time (IST)
  if (slotMs <= now.getTime() + 5 * 60 * 1000) {
    const next = new Date(Date.UTC(y, mo, day + 1));
    y = next.getUTCFullYear();
    mo = next.getUTCMonth();
    day = next.getUTCDate();
    slotMs = istWallToUtcMs(y, mo, day, hour, minute);
  }

  return {
    pickupDate: `/Date(${slotMs})/`,
    pickupTime: hhmm,
  };
}

function uniqueCreditRef(prefix = 'RFX') {
  // BlueDart: CreditReferenceNo max length 20
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  const base = String(prefix || 'RFX').replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || 'RFX';
  return `${base}${stamp}${rand}`.slice(0, 20);
}

function splitAddress(line, max = 90) {
  const s = String(line || '').trim();
  if (!s) return { a1: '', a2: '', a3: '' };
  if (s.length <= max) return { a1: s, a2: '', a3: '' };
  const a1 = s.slice(0, max);
  const rest = s.slice(max);
  if (rest.length <= max) return { a1, a2: rest, a3: '' };
  return { a1, a2: rest.slice(0, max), a3: rest.slice(max, max * 2) };
}

async function extractTokenFromResponse(data, headers = {}) {
  if (typeof data === 'string' && data.trim().split('.').length === 3) {
    return data.trim();
  }
  if (data && typeof data === 'object') {
    const nested = data.data || data.result || data.Response || data;
    const candidates = [
      data.JWTToken, data.jwtToken, data.JwtToken, data.jwt, data.token,
      data.access_token, data.accessToken, data.Token, data.JWT,
      nested?.JWTToken, nested?.jwtToken, nested?.token, nested?.access_token,
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim()) return c.trim();
    }
    // Some gateways return the JWT as the only string field
    for (const v of Object.values(data)) {
      if (typeof v === 'string' && v.split('.').length === 3) return v.trim();
    }
  }
  const headerToken =
    headers.jwttoken
    || headers.JWTToken
    || headers['jwt-token']
    || headers['x-jwt-token'];
  if (headerToken) return String(headerToken).trim();
  return null;
}

async function fetchJwtToken(cfg) {
  if (cfg.staticJwt) return cfg.staticJwt;
  if (!cfg.clientId || !cfg.clientSecret) {
    const err = new Error(
      'BlueDart JWT credentials missing (set BLUEDART_CLIENT_ID and BLUEDART_CLIENT_SECRET)'
    );
    err.status = 503;
    throw err;
  }

  if (cachedJwt.token && Date.now() < cachedJwt.expiresAt - 60_000) {
    return cachedJwt.token;
  }

  const authHeaders = {
    ClientID: cfg.clientId,
    clientSecret: cfg.clientSecret,
  };

  // Match BlueDart Postman: login with ClientID/clientSecret headers (GET or empty POST)
  let response = await axios.get(cfg.tokenUrl, {
    timeout: TIMEOUT_MS,
    headers: authHeaders,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    response = await axios.post(cfg.tokenUrl, null, {
      timeout: TIMEOUT_MS,
      headers: authHeaders,
      validateStatus: () => true,
    });
  }

  const { data, status, headers } = response;
  const token = await extractTokenFromResponse(data, headers);

  if (!token || status >= 400) {
    const msg =
      (data && (data.message || data.title || data.error || data['error-response']?.[0]?.msg))
      || `BlueDart token HTTP ${status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = 502;
    err.details = data;
    throw err;
  }

  // BlueDart JWT typically ~24h; cache 50 minutes to be safe
  cachedJwt = {
    token: String(token),
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  return cachedJwt.token;
}

/**
 * @param {object} input
 * @param {object} input.consignee - { name, mobile, address, pincode, email?, gst?, attention? }
 * @param {object} [input.services] - overrides weight, declaredValue, pieceCount, creditReferenceNo, dimensions, productCode…
 * @param {string} [input.creditReferenceNo]
 */
async function generateWayBill(input = {}) {
  const cfg = getWaybillConfig();
  if (!isWaybillConfigured()) {
    const err = new Error(
      'BlueDart waybill is not configured (BLUEDART_LOGIN_ID, BLUEDART_LICENSE_KEY/WAYBILL_LICENSE_KEY, BLUEDART_CUSTOMER_CODE)'
    );
    err.status = 503;
    throw err;
  }

  const consignee = input.consignee || {};
  const servicesIn = input.services || {};
  const pin = String(consignee.pincode || '').replace(/\D/g, '').slice(0, 6);
  const mobile = String(consignee.mobile || '').replace(/\D/g, '').slice(-10);
  const name = String(consignee.name || '').trim();
  const address = String(consignee.address || '').trim();

  if (!name) {
    const err = new Error('Consignee name is required');
    err.status = 400;
    throw err;
  }
  if (!address) {
    const err = new Error('Consignee address is required');
    err.status = 400;
    throw err;
  }
  if (pin.length !== 6) {
    const err = new Error('Consignee pincode must be 6 digits');
    err.status = 400;
    throw err;
  }
  if (mobile.length !== 10) {
    const err = new Error('Consignee mobile must be 10 digits');
    err.status = 400;
    throw err;
  }

  const pieceCount = Math.max(1, Number(servicesIn.pieceCount || servicesIn.PieceCount || 1));
  const weight = String(
    servicesIn.actualWeight
      || servicesIn.ActualWeight
      || (2.5 * pieceCount).toFixed(2)
  );
  const declaredRaw = servicesIn.declaredValue ?? servicesIn.DeclaredValue;
  if (declaredRaw == null || declaredRaw === '') {
    const err = new Error('Declared value is required');
    err.status = 400;
    throw err;
  }
  const declaredValue = Number(declaredRaw);
  if (Number.isNaN(declaredValue) || declaredValue <= 0) {
    const err = new Error('Declared value must be a positive number');
    err.status = 400;
    throw err;
  }
  const creditRef = String(
    input.creditReferenceNo
      || servicesIn.creditReferenceNo
      || servicesIn.CreditReferenceNo
      || uniqueCreditRef('RFX')
  ).replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  if (!creditRef) {
    const err = new Error('CreditReferenceNo is required (max 20 chars)');
    err.status = 400;
    throw err;
  }

  const dims = Array.isArray(servicesIn.dimensions) && servicesIn.dimensions.length
    ? servicesIn.dimensions
    : [{ Length: 47, Breadth: 29, Height: 10, Count: pieceCount }];

  const productCode = String(servicesIn.productCode || servicesIn.ProductCode || cfg.productCode || 'A');
  const subProductCode = String(
    servicesIn.subProductCode ?? servicesIn.SubProductCode ?? cfg.subProductCode ?? 'P'
  );

  const cAddr = splitAddress(address);
  const sAddr = splitAddress(cfg.shipperAddress);
  const { pickupDate, pickupTime } = resolvePickupSlot(servicesIn);

  const payload = {
    Request: {
      Consignee: {
        ConsigneeAddress1: cAddr.a1,
        ConsigneeAddress2: cAddr.a2,
        ConsigneeAddress3: cAddr.a3,
        ConsigneeAddressType: consignee.addressType || 'R',
        ConsigneeAttention: consignee.attention || name,
        ConsigneeEmailID: consignee.email || '',
        ConsigneeGSTNumber: consignee.gst || '',
        ConsigneeMobile: mobile,
        ConsigneeName: name,
        ConsigneePincode: pin,
        ConsigneeTelephone: '',
      },
      Returnadds: {
        ReturnAddress1: sAddr.a1,
        ReturnAddress2: sAddr.a2,
        ReturnAddress3: sAddr.a3,
        ReturnContact: cfg.shipperName,
        ReturnEmailID: '',
        ReturnMobile: String(cfg.shipperMobile || '').replace(/\D/g, '').slice(-10),
        ReturnPincode: cfg.shipperPincode,
        ReturnTelephone: '',
      },
      Services: {
        AWBNo: '',
        ActualWeight: weight,
        DeclaredValue: declaredValue,
        Commodity: {},
        CreditReferenceNo: creditRef,
        Dimensions: dims,
        PDFOutputNotRequired: servicesIn.pdfOutputNotRequired === true,
        PackType: '',
        PickupDate: pickupDate,
        PickupTime: pickupTime,
        PieceCount: String(pieceCount),
        ProductCode: productCode,
        ProductType: 0,
        RegisterPickup: false,
        SpecialInstruction: servicesIn.specialInstruction || '',
        SubProductCode: subProductCode,
        OTPBasedDelivery: Number(servicesIn.otpBasedDelivery ?? 0),
        OTPCode: '',
        itemdtl: Array.isArray(servicesIn.itemdtl) && servicesIn.itemdtl.length
          ? servicesIn.itemdtl
          : [
              {
                ItemID: 1,
                ItemName: servicesIn.itemName || 'LAPTOP',
                ProductDesc1: servicesIn.itemName || 'LAPTOP',
                ItemValue: declaredValue,
                ItemQuantity: pieceCount,
              },
            ],
        noOfDCGiven: 0,
      },
      Shipper: {
        CustomerAddress1: sAddr.a1,
        CustomerAddress2: sAddr.a2,
        CustomerAddress3: sAddr.a3,
        CustomerCode: cfg.customerCode,
        CustomerEmailID: '',
        CustomerGSTNumber: '',
        CustomerMobile: String(cfg.shipperMobile || '').replace(/\D/g, '').slice(-10),
        CustomerName: cfg.shipperName,
        CustomerPincode: cfg.shipperPincode,
        CustomerTelephone: '',
        IsToPayCustomer: false,
        OriginArea: cfg.originArea,
        Sender: env('BLUEDART_SENDER', 'TRUETECH'),
        VendorCode: '',
      },
    },
    Profile: {
      Api_type: 'S',
      LicenceKey: cfg.licenceKey,
      LoginID: cfg.loginId,
    },
  };

  const jwt = await fetchJwtToken(cfg);
  if (!jwt) {
    const err = new Error('BlueDart JWT token could not be obtained');
    err.status = 502;
    throw err;
  }
  const headers = {
    'Content-Type': 'application/json',
    JWTToken: jwt,
  };

  const { data, status } = await axios.post(cfg.waybillUrl, payload, {
    timeout: TIMEOUT_MS,
    headers,
    validateStatus: () => true,
  });

  const errorWrap = Array.isArray(data?.['error-response']) ? data['error-response'][0] : null;
  const result = data?.GenerateWayBillResult || data?.generateWayBillResult || errorWrap || data;
  const isError = result?.IsError === true || result?.isError === true || status >= 400;
  const awb = result?.AWBNo || result?.awbNo || result?.AWBNumber || null;
  const statuses = result?.Status || result?.status || [];
  const statusInfo = Array.isArray(statuses)
    ? statuses.map((s) => s.StatusInformation || s.statusInformation || s).filter(Boolean).join('; ')
    : String(statuses || '');

  if (isError || !awb) {
    const err = new Error(
      statusInfo
      || data?.title
      || data?.message
      || `BlueDart GenerateWayBill failed (HTTP ${status})`
    );
    err.status = status >= 400 ? status : 502;
    err.details = data;
    throw err;
  }

  const pdfBuffer = toPdfBuffer(
    result.AWBPrintContent
    || result.AwbPrintContent
    || result.awbPrintContent
    || result.LabelPrintContent
  );

  return {
    awb_number: String(awb),
    credit_reference_no: result.CCRCRDREF || creditRef,
    destination_area: result.DestinationArea || null,
    destination_location: result.DestinationLocation || null,
    cluster_code: result.ClusterCode || null,
    mps_details: result.MPSDetails || null,
    status_information: statusInfo || 'Waybill Generation Successful',
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    pdf_buffer: pdfBuffer,
    raw: result,
  };
}

/** Normalize BlueDart AWBPrintContent (byte array / base64 / Buffer) to a PDF Buffer. */
function toPdfBuffer(content) {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content;
  if (Array.isArray(content)) return Buffer.from(content);
  if (content?.type === 'Buffer' && Array.isArray(content.data)) return Buffer.from(content.data);
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return null;
    // Heuristic: raw PDF vs base64
    if (trimmed.startsWith('%PDF')) return Buffer.from(trimmed, 'utf8');
    try {
      return Buffer.from(trimmed, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Persist waybill label PDF under uploads/bluedart/.
 * @returns {string|null} relative path from backend root (e.g. uploads/bluedart/waybill_xxx.pdf)
 */
function saveWaybillPdf(awbNumber, pdfBuffer) {
  if (!pdfBuffer || !pdfBuffer.length) return null;
  const fs = require('fs');
  const path = require('path');
  const safeAwb = String(awbNumber || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const dir = path.join(__dirname, '..', 'uploads', 'bluedart');
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `waybill_${safeAwb}_${Date.now()}.pdf`;
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, pdfBuffer);
  return `uploads/bluedart/${fileName}`;
}

/**
 * Cancel an existing BlueDart AWB.
 * @param {string} awbNo
 */
async function cancelWayBill(awbNo) {
  const cfg = getWaybillConfig();
  if (!isWaybillConfigured()) {
    const err = new Error(
      'BlueDart waybill is not configured (BLUEDART_LOGIN_ID, licence key, customer code, ClientID/Secret)'
    );
    err.status = 503;
    throw err;
  }

  const awb = String(awbNo || '').trim();
  if (!awb) {
    const err = new Error('AWB number is required to cancel');
    err.status = 400;
    throw err;
  }

  const jwt = await fetchJwtToken(cfg);
  if (!jwt) {
    const err = new Error('BlueDart JWT token could not be obtained');
    err.status = 502;
    throw err;
  }

  const payload = {
    Request: { AWBNo: awb },
    Profile: {
      LoginID: cfg.loginId,
      Api_type: 'S',
      LicenceKey: cfg.licenceKey,
    },
  };

  const { data, status } = await axios.post(cfg.cancelWaybillUrl, payload, {
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      JWTToken: jwt,
    },
    validateStatus: () => true,
  });

  const errorWrap = Array.isArray(data?.['error-response']) ? data['error-response'][0] : null;
  const result = data?.CancelWaybillResult
    || data?.CancelWayBillResult
    || data?.cancelWaybillResult
    || errorWrap
    || data;
  const isError = result?.IsError === true || result?.isError === true || status >= 400;
  const statuses = result?.Status || result?.status || [];
  const statusInfo = Array.isArray(statuses)
    ? statuses.map((s) => s.StatusInformation || s.statusInformation || s).filter(Boolean).join('; ')
    : String(statuses || '');

  if (isError) {
    const err = new Error(
      statusInfo
      || data?.title
      || data?.message
      || `BlueDart CancelWaybill failed (HTTP ${status})`
    );
    err.status = status >= 400 ? status : 502;
    err.details = data;
    throw err;
  }

  return {
    awb_number: awb,
    status_information: statusInfo || 'Waybill cancelled successfully',
    raw: result,
  };
}

/**
 * Attach / update e-Way Bill details on an existing BlueDart AWB (UpdateEwayBill).
 * @param {object} input
 * @param {string} input.awbNumber
 * @param {string} input.eWaybillNumber
 * @param {string|Date|number} [input.eWaybillDate]
 * @param {string} input.invoiceNumber
 * @param {string|Date|number} [input.invoiceDate]
 * @param {string} [input.sellerGstNo]
 */
async function updateEwayBill(input = {}) {
  const cfg = getWaybillConfig();
  if (!isWaybillConfigured()) {
    const err = new Error(
      'BlueDart waybill is not configured (BLUEDART_LOGIN_ID, licence key, customer code, ClientID/Secret)'
    );
    err.status = 503;
    throw err;
  }

  const awb = String(input.awbNumber || input.Waybillnumber || '').trim();
  const ewbNo = String(input.eWaybillNumber || input.ewayBillNumber || '').trim();
  const invoiceNumber = String(input.invoiceNumber || input.InvoiceNumber || '').trim();
  const sellerGst = String(input.sellerGstNo || input.SellerGSTNo || cfg.sellerGstNo || '').trim();

  if (!awb) {
    const err = new Error('Waybill / AWB number is required');
    err.status = 400;
    throw err;
  }
  if (!ewbNo) {
    const err = new Error('e-Way Bill number is required');
    err.status = 400;
    throw err;
  }
  if (!invoiceNumber) {
    const err = new Error('Invoice number is required');
    err.status = 400;
    throw err;
  }
  if (!sellerGst) {
    const err = new Error('Seller GST is required (set BLUEDART_SELLER_GST_NO or COMPANY_GSTIN)');
    err.status = 400;
    throw err;
  }

  const toDate = (v) => {
    if (v == null || v === '') return toDotNetDate(new Date());
    if (typeof v === 'string' && v.startsWith('/Date(')) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return toDotNetDate(new Date());
    return `/Date(${d.getTime()})/`;
  };

  const jwt = await fetchJwtToken(cfg);
  if (!jwt) {
    const err = new Error('BlueDart JWT token could not be obtained');
    err.status = 502;
    throw err;
  }

  const payload = {
    ERequest: {
      InvoiceDate: toDate(input.invoiceDate || input.InvoiceDate),
      InvoiceNumber: invoiceNumber,
      SellerGSTNo: sellerGst,
      Waybillnumber: awb,
      eWaybillDate: toDate(input.eWaybillDate || input.ewayBillDate),
      eWaybillNumber: ewbNo,
    },
    Profile: {
      Api_type: 'S',
      LicenceKey: cfg.licenceKey,
      LoginID: cfg.loginId,
    },
  };

  const { data, status } = await axios.post(cfg.updateEwayBillUrl, payload, {
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      JWTToken: jwt,
    },
    validateStatus: () => true,
  });

  const errorWrap = Array.isArray(data?.['error-response']) ? data['error-response'][0] : null;
  const result = data?.UpdateEwayBillResult
    || data?.UpdateEWayBillResult
    || data?.updateEwayBillResult
    || errorWrap
    || data;
  const isError = result?.IsError === true || result?.isError === true || status >= 400;
  const statuses = result?.Status || result?.status || [];
  const statusInfo = Array.isArray(statuses)
    ? statuses.map((s) => s.StatusInformation || s.statusInformation || s).filter(Boolean).join('; ')
    : String(statuses || '');

  if (isError) {
    const err = new Error(
      statusInfo
      || data?.title
      || data?.message
      || `BlueDart UpdateEwayBill failed (HTTP ${status})`
    );
    err.status = status >= 400 ? status : 502;
    err.details = data;
    throw err;
  }

  return {
    awb_number: awb,
    eway_bill_number: ewbNo,
    invoice_number: invoiceNumber,
    status_information: statusInfo || 'E-Way Bill updated on BlueDart waybill',
    raw: result,
  };
}

module.exports = {
  isWaybillConfigured,
  generateWayBill,
  cancelWayBill,
  updateEwayBill,
  uniqueCreditRef,
  toDotNetDate,
  resolvePickupSlot,
  getWaybillConfig,
  toPdfBuffer,
  saveWaybillPdf,
};
