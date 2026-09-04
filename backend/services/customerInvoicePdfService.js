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
const {
  buildInvoiceHtmlByFormat,
  loadCompany,
  normalizeInvoiceFormat,
  LAPTOP_DETAILS_DOCUMENT,
  laptopDetailsPdfDownloadName,
} = require('./customerInvoiceHtmlService');

const UPLOAD_DIR = path.join(__dirname, '../uploads/customer-invoices');

function invoicePdfDownloadName(invoiceNumber, format) {
  return normalizeInvoiceFormat(format) === 'laptop_details'
    ? laptopDetailsPdfDownloadName(invoiceNumber)
    : `${invoiceNumber}.pdf`;
}

function sanitizeCustomerFileName(name) {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w\s.&()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || 'Customer';
}

function uniqueCustomerPdfName(customerName, invoiceNumber, used) {
  const base = sanitizeCustomerFileName(customerName || invoiceNumber);
  let fileName = `${base}.pdf`;
  if (used.has(fileName.toLowerCase())) {
    fileName = `${base} - ${invoiceNumber || 'invoice'}.pdf`;
  }
  used.add(fileName.toLowerCase());
  return fileName;
}

let browserPromise = null;

async function resolveChromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(__dirname, '../.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch (err) {
    throw new Error(
      'puppeteer is not installed for invoice PDF generation. Run: cd backend && npm install puppeteer'
    );
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = loadPuppeteer();
    const executablePath = await resolveChromeExecutable();
    if (!executablePath) {
      throw new Error(
        'Chrome is not installed for invoice PDF generation. Run: cd backend && PUPPETEER_CACHE_DIR=.cache/puppeteer npx puppeteer browsers install chrome'
      );
    }
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath,
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

async function generateCustomerInvoicePdf(invoice, options = {}) {
  const format = normalizeInvoiceFormat(options.format);
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const suffix = format === 'laptop_details' ? `-${LAPTOP_DETAILS_DOCUMENT.fileSuffix}` : '';
  const fileName = `${invoice.invoice_number}${suffix}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/customer-invoices/${fileName}`;

  const company = await loadCompany(invoice.entity_code || 'rentfoxxy');
  const html = await buildInvoiceHtmlByFormat(invoice, company, format);
  await renderHtmlToPdf(html, filePath);
  return relativePath;
}

module.exports = {
  generateCustomerInvoicePdf,
  invoicePdfDownloadName,
  sanitizeCustomerFileName,
  uniqueCustomerPdfName,
  UPLOAD_DIR,
};
