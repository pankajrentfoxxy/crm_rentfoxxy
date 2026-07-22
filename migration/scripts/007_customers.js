/**
 * 007 — ERP customers → CRM customers + customer_addresses (+ documents)
 * Additive: match by email/GST; never truncate.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  normalizeEmail,
  normalizeGst,
  str,
  parseJson,
  extractAddressText,
  findExistingByEmailOrGst,
  bumpCustomerSequence,
  bumpCustomerAddressSequence,
} = require('../lib/helpers');

function parseBillingAddress(row) {
  const parsed = parseJson(row.billing_address);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      text: str(parsed.address, 5000, '') || extractAddressText(row.billing_address),
      city: str(parsed.city, 100, null),
      state: str(parsed.state || row.billing_address_state, 100, null),
      pincode: str(parsed.zip_code || row.billing_address_pin_code, 10, null),
      contact: str(parsed.name || row.contact_person_name, 255, null),
      phone: str(parsed.phone || row.contact_person_number, 50, null),
    };
  }
  return {
    text: str(row.billing_address, 5000, '') || str(row.customer_name, 255, 'N/A'),
    city: null,
    state: str(row.billing_address_state, 100, null),
    pincode: str(row.billing_address_pin_code, 10, null),
    contact: str(row.contact_person_name, 255, null),
    phone: str(row.contact_person_number || row.customer_number, 50, null),
  };
}

function parseShippingRows(row) {
  const parsed = parseJson(row.shipping_address);
  const rows = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      rows.push({
        text: str(item.address, 5000, ''),
        city: str(item.city, 100, null),
        state: str(item.state || row.shipping_address_state, 100, null),
        pincode: str(item.zip_code || row.shipping_address_pin_code, 10, null),
        contact: str(item.name || row.contact_person_name, 255, null),
        phone: str(item.phone || row.contact_person_number, 50, null),
        addressType: 'shipping',
      });
    }
  } else if (parsed && typeof parsed === 'object') {
    rows.push({
      text: str(parsed.address, 5000, ''),
      city: str(parsed.city, 100, null),
      state: str(parsed.state || row.shipping_address_state, 100, null),
      pincode: str(parsed.zip_code || row.shipping_address_pin_code, 10, null),
      contact: str(parsed.name || row.contact_person_name, 255, null),
      phone: str(parsed.phone || row.contact_person_number, 50, null),
      addressType: 'shipping',
    });
  } else if (row.shipping_address) {
    rows.push({
      text: str(row.shipping_address, 5000, ''),
      city: null,
      state: str(row.shipping_address_state, 100, null),
      pincode: str(row.shipping_address_pin_code, 10, null),
      contact: str(row.contact_person_name, 255, null),
      phone: str(row.contact_person_number, 50, null),
      addressType: 'shipping',
    });
  }
  return rows.filter((r) => r.text);
}

function shippingSameAsBilling(billing, shippingRows) {
  if (!shippingRows.length) return true;
  if (shippingRows.length === 1) {
    const s = shippingRows[0];
    return (
      str(s.text) === str(billing.text) &&
      str(s.pincode) === str(billing.pincode)
    );
  }
  return false;
}

async function ensureCustomerAddress(crm, customerId, addr, { isHeadOffice = false, addressType = null }) {
  if (!addr.text) return 0;
  const { rows: dup } = await crm.query(
    `SELECT customer_address_id FROM customer_addresses
      WHERE customer_id = $1 AND address = $2 AND COALESCE(pincode,'') = COALESCE($3,'')
      LIMIT 1`,
    [customerId, addr.text, addr.pincode || null]
  );
  if (dup.length) return 0;

  await crm.query(
    `INSERT INTO customer_addresses (
       customer_id, concern_person, mobile_no, address, pincode,
       is_head_office, address_type, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
    [
      customerId,
      addr.contact || null,
      addr.phone || null,
      addr.text,
      addr.pincode || null,
      isHeadOffice,
      addressType,
    ]
  );
  return 1;
}

async function ensureCustomerDocuments(crm, customerId, row) {
  let count = 0;
  const docs = parseJson(row.upload_docs, []);
  const list = Array.isArray(docs) ? docs : [];

  if (row.profile) {
    list.push({ type: 'other', path: row.profile, label: 'profile' });
  }

  for (const doc of list) {
    const filePath = typeof doc === 'string' ? doc : doc?.path || doc?.file || doc?.url;
    if (!filePath) continue;
    const docType = 'other';
    const { rows: exists } = await crm.query(
      `SELECT doc_id FROM customer_documents WHERE customer_id = $1 AND file_path = $2 LIMIT 1`,
      [customerId, String(filePath)]
    );
    if (exists.length) continue;

    await crm.query(
      `INSERT INTO customer_documents (customer_id, doc_type, doc_label, file_path, file_name, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        customerId,
        docType,
        typeof doc === 'object' ? str(doc.label || doc.type, 255, 'ERP import') : 'ERP import',
        String(filePath),
        String(filePath).split('/').pop().slice(0, 255),
      ]
    );
    count += 1;
  }

  if (row.pan_card_number) {
    const panPath = `erp://customers/${row.id}/pan`;
    const { rows: panExists } = await crm.query(
      `SELECT doc_id FROM customer_documents WHERE customer_id = $1 AND doc_type = 'pan_card' LIMIT 1`,
      [customerId]
    );
    if (!panExists.length) {
      await crm.query(
        `INSERT INTO customer_documents (customer_id, doc_type, doc_label, file_path, notes, created_at)
         VALUES ($1, 'pan_card', 'PAN', $2, $3, NOW())`,
        [customerId, panPath, str(row.pan_card_number, 100, null)]
      );
      count += 1;
    }
  }

  return count;
}

module.exports = {
  id: '007',
  name: 'customers',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `customers`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let mapped = 0;
    let addressesCreated = 0;
    let docsCreated = 0;

    const [customers] = await erp.query(
      `SELECT id, customer_name, contact_person_name, contact_person_number, customer_number,
              email, billing_address, billing_address_state, billing_address_pin_code,
              shipping_address, shipping_address_state, shipping_address_pin_code,
              business_type, gst_number, pan_card_number, upload_docs, profile, password,
              status, created_at, updated_at
         FROM \`customers\` ORDER BY id`
    );

    for (const row of customers) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'customers', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) progress('customers', processed, total);
        continue;
      }

      const email = normalizeEmail(row.email);
      const gst = normalizeGst(row.gst_number);
      let crmCustomerId = await findExistingByEmailOrGst(crm, {
        table: 'customers',
        emailCol: 'email',
        gstCol: 'gst_no',
        email,
        gst,
        idCol: 'customer_id',
      });

      const billing = parseBillingAddress(row);
      const shippingRows = parseShippingRows(row);
      const sameShip = shippingSameAsBilling(billing, shippingRows);
      const primaryShipping = shippingRows[0];

      const details = {
        erp_customer_id: row.id,
        business_type: row.business_type,
        contact_person_name: row.contact_person_name,
        contact_person_number: row.contact_person_number,
        customer_number: row.customer_number,
        migrated_from: 'erp.customers',
      };

      if (crmCustomerId) {
        await setCrmId(crm, {
          entity: 'customers',
          erpId: row.id,
          crmId: crmCustomerId,
          erpTable: 'customers',
          crmTable: 'customers',
        });
        mapped += 1;
      } else {
        const name = str(row.customer_name, 255, 'Customer');
        const phone = str(row.contact_person_number || row.customer_number, 50, null);
        const statusNum = ['1', 'active', 'approved'].includes(String(row.status).toLowerCase()) ? 1 : 0;

        const { rows: ins } = await crm.query(
          `INSERT INTO customers (
             name, company_name, email, phone, gst_no, type, details, address,
             status, pan_number, company_type,
             billing_address, billing_state, billing_pincode,
             shipping_same, shipping_address, shipping_state, shipping_pincode,
             portal_password_hash, portal_enabled, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,'Existing',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,$19,$20
           ) RETURNING customer_id`,
          [
            name,
            name,
            email || null,
            phone,
            gst || null,
            JSON.stringify(details),
            billing.text || null,
            statusNum,
            str(row.pan_card_number, 20, null),
            str(row.business_type, 100, null),
            billing.text || null,
            billing.state || null,
            billing.pincode || null,
            sameShip,
            sameShip ? null : (primaryShipping?.text || null),
            sameShip ? null : (primaryShipping?.state || null),
            sameShip ? null : (primaryShipping?.pincode || null),
            str(row.password, 500, null),
            row.created_at || new Date(),
            row.updated_at || new Date(),
          ]
        );

        crmCustomerId = ins[0].customer_id;
        await setCrmId(crm, {
          entity: 'customers',
          erpId: row.id,
          crmId: crmCustomerId,
          erpTable: 'customers',
          crmTable: 'customers',
        });
        inserted += 1;
      }

      addressesCreated += await ensureCustomerAddress(crm, crmCustomerId, billing, {
        isHeadOffice: true,
        addressType: 'billing',
      });

      if (!sameShip) {
        for (const ship of shippingRows) {
          addressesCreated += await ensureCustomerAddress(crm, crmCustomerId, ship, {
            isHeadOffice: false,
            addressType: ship.addressType || 'shipping',
          });
        }
      }

      docsCreated += await ensureCustomerDocuments(crm, crmCustomerId, row);

      if (processed % batchSize === 0 || processed === total) {
        progress('customers', processed, total);
      }
    }

    await bumpCustomerSequence(crm);
    await bumpCustomerAddressSequence(crm);
    writeLog(
      'migration',
      `007 complete: inserted=${inserted} mapped=${mapped} addresses=${addressesCreated} docs=${docsCreated} total=${total}`
    );
    return inserted + mapped;
  },
};
