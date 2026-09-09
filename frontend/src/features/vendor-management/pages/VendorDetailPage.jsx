import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Pencil,
  Laptop,
  Package,
  MapPin,
  Phone,
  Landmark,
  FileText,
  ChevronRight,
  Calendar,
  Users,
  RotateCcw,
  Warehouse,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, SectionLoader, Badge } from '../../../components/ui/primitives';
import { fetchVendor } from '../vendorManagementApi';
import VendorFormModal from '../components/VendorFormModal';
import VendorLaptopsPanel from '../components/VendorLaptopsPanel';
import {
  formatStateLabel,
  paymentTermsLabel,
  paymentTermsBadgeClass,
  vendorStatusKey,
  vendorStatusLabel,
} from '../vendorMgmtUi';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function vendorStatusTone(key) {
  if (key === 'active') return 'green';
  if (key === 'suspended') return 'red';
  return 'amber';
}

function MetricCard({ icon: Icon, label, value, tone = 'slate' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600 ring-blue-100',
    green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    purple: 'bg-violet-50 text-violet-600 ring-violet-100',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{value ?? '—'}</p>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${tones[tone]}`}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
    </div>
  );
}

function InfoCard({ title, icon: Icon, onEdit, children }) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm overflow-hidden h-full">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200/80">
              <Icon className="w-4 h-4" />
            </span>
          )}
          <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
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

function FieldGrid({ children, cols = 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 ${cols === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {children}
    </dl>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [laptopCounts, setLaptopCounts] = useState({ total: 0, active: 0, returned: 0, in_stock: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchVendor(id);
      if (!data?.success) throw new Error(data?.message || 'Failed to load vendor');
      setVendor(data.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load vendor');
      navigate('/vendor-management/vendors');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <SectionLoader label="Loading vendor…" />
      </div>
    );
  }

  if (!vendor) return null;

  const statusKey = vendorStatusKey(vendor);
  const portalOn = vendor.vendor_portal_enabled !== false;
  const displayName = vendor.business_name || vendor.f_name || `Vendor #${vendor.vendor_id}`;
  const cityState = [vendor.city, formatStateLabel(vendor.state)].filter(Boolean).join(', ');
  const shippingCityState = [vendor.shipping_city, formatStateLabel(vendor.shipping_state)].filter(Boolean).join(', ');

  return (
    <div className="min-h-full bg-slate-50/80">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link to="/vendor-management/vendors" className="hover:text-slate-800 transition-colors">
            Vendors
          </Link>
          <ChevronRight className="w-4 h-4 shrink-0 text-slate-300" />
          <span className="text-slate-800 font-medium truncate max-w-[240px] sm:max-w-none">{displayName}</span>
        </nav>

        {/* Hero header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-5 md:px-6 md:py-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <span className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Building2 className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold text-slate-900 truncate">{displayName}</h1>
                  <Badge tone={vendorStatusTone(statusKey)}>{vendorStatusLabel(statusKey)}</Badge>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentTermsBadgeClass(vendor.po_payment_terms)}`}>
                    {paymentTermsLabel(vendor.po_payment_terms)}
                  </span>
                  <Badge tone={portalOn ? 'green' : 'gray'}>
                    Portal {portalOn ? 'enabled' : 'disabled'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Vendor ID #{vendor.vendor_id}
                  {vendor.business_type && (
                    <>
                      <span className="mx-2 text-slate-300">·</span>
                      {vendor.business_type}
                    </>
                  )}
                </p>
                {(vendor.contact_person_phone || vendor.email) && (
                  <p className="mt-2 text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    {(vendor.contact_person_phone || vendor.number) && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {vendor.contact_person_phone || vendor.number}
                      </span>
                    )}
                    {vendor.email && (
                      <span className="truncate">{vendor.email}</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link to={`/vendor-management/purchase-orders?vendor_id=${vendor.vendor_id}`}>
                <Button variant="secondary" size="sm" icon={Package}>View POs</Button>
              </Link>
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit Vendor
              </Button>
              <a href="#vendor-laptops" className="inline-flex">
                <Button size="sm" icon={Laptop}>View Laptops</Button>
              </a>
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          <MetricCard icon={Laptop} label="Total Laptops" value={laptopCounts.total} tone="blue" />
          <MetricCard icon={Users} label="Active" value={laptopCounts.active} tone="green" />
          <MetricCard icon={RotateCcw} label="Returned" value={laptopCounts.returned} tone="amber" />
          <MetricCard icon={Warehouse} label="In Stock" value={laptopCounts.in_stock} tone="purple" />
          <MetricCard icon={Calendar} label="Registered On" value={formatDate(vendor.registration_date)} tone="slate" />
        </div>

        {/* Profile grid */}
        <div className="grid lg:grid-cols-2 gap-4 md:gap-5">
          <InfoCard title="Business Information" icon={Building2} onEdit={() => setEditOpen(true)}>
            <FieldGrid>
              <Field label="Legal / trade name" value={vendor.f_name} />
              <Field label="Business name" value={vendor.business_name} />
              <Field label="Business type" value={vendor.business_type} />
              <Field label="Registration date" value={formatDate(vendor.registration_date)} />
              <Field label="GSTIN" value={vendor.gst_number} mono />
              <Field label="PAN" value={vendor.pan_number} mono />
              <Field label="MSME" value={vendor.msme_number} />
              <Field label="Brand code" value={vendor.brand_code} />
            </FieldGrid>
          </InfoCard>

          <InfoCard title="Registered Address" icon={MapPin} onEdit={() => setEditOpen(true)}>
            <FieldGrid cols={1}>
              <Field label="Address" value={vendor.address} />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="City / State" value={cityState} />
                <Field label="Pincode" value={vendor.pincode} mono />
              </div>
            </FieldGrid>
          </InfoCard>

          <InfoCard title="Contact Information" icon={Phone} onEdit={() => setEditOpen(true)}>
            <FieldGrid>
              <Field label="Contact person" value={vendor.contact_person_name || vendor.f_name} />
              <Field label="Phone" value={vendor.contact_person_phone || vendor.number || vendor.phone} />
              <Field label="Alternate phone" value={vendor.alternate_phone} />
              <Field label="Email" value={vendor.email} />
            </FieldGrid>
          </InfoCard>

          <InfoCard title="Banking Details" icon={Landmark} onEdit={() => setEditOpen(true)}>
            <FieldGrid>
              <Field label="Bank name" value={vendor.bank_name} />
              <Field label="Account holder" value={vendor.account_holder_name} />
              <Field label="Account number" value={vendor.account_number} mono />
              <Field label="IFSC" value={vendor.bank_ifsc_code} mono />
            </FieldGrid>
          </InfoCard>

          <InfoCard title="Shipping Address" icon={MapPin} onEdit={() => setEditOpen(true)}>
            {vendor.shipping_same !== false ? (
              <p className="text-sm text-slate-600 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                Same as registered address
              </p>
            ) : (
              <FieldGrid cols={1}>
                <Field label="Address" value={vendor.shipping_address} />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="City / State" value={shippingCityState} />
                  <Field label="Pincode" value={vendor.shipping_pincode} mono />
                </div>
              </FieldGrid>
            )}
          </InfoCard>

          <InfoCard title="Commercial & Portal" icon={FileText} onEdit={() => setEditOpen(true)}>
            <FieldGrid>
              <Field label="Payment terms" value={paymentTermsLabel(vendor.po_payment_terms)} />
              <Field label="Credit days" value={vendor.credit_days != null ? String(vendor.credit_days) : null} />
              <Field
                label="Portal last login"
                value={vendor.vendor_portal_last_login
                  ? new Date(vendor.vendor_portal_last_login).toLocaleString('en-IN')
                  : 'Never logged in'}
              />
              <Field label="Notes" value={vendor.notes} className="sm:col-span-2" />
            </FieldGrid>
          </InfoCard>
        </div>

        {/* Laptops section */}
        <section id="vendor-laptops" className="rounded-2xl border border-slate-200/80 bg-white shadow-sm scroll-mt-6">
          <header className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">Vendor Laptops</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete inventory supplied by this vendor — search, filter and track lifecycle.
              </p>
            </div>
          </header>
          <VendorLaptopsPanel
            vendorId={vendor.vendor_id}
            vendorName={displayName}
            embedded
            onCountsLoaded={setLaptopCounts}
          />
        </section>

        <div className="pb-4">
          <button
            type="button"
            onClick={() => navigate('/vendor-management/vendors')}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to vendors list
          </button>
        </div>
      </div>

      <VendorFormModal
        open={editOpen}
        mode="edit"
        vendorId={vendor.vendor_id}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />
    </div>
  );
}
