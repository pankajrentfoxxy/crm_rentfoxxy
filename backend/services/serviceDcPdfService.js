const { generateServiceDcPdf } = require('./salesManagementPdfService');
const { buildUnitsForRdc } = require('./returnDcPdfService');

async function buildUnitsForSdc(db, dcl, pickupItems) {
  return buildUnitsForRdc(db, dcl, pickupItems);
}

async function regenerateServiceDcPdfByNumber(db, sdcNumber) {
  try {
    if (!sdcNumber) return null;
    const dclRes = await db.query(
      `SELECT dcl.*, st.customer_phone, st.ticket_phone_override
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_number = $1
          AND dcl.movement_type = 'outbound'
          AND dcl.dc_purpose = 'service_return'
        LIMIT 1`,
      [sdcNumber]
    );
    const dcl = dclRes.rows[0];
    if (!dcl) return null;

    const itemsRes = await db.query(
      `SELECT * FROM support_ticket_items
        WHERE service_dc_number = $1 AND item_type = 'pickup'
        ORDER BY id ASC`,
      [sdcNumber]
    );
    const pickupItems = itemsRes.rows;
    const units = await buildUnitsForSdc(db, dcl, pickupItems);

    const pdfPath = await generateServiceDcPdf({
      serviceDcNumber: sdcNumber,
      header: {
        entity_code: dcl.entity_code,
        transaction_type: 'repair',
        hsn_code: dcl.hsn_code || '847330',
        customer_name: dcl.customer_name,
        customer_email: dcl.email,
        customer_phone: dcl.customer_phone || dcl.ticket_phone_override,
        shipping_address: dcl.customer_shipping_address,
        original_dc_number: dcl.original_dc_number,
        sales_order_number: dcl.sales_order_number,
        support_ticket_id: dcl.support_ticket_id,
        dispatch_mode: dcl.dispatch_mode,
        remarks: dcl.remarks,
      },
      units: units.length ? units : [{
        brand: dcl.brand,
        model: dcl.model_name,
        ttspl: '—',
        serial: '—',
      }],
    });

    await db.query(
      `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW()
        WHERE dc_number = $2 AND movement_type = 'outbound' AND dc_purpose = 'service_return'`,
      [pdfPath, sdcNumber]
    );
    return pdfPath;
  } catch (e) {
    console.error('[serviceDcPdf] regenerate failed:', e.message);
    return null;
  }
}

module.exports = {
  regenerateServiceDcPdfByNumber,
  buildUnitsForSdc,
};
