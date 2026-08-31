/**
 * Production QC Report PDF generation (list + detail).
 */
const PDFDocument = require('pdfkit');

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pipePdf(doc, res, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
}

function drawFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 28;
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(
        `Generated ${fmtDateTime(new Date())} · Page ${i - range.start + 1} of ${range.count}`,
        36,
        bottom,
        { width: doc.page.width - 72, align: 'center' }
      );
  }
}

function ensureSpace(doc, y, need = 40) {
  if (y + need < doc.page.height - 48) return y;
  doc.addPage();
  return 40;
}

function buildProductionQcListPdf(rows, filters = {}, options = {}) {
  const includeCustomerVendor = options.includeCustomerVendor !== false;
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 28,
        bufferPages: true,
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
        .text('Production QC Report', 28, 28);
      doc.font('Helvetica').fontSize(9).fillColor('#475569');
      const filterBits = [];
      if (filters.date_from) filterBits.push(`From ${filters.date_from}`);
      if (filters.date_to) filterBits.push(`To ${filters.date_to}`);
      if (filters.stage) filterBits.push(`Stage ${filters.stage}`);
      if (filters.qc_status) filterBits.push(`Status ${filters.qc_status}`);
      if (filters.technician_id) filterBits.push(`Technician #${filters.technician_id}`);
      if (filters.ttspl) filterBits.push(`TTSPL ${filters.ttspl}`);
      if (filters.serial) filterBits.push(`Serial ${filters.serial}`);
      if (filters.brand) filterBits.push(`Brand ${filters.brand}`);
      if (filters.model) filterBits.push(`Model ${filters.model}`);
      if (filters.customer && includeCustomerVendor) filterBits.push(`Customer ${filters.customer}`);
      doc.text(
        `${rows.length} record(s)${filterBits.length ? ` · ${filterBits.join(' · ')}` : ''}`,
        28,
        48,
        { width: doc.page.width - 56 }
      );

      const cols = [
        { key: 'ttspl_id', label: 'TTSPL', w: 70 },
        { key: 'serial_number', label: 'Serial', w: 72 },
        { key: 'technician_name', label: 'Technician', w: 78 },
        ...(includeCustomerVendor ? [{ key: 'customer_vendor', label: 'Customer/Vendor', w: 100 }] : []),
        { key: 'qc_stage', label: 'QC Stage', w: 50 },
        { key: 'current_stage', label: 'Stage', w: 70 },
        { key: 'when', label: 'QC Date/Time', w: 90 },
        { key: 'qc_status', label: 'Status', w: 40 },
        { key: 'qc_remarks', label: 'Remarks', w: 110 },
      ];

      let y = 68;
      const drawHeader = () => {
        let x = 28;
        doc.rect(28, y, doc.page.width - 56, 16).fill('#e2e8f0');
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#0f172a');
        cols.forEach((c) => {
          doc.text(c.label, x + 2, y + 4, { width: c.w - 4, ellipsis: true });
          x += c.w;
        });
        y += 18;
      };
      drawHeader();

      doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
      rows.forEach((row, idx) => {
        y = ensureSpace(doc, y, 28);
        if (y === 40) drawHeader();
        if (idx % 2 === 0) {
          doc.rect(28, y - 2, doc.page.width - 56, 14).fill('#f8fafc');
          doc.fillColor('#1e293b');
        }
        let x = 28;
        const values = {
          ttspl_id: row.ttspl_id || '—',
          serial_number: row.serial_number || '—',
          technician_name: row.technician_name || '—',
          customer_vendor: row.customer_vendor || '—',
          qc_stage: row.qc_stage || '—',
          current_stage: row.current_stage || '—',
          when: fmtDateTime(row.submitted_at),
          qc_status: row.qc_status || '—',
          qc_remarks: row.qc_remarks || '—',
        };
        cols.forEach((c) => {
          doc.text(String(values[c.key]), x + 2, y, { width: c.w - 4, ellipsis: true, lineBreak: false });
          x += c.w;
        });
        y += 14;
      });

      if (!rows.length) {
        doc.font('Helvetica').fontSize(10).fillColor('#64748b')
          .text('No QC reports found for the selected filters.', 28, y + 12);
      }

      drawFooter(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function buildProductionQcDetailPdf(detail, options = {}) {
  const includeCustomerVendor = options.includeCustomerVendor !== false;
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
        .text('Production QC Checklist', 40, 40);
      doc.font('Helvetica').fontSize(9).fillColor('#475569')
        .text(
          `${detail.ttspl_id || '—'} · ${detail.serial_number || '—'} · ${detail.qc_stage || '—'} · Attempt #${detail.attempt_no || 1}`,
          40,
          62,
          { width: 515 }
        );

      let y = 84;
      const meta = [
        ['Technician', detail.technician_name],
        ['Checked By', detail.checked_by_name],
        ...(includeCustomerVendor ? [['Customer / Vendor', detail.customer_vendor]] : []),
        ['Brand / Model', [detail.brand, detail.model].filter(Boolean).join(' · ') || null],
        ['Current Stage', detail.current_stage],
        ['QC Date & Time', fmtDateTime(detail.submitted_at)],
        ['QC Status', detail.qc_status],
        ['Final Grade', detail.final_grade],
        ['QC Remarks', detail.qc_remarks],
      ];
      doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
      meta.forEach(([label, value]) => {
        y = ensureSpace(doc, y, 16);
        doc.font('Helvetica-Bold').text(`${label}:`, 40, y, { continued: true, width: 515 });
        doc.font('Helvetica').text(` ${value || '—'}`);
        y = doc.y + 4;
      });

      y += 8;
      y = ensureSpace(doc, y, 24);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Component Checklist', 40, y);
      y += 16;

      const headerY = y;
      doc.rect(40, headerY, 515, 16).fill('#e2e8f0');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
      doc.text('Component', 44, headerY + 4, { width: 130 });
      doc.text('Result', 180, headerY + 4, { width: 80 });
      doc.text('Checked By', 270, headerY + 4, { width: 120 });
      doc.text('Checked At', 400, headerY + 4, { width: 150 });
      y = headerY + 20;

      const components = detail.components || [];
      components.forEach((comp, idx) => {
        y = ensureSpace(doc, y, 18);
        if (y === 40) {
          doc.rect(40, y, 515, 16).fill('#e2e8f0');
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
          doc.text('Component', 44, y + 4, { width: 130 });
          doc.text('Result', 180, y + 4, { width: 80 });
          doc.text('Checked By', 270, y + 4, { width: 120 });
          doc.text('Checked At', 400, y + 4, { width: 150 });
          y += 20;
        }
        if (idx % 2 === 0) {
          doc.rect(40, y - 2, 515, 14).fill('#f8fafc');
        }
        doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
        doc.text(comp.component || '—', 44, y, { width: 130, ellipsis: true, lineBreak: false });
        doc.text(comp.check_result || 'Not Checked', 180, y, { width: 80, ellipsis: true, lineBreak: false });
        doc.text(comp.checked_by || '—', 270, y, { width: 120, ellipsis: true, lineBreak: false });
        doc.text(fmtDateTime(comp.checked_at), 400, y, { width: 150, ellipsis: true, lineBreak: false });
        y += 14;
      });

      drawFooter(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  buildProductionQcListPdf,
  buildProductionQcDetailPdf,
  pipePdf,
};
