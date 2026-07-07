import React from 'react';
import { MapPin, Pencil, Plus } from 'lucide-react';
import PermissionGate from '../../../components/PermissionGate';

function formatLocation(parts) {
  return parts.filter((p) => String(p || '').trim()).join(', ') || '—';
}

function buildAddressSections(customer, savedAddresses = []) {
  const sections = [];

  const billingStreet = typeof customer.billing_address === 'object'
    ? customer.billing_address?.address
    : customer.billing_address;

  if (billingStreet || customer.billing_city || customer.billing_state || customer.billing_pincode) {
    sections.push({
      key: 'profile-billing',
      kind: 'profile-billing',
      title: 'Billing Address',
      subtitle: 'Primary billing on customer profile',
      badge: 'Profile',
      address: billingStreet || '',
      city: customer.billing_city || '',
      state: customer.billing_state || '',
      pincode: customer.billing_pincode || '',
      editable: true,
    });
  }

  if (customer.shipping_same === false) {
    sections.push({
      key: 'profile-shipping',
      kind: 'profile-shipping',
      title: 'Shipping Address',
      subtitle: 'Profile shipping (different from billing)',
      badge: 'Profile',
      address: customer.shipping_address || '',
      city: customer.shipping_city || '',
      state: customer.shipping_state || '',
      pincode: customer.shipping_pincode || '',
      editable: true,
    });
  } else if (billingStreet) {
    sections.push({
      key: 'profile-shipping-same',
      kind: 'profile-billing',
      title: 'Shipping Address',
      subtitle: 'Same as billing address',
      badge: 'Profile',
      address: billingStreet || '',
      city: customer.billing_city || '',
      state: customer.billing_state || '',
      pincode: customer.billing_pincode || '',
      editable: true,
    });
  }

  savedAddresses.forEach((addr) => {
    sections.push({
      key: `saved-${addr.customer_address_id}`,
      kind: 'saved',
      customerAddressId: addr.customer_address_id,
      title: addr.address_type || 'Address',
      subtitle: addr.is_head_office ? 'Default for quotation/DC' : 'Saved shipping address',
      badge: addr.is_head_office ? 'Default' : (addr.address_type || 'Shipping'),
      address: addr.address || '',
      city: addr.city || '',
      state: addr.state || '',
      pincode: addr.pincode || '',
      concern_person: addr.concern_person || '',
      mobile_no: addr.mobile_no || '',
      isDefault: !!addr.is_head_office,
      editable: true,
    });
  });

  return sections;
}

function AddressCard({ item, onEdit }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
            {item.title}
          </h3>
          {item.subtitle && <p className="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            item.isDefault ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {item.badge}
          </span>
          {item.editable && (
            <PermissionGate section="customers" action="edit">
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </PermissionGate>
          )}
        </div>
      </div>
      <p className="text-gray-800 whitespace-pre-wrap">{item.address || '—'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">City / State / Pincode</span>
          <p className="font-medium text-gray-800">
            {formatLocation([item.city, item.state, item.pincode])}
          </p>
        </div>
        {(item.concern_person || item.mobile_no) && (
          <div>
            <span className="text-gray-500">Contact</span>
            <p className="font-medium text-gray-800">
              {[item.concern_person, item.mobile_no].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CustomerAddressesTab({ customer, savedAddresses, loading, onAddAddress, onEditAddress }) {
  const sections = buildAddressSections(customer, savedAddresses);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">All Addresses</h2>
          <p className="text-sm text-gray-500">
            Billing, profile shipping, and saved addresses used for quotations and delivery challans.
          </p>
        </div>
        <PermissionGate section="customers" action="edit">
          <button
            type="button"
            onClick={onAddAddress}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Address
          </button>
        </PermissionGate>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Loading addresses…</div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
          No addresses recorded yet.
          <PermissionGate section="customers" action="edit">
            <button type="button" onClick={onAddAddress} className="block mx-auto mt-2 text-blue-600 hover:underline">
              Add a shipping address
            </button>
          </PermissionGate>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sections.map((item) => (
            <AddressCard key={item.key} item={item} onEdit={onEditAddress} />
          ))}
        </div>
      )}
    </div>
  );
}
