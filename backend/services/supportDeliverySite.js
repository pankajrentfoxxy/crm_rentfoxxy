'use strict';

const { normalizeDeliveryAddress, formatDeliveryAddressLine } = require('../utils/deliveryAddressUtils');

function digitsPin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function siteKey(pincode, address) {
  const pin = digitsPin(pincode);
  const norm = String(address || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  return `pin:${pin}:${norm}`;
}

function flattenAddress(raw) {
  const a = normalizeDeliveryAddress(raw) || {};
  const pincode = digitsPin(a.pincode || a.zip_code);
  const address = formatDeliveryAddressLine(raw) || a.address || a.address_line_1 || '';
  return {
    pincode,
    city: a.city || '',
    state: a.state || '',
    address: String(address || '').trim(),
    site_key: siteKey(pincode, address),
  };
}

/** Latest delivered DC for alias `s` (vendor_serial_numbers). */
const LATEST_DC_SQL = `
LEFT JOIN LATERAL (
  SELECT dcl.dc_number,
         dcl.customer_shipping_address,
         COALESCE(dcl.delivery_completed_at, dcl.updated_at, dcl.created_at) AS dc_delivered_at
    FROM delivery_challan_lines dcl
   WHERE dcl.customer_id = s.current_customer_id
     AND LOWER(COALESCE(dcl.status, '')) = 'delivered'
     AND (
       (NULLIF(s.serial_number, '') IS NOT NULL AND (
          dcl.serial_number::text ILIKE '%' || s.serial_number || '%'
          OR COALESCE(dcl.delivered_serial_numbers::text, '') ILIKE '%' || s.serial_number || '%'
       ))
       OR (NULLIF(s.inventory_asset_code, '') IS NOT NULL AND (
          dcl.serial_number::text ILIKE '%' || s.inventory_asset_code || '%'
          OR COALESCE(dcl.delivered_serial_numbers::text, '') ILIKE '%' || s.inventory_asset_code || '%'
       ))
       OR EXISTS (
         SELECT 1 FROM dc_shipment_units u
          WHERE u.dc_number = dcl.dc_number
            AND (
              u.serial_id = s.serial_id
              OR (NULLIF(s.serial_number, '') IS NOT NULL AND u.serial_number = s.serial_number)
              OR (NULLIF(s.inventory_asset_code, '') IS NOT NULL AND u.ttspl_id = s.inventory_asset_code)
            )
       )
     )
   ORDER BY COALESCE(dcl.delivery_completed_at, dcl.updated_at, dcl.created_at) DESC NULLS LAST
   LIMIT 1
) dc ON TRUE
`;

function decorateSerialRow(row) {
  const fromDc = flattenAddress(row.customer_shipping_address);
  const pincode = fromDc.pincode || digitsPin(row.extra_pincode);
  const address = fromDc.address;
  return {
    ...row,
    delivery_pincode: pincode || null,
    delivery_city: fromDc.city || null,
    delivery_address: address || null,
    dc_number: row.dc_number || null,
    site_key: pincode || address ? siteKey(pincode, address) : null,
  };
}

async function loadSerialDelivery(db, serialId) {
  const r = await db.query(
    `SELECT s.serial_id, s.serial_number, s.inventory_asset_code, s.current_customer_id,
            s.extra->>'pincode' AS extra_pincode,
            dc.dc_number, dc.customer_shipping_address
       FROM vendor_serial_numbers s
       ${LATEST_DC_SQL}
      WHERE s.serial_id = $1 AND s.deleted_at IS NULL`,
    [serialId]
  );
  if (!r.rows[0]) return null;
  return decorateSerialRow(r.rows[0]);
}

function assertSerialMatchesSite(delivery, site, opts = {}) {
  if (!delivery || delivery.asset_unknown) return;
  const want = digitsPin(site && site.pincode);
  const got = digitsPin(delivery.delivery_pincode);
  if (want && got && want !== got) {
    const label = delivery.inventory_asset_code || delivery.serial_number || delivery.serial_id;
    if (opts.site_source === 'MANUAL_OVERRIDE' && String(opts.reason || '').trim().length >= 10) {
      return {
        overridden: true,
        warning: `Laptop ${label} delivered to ${got}; ticket site overridden to ${want}`,
      };
    }
    throw Object.assign(
      new Error(`Laptop ${label} was delivered to pincode ${got}, not the selected site (${want})`),
      { status: 400 }
    );
  }
  return null;
}

module.exports = {
  digitsPin,
  siteKey,
  flattenAddress,
  LATEST_DC_SQL,
  decorateSerialRow,
  loadSerialDelivery,
  assertSerialMatchesSite,
};
