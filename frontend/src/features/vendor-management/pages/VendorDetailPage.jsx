import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Pencil, Laptop } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Button, SectionLoader } from '../../../components/ui/primitives';
import { fetchVendor } from '../vendorManagementApi';
import VendorFormModal from '../components/VendorFormModal';
import VendorLaptopsModal from '../components/VendorLaptopsModal';
import {
  formatStateLabel,
  paymentTermsLabel,
  vendorStatusKey,
  vendorStatusLabel,
} from '../vendorMgmtUi';

function DetailRow({ label, value, mono }) {
  return (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      <dl>{children}</dl>
    </div>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [laptopsOpen, setLaptopsOpen] = useState(false);

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
      <div className="p-4 max-w-5xl mx-auto">
        <SectionLoader label="Loading vendor…" />
      </div>
    );
  }

  if (!vendor) return null;

  const statusKey = vendorStatusKey(vendor);
  const portalOn = vendor.vendor_portal_enabled !== false;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate('/vendor-management/vendors')}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to vendors
      </button>

      <PageHeader
        title={vendor.business_name || vendor.f_name || `Vendor #${vendor.vendor_id}`}
        subtitle={`Vendor ID #${vendor.vendor_id}`}
        icon={Building2}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Laptop} onClick={() => setLaptopsOpen(true)}>View Laptops</Button>
            <Link to={`/vendor-management/purchase-orders?vendor_id=${vendor.vendor_id}`}>
              <Button variant="secondary">View POs</Button>
            </Link>
            <Button icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
          </div>
        )}
      />

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {vendorStatusLabel(statusKey)}
        </span>
        <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          {paymentTermsLabel(vendor.po_payment_terms)}
        </span>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${portalOn ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          Portal {portalOn ? 'enabled' : 'disabled'}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Business">
          <DetailRow label="Vendor ID" value={`#${vendor.vendor_id}`} mono />
          <DetailRow label="Legal / trade name" value={vendor.f_name} />
          <DetailRow label="Business name" value={vendor.business_name} />
          <DetailRow label="Business type" value={vendor.business_type} />
          <DetailRow label="Registration date" value={vendor.registration_date ? String(vendor.registration_date).slice(0, 10) : null} />
          <DetailRow label="GSTIN" value={vendor.gst_number} mono />
          <DetailRow label="PAN" value={vendor.pan_number} mono />
          <DetailRow label="MSME" value={vendor.msme_number} />
        </Section>

        <Section title="Contact">
          <DetailRow label="Contact person" value={vendor.contact_person_name || vendor.f_name} />
          <DetailRow label="Phone" value={vendor.contact_person_phone || vendor.number || vendor.phone} />
          <DetailRow label="Alternate phone" value={vendor.alternate_phone} />
          <DetailRow label="Email" value={vendor.email} />
          <DetailRow label="Address" value={vendor.address} />
          <DetailRow
            label="City / State"
            value={[vendor.city, formatStateLabel(vendor.state)].filter(Boolean).join(', ')}
          />
          <DetailRow label="Pincode" value={vendor.pincode} />
        </Section>

        <Section title="Banking">
          <DetailRow label="Bank name" value={vendor.bank_name} />
          <DetailRow label="Account holder" value={vendor.account_holder_name} />
          <DetailRow label="Account number" value={vendor.account_number} mono />
          <DetailRow label="IFSC" value={vendor.bank_ifsc_code} mono />
        </Section>

        <Section title="Commercial & portal">
          <DetailRow label="Payment terms" value={paymentTermsLabel(vendor.po_payment_terms)} />
          <DetailRow label="Credit days" value={vendor.credit_days != null ? String(vendor.credit_days) : null} />
          <DetailRow
            label="Portal last login"
            value={vendor.vendor_portal_last_login
              ? new Date(vendor.vendor_portal_last_login).toLocaleString()
              : 'Never logged in'}
          />
          <DetailRow label="Notes" value={vendor.notes} />
        </Section>
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

      <VendorLaptopsModal
        open={laptopsOpen}
        vendorId={vendor.vendor_id}
        vendorName={vendor.business_name || vendor.f_name || `Vendor #${vendor.vendor_id}`}
        onClose={() => setLaptopsOpen(false)}
      />
    </div>
  );
}
