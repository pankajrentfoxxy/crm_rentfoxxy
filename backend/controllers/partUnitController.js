/**
 * Physical part units: scan resolution and QR label printing.
 *
 * The QR carries only the Part ID, so `lookupPartUnit` is what turns a scan
 * into the full picture — part details, the PO and vendor it came from, its
 * serial, current status and where it ended up installed.
 */
const pool = require('../config/db');
const { buildLabelPdf, renderQrPng, DEFAULT_LABEL_MM } = require('../services/partLabelService');

const UNIT_SELECT = `
  SELECT pi.instance_id, pi.prt_id, pi.serial_number, pi.asset_code, pi.part_id,
         pi.status, pi.location_code, pi.unit_cost, pi.notes, pi.source,
         pi.spo_id, pi.grn_id, pi.spo_line_index, pi.vendor_id, pi.vendor_serial_id,
         pi.installed_ttspl_id, pi.installed_ticket_id, pi.installed_at,
         pi.removed_from_ttspl_id, pi.removed_from_ticket_id, pi.condition_on_removal,
         pi.received_at, pi.created_at, pi.label_print_count, pi.label_last_printed_at,
         p.part_name, p.category, p.part_type, p.model_number, p.pin_size,
         p.quantity AS catalog_stock,
         vsn.serial_number AS procurement_serial,
         vsn.inventory_asset_code,
         spo.purchase_order_number, spo.purchase_order_date,
         COALESCE(NULLIF(TRIM(vend.business_name), ''), NULLIF(TRIM(vend.first_name), '')) AS vendor_name,
         COALESCE(pi.vendor_id, spo.vendor_id) AS resolved_vendor_id,
         t.ttspl_id AS installed_on_ttspl, t.brand AS laptop_brand, t.model AS laptop_model
    FROM part_instances pi
    JOIN parts p                              ON p.part_id = pi.part_id
    LEFT JOIN vendor_serial_numbers vsn       ON vsn.serial_id = pi.vendor_serial_id
    LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pi.spo_id
    LEFT JOIN vendors vend                    ON vend.vendor_id = COALESCE(pi.vendor_id, spo.vendor_id)
    LEFT JOIN tickets t                       ON t.ticket_id = pi.installed_ticket_id
`;

/** Pull the ordered line this unit came from so the scan shows PO specs. */
async function attachPoLine(unit) {
  if (!unit.spo_id) return null;
  const r = await pool.query(
    `SELECT line_items FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1`,
    [unit.spo_id]
  );
  const raw = r.rows[0]?.line_items;
  const lines = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })();
  if (!lines.length) return null;
  const idx = unit.spo_line_index != null ? Number(unit.spo_line_index) : -1;
  const line = idx >= 0 ? lines[idx] : lines.find((l) => String(l?.spare_part_name || l?.name || '').toLowerCase() === String(unit.part_name || '').toLowerCase());
  if (!line) return null;
  return {
    brand_name: line.brand_name || null,
    part_type: line.part_type || null,
    specifications: line.specifications || null,
    warranty_months: line.warranty_months ?? null,
    rate: line.rate ?? null,
  };
}

/**
 * A label may encode just the Part ID, or the Part ID with the PO appended
 * ("PRT-20260729-0042/SP-PO-0042"). Scanners also sometimes pick up a URL if
 * someone re-encodes a code. Reduce whatever came in to the identifier we can
 * actually look up.
 */
function normalizeScannedCode(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  // Tolerate a URL wrapper, e.g. https://crm.rentfoxxy.com/p/PRT-...
  if (/^https?:\/\//i.test(text)) {
    const tail = text.split(/[?#]/)[0].split('/').filter(Boolean).pop();
    if (tail) text = tail;
  }
  // Take the identifier ahead of any PO / metadata suffix.
  const [head] = text.split(/[/|]/);
  return (head || text).trim();
}

// GET /api/parts/units/lookup?code=PRT-20260729-0042
exports.lookupPartUnit = async (req, res) => {
  try {
    const raw = String(req.query.code || '').trim();
    const code = normalizeScannedCode(raw);
    if (!code) return res.status(400).json({ success: false, message: 'code required' });

    const r = await pool.query(
      `${UNIT_SELECT}
        WHERE UPPER(pi.prt_id) = UPPER($1)
           OR UPPER(COALESCE(pi.serial_number, '')) = UPPER($1)
           OR UPPER(COALESCE(pi.asset_code, '')) = UPPER($1)
        ORDER BY (UPPER(pi.prt_id) = UPPER($1)) DESC, pi.instance_id DESC
        LIMIT 5`,
      [code]
    );

    if (!r.rows.length) {
      // The code may belong to a unit received before parts tracking existed.
      const legacy = await pool.query(
        `SELECT serial_id, serial_number, inventory_asset_code, spo_id, grn_id
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (UPPER(COALESCE(serial_number, '')) = UPPER($1)
             OR UPPER(COALESCE(inventory_asset_code, '')) = UPPER($1))
          LIMIT 1`,
        [code]
      );
      if (legacy.rows.length) {
        return res.status(404).json({
          success: false,
          code,
          message: 'This code exists in procurement but has no tracked part unit. Re-run the parts backfill for its spare PO.',
          procurement: legacy.rows[0],
        });
      }
      return res.status(404).json({ success: false, code, message: `No part unit found for "${code}"` });
    }

    const unit = r.rows[0];
    const [poLine, requests, movements] = await Promise.all([
      attachPoLine(unit),
      pool.query(
        `SELECT pr.request_id, pr.request_number, pr.status, pr.request_type, pr.ticket_id,
                pr.quantity, pr.created_at, t.ttspl_id
           FROM part_requests pr
           LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
          WHERE pr.instance_id = $1
          ORDER BY pr.created_at DESC`,
        [unit.instance_id]
      ),
      pool.query(
        `SELECT movement_type, occurred_at, ticket_id, ttspl_id, part_condition, notes, actor_name
           FROM part_movements WHERE instance_id = $1 ORDER BY occurred_at ASC, movement_id ASC`,
        [unit.instance_id]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      success: true,
      unit: { ...unit, po_line: poLine },
      requests: requests.rows,
      history: movements.rows,
      ambiguous: r.rows.length > 1 ? r.rows.slice(1).map((x) => x.prt_id) : [],
    });
  } catch (err) {
    console.error('lookupPartUnit:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/parts/units?search=&status=&part_id=&category=&limit=
exports.searchPartUnits = async (req, res) => {
  try {
    const { search, status, part_id, category, limit = 50 } = req.query;
    const conditions = [];
    const params = [];

    if (status) { params.push(status); conditions.push(`pi.status = $${params.length}`); }
    if (part_id) { params.push(Number(part_id)); conditions.push(`pi.part_id = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`p.category = $${params.length}`); }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conditions.push(`(pi.prt_id ILIKE $${i} OR pi.serial_number ILIKE $${i}
        OR pi.asset_code ILIKE $${i} OR p.part_name ILIKE $${i})`);
    }

    params.push(Math.min(200, Number(limit) || 50));
    const r = await pool.query(
      `${UNIT_SELECT}
       ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
       ORDER BY pi.created_at DESC, pi.instance_id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, units: r.rows });
  } catch (err) {
    console.error('searchPartUnits:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/parts/units/:code/qr.png — preview image for the UI
exports.getUnitQrPng = async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ success: false, message: 'code required' });
    const size = Math.max(80, Math.min(1200, Number(req.query.size) || 240));
    const png = await renderQrPng(code, size);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (err) {
    console.error('getUnitQrPng:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/parts/labels/print
// Body: { labels: [{ code, caption?, copies }], width_mm?, height_mm?, caption_mm? }
exports.printPartLabels = async (req, res) => {
  try {
    const { labels, width_mm, height_mm, caption_mm } = req.body || {};
    if (!Array.isArray(labels) || !labels.length) {
      return res.status(400).json({ success: false, message: 'labels required' });
    }

    const widthMm = Math.max(6, Math.min(100, Number(width_mm) || DEFAULT_LABEL_MM));
    const captionMm = Math.max(0, Math.min(20, Number(caption_mm) || 0));
    // The caption band is added on top of the QR area, so the symbol keeps its
    // full size instead of being squeezed to make room for the text.
    const heightMm = Math.max(6, Math.min(120, Number(height_mm) || widthMm + captionMm));

    const pdf = await buildLabelPdf(labels, { widthMm, heightMm, captionMm });

    // Track reprints so a unit whose label went missing is visible in inventory.
    // A code may carry a "/PO" suffix, so match on the Part ID part only.
    const codes = labels
      .map((l) => String(l?.code || '').trim().split('/')[0].toUpperCase())
      .filter(Boolean);
    if (codes.length) {
      await pool.query(
        `UPDATE part_instances
            SET label_print_count = COALESCE(label_print_count, 0) + 1,
                label_last_printed_at = NOW(), updated_at = NOW()
          WHERE UPPER(prt_id) = ANY($1::text[])`,
        [codes]
      ).catch(() => {});
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="part-labels-${Date.now()}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('printPartLabels:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
