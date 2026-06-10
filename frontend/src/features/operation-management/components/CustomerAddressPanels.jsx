import React from 'react';
import { formatStateLabel } from '../utils/quotationHelpers';

function AddressRow({ label, value }) {
  return (
    <div className="mb-2">
      <span className="text-gray-500 text-sm">{label} : </span>
      <strong className="text-sm text-gray-800">{value || 'N/A'}</strong>
    </div>
  );
}

export function BillingAddressPanel({ billing, gstNumber }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 h-full">
      <h4 className="mb-3 text-sm font-semibold text-gray-800 flex items-center gap-2">
        <span aria-hidden>👤</span> Billing address
      </h4>
      <AddressRow label="Name" value={billing?.name} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <AddressRow label="Phone" value={billing?.phone} />
        <AddressRow label="Country" value={billing?.country || 'India'} />
        <AddressRow label="State" value={formatStateLabel(billing?.state)} />
        <AddressRow label="City" value={billing?.city} />
        <AddressRow label="Zip Code" value={billing?.zip_code} />
        <AddressRow label="GST Number" value={gstNumber} />
      </div>
      <AddressRow label="Address" value={billing?.address} />
    </div>
  );
}

export function ShippingAddressPanel({
  shippingAddresses,
  selectedIndex,
  onSelectIndex,
  onAddClick,
  selectedAddress,
  readOnly = false,
}) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden h-full flex flex-col">
      {!readOnly ? (
        <div className="p-2 border-b bg-gray-50 flex gap-2 items-center">
          <select
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            value={selectedIndex}
            onChange={(e) => onSelectIndex(Number(e.target.value))}
            required
          >
            <option value={-1}>Please Select</option>
            {(shippingAddresses || []).map((addr, index) => (
              <option key={index} value={index}>
                {[addr.name, addr.phone, addr.city].filter(Boolean).join(', ')}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAddClick}
            className="shrink-0 w-10 h-10 rounded-lg bg-cyan-500 text-white text-xl leading-none hover:bg-cyan-600"
            title="Add shipping address"
          >
            +
          </button>
        </div>
      ) : null}
      <div className="p-4 flex-1">
        <h4 className="mb-3 text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span aria-hidden>👤</span> Shipping Address
        </h4>
        {selectedAddress ? (
          <>
            <AddressRow label="Name" value={selectedAddress.name} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <AddressRow label="Phone" value={selectedAddress.phone} />
              <AddressRow label="Country" value={selectedAddress.country || 'India'} />
              <AddressRow label="State" value={formatStateLabel(selectedAddress.state)} />
              <AddressRow label="City" value={selectedAddress.city} />
              <AddressRow label="Zip Code" value={selectedAddress.zip_code} />
            </div>
            <AddressRow label="Address" value={selectedAddress.address} />
          </>
        ) : (
          <p className="text-sm text-gray-400">Select a shipping address</p>
        )}
      </div>
    </div>
  );
}
