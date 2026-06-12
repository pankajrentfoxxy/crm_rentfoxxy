const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const pool = require('../config/db');

const UPLOAD_DIR = path.join(__dirname, '../uploads/sales-documents');

/** Load entity branding for a document (legal name, GSTIN, logo). */
async function loadCompany(entityCode) {
  const code = entityCode === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
  try {
    const r = await pool.query(
      `SELECT code, legal_name, gstin, address, logo_url FROM companies WHERE code = $1`,
      [code]
    );
    if (r.rows.length) return r.rows[0];
  } catch (_) { /* companies table may not exist pre-migration */ }
  return {
    code,
    legal_name: code === 'gorefurbo' ? 'Gorefurbo' : 'Rentfoxxy Technologies Pvt Ltd',
    gstin: null,
    address: null,
    logo_url: null,
  };
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

async function generateDocumentPdf({ docType, docNumber, header, lines }) {
  ensureUploadDir();
  const fileName = `${docNumber}_${Date.now()}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/sales-documents/${fileName}`;

  // Entity branding: Sales -> Gorefurbo, Rental/Demo -> Rentfoxxy.
  const company = await loadCompany(header?.entity_code);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const title = docType === 'quotation' ? 'Quotation' : docType === 'sales_order' ? 'Sales Order' : 'Delivery Challan';
    if (company.logo_url) {
      try {
        const logoAbs = company.logo_url.startsWith('uploads')
          ? path.join(__dirname, '..', company.logo_url) : null;
        if (logoAbs && fs.existsSync(logoAbs)) doc.image(logoAbs, 40, 30, { width: 90 });
      } catch (_) { /* ignore logo failures */ }
    }
    doc.fontSize(18).text(`${company.legal_name} — ${title}`, { align: 'center' });
    doc.moveDown(0.3);
    if (company.gstin) doc.fontSize(9).text(`Seller GSTIN: ${company.gstin}`, { align: 'center' });
    if (company.address) doc.fontSize(8).text(company.address, { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Document No: ${docNumber}`);
    if (header?.customer_name) doc.text(`Customer: ${header.customer_name}`);
    if (header?.customer_email) doc.text(`Email: ${header.customer_email}`);
    if (header?.gst_number) doc.text(`Buyer GST: ${header.gst_number}`);
    doc.moveDown();

    lines.forEach((line, idx) => {
      doc.fontSize(10).text(
        `${idx + 1}. ${line.brand || ''} ${line.model_name || ''} | ${line.processor || ''} ${line.generation || ''} | Qty: ${line.quantity} | Rate: ${line.rate}`
      );
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return relativePath;
}

async function emailDocument({ to, subject, text, pdfRelativePath, cc }) {
  const transport = getMailTransport();
  if (!transport || !to) return false;
  const abs = path.join(__dirname, '..', pdfRelativePath);
  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments: fs.existsSync(abs) ? [{ filename: path.basename(abs), path: abs }] : [],
  };
  if (cc) mail.cc = cc;
  await transport.sendMail(mail);
  return true;
}

module.exports = { generateDocumentPdf, emailDocument };
