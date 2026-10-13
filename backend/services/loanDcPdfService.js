/**
 * Loan DC PDF — the Service DC layout re-labelled (salesManagementPdfService
 * generateServiceDcPdf variant). A loan laptop is not chargeable, so the
 * challan carries no price and says so.
 */
const { generateServiceDcPdf } = require('./salesManagementPdfService');

async function regenerateLoanDcPdf(db, dcNumber) {
  try {
    if (!dcNumber) return null;
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
          AND dcl.dc_purpose = 'loan'
        LIMIT 1`,
      [dcNumber]
    );
    const dcl = dclRes.rows[0];
    if (!dcl) return null;

    const reqRes = await db.query(
      `SELECT request_number, original_ttspl_id, loan_serial_id
         FROM support_loan_requests WHERE loan_dc_number = $1 LIMIT 1`,
      [dcNumber]
    ).catch(() => ({ rows: [] }));
    const request = reqRes.rows[0] || {};

    const unitsRes = await db.query(
      `SELECT vsn.serial_number, vsn.inventory_asset_code, vsn.extra
         FROM vendor_serial_numbers vsn
        WHERE vsn.serial_id = $1`,
      [request.loan_serial_id || null]
    );
    const units = unitsRes.rows.map((r) => {
      const x = r.extra || {};
      return {
        brand: x.brand,
        model: x.model || x.model_name,
        processor: x.processor,
        generation: x.generation,
        ram: x.ram,
        storage: x.storage,
        screen_size: x.screen_size,
        ttspl: r.inventory_asset_code || x.ttspl_id || '—',
        serial: r.serial_number || '—',
      };
    });

    const pdfPath = await generateServiceDcPdf({
      serviceDcNumber: dcNumber,
      header: {
        entity_code: dcl.entity_code,
        transaction_type: 'rental',
        hsn_code: dcl.hsn_code,
        customer_name: dcl.customer_name,
        customer_email: dcl.email,
        customer_phone: dcl.customer_phone || dcl.ticket_phone_override,
        shipping_address: dcl.customer_shipping_address,
        billing_address: dcl.customer_billing_address,
        gst_number: dcl.gst_number,
        supply_state: dcl.supply_state,
        support_ticket_id: dcl.support_ticket_id,
        dispatch_mode: dcl.dispatch_mode,
        remarks: dcl.remarks,
        dc_date: dcl.dc_date || dcl.created_at,
        created_at: dcl.created_at,
        dispatched_at: dcl.dispatched_at,
        delivered_at: dcl.delivered_at || dcl.delivery_completed_at,
        courier_name: dcl.courier_name,
        awb_number: dcl.awb_number,
        delivery_person_name: dcl.delivery_person_name,
        delivery_person_phone: dcl.delivery_person_phone,
        esign_url: dcl.esign_url,
      },
      units: units.length ? units : [{ brand: dcl.brand, model: dcl.model_name, ttspl: '—', serial: '—' }],
      variant: {
        numberLabel: 'Loan DC Number',
        title: 'LOAN DELIVERY CHALLAN',
        subtitle: 'Temporary laptop while the customer laptop is repaired',
        badge: 'Loan — Not Chargeable',
        gateDocType: 'dc',
        refs: [
          ['Loan Request', request.request_number],
          ['Laptop Under Repair', request.original_ttspl_id],
        ],
        footer: 'This Loan Delivery Challan records a temporary laptop lent to the customer while their own laptop is under repair. It is not a sale or a new rental: no Sales Order is created and no rent is charged for the loan period. The laptop remains the property of the company and must be returned when the repaired laptop is delivered, unless a separate rental is agreed in writing.',
      },
    });

    await db.query(
      `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW()
        WHERE dc_number = $2 AND movement_type = 'outbound' AND dc_purpose = 'loan'`,
      [pdfPath, dcNumber]
    );
    return pdfPath;
  } catch (e) {
    console.error('[loanDcPdf] regenerate failed:', e.message);
    return null;
  }
}

module.exports = { regenerateLoanDcPdf };
