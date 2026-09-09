import React, { useState } from 'react';
import {
  Building2,
  FileText,
  KeyRound,
  Landmark,
  MapPin,
  Pencil,
  Phone,
  Shield,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button } from '../../../components/ui/primitives';
import { updateVendorPortalAccess } from '../vendorManagementApi';
import { useVendorMgmtCapabilities } from '../hooks/useVendorMgmtCapabilities';
import {
  formatStateLabel,
  paymentTermsLabel,
  vendorStatusKey,
  vendorStatusLabel,
} from '../vendorMgmtUi';

const PORTAL_MODULES = [
  { name: 'Vendor Portal Login', key: 'login', note: 'Master switch for all portal access' },
  { name: 'Dashboard', key: 'dashboard' },
  { name: 'Purchase Orders', key: 'purchase_orders' },
  { name: 'My Laptops', key: 'laptops' },
  { name: 'My Bills', key: 'bills' },
  { name: 'Debit Notes', key: 'debit_notes' },
  { name: 'Returns', key: 'returns' },
  { name: 'Profile', key: 'profile' },
];

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ label, value, mono, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-900 break-words ${mono ? 'font-mono text-[13px]' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function FieldGrid({ children }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
      {children}
    </dl>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
        {Icon && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200/80">
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AccessBadge({ allowed }) {
  return (
    <Badge tone={allowed ? 'green' : 'gray'}>
      {allowed ? 'Allowed' : 'Not Allowed'}
    </Badge>
  );
}

export default function VendorConfigDrawer({
  open,
  vendor,
  onClose,
  onEdit,
  onVendorUpdated,
}) {
  const { canManageVendorPortal } = useVendorMgmtCapabilities();
  const [portalBusy, setPortalBusy] = useState(false);

  if (!open || !vendor) return null;

  const portalOn = vendor.vendor_portal_enabled !== false;
  const statusKey = vendorStatusKey(vendor);
  const cityState = [vendor.city, formatStateLabel(vendor.state)].filter(Boolean).join(', ');
  const shippingCityState = [vendor.shipping_city, formatStateLabel(vendor.shipping_state)].filter(Boolean).join(', ');
  const displayName = vendor.business_name || vendor.f_name || `Vendor #${vendor.vendor_id}`;

  async function togglePortal() {
    if (!canManageVendorPortal) return;
    setPortalBusy(true);
    try {
      const { data } = await updateVendorPortalAccess(vendor.vendor_id, { portal_enabled: !portalOn });
      if (!data.success) throw new Error(data.message);
      toast.success('Portal access updated');
      onVendorUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Update failed');
    } finally {
      setPortalBusy(false);
    }
  }

  async function resetPortalPassword() {
    if (!canManageVendorPortal) return;
    setPortalBusy(true);
    try {
      const { data } = await updateVendorPortalAccess(vendor.vendor_id, { reset_password: true });
      if (!data.success) throw new Error(data.message);
      if (data.new_password) {
        await navigator.clipboard.writeText(data.new_password);
        toast.success('New password copied to clipboard');
      } else {
        toast.success('Portal password reset');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Reset failed');
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true" aria-label="Vendor details">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <div className="relative w-full max-w-full sm:max-w-[560px] h-full bg-slate-50 shadow-2xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vendor configuration</p>
            <h2 className="text-lg font-bold text-slate-900 truncate">{displayName}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Vendor ID #{vendor.vendor_id}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onEdit && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>
                Edit
              </Button>
            )}
            <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Section title="Business Information" icon={Building2}>
            <FieldGrid>
              <Field label="Legal / trade name" value={vendor.f_name} />
              <Field label="Business name" value={vendor.business_name} />
              <Field label="Business type" value={vendor.business_type} />
              <Field label="Registration date" value={formatDate(vendor.registration_date)} />
              <Field label="GSTIN" value={vendor.gst_number} mono />
              <Field label="PAN" value={vendor.pan_number} mono />
              <Field label="MSME" value={vendor.msme_number} />
              <Field label="Brand code" value={vendor.brand_code} />
              <Field label="Account status" value={vendorStatusLabel(statusKey)} />
            </FieldGrid>
          </Section>

          <Section title="Registered Address" icon={MapPin}>
            <FieldGrid>
              <Field label="Address" value={vendor.address} className="sm:col-span-2" />
              <Field label="City / State" value={cityState} />
              <Field label="Pincode" value={vendor.pincode} mono />
            </FieldGrid>
          </Section>

          <Section title="Contact Information" icon={Phone}>
            <FieldGrid>
              <Field label="Contact person" value={vendor.contact_person_name || vendor.f_name} />
              <Field label="Phone" value={vendor.contact_person_phone || vendor.number || vendor.phone} />
              <Field label="Alternate phone" value={vendor.alternate_phone} />
              <Field label="Email" value={vendor.email} />
            </FieldGrid>
          </Section>

          <Section title="Banking Details" icon={Landmark}>
            <FieldGrid>
              <Field label="Bank name" value={vendor.bank_name} />
              <Field label="Account holder" value={vendor.account_holder_name} />
              <Field label="Account number" value={vendor.account_number} mono />
              <Field label="IFSC" value={vendor.bank_ifsc_code} mono />
            </FieldGrid>
          </Section>

          <Section title="Shipping Address" icon={MapPin}>
            {vendor.shipping_same !== false ? (
              <p className="text-sm text-slate-600 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                Same as registered address
              </p>
            ) : (
              <FieldGrid>
                <Field label="Address" value={vendor.shipping_address} className="sm:col-span-2" />
                <Field label="City / State" value={shippingCityState} />
                <Field label="Pincode" value={vendor.shipping_pincode} mono />
              </FieldGrid>
            )}
          </Section>

          <Section title="Commercial" icon={FileText}>
            <FieldGrid>
              <Field label="Payment terms" value={paymentTermsLabel(vendor.po_payment_terms)} />
              <Field label="Credit days" value={vendor.credit_days != null ? String(vendor.credit_days) : null} />
              <Field label="Notes" value={vendor.notes} className="sm:col-span-2" />
            </FieldGrid>
          </Section>

          <Section title="Permissions" icon={Shield}>
            <p className="text-xs text-slate-500 mb-3">
              Vendor portal features follow the existing portal-access setting. Individual modules are not gated separately.
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Permission / Module</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {PORTAL_MODULES.map((mod) => (
                    <tr key={mod.key}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-800">{mod.name}</p>
                        {mod.note && <p className="text-[11px] text-slate-400 mt-0.5">{mod.note}</p>}
                      </td>
                      <td className="px-3 py-2.5"><AccessBadge allowed={portalOn} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <KeyRound className="w-4 h-4 text-slate-400" />
                  <span>Portal last login:</span>
                  <span className="font-medium">
                    {vendor.vendor_portal_last_login
                      ? new Date(vendor.vendor_portal_last_login).toLocaleString('en-IN')
                      : 'Never logged in'}
                  </span>
                </div>
              </div>
              {canManageVendorPortal ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={portalOn}
                      disabled={portalBusy}
                      onChange={togglePortal}
                      className="rounded border-slate-300 text-blue-600 w-4 h-4"
                    />
                    <span className="font-medium text-slate-800">
                      {portalOn ? 'Portal enabled' : 'Portal disabled'}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={resetPortalPassword}
                    className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    Reset password
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Only Admin and Super Admin can change these permissions.</p>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
