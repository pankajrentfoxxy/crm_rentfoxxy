'use strict';

const fs = require('fs');
const path = require('path');
const { buildVendorBillHtml, loadCompany } = require('./vendorBillHtmlService');

const UPLOAD_DIR = path.join(__dirname, '../uploads/vendor-bills');

function vendorBillPdfDownloadName(billNumber) {
  return `${String(billNumber || 'vendor-bill').trim()}.pdf`;
}

async function generateVendorBillPdf(bill) {
  const { renderHtmlToPdf } = require('./customerInvoicePdfService');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${bill.bill_number}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/vendor-bills/${fileName}`;
  const company = await loadCompany('rentfoxxy');
  const html = await buildVendorBillHtml(bill, company);
  await renderHtmlToPdf(html, filePath);
  return relativePath;
}

module.exports = {
  generateVendorBillPdf,
  vendorBillPdfDownloadName,
};
