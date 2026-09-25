const { generateServiceDcPdf } = require('./salesManagementPdfService');
const { buildUnitsForRdc } = require('./returnDcPdfService');

async function buildUnitsForSdc(db, dcl, pickupItems) {
  return buildUnitsForRdc(db, dcl, pickupItems);
}

async function regenerateServiceDcPdfByNumber(db, sdcNumber) {
  try {
    if (!sdcNumber) return null;
    const dclRes = await db.query(
      `SELECT dcl.*, st.customer_phone, st.ticket_phone_override,
              COALESCE(NULLIF(TRIM(dt.first_name || ' ' || COALESCE(dt.last_name, '')), ''), u.name) AS delivery_person_name,
              COALESCE(dt.phone, u.mobile_no) AS delivery_person_phone
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
         LEFT JOIN delivery_technicians dt ON dt.technician_id = dcl.delivery_person_id
         LEFT JOIN users u ON u.user_id = COALESCE(dt.user_id, dcl.delivery_person_id)
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
        billing_address: dcl.customer_billing_address,
        gst_number: dcl.gst_number,
        supply_state: dcl.supply_state,
        original_dc_number: dcl.original_dc_number,
        sales_order_number: dcl.sales_order_number,
        support_ticket_id: dcl.support_ticket_id,
        dispatch_mode: dcl.dispatch_mode,
        remarks: dcl.remarks,
        dc_date: dcl.dc_date || dcl.created_at,
        dispatched_at: dcl.dispatched_at,
        delivered_at: dcl.delivered_at || dcl.delivery_completed_at,
        courier_name: dcl.courier_name,
        awb_number: dcl.awb_number,
        delivery_person_name: dcl.delivery_person_name,
        delivery_person_phone: dcl.delivery_person_phone,
        esign_url: dcl.esign_url,
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

/**
 * Kept for the technician-change route. The service challan layout now prints the
 * ship-by mode and the assigned delivery technician itself, so this renders the same
 * document rather than a priced plain DC.
 */
async function regenerateServiceDcDocumentPdf(db, sdcNumber) {
  return regenerateServiceDcPdfByNumber(db, sdcNumber);
}

module.exports = {
  regenerateServiceDcPdfByNumber,
  regenerateServiceDcDocumentPdf,
  buildUnitsForSdc,
};
