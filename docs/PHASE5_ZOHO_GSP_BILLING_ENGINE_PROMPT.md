# RENTFOXXY CRM — PHASE 5 BUILD PROMPT
## Zoho GSP (E-Invoice + E-Way Bill) + Billing Engine (Customer + Vendor)
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Extend existing code only. Do NOT rewrite working controllers or routes.
- `node-cron` and `qrcode` are NOT in package.json yet — install them:
  `cd backend && npm install node-cron qrcode`
- `recharts` may be needed in frontend — it is already in the master prompt
  as an allowed dependency. Install if not present:
  `cd frontend && npm install recharts`
- Zoho GSP integration uses SANDBOX by default (`ZOHO_GSP_SANDBOX=true`).
  All API calls must check this env var and use the correct base URL.
- The billing scheduler uses `node-cron`. Start it inside `server.js`
  ONLY after the DB pool is ready (after the existing schema ensure calls).
- Naming conventions (DO NOT change):
  - Invoice number prefix: `INV-` (from `sm_document_sequences`)
  - Credit note prefix: `CN-`
  - Vendor bill prefix: `VB-`
  - Debit note prefix: `DN-`
  - Permission sections: `customer_billing`, `vendor_billing_mgmt`,
    `credit_notes`, `debit_notes`, `einvoice_ewb`, `security_deposits`
  - Feature folders:
    `frontend/src/features/customer-billing/`
    `frontend/src/features/vendor-billing/`
    `frontend/src/features/finance-overview/`
- Design system: same as all previous phases

---

## SECTION 1 — INSTALL DEPENDENCIES

```bash
# Backend
cd backend
npm install node-cron qrcode

# Frontend
cd frontend
npm install recharts
```

---

## SECTION 2 — DATABASE MIGRATIONS

### Migration `067_phase5_billing_engine.sql`

```sql
-- Phase 5: Customer billing engine, e-invoice tracking,
-- credit/debit notes, security deposits

-- 1. Customer monthly invoices
CREATE TABLE IF NOT EXISTS customer_invoices (
  invoice_id        SERIAL PRIMARY KEY,
  invoice_number    VARCHAR(50) NOT NULL UNIQUE,
  customer_id       INT NOT NULL REFERENCES customers(customer_id),
  invoice_month     INT NOT NULL CHECK (invoice_month BETWEEN 1 AND 12),
  invoice_year      INT NOT NULL,
  invoice_date      DATE NOT NULL,
  from_date         DATE NOT NULL,
  to_date           DATE NOT NULL,
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          NUMERIC(12,2) DEFAULT 0,
  gst_percent       NUMERIC(5,2)  DEFAULT 18,
  gst_amount        NUMERIC(12,2) DEFAULT 0,
  credit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  security_deposit  NUMERIC(12,2) DEFAULT 0,
  grand_total       NUMERIC(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  irn               VARCHAR(100),
  irn_generated_at  TIMESTAMPTZ,
  qr_code_url       TEXT,
  signed_qr_code    TEXT,
  eway_bill_number  VARCHAR(50),
  eway_bill_valid_till TIMESTAMPTZ,
  pdf_path          TEXT,
  sent_at           TIMESTAMPTZ,
  sent_by           INT REFERENCES users(user_id),
  paid_at           TIMESTAMPTZ,
  payment_reference VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, invoice_month, invoice_year)
);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer
  ON customer_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_status
  ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_month_year
  ON customer_invoices(invoice_year, invoice_month);

-- 2. Customer credit notes
CREATE TABLE IF NOT EXISTS customer_credit_notes (
  credit_note_id     SERIAL PRIMARY KEY,
  credit_note_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  invoice_id         INT REFERENCES customer_invoices(invoice_id),
  reason             VARCHAR(255) NOT NULL,
  description        TEXT,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity           INT DEFAULT 0,
  unit_rate          NUMERIC(12,2) DEFAULT 0,
  from_date          DATE,
  to_date            DATE,
  ttspl_ids          JSONB DEFAULT '[]',
  status             VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','cancelled')),
  applied_in_invoice_id INT REFERENCES customer_invoices(invoice_id),
  created_by         INT REFERENCES users(user_id),
  approved_by        INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer
  ON customer_credit_notes(customer_id);

-- 3. Customer security deposits
CREATE TABLE IF NOT EXISTS customer_security_deposits (
  deposit_id         SERIAL PRIMARY KEY,
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  sales_order_number VARCHAR(50),
  amount             NUMERIC(12,2) NOT NULL,
  received_date      DATE NOT NULL,
  status             VARCHAR(20) DEFAULT 'held'
    CHECK (status IN ('held','partially_refunded','refunded','adjusted')),
  refund_amount      NUMERIC(12,2) DEFAULT 0,
  refund_date        DATE,
  refund_reference   VARCHAR(100),
  notes              TEXT,
  created_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. E-Invoice records (Zoho GSP responses)
CREATE TABLE IF NOT EXISTS einvoice_records (
  record_id          SERIAL PRIMARY KEY,
  dc_number          VARCHAR(50) NOT NULL,
  invoice_id         INT REFERENCES customer_invoices(invoice_id),
  customer_id        INT REFERENCES customers(customer_id),
  invoice_number     VARCHAR(50),
  irn                VARCHAR(100) UNIQUE,
  ack_number         VARCHAR(100),
  ack_date           TIMESTAMPTZ,
  signed_invoice     TEXT,
  signed_qr_code     TEXT,
  qr_code_image_url  TEXT,
  status             VARCHAR(20) DEFAULT 'generated'
    CHECK (status IN ('generated','cancelled')),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      VARCHAR(255),
  zoho_response      JSONB,
  generated_by       INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_einvoice_dc
  ON einvoice_records(dc_number);

-- 5. E-Way Bill records
CREATE TABLE IF NOT EXISTS eway_bill_records (
  record_id          SERIAL PRIMARY KEY,
  dc_number          VARCHAR(50) NOT NULL,
  ewb_number         VARCHAR(50) UNIQUE,
  ewb_date           TIMESTAMPTZ,
  valid_upto         TIMESTAMPTZ,
  transporter_id     VARCHAR(50),
  transporter_name   VARCHAR(100),
  vehicle_number     VARCHAR(20),
  mode_of_transport  VARCHAR(20) DEFAULT 'road',
  distance_km        INT,
  status             VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active','extended','cancelled')),
  zoho_response      JSONB,
  generated_by       INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Add document sequences for billing
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('customer_invoice', 0, 'INV-'),
  ('credit_note',      0, 'CN-')
ON CONFLICT (doc_type) DO NOTHING;

-- 7. New permission sections for Phase 5
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('customer_billing',    'Customer Billing & Invoices',    200),
  ('vendor_billing_mgmt', 'Vendor Billing Management',      201),
  ('credit_notes',        'Customer Credit Notes',          202),
  ('debit_notes',         'Vendor Debit Notes',             203),
  ('security_deposits',   'Security Deposits',              204),
  ('billing_dashboard',   'Billing Dashboard & Reports',    205)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 8. Role permissions for Phase 5 sections
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'customer_billing',    TRUE,TRUE,TRUE,TRUE),
  ('manager', 'customer_billing',    TRUE,TRUE,TRUE,FALSE),
  ('accounts','customer_billing',    TRUE,TRUE,TRUE,FALSE),
  ('sales',   'customer_billing',    TRUE,FALSE,FALSE,FALSE),
  ('admin',   'vendor_billing_mgmt', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'vendor_billing_mgmt', TRUE,TRUE,TRUE,FALSE),
  ('accounts','vendor_billing_mgmt', TRUE,TRUE,TRUE,FALSE),
  ('admin',   'credit_notes',        TRUE,TRUE,TRUE,TRUE),
  ('manager', 'credit_notes',        TRUE,TRUE,TRUE,FALSE),
  ('accounts','credit_notes',        TRUE,TRUE,FALSE,FALSE),
  ('admin',   'debit_notes',         TRUE,TRUE,TRUE,TRUE),
  ('manager', 'debit_notes',         TRUE,TRUE,TRUE,FALSE),
  ('accounts','debit_notes',         TRUE,TRUE,FALSE,FALSE),
  ('admin',   'security_deposits',   TRUE,TRUE,TRUE,TRUE),
  ('manager', 'security_deposits',   TRUE,TRUE,TRUE,FALSE),
  ('accounts','security_deposits',   TRUE,TRUE,TRUE,FALSE),
  ('admin',   'billing_dashboard',   TRUE,FALSE,FALSE,FALSE),
  ('manager', 'billing_dashboard',   TRUE,FALSE,FALSE,FALSE),
  ('accounts','billing_dashboard',   TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 3 — BACKEND: ZOHO GSP SERVICE

### 3.1 Create `backend/services/zohoGspService.js`

This is the core integration file. Build it completely.

```javascript
/**
 * Zoho GSP Service — E-Invoice (IRN) + E-Way Bill
 *
 * Env vars required:
 *   ZOHO_GSP_CLIENT_ID
 *   ZOHO_GSP_CLIENT_SECRET
 *   ZOHO_GSP_USERNAME
 *   ZOHO_GSP_PASSWORD
 *   COMPANY_GSTIN          (e.g. "06AAHCT0310N1ZG")
 *   COMPANY_NAME           (e.g. "Rentfoxxy Technologies Pvt Ltd")
 *   COMPANY_ADDRESS
 *   COMPANY_STATE_CODE     (e.g. "06" for Haryana)
 *   COMPANY_HSN_CODE       (default "84713000" for laptops)
 *   ZOHO_GSP_SANDBOX       ("true" = sandbox, "false" = production)
 */

const axios = require('axios');
const QRCode = require('qrcode');
const pool = require('../config/db');

// Base URLs
const SANDBOX_URL = 'https://gsp.zoho.com/gstin/';
const PROD_URL    = 'https://gsp.zoho.com/gstin/';
// Note: Zoho GSP uses same domain; sandbox vs prod is controlled by credentials

// Token cache (in-memory, resets on server restart)
let _tokenCache = { access_token: null, expires_at: 0 };

/**
 * Get or refresh Zoho GSP OAuth2 access token.
 * Zoho GSP uses client_credentials grant.
 */
async function getAccessToken() {
  if (_tokenCache.access_token && Date.now() < _tokenCache.expires_at - 60000) {
    return _tokenCache.access_token;
  }

  const isSandbox = process.env.ZOHO_GSP_SANDBOX === 'true';
  const tokenUrl = isSandbox
    ? 'https://accounts.zoho.in/oauth/v2/token'
    : 'https://accounts.zoho.in/oauth/v2/token';

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.ZOHO_GSP_CLIENT_ID,
    client_secret: process.env.ZOHO_GSP_CLIENT_SECRET,
    scope:         'ZohoGSP.invoices.ALL',
  });

  const res = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  _tokenCache.access_token = res.data.access_token;
  _tokenCache.expires_at = Date.now() + (res.data.expires_in || 3600) * 1000;
  return _tokenCache.access_token;
}

/**
 * Build e-invoice payload from DC + customer data.
 * Follows GST e-invoice JSON schema 1.1
 */
function buildEInvoicePayload({ dcNumber, invoiceNumber, invoiceDate,
  sellerGstin, sellerName, sellerAddress, sellerState, sellerPincode,
  buyerGstin, buyerName, buyerAddress, buyerState, buyerPincode,
  lineItems, totalAmount, cgstAmount, sgstAmount, igstAmount,
  isInterState }) {

  const itemList = lineItems.map((item, idx) => ({
    SlNo: String(idx + 1),
    PrdDesc: item.description || `${item.brand} Laptop`,
    IsServc: 'N',
    HsnCd: item.hsn_code || process.env.COMPANY_HSN_CODE || '84713000',
    Qty: item.quantity || 1,
    Unit: 'NOS',
    UnitPrice: parseFloat(item.unit_price || item.rate || 0).toFixed(2),
    TotAmt:  parseFloat(item.total_amount || 0).toFixed(2),
    AssAmt:  parseFloat(item.taxable_amount || item.total_amount || 0).toFixed(2),
    GstRt: parseFloat(item.gst_rate || 18).toFixed(2),
    CgstAmt: isInterState ? '0.00' :
      parseFloat((item.taxable_amount || 0) * 0.09).toFixed(2),
    SgstAmt: isInterState ? '0.00' :
      parseFloat((item.taxable_amount || 0) * 0.09).toFixed(2),
    IgstAmt: isInterState ?
      parseFloat((item.taxable_amount || 0) * 0.18).toFixed(2) : '0.00',
    TotItemVal: parseFloat(item.total_with_tax || item.total_amount || 0).toFixed(2),
  }));

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: 'B2B',
      RegRev: 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: 'INV',
      No:  invoiceNumber,
      Dt:  invoiceDate, // DD/MM/YYYY
    },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: sellerName,
      TrdNm: sellerName,
      Addr1: sellerAddress,
      Loc:   sellerState,
      Pin:   parseInt(sellerPincode || '0'),
      Stcd:  process.env.COMPANY_STATE_CODE || '06',
      Ph:    null,
      Em:    null,
    },
    BuyerDtls: {
      Gstin: buyerGstin || 'URP',
      LglNm: buyerName,
      TrdNm: buyerName,
      Pos:   buyerState || process.env.COMPANY_STATE_CODE || '06',
      Addr1: buyerAddress,
      Loc:   buyerState,
      Pin:   parseInt(buyerPincode || '0'),
      Stcd:  buyerState || process.env.COMPANY_STATE_CODE || '06',
      Ph:    null,
      Em:    null,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal:  parseFloat(totalAmount).toFixed(2),
      CgstVal: isInterState ? '0.00' : parseFloat(cgstAmount).toFixed(2),
      SgstVal: isInterState ? '0.00' : parseFloat(sgstAmount).toFixed(2),
      IgstVal: isInterState ? parseFloat(igstAmount).toFixed(2) : '0.00',
      TotInvVal: parseFloat(totalAmount + cgstAmount + sgstAmount + igstAmount).toFixed(2),
    },
  };
}

/**
 * Generate E-Invoice (get IRN from Zoho GSP).
 * Stores result in einvoice_records and updates delivery_challan_lines.
 *
 * @param {object} params
 * @param {string} params.dcNumber
 * @param {object} params.customer  — { name, gst_no, billing_address, ... }
 * @param {Array}  params.lineItems — [{ brand, qty, rate, hsn_code, ... }]
 * @param {number} params.totalAmount
 * @param {number} params.userId
 * @returns {{ irn, ackNumber, ackDate, qrCodeUrl }}
 */
async function generateEInvoice({ dcNumber, customer, lineItems,
  totalAmount, userId }) {

  const isSandbox = process.env.ZOHO_GSP_SANDBOX === 'true';

  // Build invoice number from DC number
  const invoiceNumber = dcNumber;
  const now = new Date();
  const invoiceDate = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

  const sellerStateCode = process.env.COMPANY_STATE_CODE || '06';
  const buyerGstin = customer.gst_no || customer.gstNo || '';
  const buyerStateCode = customer.billing_state_code
    || customer.billingStateCode
    || sellerStateCode;
  const isInterState = sellerStateCode !== buyerStateCode;

  const gstRate = 18;
  const taxableAmount = totalAmount;
  const cgst = isInterState ? 0 : taxableAmount * 0.09;
  const sgst = isInterState ? 0 : taxableAmount * 0.09;
  const igst = isInterState ? taxableAmount * 0.18 : 0;

  const payload = buildEInvoicePayload({
    dcNumber,
    invoiceNumber,
    invoiceDate,
    sellerGstin:  process.env.COMPANY_GSTIN,
    sellerName:   process.env.COMPANY_NAME || 'Rentfoxxy Technologies Pvt Ltd',
    sellerAddress: process.env.COMPANY_ADDRESS || '',
    sellerState:  sellerStateCode,
    sellerPincode: process.env.COMPANY_PINCODE || '110001',
    buyerGstin,
    buyerName:    customer.name || customer.companyName || '',
    buyerAddress: customer.billing_address || customer.address || '',
    buyerState:   buyerStateCode,
    buyerPincode: customer.billing_pincode || customer.billingPincode || '110001',
    lineItems: lineItems.map((item) => ({
      ...item,
      taxable_amount: (item.rate || 0) * (item.quantity || 1),
      total_amount:   (item.rate || 0) * (item.quantity || 1),
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
    // Sandbox mode: return mock data so dev can test without real GSP calls
    irnData = {
      Irn:      `SANDBOX_IRN_${dcNumber}_${Date.now()}`,
      AckNo:    `SANDBOX_ACK_${Date.now()}`,
      AckDt:    new Date().toISOString(),
      SignedQRCode: `SANDBOX_QR_${dcNumber}`,
      SignedInvoice: null,
    };
    console.log('[zohoGSP] SANDBOX mode — mock IRN generated for', dcNumber);
  } else {
    // Production: call Zoho GSP API
    const token = await getAccessToken();
    const baseUrl = PROD_URL;

    const res = await axios.post(
      `${baseUrl}einvoice/type/GENERATE/version/V1_03/apiname/EINVOICE`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'gstin': process.env.COMPANY_GSTIN,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!res.data?.Success || !res.data?.Result?.Irn) {
      throw new Error(
        res.data?.ErrorDetails?.[0]?.ErrorMessage
        || 'Zoho GSP did not return IRN'
      );
    }
    irnData = res.data.Result;
  }

  // Generate QR code image from SignedQRCode
  let qrCodeUrl = null;
  if (irnData.SignedQRCode) {
    const qrBuffer = await QRCode.toBuffer(irnData.SignedQRCode, {
      type: 'png', width: 200, margin: 1
    });
    // Save to uploads/einvoice-qr/
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'uploads', 'einvoice-qr');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `qr_${dcNumber}_${Date.now()}.png`;
    fs.writeFileSync(path.join(dir, filename), qrBuffer);
    qrCodeUrl = `/uploads/einvoice-qr/${filename}`;
  }

  // Store in DB
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

  // Update delivery_challan_lines with IRN
  await pool.query(
    `UPDATE delivery_challan_lines
     SET irn = $1, irn_generated_at = NOW(), qr_code_url = $2, updated_at = NOW()
     WHERE dc_number = $3`,
    [irnData.Irn, qrCodeUrl, dcNumber]
  );

  return {
    irn:       irnData.Irn,
    ackNumber: irnData.AckNo,
    ackDate:   irnData.AckDt,
    qrCodeUrl,
    signedQrCode: irnData.SignedQRCode,
    isSandbox,
  };
}

/**
 * Cancel an E-Invoice (IRN).
 */
async function cancelEInvoice({ irn, cancelReason, userId }) {
  const isSandbox = process.env.ZOHO_GSP_SANDBOX === 'true';

  if (!isSandbox) {
    const token = await getAccessToken();
    await axios.post(
      `${PROD_URL}einvoice/type/CANCEL/version/V1_03/apiname/EINVOICE`,
      { Irn: irn, CnlRsn: '1', CnlRem: cancelReason },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'gstin': process.env.COMPANY_GSTIN,
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

/**
 * Generate E-Way Bill via Zoho GSP.
 */
async function generateEWayBill({ dcNumber, ewbData, userId }) {
  const isSandbox = process.env.ZOHO_GSP_SANDBOX === 'true';

  let ewbResult;

  if (isSandbox) {
    ewbResult = {
      EwbNo:   `SANDBOX_EWB_${dcNumber}_${Date.now()}`,
      EwbDt:   new Date().toISOString(),
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
          'Authorization': `Bearer ${token}`,
          'gstin': process.env.COMPANY_GSTIN,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!res.data?.Success || !res.data?.Result?.EwbNo) {
      throw new Error(
        res.data?.ErrorDetails?.[0]?.ErrorMessage
        || 'Zoho GSP did not return EWB number'
      );
    }
    ewbResult = res.data.Result;
  }

  // Store in DB
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
      ewbData.transporterName || null,
      ewbData.vehicleNo || null,
      ewbData.distance || null,
      JSON.stringify(ewbResult),
      userId || null,
    ]
  );

  // Update delivery_challan_lines
  await pool.query(
    `UPDATE delivery_challan_lines
     SET eway_bill_number = $1, eway_bill_valid_till = $2, updated_at = NOW()
     WHERE dc_number = $3`,
    [ewbResult.EwbNo, ewbResult.EwbValidTill
      ? new Date(ewbResult.EwbValidTill) : null, dcNumber]
  );

  return {
    ewbNumber: ewbResult.EwbNo,
    ewbDate:   ewbResult.EwbDt,
    validTill: ewbResult.EwbValidTill,
    isSandbox,
  };
}

module.exports = { generateEInvoice, cancelEInvoice, generateEWayBill };
```

---

## SECTION 4 — BACKEND: BILLING ENGINE

### 4.1 Create `backend/services/billingSchedulerService.js`

```javascript
/**
 * Billing Scheduler
 * - Runs at 00:01 on 1st of every month → auto-generates customer invoice drafts
 * - Runs at 23:59 on last day of every month → auto-generates vendor bills
 *
 * Invoices are created as DRAFT. Accounts team sends them manually.
 * This service does NOT send any emails.
 */
const cron = require('node-cron');
const pool = require('../config/db');

// ── Helpers ─────────────────────────────────────────────────────────────────

async function nextInvoiceNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'customer_invoice'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

async function nextVendorBillNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'vendor_bill'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

// ── Customer Invoice Generation ──────────────────────────────────────────────

/**
 * Generate monthly invoice for ONE customer.
 * Called by cron on 1st of month OR manually from the billing controller.
 *
 * Logic:
 * 1. Find all delivery_challan_lines with status='delivered' for this customer
 *    where quotation_type = 'rental'
 * 2. For each laptop (serial): calculate days in the month
 *    from MAX(dispatch_date, month_start) to MIN(return_date, month_end)
 * 3. daily_rate = monthly_rate / days_in_month
 * 4. Amount = daily_rate × days
 * 5. Subtract approved credit notes not yet applied
 * 6. Create customer_invoices record with status='draft'
 */
async function generateCustomerInvoice(customerId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0); // last day of month

  // Check if already generated
  const existing = await pool.query(
    `SELECT invoice_id FROM customer_invoices
     WHERE customer_id = $1 AND invoice_month = $2 AND invoice_year = $3`,
    [customerId, month, year]
  );
  if (existing.rows.length) {
    return { skipped: true, invoice_id: existing.rows[0].invoice_id };
  }

  // Get all active rental serials for this customer
  const serialsRes = await pool.query(
    `SELECT DISTINCT
       dcl.serial_number,
       dcl.dc_number,
       dcl.brand,
       dcl.model_name,
       dcl.delivered_at,
       dcl.status AS dc_status,
       vsn.ttspl_id,
       vsn.serial_id,
       sol.rate
     FROM delivery_challan_lines dcl
     LEFT JOIN vendor_serial_numbers vsn
       ON vsn.serial_number = (dcl.serial_number::jsonb->>0)
       OR vsn.ttspl_id = (dcl.serial_number::jsonb->>0)
     LEFT JOIN sales_order_lines sol
       ON sol.sales_order_number = dcl.sales_order_number
      AND sol.brand = dcl.brand
     WHERE dcl.customer_id = $1
       AND dcl.status IN ('delivered','in_transit')
       AND (dcl.quotation_type = 'rental' OR dcl.quotation_type IS NULL)
     ORDER BY dcl.delivered_at`,
    [customerId]
  );

  if (!serialsRes.rows.length) {
    return { skipped: true, reason: 'No active rental laptops' };
  }

  const daysInMonth = monthEnd.getDate();
  const lineItems = [];
  let subtotal = 0;

  for (const row of serialsRes.rows) {
    const dispatchDate = row.delivered_at ? new Date(row.delivered_at) : monthStart;
    const effectiveStart = dispatchDate > monthStart ? dispatchDate : monthStart;
    const effectiveEnd = monthEnd;

    // Calculate days
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1,
      Math.round((effectiveEnd - effectiveStart) / msPerDay) + 1
    );

    const monthlyRate = parseFloat(row.rate || 0);
    const dailyRate = monthlyRate / daysInMonth;
    const amount = parseFloat((dailyRate * days).toFixed(2));

    subtotal += amount;
    lineItems.push({
      ttspl_id:       row.ttspl_id || null,
      serial_number:  row.serial_number,
      dc_number:      row.dc_number,
      brand:          row.brand || '',
      model:          row.model_name || '',
      dispatch_date:  effectiveStart.toISOString().slice(0, 10),
      days_in_month:  days,
      monthly_rate:   monthlyRate,
      daily_rate:     parseFloat(dailyRate.toFixed(2)),
      amount,
    });
  }

  // Get approved credit notes not yet applied
  const cnRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_cn
     FROM customer_credit_notes
     WHERE customer_id = $1 AND status = 'approved'
       AND applied_in_invoice_id IS NULL`,
    [customerId]
  );
  const creditAdjustment = parseFloat(cnRes.rows[0].total_cn || 0);

  const gstPercent = 18;
  const gstAmount = parseFloat((subtotal * gstPercent / 100).toFixed(2));
  const grandTotal = Math.max(0,
    parseFloat((subtotal + gstAmount - creditAdjustment).toFixed(2))
  );

  const invoiceNumber = await nextInvoiceNumber();

  const insertRes = await pool.query(
    `INSERT INTO customer_invoices
      (invoice_number, customer_id, invoice_month, invoice_year,
       invoice_date, from_date, to_date, line_items,
       subtotal, gst_percent, gst_amount,
       credit_note_adjustment, grand_total, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,'draft')
     RETURNING invoice_id`,
    [
      invoiceNumber,
      customerId,
      month,
      year,
      new Date().toISOString().slice(0, 10),
      monthStart.toISOString().slice(0, 10),
      monthEnd.toISOString().slice(0, 10),
      JSON.stringify(lineItems),
      subtotal.toFixed(2),
      gstPercent,
      gstAmount,
      creditAdjustment.toFixed(2),
      grandTotal,
    ]
  );

  // Mark credit notes as applied to this invoice
  if (creditAdjustment > 0) {
    await pool.query(
      `UPDATE customer_credit_notes
       SET applied_in_invoice_id = $1, status = 'applied', updated_at = NOW()
       WHERE customer_id = $2 AND status = 'approved'
         AND applied_in_invoice_id IS NULL`,
      [insertRes.rows[0].invoice_id, customerId]
    );
  }

  console.log(`[billing] Generated invoice ${invoiceNumber} for customer ${customerId}`);
  return { invoice_id: insertRes.rows[0].invoice_id, invoice_number: invoiceNumber };
}

/**
 * Generate invoices for ALL active rental customers.
 * Called by cron on 1st of month.
 */
async function generateAllCustomerInvoices(month, year) {
  const customersRes = await pool.query(
    `SELECT DISTINCT customer_id
     FROM delivery_challan_lines
     WHERE status IN ('delivered','in_transit')
       AND customer_id IS NOT NULL`
  );

  const results = [];
  for (const row of customersRes.rows) {
    try {
      const result = await generateCustomerInvoice(row.customer_id, month, year);
      results.push({ customer_id: row.customer_id, ...result });
    } catch (err) {
      console.error(`[billing] Error generating invoice for customer ${row.customer_id}:`, err.message);
      results.push({ customer_id: row.customer_id, error: err.message });
    }
  }

  console.log(`[billing] Monthly invoice run complete: ${results.length} customers processed`);
  return results;
}

// ── Vendor Bill Generation ───────────────────────────────────────────────────

/**
 * Generate monthly vendor bill for ONE vendor.
 * Called by cron on last day of month OR manually.
 *
 * Logic:
 * 1. Find all vendor_serial_numbers for this vendor with
 *    po_type IN ('rental_purchase','rent_to_own') and received_at IS NOT NULL
 * 2. For each serial: calculate days in month
 *    from MAX(received_at, month_start) to MIN(returned_at, month_end)
 * 3. Amount = daily_rate × days (daily_rate = monthly_rate / days_in_month)
 * 4. Subtract approved debit notes
 * 5. Create vendor_monthly_bills with status='generated'
 */
async function generateVendorBill(vendorId, month, year) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);

  const existing = await pool.query(
    `SELECT bill_id FROM vendor_monthly_bills
     WHERE vendor_id = $1 AND bill_month = $2 AND bill_year = $3`,
    [vendorId, month, year]
  );
  if (existing.rows.length) {
    return { skipped: true, bill_id: existing.rows[0].bill_id };
  }

  const serialsRes = await pool.query(
    `SELECT vsn.serial_id, vsn.ttspl_id, vsn.serial_number,
            vsn.inventory_status, vsn.received_at, vsn.returned_at,
            vpo.rental_monthly_rate, vpo.po_type
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vsn.vendor_id = $1
       AND vpo.po_type IN ('rental_purchase','rent_to_own')
       AND vsn.received_at IS NOT NULL
       AND vsn.received_at <= $2`,
    [vendorId, monthEnd.toISOString()]
  );

  if (!serialsRes.rows.length) {
    return { skipped: true, reason: 'No rental serials' };
  }

  const daysInMonth = monthEnd.getDate();
  const lineItems = [];
  let subtotal = 0;

  for (const row of serialsRes.rows) {
    const receivedAt  = new Date(row.received_at);
    const returnedAt  = row.returned_at ? new Date(row.returned_at) : null;

    const effectiveStart = receivedAt > monthStart ? receivedAt : monthStart;
    const effectiveEnd   = (returnedAt && returnedAt < monthEnd)
      ? returnedAt : monthEnd;

    if (effectiveStart > effectiveEnd) continue; // not active this month

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1,
      Math.round((effectiveEnd - effectiveStart) / msPerDay) + 1
    );

    const monthlyRate = parseFloat(row.rental_monthly_rate || 0);
    const dailyRate = monthlyRate / daysInMonth;
    const amount = parseFloat((dailyRate * days).toFixed(2));

    subtotal += amount;
    lineItems.push({
      serial_id:     row.serial_id,
      ttspl_id:      row.ttspl_id || null,
      serial_number: row.serial_number,
      received_date: receivedAt.toISOString().slice(0, 10),
      return_date:   returnedAt ? returnedAt.toISOString().slice(0, 10) : null,
      days_in_month: days,
      monthly_rate:  monthlyRate,
      daily_rate:    parseFloat(dailyRate.toFixed(2)),
      amount,
    });
  }

  if (!lineItems.length) {
    return { skipped: true, reason: 'No active serials in this month' };
  }

  // Approved debit notes
  const dnRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_dn
     FROM vendor_debit_notes
     WHERE vendor_id = $1 AND status = 'approved'
       AND adjusted_in_bill_id IS NULL`,
    [vendorId]
  );
  const debitAdjustment = parseFloat(dnRes.rows[0].total_dn || 0);

  const gstAmount = parseFloat((subtotal * 0.18).toFixed(2));
  const totalPayable = Math.max(0,
    parseFloat((subtotal + gstAmount - debitAdjustment).toFixed(2))
  );

  const billNumber = await nextVendorBillNumber();

  const insertRes = await pool.query(
    `INSERT INTO vendor_monthly_bills
      (bill_number, vendor_id, bill_month, bill_year,
       bill_date, from_date, to_date, line_items,
       subtotal, gst_amount, debit_note_adjustment, total_payable, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,'generated')
     RETURNING bill_id`,
    [
      billNumber, vendorId, month, year,
      new Date().toISOString().slice(0, 10),
      monthStart.toISOString().slice(0, 10),
      monthEnd.toISOString().slice(0, 10),
      JSON.stringify(lineItems),
      subtotal.toFixed(2), gstAmount, debitAdjustment.toFixed(2), totalPayable,
    ]
  );

  // Mark debit notes as adjusted
  if (debitAdjustment > 0) {
    await pool.query(
      `UPDATE vendor_debit_notes
       SET adjusted_in_bill_id = $1, status = 'adjusted', updated_at = NOW()
       WHERE vendor_id = $2 AND status = 'approved'
         AND adjusted_in_bill_id IS NULL`,
      [insertRes.rows[0].bill_id, vendorId]
    );
  }

  console.log(`[billing] Generated vendor bill ${billNumber} for vendor ${vendorId}`);
  return { bill_id: insertRes.rows[0].bill_id, bill_number: billNumber };
}

async function generateAllVendorBills(month, year) {
  const vendorsRes = await pool.query(
    `SELECT DISTINCT vsn.vendor_id
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vpo.po_type IN ('rental_purchase','rent_to_own')
       AND vsn.received_at IS NOT NULL`
  );

  const results = [];
  for (const row of vendorsRes.rows) {
    try {
      const result = await generateVendorBill(row.vendor_id, month, year);
      results.push({ vendor_id: row.vendor_id, ...result });
    } catch (err) {
      console.error(`[billing] Error generating bill for vendor ${row.vendor_id}:`, err.message);
      results.push({ vendor_id: row.vendor_id, error: err.message });
    }
  }
  return results;
}

// ── Cron Scheduler ───────────────────────────────────────────────────────────

function startBillingScheduler() {
  // 1st of every month at 00:01 — generate customer invoices
  cron.schedule('1 0 1 * *', async () => {
    const now = new Date();
    const month = now.getMonth() + 1; // current month (invoicing for previous month)
    const year  = now.getFullYear();
    // Invoice for PREVIOUS month
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    console.log(`[billing] CRON: generating customer invoices for ${prevMonth}/${prevYear}`);
    await generateAllCustomerInvoices(prevMonth, prevYear);
  }, { timezone: 'Asia/Kolkata' });

  // Last day of every month at 23:59 — generate vendor bills
  cron.schedule('59 23 28-31 * *', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Only run on actual last day of month
    if (tomorrow.getMonth() !== now.getMonth()) {
      const month = now.getMonth() + 1;
      const year  = now.getFullYear();
      console.log(`[billing] CRON: generating vendor bills for ${month}/${year}`);
      await generateAllVendorBills(month, year);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[billing] Scheduler started (customer: 1st 00:01 IST, vendor: last day 23:59 IST)');
}

module.exports = {
  startBillingScheduler,
  generateCustomerInvoice,
  generateAllCustomerInvoices,
  generateVendorBill,
  generateAllVendorBills,
};
```

### 4.2 Update `backend/server.js`

Add after the existing schema ensure calls:

```javascript
const { startBillingScheduler } = require('./services/billingSchedulerService');
// ... inside the startup async block, after all ensureSchema calls:
startBillingScheduler();
```

Also add new routes:
```javascript
app.use('/api/customer-billing',  require('./routes/customerBilling'));
app.use('/api/vendor-billing',    require('./routes/vendorBilling'));
app.use('/api/einvoice',          require('./routes/einvoice'));
app.use('/api/finance-overview',  require('./routes/financeOverview'));
```

### 4.3 Create `backend/controllers/customerBillingController.js`

Export these functions:

```
listInvoices         GET  /api/customer-billing/invoices
  params: customer_id, month, year, status, page, limit
  Returns paginated list with summary totals

getInvoice           GET  /api/customer-billing/invoices/:invoiceId
  Returns full invoice with line items

generateInvoice      POST /api/customer-billing/invoices/generate
  body: { customer_id, month, year }
  Calls generateCustomerInvoice() from billingSchedulerService
  Returns created invoice

sendInvoice          POST /api/customer-billing/invoices/:id/send
  body: { to_email, cc_emails: [] }
  Generates PDF (PDFKit), emails it via nodemailer
  Updates invoice status to 'sent', sets sent_at, sent_by

markPaid             PATCH /api/customer-billing/invoices/:id/paid
  body: { payment_reference }
  Sets status='paid', paid_at=NOW(), payment_reference

listCreditNotes      GET  /api/customer-billing/credit-notes
  params: customer_id, status

createCreditNote     POST /api/customer-billing/credit-notes
  body: { customer_id, invoice_id?, reason, description, amount,
          quantity?, unit_rate?, from_date, to_date, ttspl_ids: [] }

approveCreditNote    PATCH /api/customer-billing/credit-notes/:id/approve
  Sets status='approved', approved_by

listSecurityDeposits GET  /api/customer-billing/security-deposits
  params: customer_id, status

recordSecurityDeposit POST /api/customer-billing/security-deposits
  body: { customer_id, sales_order_number, amount, received_date, notes }

refundSecurityDeposit PATCH /api/customer-billing/security-deposits/:id/refund
  body: { refund_amount, refund_reference }
```

### 4.4 Create `backend/controllers/einvoiceController.js`

```
generateDcEInvoice   POST /api/einvoice/dc/:dcNumber/generate
  1. Fetch DC details + customer + line items
  2. Call zohoGspService.generateEInvoice()
  3. Return { irn, ackNumber, qrCodeUrl, isSandbox }
  Role: accounts, admin

cancelDcEInvoice     POST /api/einvoice/dc/:dcNumber/cancel
  body: { reason }
  Calls zohoGspService.cancelEInvoice()
  Role: accounts, admin

generateDcEWayBill   POST /api/einvoice/dc/:dcNumber/ewb
  body: { transporter_name, vehicle_number, distance_km, mode_of_transport }
  Calls zohoGspService.generateEWayBill()
  Returns { ewbNumber, validTill, isSandbox }
  Role: accounts, dispatch, admin

getDcEInvoiceStatus  GET  /api/einvoice/dc/:dcNumber/status
  Returns current IRN + QR code URL + EWB number for a DC
  Role: all internal

sendEInvoiceEmail    POST /api/einvoice/dc/:dcNumber/send-email
  body: { to_email, cc_emails: [] }
  Sends email with IRN, QR code image attachment, DC PDF
  Updates delivery_challan_lines.invoice_sent_at
  Role: accounts, admin
```

### 4.5 Create `backend/controllers/vendorBillingController.js`

```
listVendorBills      GET  /api/vendor-billing/bills
  params: vendor_id, month, year, status, page, limit

getVendorBill        GET  /api/vendor-billing/bills/:billId
  Returns bill with full line items

generateVendorBill   POST /api/vendor-billing/bills/generate
  body: { vendor_id, month, year }
  Calls generateVendorBill() from billingSchedulerService

approveVendorBill    PATCH /api/vendor-billing/bills/:id/approve
  Sets status='approved', approved_by

markVendorBillPaid   PATCH /api/vendor-billing/bills/:id/paid
  body: { payment_reference, payment_date }

listDebitNotes       GET  /api/vendor-billing/debit-notes
  params: vendor_id, status

createDebitNote      POST /api/vendor-billing/debit-notes
  body: { vendor_id, po_id?, reason, description, amount,
          quantity, unit_rate, ttspl_ids: [] }

approveDebitNote     PATCH /api/vendor-billing/debit-notes/:id/approve
```

### 4.6 Create `backend/controllers/financeOverviewController.js`

```
getDashboard         GET  /api/finance-overview/dashboard
  Returns:
  {
    customer_invoices: {
      draft: { count, total_value },
      sent_unpaid: { count, total_value, oldest_date },
      paid_this_month: { count, total_value },
      overdue: { count, total_value }
    },
    vendor_bills: {
      pending_approval: { count, total_value },
      approved_unpaid: { count, total_value },
      paid_this_month: { count, total_value }
    },
    credit_notes_pending: { count, total_value },
    debit_notes_pending: { count, total_value },
    einvoice_queue: count   // DCs delivered but no IRN
  }

getEinvoiceQueue     GET  /api/finance-overview/einvoice-queue
  Returns delivery_challan_lines WHERE status='delivered'
  AND irn IS NULL AND quotation_type='sale'
  Role: accounts, admin
```

### 4.7 Create route files

`backend/routes/customerBilling.js` — wire all customer billing endpoints
`backend/routes/einvoice.js` — wire all e-invoice endpoints
`backend/routes/vendorBilling.js` — wire all vendor billing endpoints
`backend/routes/financeOverview.js` — wire finance overview endpoints

All routes: `router.use(authMiddleware)` + appropriate `checkRole` per endpoint.

### 4.8 Add env vars to `.env.example`

```bash
# Zoho GSP
ZOHO_GSP_CLIENT_ID=
ZOHO_GSP_CLIENT_SECRET=
ZOHO_GSP_USERNAME=
ZOHO_GSP_PASSWORD=
ZOHO_GSP_SANDBOX=true
COMPANY_GSTIN=
COMPANY_NAME=Rentfoxxy Technologies Pvt Ltd
COMPANY_ADDRESS=
COMPANY_STATE_CODE=06
COMPANY_PINCODE=
COMPANY_HSN_CODE=84713000
```

---

## SECTION 5 — FRONTEND: CUSTOMER BILLING

### 5.1 New feature: `frontend/src/features/customer-billing/`

```
customer-billing/
  CustomerBillingApp.jsx
  customerBillingApi.js
  pages/
    InvoiceListPage.jsx
    InvoiceDetailPage.jsx
    CreditNotesPage.jsx
    SecurityDepositsPage.jsx
  components/
    InvoiceStatusBadge.jsx
    CreditNoteForm.jsx
    SendInvoiceModal.jsx
    SecurityDepositForm.jsx
```

### 5.2 `customerBillingApi.js`

```javascript
const base = '/api/customer-billing';
const einvBase = '/api/einvoice';

export const listInvoices = (p) => api.get(`${base}/invoices`, { params: p });
export const getInvoice = (id) => api.get(`${base}/invoices/${id}`);
export const generateInvoice = (d) => api.post(`${base}/invoices/generate`, d);
export const sendInvoice = (id, d) => api.post(`${base}/invoices/${id}/send`, d);
export const markInvoicePaid = (id, d) => api.patch(`${base}/invoices/${id}/paid`, d);
export const listCreditNotes = (p) => api.get(`${base}/credit-notes`, { params: p });
export const createCreditNote = (d) => api.post(`${base}/credit-notes`, d);
export const approveCreditNote = (id) => api.patch(`${base}/credit-notes/${id}/approve`);
export const listSecurityDeposits = (p) => api.get(`${base}/security-deposits`, { params: p });
export const recordSecurityDeposit = (d) => api.post(`${base}/security-deposits`, d);
export const refundSecurityDeposit = (id, d) => api.patch(`${base}/security-deposits/${id}/refund`, d);

// E-Invoice
export const generateEInvoice = (dcNumber) =>
  api.post(`${einvBase}/dc/${dcNumber}/generate`);
export const generateEWayBill = (dcNumber, d) =>
  api.post(`${einvBase}/dc/${dcNumber}/ewb`, d);
export const getDcEInvoiceStatus = (dcNumber) =>
  api.get(`${einvBase}/dc/${dcNumber}/status`);
export const sendEInvoiceEmail = (dcNumber, d) =>
  api.post(`${einvBase}/dc/${dcNumber}/send-email`, d);
export const cancelEInvoice = (dcNumber, d) =>
  api.post(`${einvBase}/dc/${dcNumber}/cancel`, d);
```

### 5.3 `InvoiceListPage.jsx`

**Route:** `/customer-billing/invoices`

**Header:**
- Title "Customer Invoices" | subtitle "INV-* series"
- Stats row (5 cards):
  Draft | Sent (Unpaid) | Paid | Overdue | Total Outstanding (₹)
- `+ Generate Invoice` button (opens generate modal)

**Filter bar:** Customer dropdown | Month | Year | Status

**Status tabs:** All | Draft | Sent | Paid | Overdue

**Table columns:**
Invoice # | Month | Customer | Laptops | Subtotal | GST | Credit Adj | Total | Status | IRN | Actions

- IRN column: green "✓ IRN" if set, gray "-" if not
- Actions per row:
  - View (always)
  - Send (if draft or sent + accounts role)
  - Generate E-Invoice (if no IRN + accounts/admin role)
  - Mark Paid (if sent + accounts role)
  - Download PDF

### 5.4 `InvoiceDetailPage.jsx`

**Route:** `/customer-billing/invoices/:id`

**Header:** Invoice number | Customer | Month | Status badge | Actions row

**Two-column layout:**

Left (65%) — Invoice content:
```
Invoice Header:
  INV-XXXX | Date | Period: 1 Jun – 30 Jun 2026

Line Items table:
  TTSPL ID | Brand | Config | Dispatch Date | Days | Daily Rate | Amount
  (each row = one laptop for the month)

Summary box:
  Subtotal:               ₹ XX,XXX
  GST 18%:                ₹  X,XXX
  Credit Note (CN-003):  -₹    XXX   ← show credit note numbers
  Grand Total:            ₹ XX,XXX
  
  Status: [badge]
  Paid: [date + reference if paid]
```

Actions (role-based):
- `Send to Customer` → opens SendInvoiceModal
- `Generate E-Invoice` → calls API, shows IRN result
- `Generate E-Way Bill` → opens EWB form modal
- `Mark as Paid` → payment reference input
- `Download PDF` → triggers PDF generation

Right sidebar (35%):
```
Customer Info:
  Name | GST | Billing Address

E-Invoice Status:
  IRN: [value or Not generated]
  QR Code: [image if available]
  [Generate E-Invoice] button
  [Send E-Invoice Email] button

E-Way Bill:
  EWB#: [value or Not generated]
  Valid till: [datetime]
  [Generate E-Way Bill] button

Payment:
  [Mark as Paid] button
```

### 5.5 `CreditNotesPage.jsx`

**Route:** `/customer-billing/credit-notes`

**Header:** Title "Credit Notes" | `+ Create Credit Note` button

**Table:** CN # | Customer | Invoice | Reason | TTSPL IDs | Amount | Status | Actions
- Status: Pending (amber) | Approved (blue) | Applied (green) | Cancelled (red)
- Actions: Approve (manager/admin) | View | Cancel

**Create Credit Note form (drawer):**
```
Customer*: dropdown
Related Invoice: optional dropdown (customer's invoices)
Reason*: text input
Description: textarea
TTSPL IDs involved: multi-select from customer's active laptops
From Date | To Date (return period)
Quantity | Unit Rate
Amount: (auto-calculated if dates+rate provided, or manual)
[Cancel] [Create Credit Note]
```

### 5.6 `SecurityDepositsPage.jsx`

**Route:** `/customer-billing/security-deposits`

**Table:** Customer | SO # | Amount | Received Date | Status | Refund Amount | Actions
- Actions: Refund (partial/full) | View | Adjust

**Record Security Deposit form:**
```
Customer* | Sales Order # | Amount* | Received Date* | Notes
```

---

## SECTION 6 — FRONTEND: VENDOR BILLING

### 6.1 New feature: `frontend/src/features/vendor-billing/`

```
vendor-billing/
  VendorBillingApp.jsx
  vendorBillingApi.js
  pages/
    VendorBillListPage.jsx
    VendorBillDetailPage.jsx
    DebitNotesPage.jsx
  components/
    VendorBillStatusBadge.jsx
    DebitNoteForm.jsx
```

### 6.2 `VendorBillListPage.jsx`

**Route:** `/vendor-billing/bills`

**Header:** "Vendor Bills" | subtitle "VB-* series"
**Stats:** Generated | Approved | Paid | Total Payable (₹)
**Filter:** Vendor | Month | Year | Status

**Table:**
Bill # | Month | Vendor | Units | Subtotal | Debit Adj | Total Payable | Status | Actions

Actions: View | Approve (manager/admin) | Mark Paid | Download

### 6.3 `VendorBillDetailPage.jsx`

**Route:** `/vendor-billing/bills/:billId`

Line items table: TTSPL ID | Brand | Config | Received Date | Return Date | Days | Rate | Amount
Summary: Subtotal | GST | Debit Adjustments | Total Payable
Actions: Approve | Mark Paid | Download PDF

### 6.4 `DebitNotesPage.jsx`

**Route:** `/vendor-billing/debit-notes`

Table: DN # | Vendor | PO | TTSPL IDs | Reason | Amount | Status | Actions
Create Debit Note drawer:
```
Vendor* | Related PO (optional)
Reason* | Description
Number of units | Unit Rate | Total Amount
TTSPL IDs (multi-select — faulty serials from this vendor)
[Create Debit Note]
```
Approve flow: same as credit notes

---

## SECTION 7 — FRONTEND: FINANCE OVERVIEW

### 7.1 New feature: `frontend/src/features/finance-overview/`

```
finance-overview/
  FinanceOverviewApp.jsx
  pages/
    FinanceDashboardPage.jsx
    EInvoiceQueuePage.jsx
```

### 7.2 `FinanceDashboardPage.jsx`

**Route:** `/finance/dashboard`

Accessible only to accounts, manager, admin.

**Dashboard widgets (using recharts):**

Row 1 — KPI cards:
```
[Draft Invoices: X (₹X,XX,XXX)]
[Sent Unpaid: X (₹X,XX,XXX)]
[Overdue: X (₹X,XX,XXX)]
[Vendor Bills Due: X (₹X,XX,XXX)]
```

Row 2 — Two charts side by side:
- Left: Bar chart — Monthly revenue collected (last 6 months) using recharts BarChart
- Right: Pie chart — Invoice status distribution (Draft/Sent/Paid/Overdue)

Row 3 — Action queues:
- "E-Invoice Queue": DCs delivered but no IRN — table with [Generate] button per row
- "Pending Credit Notes": list awaiting approval — [Approve] button
- "Pending Debit Notes": list awaiting approval — [Approve] button

Row 4 — Vendor bills:
- Table: Vendor | Month | Amount | Status | Actions (Approve / Mark Paid)

### 7.3 `EInvoiceQueuePage.jsx`

**Route:** `/finance/einvoice-queue`

For accounts team — shows all DCs that need e-invoice generation.

Table: DC # | Date | Customer | Type | Amount | IRN Status | EWB Status | Actions
Actions: Generate E-Invoice | Generate E-Way Bill | Send to Customer

Bulk action: select multiple → Generate E-Invoice for all selected

---

## SECTION 8 — UPDATE EXISTING: EInvoicePanel.jsx

The existing `EInvoicePanel` in the sales pipeline already shows a
Phase 5 placeholder. Now replace the placeholder with real functionality.

File: `frontend/src/features/sales-pipeline/components/EInvoicePanel.jsx`

Replace the placeholder buttons with real API calls:

```javascript
import { generateEInvoice, generateEWayBill, sendEInvoiceEmail,
  getDcEInvoiceStatus } from '../../customer-billing/customerBillingApi';

// In the component:
// On mount: fetch GET /api/einvoice/dc/:dcNumber/status to get current IRN

// "Generate E-Invoice" button:
const handleGenerateEInvoice = async () => {
  try {
    setGenerating(true);
    const res = await generateEInvoice(dcNumber);
    toast.success(res.data.isSandbox
      ? `Sandbox IRN generated: ${res.data.irn}`
      : `E-Invoice generated. IRN: ${res.data.irn}`
    );
    reload(); // refresh DC detail
  } catch (err) {
    toast.error(err.response?.data?.message || 'E-Invoice generation failed');
  } finally {
    setGenerating(false);
  }
};

// Show sandbox badge when isSandbox=true:
{status?.isSandbox && (
  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
    SANDBOX MODE
  </span>
)}

// "Generate E-Way Bill" button → opens modal:
// Modal fields: Transporter Name | Vehicle Number | Distance (km) |
//               Mode (road/air/rail/ship)
// On submit: calls generateEWayBill(dcNumber, formData)

// "Send E-Invoice to Customer" → opens SendInvoiceModal from customer-billing
```

---

## SECTION 9 — ROUTING & MENU CONFIG

### 9.1 Add to `frontend/src/routes/index.jsx`

```javascript
import CustomerBillingApp from '../features/customer-billing/CustomerBillingApp';
import VendorBillingApp   from '../features/vendor-billing/VendorBillingApp';
import FinanceOverviewApp from '../features/finance-overview/FinanceOverviewApp';

// Add routes:
{ path: '/customer-billing/*',
  element: <ProtectedRoute section="customer_billing" action="view">
    <Layout><CustomerBillingApp /></Layout>
  </ProtectedRoute>
},
{ path: '/vendor-billing/*',
  element: <ProtectedRoute section="vendor_billing_mgmt" action="view">
    <Layout><VendorBillingApp /></Layout>
  </ProtectedRoute>
},
{ path: '/finance/*',
  element: <ProtectedRoute section="billing_dashboard" action="view">
    <Layout><FinanceOverviewApp /></Layout>
  </ProtectedRoute>
},
```

### 9.2 Update `frontend/src/config/menuConfig.js`

Add new FINANCE section to sidebar (after Sales Pipeline, before Floor Pipeline):

```javascript
export const financeMenuItems = [
  { icon: LayoutDashboard, label: 'Finance Dashboard',
    path: '/finance/dashboard', section: 'billing_dashboard' },
  { icon: FileText, label: 'Customer Invoices',
    path: '/customer-billing/invoices', section: 'customer_billing',
    countKey: 'draft_invoices' },
  { icon: CreditCard, label: 'Credit Notes',
    path: '/customer-billing/credit-notes', section: 'credit_notes' },
  { icon: Shield, label: 'Security Deposits',
    path: '/customer-billing/security-deposits', section: 'security_deposits' },
  { icon: Building2, label: 'Vendor Bills',
    path: '/vendor-billing/bills', section: 'vendor_billing_mgmt' },
  { icon: AlertCircle, label: 'Debit Notes',
    path: '/vendor-billing/debit-notes', section: 'debit_notes' },
  { icon: Zap, label: 'E-Invoice Queue',
    path: '/finance/einvoice-queue', section: 'einvoice_ewb',
    countKey: 'einvoice_queue' },
];
```

Add to MENU_GROUPS as accordion:
```javascript
{
  type: 'financeAccordion',
  label: 'Finance',
  icon: DollarSign,
  section: 'customer_billing',
  children: financeMenuItems
}
```

Count badges:
- `draft_invoices`: count of customer_invoices with status='draft'
- `einvoice_queue`: count of DCs delivered without IRN

---

## SECTION 10 — BUILD ORDER

Build in this exact order:

1. `npm install node-cron qrcode` in backend, `npm install recharts` in frontend
2. Run migration `067_phase5_billing_engine.sql`
3. Create `backend/services/zohoGspService.js`
4. Create `backend/services/billingSchedulerService.js`
5. Create `backend/controllers/customerBillingController.js`
6. Create `backend/controllers/einvoiceController.js`
7. Create `backend/controllers/vendorBillingController.js`
8. Create `backend/controllers/financeOverviewController.js`
9. Create all 4 route files (customerBilling, einvoice, vendorBilling, financeOverview)
10. Update `backend/server.js` — mount routes + start billing scheduler
11. Add env vars to `.env.example`
12. Create `frontend/src/features/customer-billing/` — all pages + components
13. Create `frontend/src/features/vendor-billing/` — all pages + components
14. Create `frontend/src/features/finance-overview/` — pages
15. Update `EInvoicePanel.jsx` — replace placeholder with real API calls
16. Update `frontend/src/routes/index.jsx` — add 3 new route groups
17. Update `frontend/src/config/menuConfig.js` — add Finance accordion

---

## SECTION 11 — QUALITY CHECKLIST

**Database:**
- [ ] Migration 067 runs clean
- [ ] `customer_invoices` table created
- [ ] `customer_credit_notes` table created
- [ ] `customer_security_deposits` table created
- [ ] `einvoice_records` table created
- [ ] `eway_bill_records` table created
- [ ] INV- and CN- sequences in sm_document_sequences
- [ ] 6 new permission sections in Settings → Role Permissions

**Zoho GSP:**
- [ ] `ZOHO_GSP_SANDBOX=true` in .env — sandbox mode returns mock IRN without real API call
- [ ] `generateEInvoice()` saves to einvoice_records + updates delivery_challan_lines.irn
- [ ] `generateEWayBill()` saves to eway_bill_records + updates eway_bill_valid_till
- [ ] QR code image generated and saved to uploads/einvoice-qr/
- [ ] Switching `ZOHO_GSP_SANDBOX=false` uses real Zoho API (test only when ready)

**Billing Scheduler:**
- [ ] `startBillingScheduler()` called in server.js startup
- [ ] Cron jobs registered (verify with console log on server start)
- [ ] `generateCustomerInvoice()` — correct pro-rata calculation for mid-month laptops
- [ ] `generateCustomerInvoice()` — skips if invoice already exists for that month
- [ ] `generateVendorBill()` — correct proration for received_at and returned_at
- [ ] Credit notes auto-applied when invoice generated
- [ ] Debit notes auto-applied when vendor bill generated
- [ ] Manual trigger: POST /api/customer-billing/invoices/generate works

**Customer Billing Frontend:**
- [ ] Invoice list has 5 status tabs + stat cards
- [ ] Invoice detail shows line items with per-laptop breakdown
- [ ] Credit note adjustment shown on invoice summary
- [ ] Generate E-Invoice button → shows IRN + SANDBOX badge in dev
- [ ] QR code image shown on invoice detail
- [ ] Send Invoice → email sent via Nodemailer with PDF
- [ ] Mark Paid → status changes, paid_at recorded
- [ ] Credit note form: TTSPL ID picker shows customer's active laptops
- [ ] Security deposits table with refund flow

**Vendor Billing Frontend:**
- [ ] Vendor bill list with status tabs
- [ ] Vendor bill detail shows per-TTSPL line items with proration
- [ ] Approve flow works (manager/admin only)
- [ ] Mark paid flow works
- [ ] Debit note form: TTSPL ID picker shows vendor's serials
- [ ] Debit note approve flow works

**Finance Dashboard:**
- [ ] All 4 KPI cards load from /api/finance-overview/dashboard
- [ ] Bar chart renders monthly revenue (recharts BarChart)
- [ ] Pie chart renders invoice status (recharts PieChart)
- [ ] E-Invoice queue shows DCs awaiting IRN
- [ ] Per-row Generate button triggers e-invoice + updates row in-place
- [ ] Finance accordion in sidebar with count badges

**EInvoicePanel (Sales Pipeline):**
- [ ] Replaced placeholder — real Generate E-Invoice button works
- [ ] Shows SANDBOX badge when ZOHO_GSP_SANDBOX=true
- [ ] Shows generated IRN and QR code image
- [ ] E-Way Bill modal works
- [ ] Send E-Invoice Email button works

---

## SECTION 12 — NAMING REFERENCE

| Concept | Correct | Wrong |
|---|---|---|
| Feature folder | `customer-billing` | billing, invoicing |
| Feature folder | `vendor-billing` | vendor_billing |
| Feature folder | `finance-overview` | finance, accounts |
| Invoice prefix | `INV-` | INV, inv-, INVOICE- |
| Credit note prefix | `CN-` | CN, cn-, CREDIT- |
| Vendor bill prefix | `VB-` | VB, vb-, BILL- |
| Debit note prefix | `DN-` | DN, dn-, DEBIT- |
| Invoice status | `draft`/`sent`/`paid`/`overdue`/`cancelled` | Draft, SENT |
| Credit note status | `pending`/`approved`/`applied`/`cancelled` | Pending |
| Vendor bill status | `generated`/`approved`/`paid`/`disputed` | Generated |
| Permission section | `customer_billing` | billing, invoices |
| Permission section | `vendor_billing_mgmt` | vendor_billing |
| Permission section | `billing_dashboard` | finance_dashboard |
| Cron schedule | IST timezone (`Asia/Kolkata`) | UTC |
| Sandbox mock | Return mock IRN with `SANDBOX_` prefix | throw error |

---

*End of Phase 5 prompt. Build Sections 1–9 in order given in Section 10.*
*After completion, verify Section 11 checklist before moving to Phase 6 (Support Module + Customer/Vendor Portals).*
