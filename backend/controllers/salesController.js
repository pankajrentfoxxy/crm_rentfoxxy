const pool = require('../config/db');
const { researchCompany } = require('../services/perplexityService');
const PDFDocument = require('pdfkit');
const { formatPdfDateIstOrDash, formatPdfNowIst } = require('../utils/pdfDateTimeUtils');

const logOrderStatusHistory = async (db, { orderId, fromStatus = null, toStatus, changedBy = null, notes = null }) => {
    if (!toStatus) return;
    await db.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, fromStatus, toStatus, changedBy, notes]
    );
};

const GST_RATE = 0.18;
const ALLOWED_ORDER_TYPES = ['Rent', 'Sales', 'Demo'];
const normalizeOrderType = (value) => {
    const v = String(value ?? '').trim();
    return ALLOWED_ORDER_TYPES.includes(v) ? v : 'Sales';
};
const COMPANY_DETAILS = {
    name: 'Truetech Pvt Ltd',
    address: 'JMD MEGAPOLIS, SH 13, Central Park II, Sector 48, Gurugram, Haryana 122018',
    gst: '06AAHCT0310N1ZG'
};

const formatINR = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;
// Round to 2 decimals and return as string for PostgreSQL to avoid numeric overflow
const MAX_MONEY = 999999999.99;
const safeMoney = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0.00';
  const clamped = Math.max(-MAX_MONEY, Math.min(MAX_MONEY, n));
  return (Math.round(clamped * 100) / 100).toFixed(2);
};
const roundMoney = (v) => Number(safeMoney(v));
const formatDate = (value) => formatPdfDateIstOrDash(value);
const supplierStateCode = (COMPANY_DETAILS.gst || '').slice(0, 2);
const extractStateCode = (gst) => {
    const value = String(gst || '').trim();
    return /^\d{2}/.test(value) ? value.slice(0, 2) : null;
};
const isInterStateSupply = (customerGst) => {
    const recipientState = extractStateCode(customerGst);
    return !!recipientState && recipientState !== supplierStateCode;
};
const normalizeOptionalDate = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
};

const SALES_QC_CHECKLIST_KEYS = [
    'physical_integrity',
    'keyboard_trackpad',
    'ports',
    'battery',
    'display',
    'webcam',
    'os'
];

const normalizeSalesSpec = (value) => {
    if (value === undefined || value === null) return null;
    const t = String(value).trim();
    return t.length ? t : null;
};

const validateSalesQcChecklist = (checklist) => {
    if (!checklist || typeof checklist !== 'object') return false;
    return SALES_QC_CHECKLIST_KEYS.every((k) => checklist[k] === true);
};

/** After machine/spec change: keep lead + latest lead_orders.details in sync (same sources as QC pass). */
async function syncLeadOrderFromInventoryRow(client, { sourceLeadId, invRow }) {
    if (!sourceLeadId || !invRow) return;
    const merge = JSON.stringify({
        machine_number: invRow.machine_number,
        serial_number: invRow.serial_number,
        brand: invRow.brand,
        processor: invRow.processor,
        ram: invRow.ram,
        storage: invRow.storage,
        preferred_model: invRow.model
    });
    await client.query(
        `
        UPDATE lead_orders
        SET details = COALESCE(details, '{}'::jsonb) || $1::jsonb
        WHERE lead_order_id = (
            SELECT lead_order_id
            FROM lead_orders
            WHERE lead_id = $2
            ORDER BY created_at DESC
            LIMIT 1
        )
        `,
        [merge, sourceLeadId]
    );
    await client.query(
        `
        UPDATE leads
        SET brand = COALESCE($1, brand),
            processor = COALESCE($2, processor),
            ram = COALESCE($3, ram),
            storage = COALESCE($4, storage),
            updated_at = CURRENT_TIMESTAMP
        WHERE lead_id = $5
        `,
        [invRow.brand, invRow.processor, invRow.ram, invRow.storage, sourceLeadId]
    );
}

/** Order is fully QC-complete when nothing blocks: no Warehouse/Procurement lines, no Assigned line left without QC pass. */
async function orderIsFullyQcComplete(client, orderId) {
    const blockRes = await client.query(
        `
        SELECT EXISTS (
            SELECT 1 FROM order_items oi
            WHERE oi.order_id = $1
              AND (
                oi.status = 'Warehouse'
                OR oi.status = 'Procurement'
                OR (oi.status = 'Assigned' AND oi.inventory_id IS NOT NULL AND COALESCE(oi.qc_passed, false) = false)
              )
        ) AS blocked
        `,
        [orderId]
    );
    return blockRes.rows[0]?.blocked === false;
}

async function refreshOrderPipelineStatusAfterProcurementChange(client, orderId, userId, historyNotes = null) {
    const hasProc = await client.query(
        `SELECT EXISTS (SELECT 1 FROM order_items WHERE order_id = $1 AND status = 'Procurement') AS x`,
        [orderId]
    );
    const hasWh = await client.query(
        `SELECT EXISTS (SELECT 1 FROM order_items WHERE order_id = $1 AND status = 'Warehouse') AS x`,
        [orderId]
    );
    const cur = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [orderId]);
    const fromStatus = cur.rows[0]?.status || null;
    let next = fromStatus;
    if (hasProc.rows[0]?.x) {
        next = 'Procurement Pending';
    } else if (hasWh.rows[0]?.x) {
        next = 'Warehouse Pending';
    } else if (['Procurement Pending', 'Warehouse Pending'].includes(fromStatus || '')) {
        next = 'QC Pending';
    }
    if (next !== fromStatus) {
        await client.query(
            `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`,
            [next, orderId]
        );
        await logOrderStatusHistory(client, {
            orderId,
            fromStatus,
            toStatus: next,
            changedBy: userId,
            notes: historyNotes || 'Pipeline status refreshed'
        });
    }
}

const normalizeText = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
};

const getCustomerAddressMap = async (db, customerId) => {
    const res = await db.query(
        `SELECT customer_address_id, concern_person, mobile_no, address, pincode, address_type
         FROM customer_addresses
         WHERE customer_id = $1`,
        [customerId]
    );
    const map = new Map();
    res.rows.forEach((row) => map.set(parseInt(row.customer_address_id, 10), row));
    return map;
};

const fetchOrderDocData = async (orderId) => {
    const orderRes = await pool.query(
        `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.gst_no AS customer_gst_no
         FROM orders o
         JOIN customers c ON o.customer_id = c.customer_id
         WHERE o.order_id = $1`,
        [orderId]
    );
    if (!orderRes.rows.length) return null;
    const itemsRes = await pool.query(
        `SELECT oi.*, COALESCE(oi.generation, i.generation) AS generation, i.machine_number, i.serial_number
         FROM order_items oi
         LEFT JOIN inventory i ON oi.inventory_id = i.inventory_id
         WHERE oi.order_id = $1
         ORDER BY oi.item_id ASC`,
        [orderId]
    );
    return { order: orderRes.rows[0], items: itemsRes.rows };
};

const recalculateOrderFinancials = async (db, orderId) => {
    const totalsRes = await db.query(
        `SELECT
            COALESCE(SUM((oi.unit_price * oi.quantity)), 0) AS subtotal_amount,
            COALESCE(SUM(oi.gst_amount), 0) AS items_gst_amount,
            COALESCE(SUM(CASE WHEN oi.is_wfh THEN oi.shipping_charge ELSE 0 END), 0) AS shipping_charge
         FROM order_items oi
         WHERE oi.order_id = $1`,
        [orderId]
    );
    const totals = totalsRes.rows[0] || {};
    const subtotalAmount = Number(totals.subtotal_amount || 0);
    const itemsGstAmount = Number(totals.items_gst_amount || 0);
    const shippingCharge = Number(totals.shipping_charge || 0);
    const shippingGstAmount = shippingCharge * GST_RATE;

    const orderChargesRes = await db.query(
        `SELECT security_amount FROM orders WHERE order_id = $1`,
        [orderId]
    );
    const securityAmount = Number(orderChargesRes.rows[0]?.security_amount || 0);
    const grandTotalAmount = subtotalAmount + itemsGstAmount + shippingCharge + shippingGstAmount + securityAmount;

    await db.query(
        `UPDATE orders
         SET is_wfh = $1,
             shipping_charge = $2,
             subtotal_amount = $3,
             items_gst_amount = $4,
             shipping_gst_amount = $5,
             grand_total_amount = $6
         WHERE order_id = $7`,
        [shippingCharge > 0, shippingCharge, subtotalAmount, itemsGstAmount, shippingGstAmount, grandTotalAmount, orderId]
    );
};

const recalculateOrderTrackingStatus = async (db, orderId) => {
    const summaryRes = await db.query(
        `SELECT
            COALESCE(SUM(CASE WHEN tracking_status = 'Delivered' THEN quantity ELSE 0 END), 0) AS delivered_count,
            COALESCE(SUM(CASE WHEN tracking_status = 'On The Way' THEN quantity ELSE 0 END), 0) AS on_the_way_count,
            COALESCE(SUM(CASE WHEN tracking_status = 'Not Dispatched' THEN quantity ELSE 0 END), 0) AS not_dispatched_count
         FROM order_items
         WHERE order_id = $1`,
        [orderId]
    );

    const deliveredCount = Number(summaryRes.rows[0]?.delivered_count || 0);
    const onTheWayCount = Number(summaryRes.rows[0]?.on_the_way_count || 0);
    const notDispatchedCount = Number(summaryRes.rows[0]?.not_dispatched_count || 0);

    if (deliveredCount > 0 && onTheWayCount === 0 && notDispatchedCount === 0) {
        await db.query(
            `UPDATE orders SET status = 'Delivered', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
            [orderId]
        );
        return 'Delivered';
    }
    if (deliveredCount > 0 || onTheWayCount > 0) {
        await db.query(
            `UPDATE orders SET status = 'Dispatched', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
            [orderId]
        );
        return 'Dispatched';
    }
    return null;
};

const ensureInvoiceNumber = async (orderId) => {
    const orderRes = await pool.query(`SELECT invoice_number FROM orders WHERE order_id = $1`, [orderId]);
    if (!orderRes.rows.length) return null;
    const invoiceNumber = orderRes.rows[0].invoice_number || `INV-${new Date().getFullYear()}-${String(orderId).padStart(6, '0')}`;
    await pool.query(
        `UPDATE orders SET invoice_number = $1, invoice_generated_at = CURRENT_TIMESTAMP WHERE order_id = $2`,
        [invoiceNumber, orderId]
    );
    return invoiceNumber;
};

const ensureEwayNumber = async (orderId) => {
    const orderRes = await pool.query(`SELECT eway_bill_number FROM orders WHERE order_id = $1`, [orderId]);
    if (!orderRes.rows.length) return null;
    const ewayNumber = orderRes.rows[0].eway_bill_number || `EWB-${Date.now()}-${orderId}`;
    await pool.query(
        `UPDATE orders SET eway_bill_number = $1, eway_bill_generated_at = CURRENT_TIMESTAMP WHERE order_id = $2`,
        [ewayNumber, orderId]
    );
    return ewayNumber;
};

const renderInvoicePdf = (res, bundle) => {
    const { order, items } = bundle;
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.order_id}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 80;
    const left = 40;
    const right = left + pageWidth;
    const interState = isInterStateSupply(order.customer_gst_no);
    const taxable = Number(order.subtotal_amount || 0);
    const shippingTaxable = Number(order.shipping_charge || 0);
    const totalTaxable = taxable + shippingTaxable;
    const totalGst = Number(order.items_gst_amount || 0) + Number(order.shipping_gst_amount || 0);
    const cgst = interState ? 0 : totalGst / 2;
    const sgst = interState ? 0 : totalGst / 2;
    const igst = interState ? totalGst : 0;

    doc.rect(left, 36, pageWidth, 64).stroke('#1f2937');
    doc.font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', left, 46, { width: pageWidth, align: 'center' });
    doc.fontSize(13).text(COMPANY_DETAILS.name, left, 66, { width: pageWidth, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(`${COMPANY_DETAILS.address} | GSTIN: ${COMPANY_DETAILS.gst}`, left, 84, { width: pageWidth, align: 'center' });

    let y = 112;
    doc.rect(left, y, pageWidth, 68).stroke('#1f2937');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Invoice No: ${order.invoice_number || '-'}`, left + 8, y + 8);
    doc.text(`Invoice Date: ${formatDate(order.invoice_generated_at || new Date())}`, left + 8, y + 24);
    doc.text(`Order ID: ${order.order_id}`, left + 8, y + 40);
    doc.text(`Order Type: ${order.order_type || 'Sales'}`, left + 8, y + 54);
    doc.text(`Dispatch Date: ${formatDate(order.dispatch_date || order.dispatched_at)}`, left + 280, y + 8);
    doc.text(`Place of Supply: ${interState ? 'Inter-State' : 'Intra-State'}`, left + 280, y + 24);
    doc.text(`Reverse Charge: No`, left + 280, y + 40);
    doc.text(`Payment Terms: As per agreement`, left + 280, y + 54);

    y += 76;
    doc.rect(left, y, pageWidth / 2, 84).stroke('#1f2937');
    doc.rect(left + pageWidth / 2, y, pageWidth / 2, 84).stroke('#1f2937');
    doc.font('Helvetica-Bold').fontSize(10).text('Bill From', left + 8, y + 8);
    doc.font('Helvetica').fontSize(9)
        .text(COMPANY_DETAILS.name, left + 8, y + 24)
        .text(COMPANY_DETAILS.address, left + 8, y + 38, { width: pageWidth / 2 - 16 })
        .text(`GSTIN: ${COMPANY_DETAILS.gst}`, left + 8, y + 64);
    doc.font('Helvetica-Bold').fontSize(10).text('Bill To', left + pageWidth / 2 + 8, y + 8);
    doc.font('Helvetica').fontSize(9)
        .text(order.customer_name || '-', left + pageWidth / 2 + 8, y + 24)
        .text(order.shipping_address || '-', left + pageWidth / 2 + 8, y + 38, { width: pageWidth / 2 - 16 })
        .text(`GSTIN: ${order.customer_gst_no || 'Unregistered'}`, left + pageWidth / 2 + 8, y + 64);

    y += 94;
    const cols = [left, left + 24, left + 210, left + 260, left + 298, left + 350, left + 408, left + 470, right];
    const rowHeight = 28;
    doc.rect(left, y, pageWidth, rowHeight).fill('#e5e7eb');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8);
    doc.text('S.No', cols[0] + 4, y + 10);
    doc.text('Description', cols[1] + 4, y + 10);
    doc.text('HSN', cols[2] + 4, y + 10);
    doc.text('Qty', cols[3] + 4, y + 10);
    doc.text('Rate', cols[4] + 4, y + 10);
    doc.text('Taxable', cols[5] + 4, y + 10);
    doc.text('GST %', cols[6] + 4, y + 10);
    doc.text('Amount', cols[7] + 4, y + 10);

    y += rowHeight;
    doc.fillColor('#111827').font('Helvetica').fontSize(8);
    items.forEach((item, idx) => {
        const qty = Number(item.quantity || 0);
        const unit = Number(item.unit_price || 0);
        const taxableValue = qty * unit;
        const gstAmount = Number(item.gst_amount || 0);
        const totalValue = Number(item.total_with_gst || taxableValue + gstAmount);
        const desc = `${item.brand || ''} ${item.preferred_model || ''} ${item.processor || ''}/${item.ram || ''}/${item.storage || ''}`.trim();
        const topY = y + 4;
        doc.rect(left, y, pageWidth, rowHeight).stroke('#d1d5db');
        cols.forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke('#d1d5db'));
        doc.text(String(idx + 1), cols[0] + 4, topY, { width: cols[1] - cols[0] - 6 });
        doc.text(desc || '-', cols[1] + 4, topY, { width: cols[2] - cols[1] - 6 });
        doc.text('-', cols[2] + 4, topY, { width: cols[3] - cols[2] - 6 });
        doc.text(String(qty), cols[3] + 4, topY, { width: cols[4] - cols[3] - 6, align: 'right' });
        doc.text(Number(unit).toFixed(2), cols[4] + 4, topY, { width: cols[5] - cols[4] - 6, align: 'right' });
        doc.text(Number(taxableValue).toFixed(2), cols[5] + 4, topY, { width: cols[6] - cols[5] - 6, align: 'right' });
        doc.text('18', cols[6] + 4, topY, { width: cols[7] - cols[6] - 6, align: 'right' });
        doc.text(Number(totalValue).toFixed(2), cols[7] + 4, topY, { width: cols[8] - cols[7] - 6, align: 'right' });
        y += rowHeight;
        if (item.machine_number || item.serial_number) {
            const assetLine = `Machine: ${item.machine_number || '-'} | Serial: ${item.serial_number || '-'}`;
            doc.fontSize(7).text(assetLine, cols[1] + 4, y + 2, { width: cols[5] - cols[1] - 8 });
            doc.fontSize(8);
            y += 12;
        }
    });

    const totalsTop = y + 10;
    doc.rect(left, totalsTop, pageWidth, 120).stroke('#1f2937');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Taxable Value: ${formatINR(totalTaxable)}`, left + 300, totalsTop + 10);
    if (interState) {
        doc.text(`IGST (18%): ${formatINR(igst)}`, left + 300, totalsTop + 28);
    } else {
        doc.text(`CGST (9%): ${formatINR(cgst)}`, left + 300, totalsTop + 28);
        doc.text(`SGST (9%): ${formatINR(sgst)}`, left + 300, totalsTop + 46);
    }
    doc.text(`Security Amount: ${formatINR(order.security_amount)}`, left + 300, totalsTop + 64);
    doc.text(`Grand Total: ${formatINR(order.grand_total_amount)}`, left + 300, totalsTop + 84);

    doc.font('Helvetica-Bold').fontSize(9).text('Declaration', left + 10, totalsTop + 10);
    doc.font('Helvetica').fontSize(8)
        .text('We declare that this invoice shows the actual price of goods described and that all particulars are true and correct.', left + 10, totalsTop + 26, { width: 270 })
        .text('For Truetech Pvt Ltd', left + 10, totalsTop + 82);
    doc.fontSize(8).text('Authorized Signatory', left + 10, totalsTop + 98);

    doc.fontSize(7).fillColor('#4b5563')
        .text('System-generated invoice for ERP operations. For e-invoice IRN and signed JSON/QR, connect GST IRP API.', left, totalsTop + 126, { width: pageWidth, align: 'center' });
    doc.end();
};

const renderEwayPdf = (res, bundle) => {
    const { order, items } = bundle;
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="eway-bill-${order.order_id}.pdf"`);
    doc.pipe(res);

    const left = 40;
    const pageWidth = doc.page.width - 80;
    const hsnSummary = items.map((i) => `${i.brand || ''}-${i.preferred_model || ''}`).join(', ').slice(0, 110) || '-';

    doc.rect(left, 36, pageWidth, 56).stroke('#1f2937');
    doc.font('Helvetica-Bold').fontSize(15).text('FORM GST EWB-01 (ERP FORMAT)', left, 48, { width: pageWidth, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(`E-Way Bill No: ${order.eway_bill_number || '-'}`, left, 72, { width: pageWidth / 2 });
    doc.text(`Generated: ${formatPdfNowIst()}`, left + pageWidth / 2, 72, { width: pageWidth / 2, align: 'right' });

    let y = 104;
    doc.font('Helvetica-Bold').fontSize(11).text('Part - A (Consignment Details)', left, y);
    y += 18;
    doc.rect(left, y, pageWidth, 116).stroke('#1f2937');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Transaction Type: Outward`, left + 8, y + 10);
    doc.text(`Document Type/No: Tax Invoice / ${order.invoice_number || `INV-${order.order_id}`}`, left + 8, y + 26);
    doc.text(`Document Date: ${formatDate(order.invoice_generated_at || order.created_at)}`, left + 8, y + 42);
    doc.text(`From GSTIN: ${COMPANY_DETAILS.gst}`, left + 8, y + 58);
    doc.text(`From: ${COMPANY_DETAILS.name}`, left + 8, y + 74);
    doc.text(`To GSTIN: ${order.customer_gst_no || 'URP'}`, left + 280, y + 10);
    doc.text(`To Name: ${order.customer_name || '-'}`, left + 280, y + 26);
    doc.text(`Place of Delivery: ${order.shipping_address || '-'}`, left + 280, y + 42, { width: 250 });
    doc.text(`Approx Distance (KM): -`, left + 280, y + 74);
    doc.text(`Invoice Value: ${formatINR(order.grand_total_amount)}`, left + 280, y + 90);

    y += 128;
    doc.font('Helvetica-Bold').fontSize(11).text('Goods Details', left, y);
    y += 14;
    doc.rect(left, y, pageWidth, 66).stroke('#1f2937');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Item Description: ${hsnSummary}`, left + 8, y + 10, { width: pageWidth - 16 });
    doc.text(`HSN Code: -`, left + 8, y + 28);
    doc.text(`Taxable Value: ${formatINR(order.subtotal_amount)}`, left + 160, y + 28);
    doc.text(`Tax Amount: ${formatINR(Number(order.items_gst_amount || 0) + Number(order.shipping_gst_amount || 0))}`, left + 320, y + 28);
    doc.text(`Total Qty: ${items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)}`, left + 8, y + 46);

    y += 82;
    doc.font('Helvetica-Bold').fontSize(11).text('Part - B (Transport Details)', left, y);
    y += 14;
    doc.rect(left, y, pageWidth, 86).stroke('#1f2937');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Mode: Road`, left + 8, y + 10);
    doc.text(`Transporter Name: ${order.courier_partner || '-'}`, left + 8, y + 26);
    doc.text(`Transport Document No (LR/AWB): ${order.tracker_id || '-'}`, left + 8, y + 42);
    doc.text(`Vehicle No: -`, left + 8, y + 58);
    doc.text(`Dispatch Date: ${formatDate(order.dispatch_date || order.dispatched_at)}`, left + 300, y + 10);
    doc.text(`Valid Upto: ${formatDate(order.estimated_delivery)}`, left + 300, y + 26);
    doc.text(`Generated By: ${COMPANY_DETAILS.name}`, left + 300, y + 42, { width: 220 });

    y += 98;
    doc.fontSize(7).fillColor('#4b5563').text(
        'This is ERP-generated EWB layout copy. Official E-way bill generation with NIC portal API requires transporter credentials, API authentication, and digital signing setup.',
        left, y, { width: pageWidth, align: 'center' }
    );
    doc.end();
};

// exports.researchCompanyData = async (req, res) => {
//     const { company_name } = req.body;
//     if (!company_name) return res.status(400).json({ message: 'Company name is required' });

//     try {
//         // 1. Check Database for existing company research
//         const dbRes = await pool.query(
//             `SELECT details FROM customers WHERE name ILIKE $1 AND details IS NOT NULL LIMIT 1`,
//             [company_name]
//         );

//         if (dbRes.rows.length > 0) {
//             return res.json({ success: true, data: dbRes.rows[0].details, source: 'database' });
//         }

//         // 2. Fetch from Perplexity API
//         // const data = await researchCompany(company_name);
//         const data = null;
//         res.json({ success: true, data, source: 'api' });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: 'Research failed', error: error.message });
//     }
// };

const formatCustomerAddressLine = (row) => {
    if (!row) return null;
    const bits = [row.address, row.pincode ? `Pincode: ${row.pincode}` : null].filter(Boolean);
    return bits.join(' | ');
};

exports.createCustomer = async (req, res) => {
    const { name, company_name, source_lead_id, email, phone, gst_no, type, details, address } = req.body;

    try {
        if (email || phone) {
            const existing = await pool.query(
                `SELECT * FROM customers
                 WHERE (source_lead_id = $3 AND $3 IS NOT NULL)
                    OR (email = $1 AND $1 IS NOT NULL)
                    OR (phone = $2 AND $2 IS NOT NULL)
                 LIMIT 1`,
                [email || null, phone || null, source_lead_id || null]
            );
            if (existing.rows.length > 0) {
                return res.json({ success: true, customer: existing.rows[0], existing: true });
            }
        }

        const result = await pool.query(
            `INSERT INTO customers (name, company_name, source_lead_id, email, phone, gst_no, type, details, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
            [name, company_name || null, source_lead_id || null, email, phone, gst_no, type || 'New', details, address || null]
        );
        res.json({ success: true, customer: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to create customer' });
    }
};

exports.getCustomerById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [id]);
        if (!result.rows.length) return res.status(404).json({ message: 'Customer not found' });
        const addrRes = await pool.query(
            `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type
             FROM customer_addresses WHERE customer_id = $1 ORDER BY is_head_office DESC, customer_address_id ASC`,
            [id]
        );
        res.json({ customer: { ...result.rows[0], addresses: addrRes.rows || [] } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch customer' });
    }
};

exports.getCustomers = async (req, res) => {
    try {
        const { search } = req.query;
        let result;
        if (search && String(search).trim()) {
            const term = `%${String(search).trim()}%`;
            result = await pool.query(
                `SELECT * FROM customers WHERE name ILIKE $1 OR company_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR gst_no ILIKE $1 ORDER BY created_at DESC`,
                [term]
            );
        } else {
            result = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
        }
        const addrRes = await pool.query(
            `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type
             FROM customer_addresses ORDER BY is_head_office DESC, customer_address_id ASC`
        );
        const addrByCustomer = {};
        (addrRes.rows || []).forEach((row) => {
            const cid = row.customer_id;
            if (!addrByCustomer[cid]) addrByCustomer[cid] = [];
            addrByCustomer[cid].push(row);
        });
        const customers = (result.rows || []).map((c) => ({
            ...c,
            addresses: addrByCustomer[c.customer_id] || []
        }));
        res.json({ customers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch customers' });
    }
};

exports.updateCustomer = async (req, res) => {
    const { id } = req.params;
    const { name, company_name, email, phone, gst_no, type, address } = req.body;

    try {
        await pool.query(
            `UPDATE customers SET
              name = COALESCE($1, name),
              company_name = COALESCE($2, company_name),
              email = COALESCE($3, email),
              phone = COALESCE($4, phone),
              gst_no = COALESCE($5, gst_no),
              type = COALESCE($6, type),
              address = COALESCE($7, address),
              updated_at = CURRENT_TIMESTAMP
             WHERE customer_id = $8`,
            [name || null, company_name || null, email || null, phone || null, gst_no || null, type || null, address || null, id]
        );
        const res2 = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [id]);
        if (!res2.rows.length) return res.status(404).json({ message: 'Customer not found' });
        res.json({ success: true, customer: res2.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update customer' });
    }
};

exports.updateCustomerAddress = async (req, res) => {
    const { id, addr_id } = req.params;
    const { concern_person, mobile_no, address, pincode, is_head_office, address_type } = req.body;

    try {
        const check = await pool.query(
            'SELECT 1 FROM customer_addresses WHERE customer_address_id = $1 AND customer_id = $2',
            [addr_id, id]
        );
        if (!check.rows.length) return res.status(404).json({ message: 'Address not found' });

        await pool.query(
            `UPDATE customer_addresses SET
              concern_person = COALESCE($1, concern_person),
              mobile_no = COALESCE($2, mobile_no),
              address = COALESCE($3, address),
              city = COALESCE($4, city),
              state = COALESCE($5, state),
              pincode = COALESCE($6, pincode),
              is_head_office = COALESCE($7, is_head_office),
              address_type = COALESCE($8, address_type),
              updated_at = CURRENT_TIMESTAMP
             WHERE customer_address_id = $9`,
            [concern_person || null, mobile_no || null, address || null, req.body.city || null, req.body.state || null, pincode || null, is_head_office ?? false, address_type || null, addr_id]
        );
        const res2 = await pool.query('SELECT * FROM customer_addresses WHERE customer_address_id = $1', [addr_id]);
        res.json({ success: true, address: res2.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update address' });
    }
};

exports.addCustomerAddress = async (req, res) => {
    const { id } = req.params;
    const { concern_person, mobile_no, address, pincode, is_head_office, address_type } = req.body;

    try {
        const check = await pool.query('SELECT 1 FROM customers WHERE customer_id = $1', [id]);
        if (!check.rows.length) return res.status(404).json({ message: 'Customer not found' });

        const res2 = await pool.query(
            `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [id, concern_person || null, mobile_no || null, address || '', pincode || null, is_head_office ?? false, address_type || null]
        );
        res.json({ success: true, address: res2.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add address' });
    }
};

exports.uploadCustomersCsv = async (req, res) => {
    const csv = require('csv-parser');
    const fs = require('fs');

    if (!req.file || !req.file.path) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    const rows = [];
    const filePath = req.file.path;

    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', resolve)
                .on('error', reject);
        });
        fs.unlinkSync(filePath);
    } catch (err) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(400).json({ message: 'Failed to parse CSV', error: err.message });
    }

    let imported = 0;
    let addressesAdded = 0;
    let skippedNoName = 0;
    let skippedNoKey = 0;
    let skippedDuplicate = 0;
    let addressesAddedToExisting = 0;
    let failed = 0;
    const addToExisting = req.body?.add_to_existing === true || req.query?.add_to_existing === 'true';

    const pick = (row, ...keys) => {
        for (const k of keys) {
            const v = row[k] || row[k.replace(/_/g, ' ')];
            if (v !== undefined && String(v).trim()) return String(v).trim();
        }
        return null;
    };

    // Use name, or company_name, or email/phone as fallback for display name
    const getDisplayName = (row) => {
        return pick(row, 'name', 'Name') || pick(row, 'company_name', 'company name', 'Company') || pick(row, 'email', 'Email') || pick(row, 'phone', 'Phone') || 'Unknown';
    };

    // Group rows by customer key (email > phone > name+company). Same customer in multiple rows = multiple addresses.
    const getCustomerKey = (row) => {
        const email = pick(row, 'email', 'Email');
        const phone = pick(row, 'phone', 'Phone');
        const name = pick(row, 'name', 'Name');
        const company = pick(row, 'company_name', 'company name', 'Company');
        if (email) return `email:${email}`;
        if (phone) return `phone:${phone}`;
        if (name || company) return `name:${name || ''}|${company || ''}`;
        return null;
    };

    const groups = new Map();
    for (const row of rows) {
        const key = getCustomerKey(row);
        if (!key) {
            skippedNoKey++;
            continue;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    for (const [, groupRows] of groups) {
        try {
            const row = groupRows[0];
            const name = getDisplayName(row);
            const email = pick(row, 'email', 'Email');
            const phone = pick(row, 'phone', 'Phone');
            const companyName = pick(row, 'company_name', 'company name', 'Company');
            const gstNo = pick(row, 'gst_no', 'gst no', 'GST');
            const type = (pick(row, 'type', 'Type') || 'Existing').toLowerCase() === 'new' ? 'New' : 'Existing';

            const existing = await pool.query(
                `SELECT customer_id FROM customers WHERE (email = $1 AND $1 IS NOT NULL) OR (phone = $2 AND $2 IS NOT NULL) LIMIT 1`,
                [email || null, phone || null]
            );

            let customerId;
            if (existing.rows.length > 0) {
                if (!addToExisting) {
                    skippedDuplicate++;
                    continue;
                }
                customerId = existing.rows[0].customer_id;
            } else {
                const custRes = await pool.query(
                    `INSERT INTO customers (name, company_name, email, phone, gst_no, type, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                     RETURNING customer_id`,
                    [name, companyName || null, email || null, phone || null, gstNo || null, type]
                );
                customerId = custRes.rows[0].customer_id;
                imported++;
            }

            const seenAddresses = new Set();
            const existingAddrs = existing.rows.length > 0 ? await pool.query(
                `SELECT LOWER(address) as addr, pincode FROM customer_addresses WHERE customer_id = $1`,
                [customerId]
            ) : { rows: [] };
            for (const a of existingAddrs.rows) {
                seenAddresses.add(`${(a.addr || '').toLowerCase()}|${(a.pincode || '').trim()}`);
            }

            let isFirst = seenAddresses.size === 0;
            for (const r of groupRows) {
                const concernPerson = pick(r, 'concern_person', 'concern person', 'Contact');
                const mobileNo = pick(r, 'mobile_no', 'mobile no', 'Mobile') || phone;
                const address = pick(r, 'address', 'Address');
                const pincode = pick(r, 'pincode', 'Pincode');
                const addrKey = `${(address || '').toLowerCase()}|${(pincode || '').trim()}`;

                if (address && !seenAddresses.has(addrKey)) {
                    seenAddresses.add(addrKey);
                    const addressType = (pick(r, 'address_type', 'address type', 'Address Type') || 'Shipping').trim() || 'Shipping';
                    await pool.query(
                        `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [customerId, concernPerson || null, mobileNo || null, address, pincode || null, isFirst, addressType]
                    );
                    addressesAdded++;
                    if (existing.rows.length > 0) addressesAddedToExisting++;
                    isFirst = false;
                }
            }
        } catch (err) {
            failed++;
            console.error('Customer CSV import error:', err.message);
        }
    }

    res.json({
        success: true,
        totalRows: rows.length,
        imported,
        addressesAdded,
        skippedNoName,
        skippedNoKey,
        skippedDuplicate,
        addressesAddedToExisting,
        failed,
        message: `Imported ${imported} customers, ${addressesAdded} addresses. Skipped: ${skippedDuplicate} duplicates, ${skippedNoKey} no key. ${failed} failed.`
    });
};

exports.createOrder = async (req, res) => {
    const {
        customer_id,
        lead_type,
        order_type,
        status,
        items,
        estimate_id,
        delivery_date,
        shipping_address,
        customer_address_id,
        lockin_period_days = 0,
        security_amount = 0,
        is_wfh = false,
        shipping_charge = 0
    } = req.body;
    const owner_user_id = req.user.user_id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create Order
        const initialStatus = status || 'New Lead';
        const parsedSecurity = roundMoney(security_amount);
        const parsedLockin = parseInt(lockin_period_days, 10) || 0;
        const orderEstimateId = normalizeText(estimate_id);
        const customerAddressMap = await getCustomerAddressMap(client, customer_id);
        const normalizedItems = (items || []).map((item, idx) => {
            const deliveryMode = String(item.delivery_mode || (item.is_wfh ? 'WFH' : 'Office')).toUpperCase() === 'WFH' ? 'WFH' : 'Office';
            const itemIsWfh = deliveryMode === 'WFH';
            const itemShippingCharge = itemIsWfh ? (parseFloat(item.shipping_charge) || 0) : 0;
            const selectedAddressId = item.customer_address_id ? parseInt(item.customer_address_id, 10) : null;
            const selectedOfficeAddress = selectedAddressId ? customerAddressMap.get(selectedAddressId) : null;

            if (!itemIsWfh && !selectedOfficeAddress) {
                throw new Error('Please select a valid office delivery address for each office laptop');
            }

            const deliveryContactName = itemIsWfh
                ? normalizeText(item.delivery_contact_name)
                : normalizeText(selectedOfficeAddress?.concern_person);
            const deliveryContactPhone = itemIsWfh
                ? normalizeText(item.delivery_contact_phone)
                : normalizeText(selectedOfficeAddress?.mobile_no);
            const deliveryAddress = itemIsWfh
                ? normalizeText(item.delivery_address)
                : normalizeText(selectedOfficeAddress?.address);
            const deliveryPincode = itemIsWfh
                ? normalizeText(item.delivery_pincode)
                : normalizeText(selectedOfficeAddress?.pincode);

            if (itemIsWfh) {
                if (!deliveryAddress || !deliveryPincode || !deliveryContactName || !deliveryContactPhone) {
                    throw new Error('For WFH delivery, Name, Phone, Address and Pincode are required');
                }
            }

            return {
                ...item,
                delivery_mode: deliveryMode,
                customer_address_id: itemIsWfh ? null : selectedAddressId,
                delivery_contact_name: deliveryContactName,
                delivery_contact_phone: deliveryContactPhone,
                delivery_address: deliveryAddress,
                delivery_pincode: deliveryPincode,
                is_wfh: itemIsWfh,
                shipping_charge: itemShippingCharge,
                estimate_id: null,
                destination_pincode: null,
                proposed_delivery_date: item.proposed_delivery_date || null
            };
        });

        const shippingChargeFromItems = roundMoney(normalizedItems.reduce(
            (sum, item) => sum + (item.is_wfh ? (parseFloat(item.shipping_charge) || 0) : 0),
            0
        ));
        const shippingGstAmount = roundMoney(shippingChargeFromItems * GST_RATE);

        let resolvedShippingAddress = shipping_address || null;
        if (!resolvedShippingAddress && customer_address_id) {
            const addressRes = await client.query(
                `SELECT customer_address_id, customer_id, address, pincode
                 FROM customer_addresses
                 WHERE customer_address_id = $1`,
                [customer_address_id]
            );
            const selected = addressRes.rows[0];
            if (!selected || parseInt(selected.customer_id, 10) !== parseInt(customer_id, 10)) {
                throw new Error('Selected customer address is invalid for this customer');
            }
            resolvedShippingAddress = formatCustomerAddressLine(selected);
        }
        if (!resolvedShippingAddress) {
            const headOfficeRes = await client.query(
                `SELECT address, pincode
                 FROM customer_addresses
                 WHERE customer_id = $1
                 ORDER BY is_head_office DESC, customer_address_id ASC
                 LIMIT 1`,
                [customer_id]
            );
            resolvedShippingAddress = formatCustomerAddressLine(headOfficeRes.rows[0]) || null;
        }

        // New vs Existing: first order = New, repeat order = Existing
        const prevOrdersRes = await client.query(
            `SELECT 1 FROM orders WHERE customer_id = $1 AND cancelled_at IS NULL LIMIT 1`,
            [customer_id]
        );
        const customerType = prevOrdersRes.rows.length === 0 ? 'New' : 'Existing';

        const resolvedOrderType = normalizeOrderType(order_type);
        const orderRes = await client.query(
            `INSERT INTO orders (customer_id, lead_type, order_type, status, owner_user_id, lockin_period_days, security_amount, estimate_id, is_wfh, shipping_charge, shipping_gst_amount, delivery_date, shipping_address, customer_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING order_id`,
            [customer_id, lead_type, resolvedOrderType, initialStatus, owner_user_id, parsedLockin, parseFloat(safeMoney(parsedSecurity)), orderEstimateId, shippingChargeFromItems > 0, parseFloat(safeMoney(shippingChargeFromItems)), parseFloat(safeMoney(shippingGstAmount)), delivery_date || null, resolvedShippingAddress, customerType]
        );

        // Update customer.type to Existing after first order
        if (customerType === 'New') {
            await client.query(`UPDATE customers SET type = 'Existing', updated_at = CURRENT_TIMESTAMP WHERE customer_id = $1`, [customer_id]);
        }
        const orderId = orderRes.rows[0].order_id;
        const assignments = [];
        let subtotalAmount = 0;
        let itemsGstAmount = 0;
        const consumedInventoryIds = new Set();

        // Process Items
        if (normalizedItems.length > 0) {
            for (const item of normalizedItems) {
                const quantity = parseInt(item.quantity) || 1;
                const unitPrice = roundMoney(item.unit_price);
                const perLaptopShipping = roundMoney(item.is_wfh ? item.shipping_charge : 0);

                if (item.inventory_ids && item.inventory_ids.length > 0) {
                    const candidateIds = item.inventory_ids
                        .map((value) => parseInt(value, 10))
                        .filter((value) => Number.isInteger(value) && value > 0 && !consumedInventoryIds.has(value));
                    const idsToReserve = candidateIds.slice(0, quantity);
                    let hasWarehouse = false;
                    let allAssigned = true;
                    for (let index = 0; index < quantity; index++) {
                        let invId = idsToReserve[index];
                        const lineSubtotal = unitPrice;
                        const lineGst = roundMoney(lineSubtotal * GST_RATE);
                        const lineTotal = roundMoney(lineSubtotal + lineGst);
                        subtotalAmount += lineSubtotal;
                        itemsGstAmount += lineGst;

                        let itemStatus = 'Assigned';
                        const explicitInvId = Number.isInteger(invId) && invId > 0;

                        // Cart often has quantity > 1 but only one inventory_id (repeated "add same line").
                        // idsToReserve is shorter than quantity → reserve extra units the same way as no-ID orders.
                        if (!explicitInvId) {
                            const pickRes = await client.query(
                                `SELECT inventory_id, stock_type FROM inventory 
                                 WHERE (status = 'Ready' OR status = 'In Stock')
                                 AND (stock_type = 'Cooling Period' OR stock_type = 'Ready')
                                 AND brand ILIKE $1 
                                 AND processor ILIKE $2
                                 AND ram ILIKE $3
                                 AND NOT (inventory_id = ANY($4::int[]))
                                 LIMIT 1 FOR UPDATE SKIP LOCKED`,
                                [
                                    item.brand || '%',
                                    `%${item.processor}%` || '%',
                                    item.ram || '%',
                                    Array.from(consumedInventoryIds)
                                ]
                            );
                            const picked = pickRes.rows[0];
                            if (picked) {
                                invId = picked.inventory_id;
                                // All reserved stock (Ready or Cooling) passes through warehouse before QC
                                itemStatus = 'Warehouse';
                                hasWarehouse = true;
                                allAssigned = false;
                                consumedInventoryIds.add(invId);
                                await client.query(
                                    `UPDATE inventory SET status = 'Reserved' WHERE inventory_id = $1`,
                                    [invId]
                                );
                            }
                        } else {
                            const invRes = await client.query(
                                `SELECT stock_type, status FROM inventory WHERE inventory_id = $1 FOR UPDATE`,
                                [invId]
                            );
                            const inv = invRes.rows[0];
                            if (!inv) {
                                throw new Error(`Inventory ${invId} not found`);
                            }
                            if (inv.status !== 'Ready' && inv.status !== 'In Stock') {
                                throw new Error(`Machine ${invId} is no longer available (already assigned to another order). Please refresh and select a different laptop.`);
                            }
                            itemStatus = 'Warehouse';
                            hasWarehouse = true;
                            allAssigned = false;
                            consumedInventoryIds.add(invId);
                            await client.query(
                                `UPDATE inventory SET status = 'Reserved' WHERE inventory_id = $1`,
                                [invId]
                            );
                        }

                        await client.query(
                            `INSERT INTO order_items (
                                order_id, brand, processor, generation, ram, storage, quantity, preferred_model, status, inventory_id,
                                unit_price, gst_percent, gst_amount, total_with_gst, is_wfh, shipping_charge,
                                delivery_mode, customer_address_id, delivery_contact_name, delivery_contact_phone, delivery_address, delivery_pincode,
                                estimate_id, destination_pincode, proposed_delivery_date, tracking_status
                             ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, 18, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'Not Dispatched')`,
                            [
                                orderId,
                                item.brand,
                                item.processor,
                                item.generation || null,
                                item.ram,
                                item.storage,
                                item.model || item.preferred_model,
                                itemStatus,
                                invId || null,
                                parseFloat(safeMoney(unitPrice)),
                                parseFloat(safeMoney(lineGst)),
                                parseFloat(safeMoney(lineTotal)),
                                !!item.is_wfh,
                                parseFloat(safeMoney(perLaptopShipping)),
                                item.delivery_mode,
                                item.customer_address_id || null,
                                item.delivery_contact_name || null,
                                item.delivery_contact_phone || null,
                                item.delivery_address || null,
                                item.delivery_pincode || null,
                                null,
                                null,
                                item.proposed_delivery_date || null
                            ]
                        );
                    }
                    assignments.push({ item, status: hasWarehouse ? 'Warehouse Needed' : 'Assigned', quantity });
                } else {
                    const inventoryCheck = await client.query(
                        `SELECT inventory_id, stock_type FROM inventory 
                         WHERE (status = 'Ready' OR status = 'In Stock')
                         AND (stock_type = 'Cooling Period' OR stock_type = 'Ready')
                         AND brand ILIKE $1 
                         AND processor ILIKE $2
                         AND ram ILIKE $3
                         AND NOT (inventory_id = ANY($5::int[]))
                         LIMIT $4 FOR UPDATE SKIP LOCKED`,
                        [
                            item.brand || '%',
                            `%${item.processor}%` || '%',
                            item.ram || '%',
                            quantity,
                            Array.from(consumedInventoryIds)
                        ]
                    );

                    if (inventoryCheck.rows.length >= quantity) {
                        let hasWarehouseFallback = false;
                        for (let index = 0; index < quantity; index++) {
                            const row = inventoryCheck.rows[index];
                            const inventoryId = row.inventory_id;
                            const itemStatus = 'Warehouse';
                            hasWarehouseFallback = true;

                            const lineSubtotal = unitPrice;
                            const lineGst = roundMoney(lineSubtotal * GST_RATE);
                            const lineTotal = roundMoney(lineSubtotal + lineGst);
                            subtotalAmount += lineSubtotal;
                            itemsGstAmount += lineGst;

                            await client.query(`UPDATE inventory SET status = 'Reserved' WHERE inventory_id = $1`, [inventoryId]);
                            consumedInventoryIds.add(inventoryId);
                        await client.query(
                                `INSERT INTO order_items (
                                    order_id, brand, processor, generation, ram, storage, quantity, preferred_model, status, inventory_id,
                                    unit_price, gst_percent, gst_amount, total_with_gst, is_wfh, shipping_charge,
                                    delivery_mode, customer_address_id, delivery_contact_name, delivery_contact_phone, delivery_address, delivery_pincode,
                                    estimate_id, destination_pincode, proposed_delivery_date, tracking_status
                                 ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, 18, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'Not Dispatched')`,
                                [
                                    orderId,
                                    item.brand,
                                    item.processor,
                                    item.generation || null,
                                    item.ram,
                                    item.storage,
                                    item.preferred_model,
                                    itemStatus,
                                    inventoryId,
                                    parseFloat(safeMoney(unitPrice)),
                                    parseFloat(safeMoney(lineGst)),
                                    parseFloat(safeMoney(lineTotal)),
                                    !!item.is_wfh,
                                    parseFloat(safeMoney(perLaptopShipping)),
                                    item.delivery_mode,
                                    item.customer_address_id || null,
                                    item.delivery_contact_name || null,
                                    item.delivery_contact_phone || null,
                                    item.delivery_address || null,
                                    item.delivery_pincode || null,
                                    null,
                                    null,
                                    item.proposed_delivery_date || null
                                ]
                            );
                        }
                        assignments.push({ item, status: hasWarehouseFallback ? 'Warehouse Needed' : 'Assigned', quantity });
                    } else {
                        for (let index = 0; index < quantity; index++) {
                            const lineSubtotal = unitPrice;
                            const lineGst = roundMoney(lineSubtotal * GST_RATE);
                            const lineTotal = roundMoney(lineSubtotal + lineGst);
                            subtotalAmount += lineSubtotal;
                            itemsGstAmount += lineGst;

                        const itemRes = await client.query(
                                `INSERT INTO order_items (
                                    order_id, brand, processor, generation, ram, storage, quantity, preferred_model, status,
                                    unit_price, gst_percent, gst_amount, total_with_gst, is_wfh, shipping_charge,
                                    delivery_mode, customer_address_id, delivery_contact_name, delivery_contact_phone, delivery_address, delivery_pincode,
                                    estimate_id, destination_pincode, proposed_delivery_date, tracking_status
                                 ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'Procurement', $8, 18, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'Not Dispatched')
                             RETURNING item_id`,
                                [
                                    orderId,
                                    item.brand,
                                    item.processor,
                                    item.generation || null,
                                    item.ram,
                                    item.storage,
                                    item.preferred_model,
                                    parseFloat(safeMoney(unitPrice)),
                                    parseFloat(safeMoney(lineGst)),
                                    parseFloat(safeMoney(lineTotal)),
                                    !!item.is_wfh,
                                    parseFloat(safeMoney(perLaptopShipping)),
                                    item.delivery_mode,
                                    item.customer_address_id || null,
                                    item.delivery_contact_name || null,
                                    item.delivery_contact_phone || null,
                                    item.delivery_address || null,
                                    item.delivery_pincode || null,
                                    null,
                                    null,
                                    item.proposed_delivery_date || null
                                ]
                        );
                        await client.query(
                            `INSERT INTO procurement_requests (order_item_id, status) VALUES ($1, 'New')`,
                            [itemRes.rows[0].item_id]
                        );
                        }
                        assignments.push({ item, status: 'Procurement Needed', quantity });
                    }
                }
            }
        }

        // Determine final order status based on assignments
        const hasProcurement = assignments.some(a => a.status === 'Procurement Needed');
        const hasWarehouse = assignments.some(a => a.status === 'Warehouse Needed');
        const allAssigned = assignments.length > 0 && assignments.every(a => a.status === 'Assigned');

        let finalStatus = 'Procurement Pending'; // Default if items need procurement
        if (allAssigned) {
            finalStatus = 'QC Pending'; // All items assigned, ready for QC
        } else if (hasWarehouse) {
            finalStatus = 'Warehouse Pending'; // Assigned stock must be confirmed in warehouse before QC
        } else if (hasProcurement) {
            finalStatus = 'Procurement Pending';
        } else if (assignments.length === 0) {
            finalStatus = 'New Lead'; // No items yet
        }

        const grandTotalAmount = roundMoney(subtotalAmount + itemsGstAmount + parsedSecurity + shippingChargeFromItems + shippingGstAmount);

        // Update order status + totals (first time entering QC queue: stamp qc_received_at)
        // Use $7 for the CASE test — reusing $1 for status + CASE caused "inconsistent types deduced for parameter $1" in PostgreSQL.
        await client.query(
            `UPDATE orders
             SET status = $1,
                 subtotal_amount = $2,
                 items_gst_amount = $3,
                 shipping_gst_amount = $4,
                 grand_total_amount = $5,
                 qc_received_at = CASE
                     WHEN $7::text = 'QC Pending' THEN COALESCE(qc_received_at, CURRENT_TIMESTAMP)
                     ELSE qc_received_at
                 END
             WHERE order_id = $6`,
            [
                finalStatus,
                parseFloat(safeMoney(subtotalAmount)),
                parseFloat(safeMoney(itemsGstAmount)),
                parseFloat(safeMoney(shippingGstAmount)),
                parseFloat(safeMoney(grandTotalAmount)),
                orderId,
                finalStatus
            ]
        );
        await logOrderStatusHistory(client, {
            orderId,
            fromStatus: null,
            toStatus: finalStatus,
            changedBy: owner_user_id,
            notes: 'Order created'
        });

        await client.query('COMMIT');
        res.json({ success: true, order_id: orderId, status: finalStatus, assignments });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('createOrder error:', error);
        res.status(500).json({ message: error.message || 'Failed to create order' });
    } finally {
        client.release();
    }
};

function userHasGlobalOrderListAccess(reqUser) {
    if (!reqUser) return false;
    const role = String(reqUser.role || '').toLowerCase();
    if (['admin', 'manager', 'floor_manager'].includes(role)) return true;
    let perms = reqUser.permissions;
    if (!Array.isArray(perms)) {
        if (typeof perms === 'string') {
            try {
                const parsed = JSON.parse(perms);
                perms = Array.isArray(parsed) ? parsed : [];
            } catch {
                perms = [];
            }
        } else {
            perms = [];
        }
    }
    return perms.includes('qc_access') || perms.includes('dispatch_access');
}

/** Append WHERE clauses for order list / export (shared filters). */
function appendOrderListFilters(req, conditions, params) {
    let paramCount = params.length + 1;
    const hasGlobalOrderAccess = userHasGlobalOrderListAccess(req.user);
    const viewerId = req.user.user_id ?? req.user.userId;

    if (!hasGlobalOrderAccess || req.query.owner === 'mine') {
        conditions.push(`o.owner_user_id = $${paramCount}`);
        params.push(viewerId);
        paramCount++;
    }

    if (req.query.status) {
        conditions.push(`o.status = $${paramCount}`);
        params.push(req.query.status);
        paramCount++;
    } else {
        conditions.push(`o.status != 'Cancelled'`);
    }

    if (req.query.customer_type) {
        conditions.push(`COALESCE(o.customer_type, 'New') = $${paramCount}`);
        params.push(req.query.customer_type);
        paramCount++;
    }

    if (req.query.date_from) {
        conditions.push(`o.created_at >= $${paramCount}`);
        params.push(`${req.query.date_from}T00:00:00.000Z`);
        paramCount++;
    }
    if (req.query.date_to) {
        conditions.push(`o.created_at <= $${paramCount}`);
        params.push(`${req.query.date_to}T23:59:59.999Z`);
        paramCount++;
    }

    const companySearch = (req.query.company_search || '').trim();
    if (companySearch) {
        conditions.push(`(c.company_name ILIKE $${paramCount} OR c.name ILIKE $${paramCount})`);
        params.push(`%${companySearch}%`);
        paramCount++;
    }

    const orderTypeFilter = (req.query.order_type || '').trim();
    if (orderTypeFilter && ALLOWED_ORDER_TYPES.includes(orderTypeFilter)) {
        conditions.push(`COALESCE(NULLIF(TRIM(o.order_type), ''), 'Sales') = $${paramCount}`);
        params.push(orderTypeFilter);
        paramCount++;
    }

    return paramCount;
}

/** Owner, customer_type, dates, company, order_type — no status filter (for per-stage breakdown). */
function appendOrderStatsDimensionFilters(req, conditions, params) {
    const hasGlobalAccess = userHasGlobalOrderListAccess(req.user);
    const viewerId = req.user.user_id ?? req.user.userId;
    if (!hasGlobalAccess || req.query.owner === 'mine') {
        conditions.push(`o.owner_user_id = $${params.length + 1}`);
        params.push(viewerId);
    }
    if (req.query.customer_type) {
        conditions.push(`COALESCE(o.customer_type, 'New') = $${params.length + 1}`);
        params.push(req.query.customer_type);
    }
    if (req.query.date_from) {
        conditions.push(`o.created_at >= $${params.length + 1}`);
        params.push(req.query.date_from + 'T00:00:00.000Z');
    }
    if (req.query.date_to) {
        conditions.push(`o.created_at <= $${params.length + 1}`);
        params.push(req.query.date_to + 'T23:59:59.999Z');
    }
    const companySearch = (req.query.company_search || '').trim();
    if (companySearch) {
        conditions.push(`(c.company_name ILIKE $${params.length + 1} OR c.name ILIKE $${params.length + 1})`);
        params.push(`%${companySearch}%`);
    }
    const statsOrderType = (req.query.order_type || '').trim();
    if (statsOrderType && ALLOWED_ORDER_TYPES.includes(statsOrderType)) {
        conditions.push(`COALESCE(NULLIF(TRIM(o.order_type), ''), 'Sales') = $${params.length + 1}`);
        params.push(statsOrderType);
    }
}

exports.getOrderStats = async (req, res) => {
    const { date_from, date_to, status, owner } = req.query;
    const hasGlobalAccess = userHasGlobalOrderListAccess(req.user);
    const viewerId = req.user.user_id ?? req.user.userId;

    try {
        const conditions = ["o.status != 'Cancelled'"];
        const params = [];
        let paramCount = 1;

        if (!hasGlobalAccess || owner === 'mine') {
            conditions.push(`o.owner_user_id = $${paramCount}`);
            params.push(viewerId);
            paramCount++;
        }
        if (status) {
            conditions.push(`o.status = $${paramCount}`);
            params.push(status);
            paramCount++;
        }
        if (req.query.customer_type) {
            conditions.push(`COALESCE(o.customer_type, 'New') = $${paramCount}`);
            params.push(req.query.customer_type);
            paramCount++;
        }
        if (date_from) {
            conditions.push(`o.created_at >= $${paramCount}`);
            params.push(date_from + 'T00:00:00.000Z');
            paramCount++;
        }
        if (date_to) {
            conditions.push(`o.created_at <= $${paramCount}`);
            params.push(date_to + 'T23:59:59.999Z');
            paramCount++;
        }
        const companySearch = (req.query.company_search || '').trim();
        if (companySearch) {
            conditions.push(`(c.company_name ILIKE $${paramCount} OR c.name ILIKE $${paramCount})`);
            params.push(`%${companySearch}%`);
            paramCount++;
        }

        const statsOrderType = (req.query.order_type || '').trim();
        if (statsOrderType && ALLOWED_ORDER_TYPES.includes(statsOrderType)) {
            conditions.push(`COALESCE(NULLIF(TRIM(o.order_type), ''), 'Sales') = $${paramCount}`);
            params.push(statsOrderType);
            paramCount++;
        }

        const where = conditions.join(' AND ');
        const result = await pool.query(`
            SELECT
                COALESCE(o.customer_type, 'New') as customer_type,
                COUNT(DISTINCT o.order_id) as order_count,
                COALESCE(SUM(oi.quantity), 0)::int as laptop_count
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE ${where}
            GROUP BY COALESCE(o.customer_type, 'New')
        `, params);

        const newRow = result.rows.find(r => r.customer_type === 'New') || { order_count: 0, laptop_count: 0 };
        const existingRow = result.rows.find(r => r.customer_type === 'Existing') || { order_count: 0, laptop_count: 0 };

        const demoWhere = `${where} AND COALESCE(NULLIF(TRIM(o.order_type), ''), 'Sales') = 'Demo'`;
        const demoRes = await pool.query(
            `
            SELECT COUNT(DISTINCT o.order_id)::int AS oc, COALESCE(SUM(oi.quantity), 0)::int AS lc
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE ${demoWhere}
            `,
            params
        );
        const demoRow = demoRes.rows[0] || { oc: 0, lc: 0 };

        const stageDimConditions = [];
        const stageDimParams = [];
        appendOrderStatsDimensionFilters(req, stageDimConditions, stageDimParams);
        const stageWhere = stageDimConditions.length ? stageDimConditions.join(' AND ') : 'TRUE';
        const stageRes = await pool.query(
            `
            SELECT o.status, COUNT(DISTINCT o.order_id)::int AS order_count, COALESCE(SUM(oi.quantity), 0)::int AS laptop_count
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE ${stageWhere}
            GROUP BY o.status
            `,
            stageDimParams
        );

        const LEAD_STAGE_KEYS = [
            'Procurement Pending',
            'Warehouse Pending',
            'QC Pending',
            'QC Passed',
            'Dispatched',
            'Delivered',
            'Cancelled'
        ];
        const stageBreakdown = {};
        for (const k of LEAD_STAGE_KEYS) {
            stageBreakdown[k] = { orderCount: 0, laptopCount: 0 };
        }
        for (const row of stageRes.rows || []) {
            const st = row.status;
            if (stageBreakdown[st]) {
                stageBreakdown[st].orderCount = parseInt(row.order_count, 10) || 0;
                stageBreakdown[st].laptopCount = parseInt(row.laptop_count, 10) || 0;
            }
        }

        res.json({
            newCustomerOrders: parseInt(newRow.order_count, 10) || 0,
            existingCustomerOrders: parseInt(existingRow.order_count, 10) || 0,
            newCustomerLaptops: parseInt(newRow.laptop_count, 10) || 0,
            existingCustomerLaptops: parseInt(existingRow.laptop_count, 10) || 0,
            totalOrders: (parseInt(newRow.order_count, 10) || 0) + (parseInt(existingRow.order_count, 10) || 0),
            totalLaptops: (parseInt(newRow.laptop_count, 10) || 0) + (parseInt(existingRow.laptop_count, 10) || 0),
            demoOrders: parseInt(demoRow.oc, 10) || 0,
            demoLaptops: parseInt(demoRow.lc, 10) || 0,
            stageBreakdown
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch order stats' });
    }
};

exports.getOrders = async (req, res) => {
    const { limit, offset } = req.query;

    try {
        let query = `
            SELECT 
                o.order_id, o.status, o.lead_type, o.created_at, o.owner_user_id,
                o.order_type, o.customer_type, o.lockin_period_days, o.security_amount, o.estimate_id, o.is_wfh, o.shipping_charge, o.shipping_gst_amount,
                o.subtotal_amount, o.items_gst_amount, o.grand_total_amount, o.invoice_number, o.eway_bill_number,
                o.dispatch_date, o.tracker_id, o.courier_partner, o.dispatched_at, o.estimated_delivery, o.delivery_date,
                c.name as customer_name, c.email as customer_email,
                c.company_name, c.gst_no,
                u.name as owner_name,
                COALESCE(SUM(oi.quantity), 0) as items_count,
                COALESCE(SUM(CASE WHEN oi.status = 'Assigned' THEN oi.quantity ELSE 0 END), 0) as assigned_count,
                COALESCE(SUM(CASE WHEN oi.status = 'Procurement' THEN oi.quantity ELSE 0 END), 0) as procurement_count,
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) as total_value,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'Delivered' THEN oi.quantity ELSE 0 END), 0) AS delivered_laptops,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'On The Way' THEN oi.quantity ELSE 0 END), 0) AS on_the_way_laptops,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS not_dispatched_laptops,
                COALESCE(SUM(CASE WHEN (oi.qc_passed = true OR o.status = 'QC Passed') AND oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS ready_for_dispatch_count
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.owner_user_id = u.user_id
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
        `;

        const conditions = [];
        const params = [];
        appendOrderListFilters(req, conditions, params);

        const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
        const countSql = `SELECT COUNT(DISTINCT o.order_id)::int AS c
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.owner_user_id = u.user_id
            ${whereClause}`;

        const pageLimit = limit !== undefined && limit !== '' ? Math.min(parseInt(limit, 10) || 50, 100) : null;
        const pageOffset = pageLimit != null ? Math.max(parseInt(offset, 10) || 0, 0) : null;

        query += whereClause;
        query += ` GROUP BY o.order_id, o.customer_type, c.name, c.email, c.company_name, c.gst_no, u.name ORDER BY o.created_at DESC`;

        if (pageLimit != null) {
            const limitIdx = params.length + 1;
            query += ` LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`;
            const countRes = await pool.query(countSql, params);
            const result = await pool.query(query, [...params, pageLimit, pageOffset]);
            return res.json({ orders: result.rows, total: countRes.rows[0]?.c ?? 0 });
        }

        const result = await pool.query(query, params);
        res.json({ orders: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch orders' });
    }
};

const csvEscapeCell = (value) => {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

exports.exportOrdersCsv = async (req, res) => {
    try {
        const conditions = [];
        const params = [];
        appendOrderListFilters(req, conditions, params);
        const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

        const exportSql = `
            SELECT
                o.order_id,
                o.created_at AS order_date,
                COALESCE(c.company_name, c.name, '') AS company_name,
                COALESCE(o.customer_type, 'New') AS customer_type,
                o.status AS order_status,
                u.name AS owner_name,
                o.dispatch_date,
                o.dispatched_at,
                o.subtotal_amount,
                o.items_gst_amount,
                o.security_amount,
                o.order_type,
                o.lockin_period_days,
                o.estimate_id,
                oi.item_id,
                oi.quantity AS line_qty,
                oi.status AS item_row_status,
                (SELECT COALESCE(SUM(oi2.quantity), 0) FROM order_items oi2 WHERE oi2.order_id = o.order_id AND oi2.tracking_status = 'Delivered')::text AS delivered_qty,
                (SELECT COALESCE(SUM(oi2.quantity), 0) FROM order_items oi2 WHERE oi2.order_id = o.order_id AND oi2.tracking_status = 'On The Way')::text AS on_the_way_qty,
                (SELECT COALESCE(SUM(oi2.quantity), 0) FROM order_items oi2 WHERE oi2.order_id = o.order_id AND oi2.tracking_status = 'Not Dispatched')::text AS not_dispatched_qty,
                i.machine_number,
                oi.brand,
                oi.preferred_model AS model,
                COALESCE(oi.generation, i.generation) AS generation,
                oi.processor,
                oi.ram,
                oi.storage AS hard_disk
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.owner_user_id = u.user_id
            JOIN order_items oi ON o.order_id = oi.order_id
            LEFT JOIN inventory i ON oi.inventory_id = i.inventory_id
            ${whereClause}
            ORDER BY o.created_at DESC, o.order_id ASC, oi.item_id ASC
        `;

        const result = await pool.query(exportSql, params);
        const header = [
            'Order date',
            'Company name',
            'Type',
            'Item qty',
            'Item line status',
            'Order status',
            'Owner',
            'Dispatch date',
            'Dispatched at',
            'Sub-total',
            'GST',
            'Security',
            'Delivered (qty)',
            'On the way (qty)',
            'Not dispatched (qty)',
            'Order type',
            'Lock-in (days)',
            'Estimate ID',
            'Machine number',
            'Brand',
            'Model',
            'Generation',
            'Processor',
            'RAM',
            'Hard disk'
        ];
        const lines = [header.map(csvEscapeCell).join(',')];
        for (const row of result.rows) {
            const orderDate = row.order_date ? new Date(row.order_date).toISOString().slice(0, 10) : '';
            const dispDate = row.dispatch_date ? new Date(row.dispatch_date).toISOString().slice(0, 10) : '';
            const dispAt = row.dispatched_at ? new Date(row.dispatched_at).toISOString().slice(0, 19).replace('T', ' ') : '';
            lines.push(
                [
                    orderDate,
                    row.company_name,
                    row.customer_type,
                    row.line_qty,
                    row.item_row_status,
                    row.order_status,
                    row.owner_name,
                    dispDate,
                    dispAt,
                    row.subtotal_amount,
                    row.items_gst_amount,
                    row.security_amount,
                    row.delivered_qty,
                    row.on_the_way_qty,
                    row.not_dispatched_qty,
                    row.order_type,
                    row.lockin_period_days,
                    row.estimate_id,
                    row.machine_number,
                    row.brand,
                    row.model,
                    row.generation,
                    row.processor,
                    row.ram,
                    row.hard_disk
                ]
                    .map(csvEscapeCell)
                    .join(',')
            );
        }

        const csv = '\ufeff' + lines.join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
        res.send(csv);
    } catch (error) {
        console.error('exportOrdersCsv', error);
        res.status(500).json({ message: 'Failed to export orders' });
    }
};

const QC_PIPELINE_STATUSES = ['Procurement Pending', 'Warehouse Pending', 'QC Pending'];
const DISPATCH_PIPELINE_STATUSES = ['Procurement Pending', 'Warehouse Pending', 'QC Pending', 'QC Passed', 'Dispatched'];

/** Who may see all pipeline orders (not scoped to owner_user_id). JWT/DB-safe role + permissions. */
function userHasPipelineGlobalAccess(reqUser) {
    if (!reqUser) return false;
    const role = String(reqUser.role || '').toLowerCase();
    if (['admin', 'manager', 'floor_manager'].includes(role)) return true;
    let perms = reqUser.permissions;
    if (!Array.isArray(perms)) {
        if (typeof perms === 'string') {
            try {
                const parsed = JSON.parse(perms);
                perms = Array.isArray(parsed) ? parsed : [];
            } catch {
                perms = [];
            }
        } else {
            perms = [];
        }
    }
    return perms.includes('qc_access') || perms.includes('dispatch_access');
}

exports.getQcPipelineOrders = async (req, res) => {
    const hasGlobalOrderAccess = userHasPipelineGlobalAccess(req.user);

    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const search = (req.query.search || '').trim();

        const conditions = [`o.status = ANY($1)`, `o.status != 'Cancelled'`];
        const params = [QC_PIPELINE_STATUSES];
        let paramCount = 2;

        const viewerId = req.user.user_id ?? req.user.userId;
        if (!hasGlobalOrderAccess || req.query.owner === 'mine') {
            conditions.push(`o.owner_user_id = $${paramCount}`);
            params.push(viewerId);
            paramCount++;
        }

        if (search) {
            const term = `%${search}%`;
            conditions.push(`(
                c.company_name ILIKE $${paramCount} OR c.name ILIKE $${paramCount} OR CAST(o.order_id AS TEXT) ILIKE $${paramCount}
                OR EXISTS (
                    SELECT 1 FROM order_items oi_x
                    LEFT JOIN inventory i_x ON oi_x.inventory_id = i_x.inventory_id
                    WHERE oi_x.order_id = o.order_id
                    AND (i_x.machine_number ILIKE $${paramCount} OR i_x.serial_number ILIKE $${paramCount})
                )
            )`);
            params.push(term);
            paramCount++;
        }

        const whereSql = conditions.join(' AND ');
        const countSql = `
            SELECT COUNT(DISTINCT o.order_id)::int AS c
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            WHERE ${whereSql}
        `;
        const limIdx = paramCount;
        const idsSql = `
            SELECT o.order_id
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            WHERE ${whereSql}
            ORDER BY o.created_at DESC
            LIMIT $${limIdx} OFFSET $${limIdx + 1}
        `;

        const countRes = await pool.query(countSql, params);
        const idsRes = await pool.query(idsSql, [...params, limit, offset]);
        const ids = idsRes.rows.map((r) => r.order_id);
        const total = countRes.rows[0]?.c ?? 0;

        if (ids.length === 0) {
            return res.json({ orders: [], total });
        }

        const ordersSql = `
            SELECT 
                o.order_id, o.status, o.lead_type, o.created_at, o.owner_user_id,
                o.order_type, o.customer_type, o.lockin_period_days, o.security_amount, o.estimate_id, o.is_wfh, o.shipping_charge, o.shipping_gst_amount,
                o.subtotal_amount, o.items_gst_amount, o.grand_total_amount, o.invoice_number, o.eway_bill_number,
                o.dispatch_date, o.tracker_id, o.courier_partner, o.dispatched_at, o.estimated_delivery, o.delivery_date,
                o.qc_received_at,
                o.qc_completed_at,
                c.name as customer_name, c.email as customer_email,
                c.company_name, c.gst_no,
                u.name as owner_name,
                COALESCE(SUM(oi.quantity), 0) as items_count,
                COALESCE(SUM(CASE WHEN oi.status = 'Assigned' THEN oi.quantity ELSE 0 END), 0) as assigned_count,
                COALESCE(SUM(CASE WHEN oi.status = 'Procurement' THEN oi.quantity ELSE 0 END), 0) as procurement_count,
                COALESCE(SUM(oi.unit_price * oi.quantity), 0) as total_value,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'Delivered' THEN oi.quantity ELSE 0 END), 0) AS delivered_laptops,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'On The Way' THEN oi.quantity ELSE 0 END), 0) AS on_the_way_laptops,
                COALESCE(SUM(CASE WHEN oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS not_dispatched_laptops,
                COALESCE(SUM(CASE WHEN (oi.qc_passed = true OR o.status = 'QC Passed') AND oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS ready_for_dispatch_count
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.owner_user_id = u.user_id
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE o.order_id = ANY($1::int[])
            GROUP BY
                o.order_id, o.status, o.lead_type, o.created_at, o.owner_user_id,
                o.order_type, o.customer_type, o.lockin_period_days, o.security_amount, o.estimate_id, o.is_wfh,
                o.shipping_charge, o.shipping_gst_amount, o.subtotal_amount, o.items_gst_amount, o.grand_total_amount,
                o.invoice_number, o.eway_bill_number, o.dispatch_date, o.tracker_id, o.courier_partner, o.dispatched_at,
                o.estimated_delivery, o.delivery_date,
                o.qc_received_at, o.qc_completed_at,
                c.name, c.email, c.company_name, c.gst_no, u.name
        `;
        const ordersRes = await pool.query(ordersSql, [ids]);
        const orderMap = new Map(ordersRes.rows.map((r) => [r.order_id, r]));
        const orderedRows = ids.map((id) => orderMap.get(id)).filter(Boolean);

        const itemsRes = await pool.query(
            `SELECT oi.item_id, oi.order_id, oi.brand, oi.preferred_model, oi.processor, oi.generation, oi.ram, oi.storage,
                    oi.status, oi.quantity, oi.inventory_id, COALESCE(oi.qc_passed, false) AS qc_passed,
                    i.machine_number, i.serial_number
             FROM order_items oi
             LEFT JOIN inventory i ON oi.inventory_id = i.inventory_id
             WHERE oi.order_id = ANY($1::int[])`,
            [ids]
        );
        const itemsByOrder = new Map();
        for (const row of itemsRes.rows || []) {
            if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
            itemsByOrder.get(row.order_id).push(row);
        }

        const orders = orderedRows.map((o) => ({
            ...o,
            items: itemsByOrder.get(o.order_id) || []
        }));

        res.json({ orders, total });
    } catch (error) {
        console.error('getQcPipelineOrders', error);
        const code = error && error.code;
        const hint =
            code === '42703'
                ? 'Undefined column (run latest SQL migrations on the server).'
                : undefined;
        res.status(500).json({
            message: 'Failed to fetch QC pipeline orders',
            code: code || undefined,
            hint
        });
    }
};

exports.getDispatchPipelineOrders = async (req, res) => {
    const hasGlobalOrderAccess = userHasPipelineGlobalAccess(req.user);
    const viewerId = req.user.user_id ?? req.user.userId;

    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const search = (req.query.search || '').trim();
        const ownerFilter = !hasGlobalOrderAccess || req.query.owner === 'mine';
        const pipelineParams = ownerFilter ? [DISPATCH_PIPELINE_STATUSES, viewerId] : [DISPATCH_PIPELINE_STATUSES];
        const ownerClause = ownerFilter ? ' AND o.owner_user_id = $2' : '';

        const statusPerOrderSql = `
            SELECT o.order_id, o.status, o.dispatched_at,
                   COALESCE(SUM(oi.quantity), 0)::numeric AS cnt
            FROM orders o
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE o.status = ANY($1)
              AND o.status != 'Cancelled'
              ${ownerClause}
            GROUP BY o.order_id, o.status, o.dispatched_at
        `;

        const statusAggSql = `
            SELECT
                COALESCE(SUM(CASE WHEN s.status = 'Warehouse Pending' THEN s.cnt ELSE 0 END), 0)::int AS warehouse_laptops,
                COALESCE(SUM(CASE WHEN s.status = 'Procurement Pending' THEN s.cnt ELSE 0 END), 0)::int AS procurement_laptops,
                COALESCE(SUM(CASE WHEN s.status = 'QC Pending' THEN s.cnt ELSE 0 END), 0)::int AS qc_pending_laptops,
                COALESCE(SUM(CASE WHEN s.status = 'QC Passed' THEN s.cnt ELSE 0 END), 0)::int AS qc_passed_laptops,
                COALESCE(SUM(CASE WHEN s.status = 'Dispatched' AND s.dispatched_at IS NOT NULL
                    AND (s.dispatched_at AT TIME ZONE 'UTC')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date THEN s.cnt ELSE 0 END), 0)::int AS dispatched_today_laptops,
                COALESCE(SUM(s.cnt), 0)::int AS total_pipeline_laptops
            FROM (${statusPerOrderSql}) AS s
        `;

        const onTheWaySql = `
            SELECT COALESCE(SUM(x.otw), 0)::int AS on_the_way_laptops
            FROM (
                SELECT COALESCE(SUM(CASE WHEN oi.tracking_status = 'On The Way' THEN oi.quantity ELSE 0 END), 0) AS otw
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                WHERE o.status = ANY($1)
                  AND o.status != 'Cancelled'
                  ${ownerClause}
                GROUP BY o.order_id
            ) x
        `;

        const deliveredSql = `
            SELECT
                COUNT(DISTINCT o.order_id)::int AS delivered_order_count,
                COALESCE(SUM(ic.cnt), 0)::int AS delivered_laptops
            FROM orders o
            LEFT JOIN (
                SELECT order_id, COALESCE(SUM(quantity), 0)::int AS cnt FROM order_items GROUP BY order_id
            ) ic ON ic.order_id = o.order_id
            WHERE o.status = 'Delivered'
            ${ownerFilter ? ' AND o.owner_user_id = $1' : ''}
        `;
        const deliveredParams = ownerFilter ? [viewerId] : [];

        const listConditions = [`o.status = ANY($1)`, `o.status != 'Cancelled'`];
        const listParams = [DISPATCH_PIPELINE_STATUSES];
        let listParamCount = 2;
        if (ownerFilter) {
            listConditions.push(`o.owner_user_id = $${listParamCount}`);
            listParams.push(viewerId);
            listParamCount++;
        }
        if (search) {
            const term = `%${search}%`;
            listConditions.push(`(
                c.company_name ILIKE $${listParamCount} OR c.name ILIKE $${listParamCount} OR CAST(o.order_id AS TEXT) ILIKE $${listParamCount}
                OR EXISTS (
                    SELECT 1 FROM order_items oi_x
                    LEFT JOIN inventory i_x ON oi_x.inventory_id = i_x.inventory_id
                    WHERE oi_x.order_id = o.order_id
                    AND (i_x.machine_number ILIKE $${listParamCount} OR i_x.serial_number ILIKE $${listParamCount})
                )
            )`);
            listParams.push(term);
            listParamCount++;
        }
        const listWhere = listConditions.join(' AND ');

        const countSql = `
            SELECT COUNT(DISTINCT o.order_id)::int AS c
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            WHERE ${listWhere}
        `;
        const idsSql = `
            SELECT o.order_id
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            WHERE ${listWhere}
            ORDER BY o.created_at DESC
            LIMIT $${listParamCount} OFFSET $${listParamCount + 1}
        `;

        const [statusAggRes, onTheWayRes, deliveredRes, countRes, idsRes] = await Promise.all([
            pool.query(statusAggSql, pipelineParams),
            pool.query(onTheWaySql, pipelineParams),
            pool.query(deliveredSql, deliveredParams),
            pool.query(countSql, listParams),
            pool.query(idsSql, [...listParams, limit, offset])
        ]);

        const ids = idsRes.rows.map((r) => r.order_id);
        const total = countRes.rows[0]?.c ?? 0;

        let orders = [];
        if (ids.length > 0) {
            const ordersSql = `
                SELECT 
                    o.order_id, o.status, o.lead_type, o.created_at, o.owner_user_id,
                    o.order_type, o.customer_type, o.lockin_period_days, o.security_amount, o.estimate_id, o.is_wfh, o.shipping_charge, o.shipping_gst_amount,
                    o.subtotal_amount, o.items_gst_amount, o.grand_total_amount, o.invoice_number, o.eway_bill_number,
                    o.dispatch_date, o.tracker_id, o.courier_partner, o.dispatched_at, o.estimated_delivery, o.delivery_date,
                    c.name as customer_name, c.email as customer_email,
                    c.company_name, c.gst_no,
                    u.name as owner_name,
                    COALESCE(SUM(oi.quantity), 0) as items_count,
                    COALESCE(SUM(CASE WHEN oi.status = 'Assigned' THEN oi.quantity ELSE 0 END), 0) as assigned_count,
                    COALESCE(SUM(CASE WHEN oi.status = 'Procurement' THEN oi.quantity ELSE 0 END), 0) as procurement_count,
                    COALESCE(SUM(oi.unit_price * oi.quantity), 0) as total_value,
                    COALESCE(SUM(CASE WHEN oi.tracking_status = 'Delivered' THEN oi.quantity ELSE 0 END), 0) AS delivered_laptops,
                    COALESCE(SUM(CASE WHEN oi.tracking_status = 'On The Way' THEN oi.quantity ELSE 0 END), 0) AS on_the_way_laptops,
                    COALESCE(SUM(CASE WHEN oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS not_dispatched_laptops,
                    COALESCE(SUM(CASE WHEN (oi.qc_passed = true OR o.status = 'QC Passed') AND oi.tracking_status = 'Not Dispatched' THEN oi.quantity ELSE 0 END), 0) AS ready_for_dispatch_count
                FROM orders o
                JOIN customers c ON o.customer_id = c.customer_id
                LEFT JOIN users u ON o.owner_user_id = u.user_id
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                WHERE o.order_id = ANY($1::int[])
                GROUP BY o.order_id, o.customer_type, c.name, c.email, c.company_name, c.gst_no, u.name
            `;
            const ordersRes = await pool.query(ordersSql, [ids]);
            const orderMap = new Map(ordersRes.rows.map((r) => [r.order_id, r]));
            orders = ids.map((id) => orderMap.get(id)).filter(Boolean);
        }

        const s = statusAggRes.rows[0] || {};
        const del = deliveredRes.rows[0] || {};
        res.json({
            orders,
            total,
            summary: {
                warehouse_laptops: s.warehouse_laptops ?? 0,
                procurement_laptops: s.procurement_laptops ?? 0,
                qc_pending_laptops: s.qc_pending_laptops ?? 0,
                qc_passed_laptops: s.qc_passed_laptops ?? 0,
                dispatched_today_laptops: s.dispatched_today_laptops ?? 0,
                on_the_way_laptops: onTheWayRes.rows[0]?.on_the_way_laptops ?? 0,
                total_pipeline_laptops: s.total_pipeline_laptops ?? 0,
                delivered_order_count: del.delivered_order_count ?? 0,
                delivered_laptops: del.delivered_laptops ?? 0
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch dispatch pipeline orders' });
    }
};

exports.getPipelineLaptops = async (req, res) => {
    const hasGlobalOrderAccess = userHasPipelineGlobalAccess(req.user);
    const viewerId = req.user.user_id ?? req.user.userId;

    try {
        let query = `
            SELECT
                oi.order_id,
                oi.item_id,
                oi.brand,
                oi.processor,
                COALESCE(oi.generation, i.generation) AS generation,
                oi.ram,
                oi.storage,
                oi.preferred_model,
                i.machine_number,
                i.serial_number,
                oi.status AS item_status,
                oi.tracking_status,
                COALESCE(oi.qc_passed, false) AS qc_passed,
                c.company_name
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN inventory i ON oi.inventory_id = i.inventory_id
            WHERE o.status IN ('Procurement Pending', 'Warehouse Pending', 'QC Pending', 'QC Passed')
        `;
        const params = [];
        if (!hasGlobalOrderAccess) {
            query += ` AND o.owner_user_id = $1`;
            params.push(viewerId);
        }
        query += ` ORDER BY oi.order_id ASC, oi.item_id ASC`;

        const result = await pool.query(query, params);
        res.json({ laptops: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch pipeline laptops' });
    }
};

exports.generateInvoice = async (req, res) => {
    const { id } = req.params;
    try {
        const invoiceNumber = await ensureInvoiceNumber(id);
        if (!invoiceNumber) return res.status(404).json({ message: 'Order not found' });
        res.json({ success: true, invoice_number: invoiceNumber, message: 'Invoice generated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate invoice' });
    }
};

exports.generateEwayBill = async (req, res) => {
    const { id } = req.params;
    try {
        const ewayBillNumber = await ensureEwayNumber(id);
        if (!ewayBillNumber) return res.status(404).json({ message: 'Order not found' });
        res.json({ success: true, eway_bill_number: ewayBillNumber, message: 'E-way bill generated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to generate e-way bill' });
    }
};

exports.downloadInvoicePdf = async (req, res) => {
    const { id } = req.params;
    try {
        const invoiceNumber = await ensureInvoiceNumber(id);
        if (!invoiceNumber) return res.status(404).json({ message: 'Order not found' });
        const bundle = await fetchOrderDocData(id);
        if (!bundle) return res.status(404).json({ message: 'Order not found' });
        bundle.order.invoice_number = invoiceNumber;
        renderInvoicePdf(res, bundle);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to download invoice PDF' });
    }
};

exports.downloadEwayPdf = async (req, res) => {
    const { id } = req.params;
    try {
        const ewayNumber = await ensureEwayNumber(id);
        if (!ewayNumber) return res.status(404).json({ message: 'Order not found' });
        const bundle = await fetchOrderDocData(id);
        if (!bundle) return res.status(404).json({ message: 'Order not found' });
        bundle.order.eway_bill_number = ewayNumber;
        renderEwayPdf(res, bundle);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to download e-way PDF' });
    }
};

exports.getOrderDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const orderRes = await pool.query(`
            SELECT o.*, c.name as customer_name, c.company_name, c.email as customer_email, c.phone as customer_phone,
                   u.name as owner_name
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN users u ON o.owner_user_id = u.user_id
            WHERE o.order_id = $1
        `, [id]);

        if (orderRes.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const order = orderRes.rows[0];
        const isPrivileged =
            ['admin', 'manager', 'floor_manager'].includes(req.user.role) ||
            (req.user.permissions && (req.user.permissions.includes('qc_access') || req.user.permissions.includes('dispatch_access')));
        if (!isPrivileged && order.owner_user_id !== req.user.user_id) {
            return res.status(403).json({ message: 'Access denied' });
        }

        const itemsRes = await pool.query(`
            SELECT
                oi.*,
                COALESCE(oi.generation, i.generation) AS generation,
                i.machine_number,
                i.serial_number,
                ca.concern_person AS linked_concern_person,
                ca.mobile_no AS linked_mobile_no,
                ca.address AS linked_address,
                ca.pincode AS linked_pincode
            FROM order_items oi
            LEFT JOIN inventory i ON oi.inventory_id = i.inventory_id
            LEFT JOIN customer_addresses ca ON oi.customer_address_id = ca.customer_address_id
            WHERE oi.order_id = $1
        `, [id]);
        const customerAddressesRes = await pool.query(
            `SELECT customer_address_id, concern_person, mobile_no, address, pincode, is_head_office, address_type
             FROM customer_addresses
             WHERE customer_id = $1
             ORDER BY is_head_office DESC, customer_address_id ASC`,
            [order.customer_id]
        );

        const historyRes = await pool.query(`
            SELECT osh.*, u.name as changed_by_name
            FROM order_status_history osh
            LEFT JOIN users u ON osh.changed_by = u.user_id
            WHERE osh.order_id = $1
            ORDER BY osh.changed_at ASC
        `, [id]);

        const officeFallbackAddress = (customerAddressesRes.rows || [])[0] || null;
        const enrichedItems = itemsRes.rows.map((item) => {
            const itemMode = item.delivery_mode || (item.is_wfh ? 'WFH' : 'Office');
            const officeAddressForFallback = itemMode === 'Office' ? officeFallbackAddress : null;
            return {
                ...item,
                delivery_mode: itemMode,
                customer_address_id: item.customer_address_id || officeAddressForFallback?.customer_address_id || null,
                delivery_contact_name: item.delivery_contact_name || item.linked_concern_person || officeAddressForFallback?.concern_person || null,
                delivery_contact_phone: item.delivery_contact_phone || item.linked_mobile_no || officeAddressForFallback?.mobile_no || null,
                delivery_address: item.delivery_address || item.linked_address || officeAddressForFallback?.address || null,
                delivery_pincode: item.delivery_pincode || item.linked_pincode || officeFallbackAddress?.pincode || null
            };
        });
        const trackingSummary = enrichedItems.reduce((acc, item) => {
            const quantity = Number(item.quantity || 0);
            if (item.tracking_status === 'Delivered') acc.delivered += quantity;
            else if (item.tracking_status === 'On The Way') acc.on_the_way += quantity;
            else acc.not_dispatched += quantity;
            return acc;
        }, { delivered: 0, on_the_way: 0, not_dispatched: 0 });

        let customerAddresses = customerAddressesRes.rows || [];
        if (!customerAddresses.length) {
            const fallbackMap = new Map();
            enrichedItems
                .filter((item) => item.customer_address_id && item.delivery_address)
                .forEach((item) => {
                    const key = String(item.customer_address_id);
                    if (!fallbackMap.has(key)) {
                        fallbackMap.set(key, {
                            customer_address_id: item.customer_address_id,
                            concern_person: item.delivery_contact_name || null,
                            mobile_no: item.delivery_contact_phone || null,
                            address: item.delivery_address || null,
                            pincode: item.delivery_pincode || null,
                            is_head_office: false
                        });
                    }
                });
            customerAddresses = Array.from(fallbackMap.values());
        }

        res.json({
            order,
            items: enrichedItems,
            customer_addresses: customerAddresses,
            status_history: historyRes.rows,
            tracking_summary: trackingSummary
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch order details' });
    }
};

exports.dispatchOrder = async (req, res) => {
    const { id } = req.params;
    const { dispatch_date, tracker_id, courier_partner, estimated_delivery, item_ids } = req.body;
    const safeEstimatedDelivery = normalizeOptionalDate(estimated_delivery);
    const safeDispatchDate = normalizeOptionalDate(dispatch_date);

    try {
        const current = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = current.rows[0]?.status || null;
        if (!fromStatus) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const allowedStatuses = ['QC Passed', 'Dispatched'];
        const hasQCPassedItems = await pool.query(
            `SELECT 1 FROM order_items WHERE order_id = $1 AND COALESCE(qc_passed, false) = true AND tracking_status = 'Not Dispatched' LIMIT 1`,
            [id]
        );
        if (!allowedStatuses.includes(fromStatus) && hasQCPassedItems.rows.length === 0) {
            return res.status(400).json({ message: 'Order must have QC passed items before dispatch updates' });
        }

        const targetItemsRes = await pool.query(
            `SELECT item_id FROM order_items
             WHERE order_id = $1
               AND COALESCE(qc_passed, false) = true
               AND tracking_status = 'Not Dispatched'
               AND ($2::int[] IS NULL OR item_id = ANY($2::int[]))`,
            [id, Array.isArray(item_ids) && item_ids.length > 0 ? item_ids : null]
        );
        const targetItemIds = targetItemsRes.rows.map((row) => row.item_id);
        if (!targetItemIds.length) {
            return res.status(400).json({ message: 'No not-dispatched laptops matched for dispatch' });
        }

        await pool.query(
            `UPDATE order_items
             SET tracking_status = 'On The Way',
                 item_tracker_id = $1,
                 item_courier_partner = $2,
                 item_dispatch_date = $3,
                 item_estimated_delivery = $4
             WHERE item_id = ANY($5::int[])`,
            [tracker_id || null, courier_partner || null, safeDispatchDate, safeEstimatedDelivery, targetItemIds]
        );

        const updateRes = await pool.query(`
            UPDATE orders 
            SET status = 'Dispatched', 
                dispatch_date = $1, 
                tracker_id = $2, 
                courier_partner = $3,
                estimated_delivery = $4,
                dispatched_at = CURRENT_TIMESTAMP
            WHERE order_id = $5
        `, [safeDispatchDate, tracker_id || null, courier_partner || null, safeEstimatedDelivery, id]);
        if (updateRes.rowCount === 0) {
            return res.status(400).json({ message: 'Failed to move order to Dispatched' });
        }

        // Also update inventory items to 'Outward'
        await pool.query(`
            UPDATE inventory SET status = 'Outward'
            WHERE inventory_id IN (
                SELECT inventory_id FROM order_items WHERE order_id = $1 AND inventory_id IS NOT NULL
            )
        `, [id]);

        await logOrderStatusHistory(pool, {
            orderId: parseInt(id, 10),
            fromStatus,
            toStatus: 'Dispatched',
            changedBy: req.user.user_id,
            notes: `Laptops: ${targetItemIds.length} | Courier: ${courier_partner || '-'} | Tracker: ${tracker_id || '-'}`
        });

        res.json({ success: true, message: 'Selected laptops dispatched successfully', item_ids: targetItemIds });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to dispatch order' });
    }
};

// QC Pass - Mark order as QC Passed
// Manually send order to QC (when all items are assigned)
exports.sendToQC = async (req, res) => {
    const { id } = req.params;
    try {
        const current = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = current.rows[0]?.status || null;
        if (!fromStatus) {
            return res.status(404).json({ message: 'Order not found' });
        }
        if (fromStatus !== 'Procurement Pending') {
            return res.status(400).json({ message: 'Only Procurement Pending orders can be moved to QC Pending' });
        }

        // Check if all items are assigned
        const check = await pool.query(`
            SELECT COUNT(*) as pending FROM order_items WHERE order_id = $1 AND status != 'Assigned'
        `, [id]);

        if (parseInt(check.rows[0].pending) > 0) {
            return res.status(400).json({ message: 'Cannot send to QC - not all items are assigned yet' });
        }

        await pool.query(
            `UPDATE orders SET status = 'QC Pending',
                qc_received_at = COALESCE(qc_received_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
             WHERE order_id = $1`,
            [id]
        );
        await logOrderStatusHistory(pool, {
            orderId: parseInt(id, 10),
            fromStatus,
            toStatus: 'QC Pending',
            changedBy: req.user.user_id,
            notes: 'Manually sent to QC'
        });
        res.json({ success: true, message: 'Order moved to QC Pending' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to send to QC' });
    }
};

/**
 * QC: replace assigned machine (same inventory rules as warehouse). Updates order_items, inventory, lead snapshot.
 */
exports.qcReplaceOrderItem = async (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.item_id, 10);
    const raw = req.body?.new_machine_number;
    if (!Number.isFinite(orderId) || !Number.isFinite(itemId)) {
        return res.status(400).json({ message: 'Invalid order or item id' });
    }
    if (!raw || !String(raw).trim()) {
        return res.status(400).json({ message: 'new_machine_number is required' });
    }
    const machineNum = String(raw).trim();
    const normalized = machineNum.replace(/[\s\-_]/g, '').toUpperCase();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ctxRes = await client.query(
            `
            SELECT oi.item_id, oi.order_id, oi.inventory_id, oi.status AS item_status,
                   o.status AS order_status, c.source_lead_id
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            JOIN customers c ON c.customer_id = o.customer_id
            WHERE oi.order_id = $1 AND oi.item_id = $2
              AND o.status IN ('QC Pending', 'Warehouse Pending', 'Procurement Pending')
              AND COALESCE(oi.qc_passed, false) = false
              AND oi.status IN ('Assigned', 'Warehouse')
              AND oi.inventory_id IS NOT NULL
            FOR UPDATE OF oi
            `,
            [orderId, itemId]
        );
        if (ctxRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                message:
                    'Line not found or not eligible (must be Assigned/Warehouse with machine, order in procurement/warehouse/QC queue, not QC-passed)'
            });
        }
        const row = ctxRes.rows[0];

        const newInvRes = await client.query(
            `SELECT inventory_id, machine_number, serial_number, brand, model, processor, ram, storage
             FROM inventory
             WHERE (machine_number = $1 OR UPPER(REPLACE(REPLACE(REPLACE(COALESCE(machine_number,''), ' ', ''), '-', ''), '_', '')) = $2)
               AND status IN ('Ready', 'In Stock')
               AND stock_type IN ('Ready', 'Cooling Period')
               FOR UPDATE SKIP LOCKED`,
            [machineNum, normalized]
        );

        let newInv = null;
        if (newInvRes.rows.length > 0) {
            if (row.inventory_id && newInvRes.rows.some((r) => r.inventory_id === row.inventory_id)) {
                newInv = newInvRes.rows.find((r) => r.inventory_id === row.inventory_id);
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: 'Machine is already assigned to this item.',
                    order_id: row.order_id,
                    new_machine_number: newInv.machine_number,
                    new_serial_number: newInv.serial_number
                });
            }
            newInv = newInvRes.rows[0];
        }

        if (!newInv) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Machine ${machineNum} not found or not available. Use Ready/In Stock inventory (Ready or Cooling stock type).`
            });
        }

        const oldInvId = row.inventory_id;
        const newInvId = newInv.inventory_id;

        if (oldInvId && oldInvId !== newInvId) {
            await client.query(`UPDATE inventory SET status = 'In Repair' WHERE inventory_id = $1`, [oldInvId]);
        }
        await client.query(`UPDATE inventory SET status = 'Reserved' WHERE inventory_id = $1`, [newInvId]);

        await client.query(
            `
            UPDATE order_items
            SET inventory_id = $1,
                brand = $2,
                processor = $3,
                ram = $4,
                storage = $5,
                preferred_model = $6
            WHERE item_id = $7 AND order_id = $8
            `,
            [newInvId, newInv.brand, newInv.processor, newInv.ram, newInv.storage, newInv.model, itemId, orderId]
        );

        if (row.source_lead_id) {
            await syncLeadOrderFromInventoryRow(client, { sourceLeadId: row.source_lead_id, invRow: newInv });
        }

        await logOrderStatusHistory(client, {
            orderId,
            fromStatus: row.order_status,
            toStatus: row.order_status,
            changedBy: req.user.user_id,
            notes: `QC replaced machine on item ${itemId} → ${newInv.machine_number}`
        });

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Machine updated for this line (order, dispatch, lead snapshot aligned).',
            order_id: row.order_id,
            new_machine_number: newInv.machine_number,
            new_serial_number: newInv.serial_number
        });
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (e) {
            console.error(e);
        }
        console.error('qcReplaceOrderItem', err);
        res.status(500).json({ message: err.message || 'Failed to replace machine' });
    } finally {
        client.release();
    }
};

/**
 * QC: send one line back to procurement (releases inventory, creates/reset procurement request, order → Procurement Pending if needed).
 */
exports.qcSendItemToProcurement = async (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.item_id, 10);
    if (!Number.isFinite(orderId) || !Number.isFinite(itemId)) {
        return res.status(400).json({ message: 'Invalid order or item id' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ctxRes = await client.query(
            `
            SELECT oi.item_id, oi.order_id, oi.inventory_id, oi.status AS item_status,
                   o.status AS order_status, c.source_lead_id
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            JOIN customers c ON c.customer_id = o.customer_id
            WHERE oi.order_id = $1 AND oi.item_id = $2
              AND o.status IN ('QC Pending', 'Warehouse Pending', 'Procurement Pending')
              AND COALESCE(oi.qc_passed, false) = false
              AND oi.status IN ('Assigned', 'Warehouse')
            FOR UPDATE OF oi
            `,
            [orderId, itemId]
        );
        if (ctxRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Line not found or not eligible for procurement' });
        }
        const row = ctxRes.rows[0];

        if (row.inventory_id) {
            await client.query(
                `
                UPDATE inventory
                SET status = 'Ready', updated_at = CURRENT_TIMESTAMP
                WHERE inventory_id = $1 AND status = 'Reserved'
                `,
                [row.inventory_id]
            );
        }

        await client.query(
            `
            UPDATE order_items
            SET status = 'Procurement',
                inventory_id = NULL,
                qc_passed = false,
                qc_sales_checklist = NULL,
                qc_sales_passed_at = NULL
            WHERE item_id = $1 AND order_id = $2
            `,
            [itemId, orderId]
        );

        const prExisting = await client.query(`SELECT request_id FROM procurement_requests WHERE order_item_id = $1`, [itemId]);
        if (prExisting.rows.length > 0) {
            await client.query(
                `UPDATE procurement_requests SET status = 'New', updated_at = CURRENT_TIMESTAMP WHERE request_id = $1`,
                [prExisting.rows[0].request_id]
            );
        } else {
            await client.query(`INSERT INTO procurement_requests (order_item_id, status) VALUES ($1, 'New')`, [itemId]);
        }

        await refreshOrderPipelineStatusAfterProcurementChange(
            client,
            orderId,
            req.user.user_id,
            `QC sent order line ${itemId} to procurement`
        );

        if (row.source_lead_id) {
            const merge = JSON.stringify({
                procurement_requested_at: new Date().toISOString(),
                order_item_id: itemId,
                note: 'Line sent to procurement from QC'
            });
            await client.query(
                `
                UPDATE lead_orders
                SET details = COALESCE(details, '{}'::jsonb) || $1::jsonb
                WHERE lead_order_id = (
                    SELECT lead_order_id FROM lead_orders WHERE lead_id = $2 ORDER BY created_at DESC LIMIT 1
                )
                `,
                [merge, row.source_lead_id]
            );
        }

        const statusRes = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [orderId]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Line moved to procurement. Previous machine released to stock where applicable.',
            order_id: orderId,
            order_status: statusRes.rows[0]?.status
        });
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (e) {
            console.error(e);
        }
        console.error('qcSendItemToProcurement', err);
        res.status(500).json({ message: err.message || 'Failed to send line to procurement' });
    } finally {
        client.release();
    }
};

exports.qcPassOrder = async (req, res) => {
    return res.status(400).json({
        message:
            'Batch QC Pass is no longer available. Open order details and complete per-laptop QC (checklist + configuration).'
    });
};

/** @deprecated Use POST /orders/:id/items/:item_id/qc-pass-submit */
exports.qcPassOrderItem = async (req, res) => {
    return res.status(400).json({
        message: 'Use POST /sales/orders/:id/items/:item_id/qc-pass-submit with checklist and optional RAM/storage updates.'
    });
};

/**
 * Per-item sales QC: checklist (required), optional RAM/HDD edits, single transaction across
 * order_items, inventory, leads, and latest lead_orders.details.
 */
exports.qcPassOrderItemSubmit = async (req, res) => {
    const { id, item_id } = req.params;
    const orderId = parseInt(id, 10);
    const itemId = parseInt(item_id, 10);
    const { checklist, ram: ramIn, storage: storageIn } = req.body || {};

    if (!Number.isFinite(orderId) || !Number.isFinite(itemId)) {
        return res.status(400).json({ message: 'Invalid order or item id' });
    }
    if (!validateSalesQcChecklist(checklist)) {
        return res.status(400).json({ message: 'All QC checklist items must be confirmed before submit' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ctxRes = await client.query(
            `
            SELECT
                oi.item_id,
                oi.order_id,
                oi.status AS item_status,
                oi.qc_passed,
                oi.ram,
                oi.storage,
                oi.inventory_id,
                o.status AS order_status,
                c.source_lead_id
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            JOIN customers c ON c.customer_id = o.customer_id
            WHERE oi.order_id = $1 AND oi.item_id = $2
            FOR UPDATE OF oi
            `,
            [orderId, itemId]
        );

        if (ctxRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Order item not found' });
        }

        const row = ctxRes.rows[0];
        const allowedStatuses = ['QC Pending', 'Warehouse Pending', 'Procurement Pending'];
        if (!allowedStatuses.includes(row.order_status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'Order must be in QC Pending, Warehouse Pending, or Procurement Pending'
            });
        }
        if (row.item_status !== 'Assigned') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Only Assigned items (machine linked) can be QC passed' });
        }
        if (row.qc_passed === true) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Item is already QC passed' });
        }

        const prevRamNorm = normalizeSalesSpec(row.ram);
        const prevStorageNorm = normalizeSalesSpec(row.storage);
        const newRam = ramIn !== undefined ? normalizeSalesSpec(ramIn) : prevRamNorm;
        const newStorage = storageIn !== undefined ? normalizeSalesSpec(storageIn) : prevStorageNorm;
        const ramChanged = newRam !== prevRamNorm;
        const storageChanged = newStorage !== prevStorageNorm;

        const checklistRecord = {
            ...checklist,
            recorded_at: new Date().toISOString()
        };

        await client.query(
            `
            UPDATE order_items
            SET ram = $1,
                storage = $2,
                qc_passed = true,
                qc_sales_checklist = $3::jsonb,
                qc_sales_passed_at = CURRENT_TIMESTAMP
            WHERE item_id = $4 AND order_id = $5
            `,
            [newRam, newStorage, JSON.stringify(checklistRecord), itemId, orderId]
        );

        if (row.inventory_id) {
            await client.query(
                `
                UPDATE inventory
                SET ram = $1,
                    storage = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE inventory_id = $3
                `,
                [newRam, newStorage, row.inventory_id]
            );
        }

        if (row.source_lead_id && (ramChanged || storageChanged)) {
            await client.query(
                `
                UPDATE leads
                SET ram = $1,
                    storage = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lead_id = $3
                `,
                [newRam, newStorage, row.source_lead_id]
            );

            const merge = JSON.stringify({ ram: newRam, storage: newStorage });
            await client.query(
                `
                UPDATE lead_orders
                SET details = COALESCE(details, '{}'::jsonb) || $1::jsonb
                WHERE lead_order_id = (
                    SELECT lead_order_id
                    FROM lead_orders
                    WHERE lead_id = $2
                    ORDER BY created_at DESC
                    LIMIT 1
                )
                `,
                [merge, row.source_lead_id]
            );
        }

        if (row.order_status === 'Warehouse Pending') {
            await client.query(
                `UPDATE orders SET status = 'QC Pending',
                    qc_received_at = COALESCE(qc_received_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = $1`,
                [orderId]
            );
        } else if (row.order_status === 'Procurement Pending') {
            await client.query(
                `UPDATE orders SET
                    qc_received_at = COALESCE(qc_received_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = $1`,
                [orderId]
            );
        }

        // Do not require qc_passed on every order_item row (mixed Warehouse + Assigned would block forever).
        const complete = await orderIsFullyQcComplete(client, orderId);

        if (complete) {
            const before = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [orderId]);
            const fromStatus = before.rows[0]?.status || null;
            await client.query(
                `UPDATE orders SET status = 'QC Passed',
                    qc_completed_at = COALESCE(qc_completed_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = $1`,
                [orderId]
            );
            await logOrderStatusHistory(client, {
                orderId,
                fromStatus,
                toStatus: 'QC Passed',
                changedBy: req.user.user_id,
                notes: 'Sales QC: all pipeline items cleared (checklist complete per assigned unit)'
            });
        }

        const finalStatusRes = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [orderId]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Laptop marked as QC Passed',
            order_status: finalStatusRes.rows[0]?.status,
            spec_updated: ramChanged || storageChanged
        });
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error(rollbackErr);
        }
        console.error(error);
        res.status(500).json({ message: 'Failed to complete QC pass' });
    } finally {
        client.release();
    }
};

// Mark as Delivered
exports.markDelivered = async (req, res) => {
    const { id } = req.params;
    try {
        const current = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = current.rows[0]?.status || null;
        if (!fromStatus) {
            return res.status(404).json({ message: 'Order not found' });
        }
        if (!['Dispatched', 'QC Passed'].includes(fromStatus)) {
            return res.status(400).json({ message: 'Only Dispatched orders can be marked Delivered' });
        }
        await pool.query(
            `UPDATE order_items
             SET tracking_status = 'Delivered',
                 delivered_at = CURRENT_TIMESTAMP
             WHERE order_id = $1`,
            [id]
        );
        const updateRes = await pool.query(`UPDATE orders SET status = 'Delivered' WHERE order_id = $1`, [id]);
        if (updateRes.rowCount === 0) return res.status(400).json({ message: 'Failed to mark delivered' });
        await logOrderStatusHistory(pool, {
            orderId: parseInt(id, 10),
            fromStatus,
            toStatus: 'Delivered',
            changedBy: req.user.user_id,
            notes: 'Marked delivered'
        });
        res.json({ success: true, message: 'Order marked as Delivered' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to mark as delivered' });
    }
};

exports.addQCNote = async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    if (!notes || !String(notes).trim()) {
        return res.status(400).json({ message: 'Notes are required' });
    }
    try {
        const current = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = current.rows[0]?.status || null;
        if (!fromStatus) {
            return res.status(404).json({ message: 'Order not found' });
        }
        await logOrderStatusHistory(pool, {
            orderId: parseInt(id, 10),
            fromStatus,
            toStatus: fromStatus,
            changedBy: req.user.user_id,
            notes: `QC Note: ${String(notes).trim()}`
        });
        res.json({ success: true, message: 'QC note added successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add QC note' });
    }
};

exports.cancelOrder = async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = current.rows[0]?.status || null;
        if (!fromStatus) return res.status(404).json({ message: 'Order not found' });
        if (fromStatus === 'Cancelled') return res.status(400).json({ message: 'Order is already cancelled' });

        await client.query(
            `UPDATE orders
             SET status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $1, updated_at = CURRENT_TIMESTAMP
             WHERE order_id = $2`,
            [req.user.user_id, id]
        );

        await client.query(
            `UPDATE inventory SET status = 'In Stock'
             WHERE inventory_id IN (
                SELECT inventory_id FROM order_items WHERE order_id = $1 AND inventory_id IS NOT NULL
             )`,
            [id]
        );

        await client.query(
            `UPDATE procurement_requests
             SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE order_item_id IN (SELECT item_id FROM order_items WHERE order_id = $1)`,
            [id]
        );

        await logOrderStatusHistory(client, {
            orderId: parseInt(id, 10),
            fromStatus,
            toStatus: 'Cancelled',
            changedBy: req.user.user_id,
            notes: reason ? `Cancelled by customer: ${String(reason).trim()}` : 'Cancelled by customer'
        });

        await client.query('COMMIT');
        res.json({ success: true, message: 'Order cancelled successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Failed to cancel order' });
    } finally {
        client.release();
    }
};

exports.updateOrderItemPrice = async (req, res) => {
    const { id, item_id } = req.params;
    const { unit_price, quantity: reqQuantity } = req.body;
    const parsedPrice = unit_price !== undefined && unit_price !== null && unit_price !== ''
        ? parseFloat(unit_price)
        : null;
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
        return res.status(400).json({ message: 'Valid unit price (rent) is required' });
    }
    try {
        const itemRes = await pool.query(
            `SELECT unit_price, quantity FROM order_items WHERE order_id = $1 AND item_id = $2`,
            [id, item_id]
        );
        if (!itemRes.rows.length) return res.status(404).json({ message: 'Order item not found' });
        const currentPrice = parseFloat(itemRes.rows[0].unit_price) || 0;
        const currentQty = parseInt(itemRes.rows[0].quantity, 10) || 1;
        if (reqQuantity !== undefined && reqQuantity !== null && reqQuantity !== '') {
            const attempted = parseInt(reqQuantity, 10);
            if (Number.isInteger(attempted) && attempted !== currentQty) {
                return res.status(400).json({ message: 'Line quantity cannot be changed after the order is placed' });
            }
        }
        const nextPrice = parsedPrice !== null ? parsedPrice : currentPrice;
        const nextQty = currentQty;
        const lineSubtotal = roundMoney(nextPrice * nextQty);
        const lineGst = roundMoney(lineSubtotal * GST_RATE);
        const lineTotal = roundMoney(lineSubtotal + lineGst);

        await pool.query(
            `UPDATE order_items
             SET unit_price = $1, quantity = $2, gst_amount = $3, total_with_gst = $4
             WHERE order_id = $5 AND item_id = $6`,
            [parseFloat(safeMoney(nextPrice)), nextQty, parseFloat(safeMoney(lineGst)), parseFloat(safeMoney(lineTotal)), id, item_id]
        );
        await recalculateOrderFinancials(pool, id);
        const msg = [parsedPrice !== null && 'price'].filter(Boolean).join(' and ');
        res.json({ success: true, message: msg ? `${msg} updated` : 'Updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update order item' });
    }
};

exports.updateOrderCharges = async (req, res) => {
    const { id } = req.params;
    const { security_amount, lockin_period_days } = req.body;
    try {
        const orderRes = await pool.query(`SELECT order_id FROM orders WHERE order_id = $1`, [id]);
        if (!orderRes.rows.length) return res.status(404).json({ message: 'Order not found' });

        const updates = [];
        const values = [];
        let paramCount = 1;
        if (security_amount !== undefined && security_amount !== null && security_amount !== '') {
            const parsed = parseFloat(security_amount);
            if (!Number.isFinite(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'Security amount must be a non-negative number' });
            }
            updates.push(`security_amount = $${paramCount++}`);
            values.push(parseFloat(safeMoney(parsed)));
        }
        if (lockin_period_days !== undefined && lockin_period_days !== null && lockin_period_days !== '') {
            const parsed = parseInt(lockin_period_days, 10);
            if (!Number.isInteger(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'Lock-in days must be a non-negative integer' });
            }
            updates.push(`lockin_period_days = $${paramCount++}`);
            values.push(parsed);
        }
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Provide security_amount and/or lockin_period_days to update' });
        }
        values.push(id);
        await pool.query(
            `UPDATE orders SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE order_id = $${paramCount}`,
            values
        );
        await recalculateOrderFinancials(pool, id);
        res.json({ success: true, message: 'Security and lock-in updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update order charges' });
    }
};

exports.updateOrderItemLogistics = async (req, res) => {
    const { id, item_id } = req.params;
    const {
        delivery_mode,
        customer_address_id,
        shipping_charge,
        delivery_contact_name,
        delivery_contact_phone,
        delivery_address,
        delivery_pincode
    } = req.body;
    try {
        const mode = String(delivery_mode || '').toUpperCase() === 'WFH' ? 'WFH' : 'Office';
        const parsedShipping = mode === 'WFH' ? (parseFloat(shipping_charge) || 0) : 0;
        const orderRes = await pool.query(`SELECT customer_id FROM orders WHERE order_id = $1`, [id]);
        if (!orderRes.rows.length) return res.status(404).json({ message: 'Order not found' });

        let nextAddressId = null;
        let nextContactName = null;
        let nextContactPhone = null;
        let nextDeliveryAddress = null;
        let nextDeliveryPincode = null;
        if (mode === 'Office') {
            if (!customer_address_id) {
                return res.status(400).json({ message: 'Office delivery requires selecting a saved address' });
            }
            const addrRes = await pool.query(
                `SELECT customer_address_id, concern_person, mobile_no, address, pincode
                 FROM customer_addresses
                 WHERE customer_address_id = $1 AND customer_id = $2`,
                [customer_address_id, orderRes.rows[0].customer_id]
            );
            if (!addrRes.rows.length) {
                return res.status(400).json({ message: 'Selected address is invalid for this customer' });
            }
            const selected = addrRes.rows[0];
            nextAddressId = selected.customer_address_id;
            nextContactName = normalizeText(selected.concern_person);
            nextContactPhone = normalizeText(selected.mobile_no);
            nextDeliveryAddress = normalizeText(selected.address);
            nextDeliveryPincode = normalizeText(selected.pincode);
        } else {
            nextContactName = normalizeText(delivery_contact_name);
            nextContactPhone = normalizeText(delivery_contact_phone);
            nextDeliveryAddress = normalizeText(delivery_address);
            nextDeliveryPincode = normalizeText(delivery_pincode);
            if (!nextContactName || !nextContactPhone || !nextDeliveryAddress || !nextDeliveryPincode) {
                return res.status(400).json({ message: 'WFH requires Name, Phone, Address and Pincode' });
            }
            if (parsedShipping <= 0) {
                return res.status(400).json({ message: 'WFH shipping charge must be greater than zero' });
            }
        }

        const updateRes = await pool.query(
            `UPDATE order_items
             SET delivery_mode = $1,
                 customer_address_id = $2,
                 is_wfh = $3,
                 shipping_charge = $4,
                 delivery_contact_name = $5,
                 delivery_contact_phone = $6,
                 delivery_address = $7,
                 delivery_pincode = $8,
                 estimate_id = NULL,
                 destination_pincode = NULL
             WHERE order_id = $9 AND item_id = $10`,
            [
                mode,
                nextAddressId,
                mode === 'WFH',
                parsedShipping,
                nextContactName,
                nextContactPhone,
                nextDeliveryAddress,
                nextDeliveryPincode,
                id,
                item_id
            ]
        );
        if (updateRes.rowCount === 0) return res.status(404).json({ message: 'Order item not found' });

        await recalculateOrderFinancials(pool, id);
        res.json({ success: true, message: 'Order item logistics updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update order item logistics' });
    }
};

exports.updateOrderItemTracking = async (req, res) => {
    const { id, item_id } = req.params;
    const { tracking_status, item_tracker_id, item_courier_partner, item_dispatch_date, item_estimated_delivery } = req.body;
    const safeItemDispatchDate = normalizeOptionalDate(item_dispatch_date);
    const safeItemEstimatedDelivery = normalizeOptionalDate(item_estimated_delivery);
    const validStatuses = new Set(['Not Dispatched', 'On The Way', 'Delivered']);
    if (!validStatuses.has(tracking_status)) {
        return res.status(400).json({ message: 'Invalid tracking status' });
    }
    try {
        const updateRes = await pool.query(
            `UPDATE order_items
             SET tracking_status = $1::varchar,
                 item_tracker_id = CASE WHEN $1::varchar = 'Not Dispatched' THEN NULL ELSE COALESCE($2::varchar, item_tracker_id) END,
                 item_courier_partner = CASE WHEN $1::varchar = 'Not Dispatched' THEN NULL ELSE COALESCE($3::varchar, item_courier_partner) END,
                 item_dispatch_date = CASE
                    WHEN $1::varchar = 'Not Dispatched' THEN NULL
                    WHEN $1::varchar = 'On The Way' THEN COALESCE($4::date, item_dispatch_date, CURRENT_DATE)
                    ELSE COALESCE(item_dispatch_date, $4::date, CURRENT_DATE)
                 END,
                 item_estimated_delivery = CASE WHEN $1::varchar = 'Not Dispatched' THEN NULL ELSE COALESCE($5::date, item_estimated_delivery) END,
                 delivered_at = CASE WHEN $1::varchar = 'Delivered' THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE order_id = $6::int AND item_id = $7::int`,
            [tracking_status, item_tracker_id ?? null, item_courier_partner ?? null, safeItemDispatchDate, safeItemEstimatedDelivery, id, item_id]
        );
        if (updateRes.rowCount === 0) return res.status(404).json({ message: 'Order item not found' });

        const statusBefore = await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [id]);
        const fromStatus = statusBefore.rows[0]?.status || null;
        const recalculatedStatus = await recalculateOrderTrackingStatus(pool, id);
        if (recalculatedStatus && fromStatus && fromStatus !== recalculatedStatus) {
            await logOrderStatusHistory(pool, {
                orderId: parseInt(id, 10),
                fromStatus,
                toStatus: recalculatedStatus,
                changedBy: req.user.user_id,
                notes: `Laptop item #${item_id} updated to ${tracking_status}`
            });
        }

        res.json({ success: true, message: 'Laptop tracking updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update laptop tracking' });
    }
};
