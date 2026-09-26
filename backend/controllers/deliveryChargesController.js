const fs = require('fs');
const path = require('path');
const {
  MONTH_LABELS,
  parsePeriod,
  listMonthCharges,
  groupByCustomer,
  getMonthReport,
  buildCustomerStatementHtml,
} = require('../services/deliveryChargesService');
const { renderHtmlToPdf, sanitizeCustomerFileName } = require('../services/customerInvoicePdfService');

const TMP_DIR = path.join(__dirname, '../uploads/delivery-charges');

function sendError(res, err, label) {
  if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
  console.error(`${label}:`, err);
  return res.status(500).json({ success: false, message: err.message || 'Request failed' });
}

exports.getDeliveryCharges = async (req, res) => {
  try {
    const report = await getMonthReport(req.query);
    res.json({ success: true, ...report });
  } catch (err) {
    sendError(res, err, 'getDeliveryCharges');
  }
};

exports.exportDeliveryChargesExcel = async (req, res) => {
  try {
    const { month, year } = parsePeriod(req.query);
    const rows = await listMonthCharges({ month, year, customerId: req.query.customer_id, search: req.query.search });
    const customers = groupByCustomer(rows);
    const period = `${MONTH_LABELS[month]} ${year}`;

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    const summary = customers.map((c) => ({
      Month: period,
      Customer: c.customer_name,
      GSTIN: c.gst_number || '',
      'Billing Address': c.billing_address || '',
      DCs: c.dc_count,
      Laptops: c.laptop_qty,
      'Delivery Charges': c.total,
    }));
    summary.push({
      Month: '',
      Customer: 'TOTAL',
      GSTIN: '',
      'Billing Address': '',
      DCs: rows.length,
      Laptops: rows.reduce((s, r) => s + r.laptop_qty, 0),
      'Delivery Charges': Number(rows.reduce((s, r) => s + r.delivery_charge, 0).toFixed(2)),
    });
    const ws1 = XLSX.utils.json_to_sheet(summary);
    ws1['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 18 }, { wch: 60 }, { wch: 6 }, { wch: 8 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Customer Summary');

    const details = rows.map((r) => ({
      Month: period,
      Customer: r.customer_name,
      'DC Number': r.dc_number,
      'Sales Order': r.sales_order_number || '',
      'Dispatch Date': r.dispatched_at ? new Date(r.dispatched_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
      'Delivery Contact': r.delivery_contact,
      'Delivery Address': r.delivery_address,
      Laptops: r.laptop_qty,
      Courier: r.courier_name || '',
      AWB: r.awb_number || '',
      'DC Status': r.status || '',
      'Delivery Charges': r.delivery_charge,
    }));
    const ws2 = XLSX.utils.json_to_sheet(details);
    ws2['!cols'] = [
      { wch: 10 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 28 },
      { wch: 70 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'DC Details');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const scope = req.query.customer_id && customers[0]
      ? `${sanitizeCustomerFileName(customers[0].customer_name)}_`
      : '';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="delivery_charges_${scope}${MONTH_LABELS[month]}_${year}.xlsx"`);
    res.send(buf);
  } catch (err) {
    sendError(res, err, 'exportDeliveryChargesExcel');
  }
};

exports.downloadDeliveryChargesStatement = async (req, res) => {
  let filePath;
  try {
    const { month, year } = parsePeriod(req.query);
    const customerId = parseInt(req.query.customer_id, 10);
    if (!Number.isInteger(customerId)) return res.status(400).json({ success: false, message: 'customer_id required' });

    const rows = await listMonthCharges({ month, year, customerId });
    const [group] = groupByCustomer(rows);
    if (!group) return res.status(404).json({ success: false, message: 'No delivery charges for this customer in this month' });

    const html = await buildCustomerStatementHtml(group, { month, year });
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    filePath = path.join(TMP_DIR, `dc-charges-${customerId}-${year}-${month}-${Date.now()}.pdf`);
    await renderHtmlToPdf(html, filePath);

    const name = `Delivery-Charges-${sanitizeCustomerFileName(group.customer_name)}-${MONTH_LABELS[month]}-${year}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(fs.readFileSync(filePath));
  } catch (err) {
    sendError(res, err, 'downloadDeliveryChargesStatement');
  } finally {
    if (filePath) fs.promises.unlink(filePath).catch(() => {});
  }
};
