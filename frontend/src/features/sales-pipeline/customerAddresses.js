/**
 * Customer billing and shipping address helpers, shared by the quotation and
 * sales-order forms (old and Carret). They used to be copied into each form.
 *
 * Address shape everywhere: { name, phone, country, state, city, zip_code, address, gst_number? }
 */
export function getField(obj, snake, camel) {
  if (!obj) return '';
  const val = obj[snake] ?? obj[camel];
  if (val && typeof val === 'object' && val.address) return val.address;
  return val || '';
}

export function customerDisplayName(customer) {
  if (!customer) return 'N/A';
  return customer.company_name || customer.companyName || customer.name || customer.customer_name || 'N/A';
}

export function buildBillingAddress(customer) {
  if (!customer) return null;
  const displayName = customerDisplayName(customer);
  if (customer.billing_address && typeof customer.billing_address === 'object') {
    return {
      ...customer.billing_address,
      name: displayName,
      gst_number: customer.billing_address.gst_number
        || getField(customer, 'gst_no', 'gstNo')
        || getField(customer, 'gst_number', 'gstNumber'),
    };
  }
  return {
    name: displayName,
    phone: customer.phone || customer.customer_number || 'N/A',
    country: 'India',
    state: getField(customer, 'billing_state', 'billingState') || 'N/A',
    city: getField(customer, 'billing_city', 'billingCity') || 'N/A',
    zip_code: getField(customer, 'billing_pincode', 'billingPincode') || 'N/A',
    gst_number: getField(customer, 'gst_no', 'gstNo') || getField(customer, 'gst_number', 'gstNumber') || 'N/A',
    address: getField(customer, 'billing_address', 'billingAddress') || 'N/A',
  };
}

export const emptyManualAddress = () => ({
  name: '', phone: '', country: 'India', state: '', city: '', zip_code: '', address: '',
});

/**
 * The shipping choices for a customer, in the order the forms show them:
 * billing, the customer's own shipping address (when different), every saved
 * address, then manual entry (address: null).
 */
export function buildShippingOptions(customer, savedAddresses = []) {
  if (!customer) return [];
  const billing = buildBillingAddress(customer);
  const options = [{ label: 'Same as billing address', value: 'billing', address: billing }];

  const shippingSame = customer.shipping_same ?? customer.shippingSame ?? true;
  if (!shippingSame && getField(customer, 'shipping_address', 'shippingAddress')) {
    options.push({
      label: 'Customer shipping address',
      value: 'customer_shipping',
      address: {
        name: customer.name || customer.customer_name,
        phone: customer.phone || customer.customer_number,
        country: 'India',
        state: getField(customer, 'shipping_state', 'shippingState'),
        city: getField(customer, 'shipping_city', 'shippingCity'),
        zip_code: getField(customer, 'shipping_pincode', 'shippingPincode'),
        address: getField(customer, 'shipping_address', 'shippingAddress'),
      },
    });
  }

  (savedAddresses || []).forEach((addr, i) => {
    options.push({
      label: `${addr.concern_person || 'Address'} — ${addr.address}, ${addr.pincode || ''}`,
      value: `saved_${addr.customer_address_id || i}`,
      address: {
        name: addr.concern_person || customer.name || customer.customer_name,
        phone: addr.mobile_no || customer.phone,
        country: 'India',
        state: addr.state || '',
        city: addr.city || '',
        zip_code: addr.pincode || '',
        address: addr.address || '',
      },
    });
  });

  options.push({ label: '+ Enter address manually', value: 'manual', address: null });
  return options;
}
