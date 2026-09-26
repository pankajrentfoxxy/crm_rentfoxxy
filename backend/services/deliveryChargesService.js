'use strict';

/**
 * Delivery (shipping) charges to collect from customers, month by month.
 *
 * These are NOT billed on the monthly rental invoice. Each outbound DC carries
 * its own `shiping_charges` (copied from the sales order); a DC belongs to the
 * month it was dispatched (IST, falling back to its creation date). Rejected and
 * cancelled DCs never reached the customer, so they are left out.
 *
 * Return DCs count too: a return pickup from a work-from-home employee is
 * chargeable (Rs 799 + GST, claude/carret-support.md) and Support puts that on
 * the Return DC's `shiping_charges`. A return DC belongs to the month the pickup
 * was dispatched. Return DCs often carry no customer name, so it falls back to
 * the customer record.
 *
 * Read-only: nothing here writes to the database.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { loadCompany } = require('./customerInvoiceHtmlService');
const { amountInIndianWords } = require('../utils/indianAmountWords');
const { formatPdfDateIst } = require('../utils/pdfDateTimeUtils');
const { fmtMoneyInr, escapeHtml } = require('../utils/invoiceItemFormatting');

const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CSS_PATH = path.join(__dirname, '../templates/rentfoxxy-invoice.css');
const LOGO_PATH = path.join(__dirname, '../assets/rentfoxxy-logo.png');

// One row per DC. Header fields repeat on every line of a DC, so MAX() is safe.
const DC_CHARGES_CTE = `
  WITH dc AS (
    SELECT dcl.dc_number,
           MAX(dcl.customer_id) AS customer_id,
           MAX(dcl.customer_name) AS dcl_customer_name,
           MAX(COALESCE(dcl.movement_type, 'outbound')) AS movement_type,
           MAX(dcl.sales_order_number) AS sales_order_number,
           MAX(dcl.gst_number) AS dcl_gst_number,
           MAX(dcl.status) AS status,
           MAX(dcl.entity_code) AS entity_code,
           MAX(dcl.courier_name) AS courier_name,
           MAX(dcl.awb_number) AS awb_number,
           MAX(COALESCE(dcl.shiping_charges, 0)) AS delivery_charge,
           (ARRAY_AGG(dcl.customer_shipping_address) FILTER (WHERE dcl.customer_shipping_address IS NOT NULL))[1] AS shipping_address,
           (ARRAY_AGG(dcl.customer_billing_address) FILTER (WHERE dcl.customer_billing_address IS NOT NULL))[1] AS billing_address,
           SUM(COALESCE(dcl.main_qty, dcl.quantity, 0))::int AS laptop_qty,
           MAX(COALESCE(dcl.dispatched_at, dcl.created_at)) AS dispatched_at,
           MAX(COALESCE(dcl.delivered_at, dcl.delivery_completed_at)) AS delivered_at
      FROM delivery_challan_lines dcl
     WHERE COALESCE(dcl.movement_type, 'outbound') IN ('outbound', 'return')
     GROUP BY dcl.dc_number
  ),
  charged AS (
    SELECT dc.*,
           COALESCE(NULLIF(dc.dcl_customer_name, ''), c.company_name, c.name) AS customer_name,
           COALESCE(NULLIF(dc.dcl_gst_number, ''), c.gst_no) AS gst_number,
           EXTRACT(MONTH FROM dc.dispatched_at AT TIME ZONE 'Asia/Kolkata')::int AS charge_month,
           EXTRACT(YEAR FROM dc.dispatched_at AT TIME ZONE 'Asia/Kolkata')::int AS charge_year
      FROM dc
      LEFT JOIN customers c ON c.customer_id = dc.customer_id
     WHERE dc.delivery_charge > 0
       AND LOWER(COALESCE(dc.status, '')) NOT IN ('rejected', 'cancelled')
  )`;

function parsePeriod(query) {
  const month = parseInt(query.month, 10);
  const year = parseInt(query.year, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error('Valid month (1-12) required'), { status: 400 });
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw Object.assign(new Error('Valid year required'), { status: 400 });
  return { month, year };
}

function formatAddress(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const cityLine = [addr.city, addr.state].filter(Boolean).join(', ');
  return [addr.address, cityLine, addr.pincode]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(', ');
}

function contactLine(addr) {
  if (!addr || typeof addr !== 'object') return '';
  return [addr.name, addr.phone].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
}

function shapeRow(r) {
  return {
    dc_number: r.dc_number,
    movement_type: r.movement_type,
    kind: r.movement_type === 'return' ? 'Return pickup' : 'Delivery',
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    sales_order_number: r.sales_order_number,
    gst_number: r.gst_number,
    status: r.status,
    entity_code: r.entity_code,
    courier_name: r.courier_name,
    awb_number: r.awb_number,
    laptop_qty: Number(r.laptop_qty || 0),
    delivery_charge: Number(r.delivery_charge || 0),
    dispatched_at: r.dispatched_at,
    delivered_at: r.delivered_at,
    delivery_contact: contactLine(r.shipping_address),
    delivery_address: formatAddress(r.shipping_address),
    billing_address: formatAddress(r.billing_address),
  };
}

/** Every charged DC for one month, optionally narrowed to a customer or a search term. */
async function listMonthCharges({ month, year, customerId, search }) {
  const params = [month, year];
  const where = ['charge_month = $1', 'charge_year = $2'];
  if (customerId) {
    params.push(Number(customerId));
    where.push(`customer_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(customer_name ILIKE ${p} OR dc_number ILIKE ${p} OR sales_order_number ILIKE ${p}
                 OR shipping_address::text ILIKE ${p})`);
  }
  const res = await pool.query(
    `${DC_CHARGES_CTE}
     SELECT * FROM charged
      WHERE ${where.join(' AND ')}
      ORDER BY customer_name, dispatched_at, dc_number`,
    params,
  );
  return res.rows.map(shapeRow);
}

function groupByCustomer(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.customer_id ?? `name:${row.customer_name}`;
    if (!map.has(key)) {
      map.set(key, {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        gst_number: row.gst_number,
        billing_address: row.billing_address,
        entity_code: row.entity_code,
        dc_count: 0,
        laptop_qty: 0,
        total: 0,
        dcs: [],
      });
    }
    const g = map.get(key);
    g.dc_count += 1;
    g.laptop_qty += row.laptop_qty;
    g.total += row.delivery_charge;
    g.dcs.push(row);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      total: Number(g.total.toFixed(2)),
      dcs: g.dcs.sort((a, b) => new Date(a.dispatched_at) - new Date(b.dispatched_at)),
    }))
    .sort((a, b) => b.total - a.total || String(a.customer_name).localeCompare(String(b.customer_name)));
}

/** Month-by-month totals for the trailing 12 months ending at the given period. */
async function monthlyTrend({ month, year }) {
  const endIdx = year * 12 + (month - 1);
  const startIdx = endIdx - 11;
  const res = await pool.query(
    `${DC_CHARGES_CTE}
     SELECT charge_year, charge_month,
            COUNT(*)::int AS dc_count,
            COUNT(DISTINCT COALESCE(customer_id::text, customer_name))::int AS customer_count,
            SUM(delivery_charge)::numeric AS total
       FROM charged
      WHERE (charge_year * 12 + charge_month - 1) BETWEEN $1 AND $2
      GROUP BY 1, 2`,
    [startIdx, endIdx],
  );
  const byKey = new Map(res.rows.map((r) => [`${r.charge_year}-${r.charge_month}`, r]));
  const out = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    const r = byKey.get(`${y}-${m}`);
    out.push({
      year: y,
      month: m,
      label: `${MONTH_LABELS[m]} ${y}`,
      dc_count: r ? r.dc_count : 0,
      customer_count: r ? r.customer_count : 0,
      total: r ? Number(r.total) : 0,
    });
  }
  return out;
}

async function getMonthReport(query) {
  const { month, year } = parsePeriod(query);
  const rows = await listMonthCharges({
    month,
    year,
    customerId: query.customer_id,
    search: query.search,
  });
  const customers = groupByCustomer(rows);
  const total = rows.reduce((s, r) => s + r.delivery_charge, 0);
  return {
    month,
    year,
    label: `${MONTH_LABELS[month]} ${year}`,
    summary: {
      customer_count: customers.length,
      dc_count: rows.length,
      laptop_qty: rows.reduce((s, r) => s + r.laptop_qty, 0),
      total: Number(total.toFixed(2)),
    },
    customers,
    trend: await monthlyTrend({ month, year }),
  };
}

function fmtDate(d) {
  return formatPdfDateIst(d, { fallback: '—', withLabel: false });
}

function logoDataUri() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return '';
    return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch {
    return '';
  }
}

/** Per-customer statement of the month's delivery charges, sent alongside the next rental invoice. */
async function buildCustomerStatementHtml(group, { month, year }) {
  const company = await loadCompany(group.entity_code);
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const logo = logoDataUri();
  const period = `${MONTH_LABELS[month]} ${year}`;

  const bodyRows = group.dcs.map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(d.dc_number)}<div style="color:#64748b;font-size:9px">${escapeHtml([d.movement_type === 'return' ? d.kind : '', d.sales_order_number].filter(Boolean).join(' · '))}</div></td>
      <td>${escapeHtml(fmtDate(d.dispatched_at))}</td>
      <td>${escapeHtml(d.delivery_contact || '—')}<div style="color:#475569">${escapeHtml(d.delivery_address || '—')}</div></td>
      <td class="num">${d.laptop_qty || '—'}</td>
      <td class="num">${fmtMoneyInr(d.delivery_charge)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Delivery charges – ${escapeHtml(group.customer_name)} – ${period}</title>
<style>${css}</style>
</head>
<body>
<table class="head">
  <tr>
    <td>
      ${logo ? `<img class="brand-img" src="${logo}" alt="Rentfoxxy">` : '<div class="brand">rent<span>foxxy</span></div>'}
    </td>
    <td class="doc-title">
      <div class="kind">Delivery Charges</div>
      <div class="sub">Statement for ${period}</div>
    </td>
  </tr>
</table>

<table class="supplier">
  <tr>
    <td>
      <div class="name">${escapeHtml(company.legal_name)}</div>
      <div class="addr">${escapeHtml(company.address || '')}${company.gstin ? ` &nbsp;|&nbsp; GSTIN ${escapeHtml(company.gstin)}` : ''}</div>
    </td>
  </tr>
</table>

<table class="meta">
  <tr>
    <td class="block">
      <h3>Customer</h3>
      <div class="party">${escapeHtml(group.customer_name)}</div>
      <div class="addr">${escapeHtml(group.billing_address || '')}</div>
      ${group.gst_number ? `<table class="kv" style="margin-top:6px"><tr><td>GSTIN</td><td>${escapeHtml(group.gst_number)}</td></tr></table>` : ''}
    </td>
    <td class="block">
      <h3>Summary</h3>
      <table class="kv">
        <tr><td>Period</td><td>${period}</td></tr>
        <tr><td>Deliveries</td><td>${group.dc_count}</td></tr>
        <tr><td>Laptops</td><td>${group.laptop_qty}</td></tr>
      </table>
    </td>
  </tr>
</table>

<table class="items">
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:17%">DC / SO</th>
      <th style="width:13%">Dispatched</th>
      <th style="width:50%">Delivery address</th>
      <th class="num" style="width:5%">Qty</th>
      <th class="num" style="width:11%">Charge</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows || '<tr><td colspan="6">No deliveries</td></tr>'}
  </tbody>
</table>

<table class="totals-wrap">
  <tr>
    <td class="words-cell">
      <div class="words">
        <div class="lbl">Amount in words</div>
        <div class="val">${escapeHtml(amountInIndianWords(group.total))}</div>
      </div>
    </td>
    <td>
      <table class="totals" align="right">
        <tr class="grand"><td>Total delivery charges</td><td>${fmtMoneyInr(group.total)}</td></tr>
      </table>
    </td>
  </tr>
</table>

<div class="computer">Delivery charges are billed separately from the monthly rental invoice. This is a computer-generated statement.</div>
</body>
</html>`;
}

module.exports = {
  MONTH_LABELS,
  parsePeriod,
  listMonthCharges,
  groupByCustomer,
  getMonthReport,
  buildCustomerStatementHtml,
};
