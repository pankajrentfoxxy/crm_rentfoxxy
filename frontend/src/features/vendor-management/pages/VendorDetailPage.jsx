import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Pencil,
  Laptop,
  Package,
  Phone,
  ChevronRight,
  PanelRight,
  Users,
  RotateCcw,
  Warehouse,
  Truck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, SectionLoader, Badge } from '../../../components/ui/primitives';
import { fetchVendor } from '../vendorManagementApi';
import VendorFormModal from '../components/VendorFormModal';
import VendorConfigDrawer from '../components/VendorConfigDrawer';
import VendorLaptopsPanel from '../components/VendorLaptopsPanel';
import {
  formatStateLabel,
  paymentTermsLabel,
  paymentTermsBadgeClass,
  vendorStatusKey,
  vendorStatusLabel,
} from '../vendorMgmtUi';

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

export default function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [laptopCounts, setLaptopCounts] = useState({
    total: 0, active: 0, returned: 0, in_stock: 0, in_transit: 0,
  });

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

  return (
    <div className="min-h-full bg-slate-50/80">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-6">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link to="/vendor-management/vendors" className="hover:text-slate-800 transition-colors">
            Vendors
          </Link>
          <ChevronRight className="w-4 h-4 shrink-0 text-slate-300" />
          <span className="text-slate-800 font-medium truncate max-w-[240px] sm:max-w-none">{displayName}</span>
        </nav>

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
                  {cityState && (
                    <>
                      <span className="mx-2 text-slate-300">·</span>
                      {cityState}
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
              <Button variant="secondary" size="sm" icon={PanelRight} onClick={() => setConfigOpen(true)}>
                View Details
              </Button>
              <Link to={`/vendor-management/purchase-orders?vendor_id=${vendor.vendor_id}`}>
                <Button variant="secondary" size="sm" icon={Package}>View POs</Button>
              </Link>
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit Vendor
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          <MetricCard icon={Laptop} label="Total Laptops" value={laptopCounts.total} tone="blue" />
          <MetricCard icon={Users} label="Active" value={laptopCounts.active} tone="green" />
          <MetricCard icon={Truck} label="In Transit" value={laptopCounts.in_transit} tone="blue" />
          <MetricCard icon={Warehouse} label="In Stock" value={laptopCounts.in_stock} tone="purple" />
          <MetricCard icon={RotateCcw} label="Returned" value={laptopCounts.returned} tone="amber" />
        </div>

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

      <VendorConfigDrawer
        open={configOpen}
        vendor={vendor}
        onClose={() => setConfigOpen(false)}
        onEdit={() => {
          setConfigOpen(false);
          setEditOpen(true);
        }}
        onVendorUpdated={load}
      />

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
