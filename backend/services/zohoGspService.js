/**
 * Zoho GSP Service — E-Invoice (IRN) + E-Way Bill
 */
const axios = require('axios');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const PROD_URL = 'https://gsp.zoho.com/gstin/';

let _tokenCache = { access_token: null, expires_at: 0 };

async function getAccessToken() {
  if (_tokenCache.access_token && Date.now() < _tokenCache.expires_at - 60000) {
    return _tokenCache.access_token;
  }

  const tokenUrl = 'https://accounts.zoho.in/oauth/v2/token';
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ZOHO_GSP_CLIENT_ID,
    client_secret: process.env.ZOHO_GSP_CLIENT_SECRET,
    scope: 'ZohoGSP.invoices.ALL',
  });

  const res = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  _tokenCache.access_token = res.data.access_token;
  _tokenCache.expires_at = Date.now() + (res.data.expires_in || 3600) * 1000;
  return _tokenCache.access_token;
}

function buildEInvoicePayload({
  invoiceNumber, invoiceDate,
  sellerGstin, sellerName, sellerAddress, sellerState, sellerPincode,
  buyerGstin, buyerName, buyerAddress, buyerState, buyerPincode,
  lineItems, totalAmount, cgstAmount, sgstAmount, igstAmount,
  isInterState,
}) {
  const itemList = lineItems.map((item, idx) => ({
    SlNo: String(idx + 1),
    PrdDesc: item.description || `${item.brand} Laptop`,
    IsServc: 'N',
    HsnCd: item.hsn_code || process.env.COMPANY_HSN_CODE || '84713000',
    Qty: item.quantity || 1,
    Unit: 'NOS',
    UnitPrice: parseFloat(item.unit_price || item.rate || 0).toFixed(2),
    TotAmt: parseFloat(item.total_amount || 0).toFixed(2),
    AssAmt: parseFloat(item.taxable_amount || item.total_amount || 0).toFixed(2),
    GstRt: parseFloat(item.gst_rate || 18).toFixed(2),
    CgstAmt: isInterState ? '0.00' : parseFloat((item.taxable_amount || 0) * 0.09).toFixed(2),
    SgstAmt: isInterState ? '0.00' : parseFloat((item.taxable_amount || 0) * 0.09).toFixed(2),
    IgstAmt: isInterState ? parseFloat((item.taxable_amount || 0) * 0.18).toFixed(2) : '0.00',
    TotItemVal: parseFloat(item.total_with_tax || item.total_amount || 0).toFixed(2),
  }));

  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: invoiceNumber, Dt: invoiceDate },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: sellerName,
      TrdNm: sellerName,
      Addr1: sellerAddress,
      Loc: sellerState,
      Pin: parseInt(sellerPincode || '0', 10),
      Stcd: process.env.COMPANY_STATE_CODE || '06',
      Ph: null,
      Em: null,
    },
    BuyerDtls: {
      Gstin: buyerGstin || 'URP',
      LglNm: buyerName,
      TrdNm: buyerName,
      Pos: buyerState || process.env.COMPANY_STATE_CODE || '06',
      Addr1: buyerAddress,
      Loc: buyerState,
      Pin: parseInt(buyerPincode || '0', 10),
      Stcd: buyerState || process.env.COMPANY_STATE_CODE || '06',
      Ph: null,
      Em: null,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: parseFloat(totalAmount).toFixed(2),
      CgstVal: isInterState ? '0.00' : parseFloat(cgstAmount).toFixed(2),
      SgstVal: isInterState ? '0.00' : parseFloat(sgstAmount).toFixed(2),
      IgstVal: isInterState ? parseFloat(igstAmount).toFixed(2) : '0.00',
      TotInvVal: parseFloat(totalAmount + cgstAmount + sgstAmount + igstAmount).toFixed(2),
    },
  };
}

async function generateEInvoice({ dcNumber, customer, lineItems, totalAmount, userId }) {
  const isSandbox = process.env.ZOHO_GSP_SANDBOX !== 'false';

  const invoiceNumber = dcNumber;
  const now = new Date();
  const invoiceDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  const sellerStateCode = process.env.COMPANY_STATE_CODE || '06';
  const buyerGstin = customer.gst_no || customer.gstNo || customer.gst_number || '';
  const buyerStateCode = customer.billing_state_code || customer.billingStateCode || sellerStateCode;
  const isInterState = sellerStateCode !== buyerStateCode;

  const taxableAmount = totalAmount;
  const cgst = isInterState ? 0 : taxableAmount * 0.09;
  const sgst = isInterState ? 0 : taxableAmount * 0.09;
  const igst = isInterState ? taxableAmount * 0.18 : 0;

  const payload = buildEInvoicePayload({
    invoiceNumber,
    invoiceDate,
    sellerGstin: process.env.COMPANY_GSTIN,
    sellerName: process.env.COMPANY_NAME || 'Rentfoxxy Technologies Pvt Ltd',
    sellerAddress: process.env.COMPANY_ADDRESS || '',
    sellerState: sellerStateCode,
    sellerPincode: process.env.COMPANY_PINCODE || '110001',
    buyerGstin,
    buyerName: customer.name || customer.companyName || customer.customer_name || '',
    buyerAddress: customer.billing_address || customer.address || '',
    buyerState: buyerStateCode,
    buyerPincode: customer.billing_pincode || customer.billingPincode || '110001',
    lineItems: lineItems.map((item) => ({
      ...item,
      taxable_amount: (item.rate || 0) * (item.quantity || 1),
      total_amount: (item.rate || 0) * (item.quantity || 1),
      total_with_tax: (item.rate || 0) * (item.quantity || 1) * 1.18,
    })),
    totalAmount: taxableAmount,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    isInterState,
  });

  let irnData;

  if (isSandbox) {
    irnData = {
      Irn: `SANDBOX_IRN_${dcNumber}_${Date.now()}`,
      AckNo: `SANDBOX_ACK_${Date.now()}`,
      AckDt: new Date().toISOString(),
      SignedQRCode: `SANDBOX_QR_${dcNumber}`,
      SignedInvoice: null,
    };
    console.log('[zohoGSP] SANDBOX mode — mock IRN generated for', dcNumber);
  } else {
    const token = await getAccessToken();
    const res = await axios.post(
      `${PROD_URL}einvoice/type/GENERATE/version/V1_03/apiname/EINVOICE`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          gstin: process.env.COMPANY_GSTIN,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!res.data?.Success || !res.data?.Result?.Irn) {
      throw new Error(res.data?.ErrorDetails?.[0]?.ErrorMessage || 'Zoho GSP did not return IRN');
    }
    irnData = res.data.Result;
  }

  let qrCodeUrl = null;
  if (irnData.SignedQRCode) {
    const qrBuffer = await QRCode.toBuffer(irnData.SignedQRCode, { type: 'png', width: 200, margin: 1 });
    const dir = path.join(__dirname, '..', 'uploads', 'einvoice-qr');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `qr_${dcNumber}_${Date.now()}.png`;
    fs.writeFileSync(path.join(dir, filename), qrBuffer);
    qrCodeUrl = `/uploads/einvoice-qr/${filename}`;
  }

  await pool.query(
    `INSERT INTO einvoice_records
      (dc_number, customer_id, invoice_number, irn, ack_number, ack_date,
       signed_qr_code, qr_code_image_url, zoho_response, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     ON CONFLICT (irn) DO NOTHING`,
    [
      dcNumber,
      customer.customer_id || null,
      invoiceNumber,
      irnData.Irn,
      irnData.AckNo || null,
      irnData.AckDt ? new Date(irnData.AckDt) : new Date(),
      irnData.SignedQRCode || null,
      qrCodeUrl,
      JSON.stringify(irnData),
      userId || null,
    ]
  );

  await pool.query(
    `UPDATE delivery_challan_lines
     SET irn = $1, irn_generated_at = NOW(), qr_code_url = $2, updated_at = NOW()
     WHERE dc_number = $3`,
    [irnData.Irn, qrCodeUrl, dcNumber]
  );

  return {
    irn: irnData.Irn,
    ackNumber: irnData.AckNo,
    ackDate: irnData.AckDt,
    qrCodeUrl,
    signedQrCode: irnData.SignedQRCode,
    isSandbox,
  };
}

async function cancelEInvoice({ irn, cancelReason }) {
  const isSandbox = process.env.ZOHO_GSP_SANDBOX !== 'false';

  if (!isSandbox) {
    const token = await getAccessToken();
    await axios.post(
      `${PROD_URL}einvoice/type/CANCEL/version/V1_03/apiname/EINVOICE`,
      { Irn: irn, CnlRsn: '1', CnlRem: cancelReason },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          gstin: process.env.COMPANY_GSTIN,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
  }

  await pool.query(
    `UPDATE einvoice_records
     SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1
     WHERE irn = $2`,
    [cancelReason, irn]
  );

  return { cancelled: true };
}

async function generateEWayBill({ dcNumber, ewbData, userId }) {
  const isSandbox = process.env.ZOHO_GSP_SANDBOX !== 'false';

  let ewbResult;

  if (isSandbox) {
    ewbResult = {
      EwbNo: `SANDBOX_EWB_${dcNumber}_${Date.now()}`,
      EwbDt: new Date().toISOString(),
      EwbValidTill: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
    console.log('[zohoGSP] SANDBOX mode — mock EWB generated for', dcNumber);
  } else {
    const token = await getAccessToken();
    const res = await axios.post(
      `${PROD_URL}ewayapi/type/GENEWAYBILL/version/V1_03/apiname/GENEWAYBILL`,
      ewbData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          gstin: process.env.COMPANY_GSTIN,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!res.data?.Success || !res.data?.Result?.EwbNo) {
      throw new Error(res.data?.ErrorDetails?.[0]?.ErrorMessage || 'Zoho GSP did not return EWB number');
    }
    ewbResult = res.data.Result;
  }

  await pool.query(
    `INSERT INTO eway_bill_records
      (dc_number, ewb_number, ewb_date, valid_upto,
       transporter_name, vehicle_number, distance_km,
       zoho_response, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (ewb_number) DO NOTHING`,
    [
      dcNumber,
      ewbResult.EwbNo,
      ewbResult.EwbDt ? new Date(ewbResult.EwbDt) : new Date(),
      ewbResult.EwbValidTill ? new Date(ewbResult.EwbValidTill) : null,
      ewbData.transporterName || ewbData.transporter_name || null,
      ewbData.vehicleNo || ewbData.vehicle_number || null,
      ewbData.distance || ewbData.distance_km || null,
      JSON.stringify(ewbResult),
      userId || null,
    ]
  );

  await pool.query(
    `UPDATE delivery_challan_lines
     SET eway_bill_number = $1, eway_bill_valid_till = $2, updated_at = NOW()
     WHERE dc_number = $3`,
    [
      ewbResult.EwbNo,
      ewbResult.EwbValidTill ? new Date(ewbResult.EwbValidTill) : null,
      dcNumber,
    ]
  );

  return {
    ewbNumber: ewbResult.EwbNo,
    ewbDate: ewbResult.EwbDt,
    validTill: ewbResult.EwbValidTill,
    isSandbox,
  };
}

module.exports = { generateEInvoice, cancelEInvoice, generateEWayBill };
