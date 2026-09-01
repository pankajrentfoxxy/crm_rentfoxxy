'use strict';

/**
 * Renders customer invoice HTML to PDF via Puppeteer (Chromium).
 * Server needs Chrome runtime libs — on Ubuntu 24.04+:
 *   apt install libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libnss3 \
 *     libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libpango-1.0-0 libcairo2 \
 *     libx11-xcb1 libxshmfence1 libasound2t64 fonts-liberation
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { buildInvoiceHtml, loadCompany } = require('./customerInvoiceHtmlService');

const UPLOAD_DIR = path.join(__dirname, '../uploads/customer-invoices');

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
  }
  return browserPromise;
}

async function renderHtmlToPdf(html, filePath) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '14mm', right: '12mm', bottom: '18mm', left: '12mm' },
    });
  } finally {
    await page.close();
  }
}

async function generateCustomerInvoicePdf(invoice) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${invoice.invoice_number}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/customer-invoices/${fileName}`;

  const company = await loadCompany(invoice.entity_code || 'rentfoxxy');
  const html = buildInvoiceHtml(invoice, company);
  await renderHtmlToPdf(html, filePath);
  return relativePath;
}

module.exports = {
  generateCustomerInvoicePdf,
  UPLOAD_DIR,
};
