import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, ExternalLink, FileText, Loader2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button, SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import {
  getCustomer, getCustomerLaptops, getCustomerAssetActivity, getCustomerAddresses, verifyCustomerKyc, enableCustomerPortal,
  updateCustomerStatus, getCustomerTickets, getCustomerRentalSummary, loginAsCustomerPortal,
} from '../leadCrmApi';
import { formatCurrency, formatAssetCalendarDate as fmtAssetDate } from '../leadCrmUtils';
import { getBackendOrigin } from '../../../utils/api';
import CustomerDocuments from '../components/CustomerDocuments';
import CustomerFormDrawer from '../components/CustomerFormDrawer';
import CustomerAddressesTab from '../components/CustomerAddressesTab';
import CustomerAddressModal from '../components/CustomerAddressModal';
import CustomerAssetEditModal from '../components/CustomerAssetEditModal';
import CustomerAssetActivityFeed from '../components/CustomerAssetActivityFeed';
import usePermission from '../../../hooks/usePermission';

const TABS = ['Profile', 'Addresses', 'Documents', 'Assets', 'Tickets', 'Orders', 'Lead Origin', 'Portal Access'];
const TAB_PROFILE = 0;
const TAB_ADDRESSES = 1;
const TAB_DOCUMENTS = 2;
const TAB_ASSETS = 3;
const TAB_TICKETS = 4;
const TAB_ORDERS = 5;
const TAB_LEAD_ORIGIN = 6;
const TAB_PORTAL = 7;
const ASSET_PAGE_SIZE = 25;
const TICKET_PAGE_SIZE = 20;
const TICKET_STATUS_CHIPS = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function formatTicketNumber(id) {
  return `STK-${String(id).padStart(4, '0')}`;
}

function ticketStatusClass(status) {
  const map = {
    open: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-800',
    closed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

const COMPLAINT_TYPE_BADGE = {
  complaint: 'bg-blue-100 text-blue-800',
  replacement: 'bg-purple-100 text-purple-800',
  pickup: 'bg-amber-100 text-amber-800',
};

const COMPLAINT_SUBTYPE_BADGE = {
  repair: 'bg-orange-100 text-orange-800',
  return: 'bg-emerald-100 text-emerald-800',
  mixed: 'bg-slate-100 text-slate-700',
};

function podFileUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  const clean = String(path).replace(/^\/+/, '');
  if (clean.startsWith('uploads/')) return `${origin}/${clean}`;
  return `${origin}/uploads/${clean}`;
}

function laptopConfig(lap) {
  return [lap.processor, lap.generation, lap.ram, lap.storage, lap.gpu, lap.screen_size]
    .filter(Boolean)
    .join(' · ');
}

function PodLinks({ pdfPath, files, keyPrefix }) {
  // Prefer the full Delivery Challan PDF (it already embeds the e-signature).
  if (pdfPath) {
    return (
      <a
        href={podFileUrl(pdfPath)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
      >
        <FileText className="w-3 h-3" />
        View DC PDF
      </a>
    );
  }
  if (!Array.isArray(files) || files.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((p, idx) => (
        <a
          key={`${keyPrefix}-pod-${idx}`}
          href={podFileUrl(p)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
        >
          <FileText className="w-3 h-3" />
          {files.length > 1 ? `View ${idx + 1}` : 'View POD'}
        </a>
      ))}
    </div>
  );
}

function KycBadge({ status }) {
  const map = {
    verified: 'bg-green-100 text-green-700',
    submitted: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-600',
  };
  const s = status || 'pending';
  return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${map[s] || map.pending}`}>KYC: {s}</span>;
}
const PRODUCTION_PORTAL_URL = 'https://customer.rentfoxxy.com';

function resolveCustomerPortalUrl(fromApi) {
  const configured = process.env.REACT_APP_CUSTOMER_PORTAL_URL || '';
  const raw = String(fromApi || configured || '').replace(/\/+$/, '');
  const isLocal = !raw || /localhost|127\.0\.0\.1/.test(raw);
  const onRentfoxxyHost =
    typeof window !== 'undefined' && /\.rentfoxxy\.com$/i.test(window.location.hostname);
  if (isLocal && onRentfoxxyHost) return PRODUCTION_PORTAL_URL;
  return raw || 'http://localhost:3002';
}

const PORTAL_URL = resolveCustomerPortalUrl();

function customerField(customer, key) {
  if (!customer) return '';
  const direct = customer[key] || customer.details?.[key];
  if (direct) return direct;
  if (key.startsWith('spock_person_')) {
    const legacyKey = key.replace(/^spock_person_/, 'expox_person_');
    return customer[legacyKey] || customer.details?.[legacyKey] || '';
  }
  return '';
}

function ProfileFieldGrid({ title, fields, customer }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm">
      <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(([label, key]) => (
          <div key={key}>
            <span className="text-gray-500">{label}</span>
            <p className="font-medium">{customerField(customer, key) || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PasswordModal({ password, onClose }) {
  const copy = () => {
    navigator.clipboard.writeText(password);
    toast.success('Password copied');
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-lg font-semibold">Portal credentials</h3>
        <p className="text-sm text-gray-600">Share this temporary password with the customer:</p>
        <div className="flex items-center gap-2 bg-gray-50 border rounded-lg p-3 font-mono text-sm">
          <span className="flex-1">{password}</span>
          <button type="button" onClick={copy} className="p-1.5 hover:bg-gray-200 rounded">
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500">Portal URL: {PORTAL_URL}</p>
        <button type="button" onClick={onClose} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm">Done</button>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [assetRows, setAssetRows] = useState([]);
  const [assetCounts, setAssetCounts] = useState({ active: 0, returned: 0 });
  const [assetView, setAssetView] = useState('active');
  const [assetPage, setAssetPage] = useState(1);
  const [assetSearchInput, setAssetSearchInput] = useState('');
  const assetSearch = useDebouncedValue(assetSearchInput.trim(), 320);
  const [assetFrom, setAssetFrom] = useState('');
  const [assetTo, setAssetTo] = useState('');
  const [assetPagination, setAssetPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: ASSET_PAGE_SIZE });
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [tab, setTab] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [ttsplOpen, setTtsplOpen] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [newPassword, setNewPassword] = useState(null);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [assetEdit, setAssetEdit] = useState(null);
  const [assetActivity, setAssetActivity] = useState([]);
  const [assetActivityLoading, setAssetActivityLoading] = useState(false);
  const [ticketRows, setTicketRows] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketSearchInput, setTicketSearchInput] = useState('');
  const ticketSearch = useDebouncedValue(ticketSearchInput.trim(), 320);
  const [ticketStatus, setTicketStatus] = useState('');
  const [ticketPagination, setTicketPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: TICKET_PAGE_SIZE });
  const [rentalSummary, setRentalSummary] = useState({ total_monthly_rent: 0, active_asset_count: 0 });
  const { canEdit: canEditCustomerAssets, user } = usePermission();
  const isSuperAdmin = user?.role === 'super_admin';
  const [portalPreviewBusy, setPortalPreviewBusy] = useState(false);

  const loadCustomer = useCallback(async () => {
    try {
      const res = await getCustomer(id);
      const row = res.data?.customer;
      setCustomer(row);
      setSavedAddresses(row?.saved_addresses || []);
    } catch {
      toast.error('Failed to load customer');
    }
  }, [id]);

  const loadAddresses = useCallback(async () => {
    setAddressesLoading(true);
    try {
      const res = await getCustomerAddresses(id);
      setSavedAddresses(res.data?.addresses || []);
    } catch {
      toast.error('Failed to load addresses');
    } finally {
      setAddressesLoading(false);
    }
  }, [id]);

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    try {
      const lapRes = await getCustomerLaptops(id, {
        lifecycle: assetView,
        page: assetPage,
        limit: ASSET_PAGE_SIZE,
        search: assetSearch || undefined,
        from: assetFrom || undefined,
        to: assetTo || undefined,
      });
      setAssetRows(lapRes.data?.data || []);
      if (lapRes.data?.counts) setAssetCounts(lapRes.data.counts);
      setAssetPagination(lapRes.data?.pagination || {
        page: assetPage,
        totalPages: 1,
        total: lapRes.data?.data?.length || 0,
        limit: ASSET_PAGE_SIZE,
      });
    } catch {
      toast.error('Failed to load customer assets');
    } finally {
      setAssetsLoading(false);
    }
  }, [id, assetView, assetPage, assetSearch, assetFrom, assetTo]);

  const loadAssetActivity = useCallback(async () => {
    setAssetActivityLoading(true);
    try {
      const res = await getCustomerAssetActivity(id, { limit: 15 });
      setAssetActivity(res.data?.activity || []);
    } catch {
      setAssetActivity([]);
    } finally {
      setAssetActivityLoading(false);
    }
  }, [id]);

  const refreshAssetsTab = useCallback(async () => {
    await Promise.all([loadAssets(), loadAssetActivity()]);
  }, [loadAssets, loadAssetActivity]);

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const [ticketsRes, rentalRes] = await Promise.all([
        getCustomerTickets(id, {
          page: ticketPage,
          limit: TICKET_PAGE_SIZE,
          search: ticketSearch || undefined,
          status: ticketStatus || undefined,
        }),
        getCustomerRentalSummary(id),
      ]);
      setTicketRows(ticketsRes.data?.tickets || []);
      setTicketPagination(ticketsRes.data?.pagination || {
        page: ticketPage,
        totalPages: 1,
        total: ticketsRes.data?.total || 0,
        limit: TICKET_PAGE_SIZE,
      });
      setRentalSummary({
        total_monthly_rent: Number(rentalRes.data?.total_monthly_rent || 0),
        active_asset_count: Number(rentalRes.data?.active_asset_count || 0),
      });
    } catch {
      toast.error('Failed to load customer tickets');
      setTicketRows([]);
    } finally {
      setTicketsLoading(false);
    }
  }, [id, ticketPage, ticketSearch, ticketStatus]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);

  useEffect(() => {
    if (tab !== TAB_ASSETS) return;
    loadAssets();
    loadAssetActivity();
  }, [tab, loadAssets, loadAssetActivity]);

  useEffect(() => {
    if (tab !== TAB_ADDRESSES) return;
    loadAddresses();
  }, [tab, loadAddresses]);

  useEffect(() => {
    if (tab !== TAB_TICKETS) return;
    loadTickets();
  }, [tab, loadTickets]);

  useEffect(() => { setAssetPage(1); }, [assetSearch, assetView, assetFrom, assetTo]);
  useEffect(() => { setTicketPage(1); }, [ticketSearch, ticketStatus]);

  const load = useCallback(async () => {
    await loadCustomer();
    if (tab === TAB_ASSETS) await refreshAssetsTab();
    if (tab === TAB_ADDRESSES) await loadAddresses();
    if (tab === TAB_TICKETS) await loadTickets();
  }, [loadCustomer, refreshAssetsTab, loadAddresses, loadTickets, tab]);

  if (!customer) return <div className="p-6 text-center text-gray-400">Loading...</div>;

  const handlePortalAction = async (payload) => {
    setPortalBusy(true);
    try {
      const res = await enableCustomerPortal(id, payload);
      if (res.data?.new_password) setNewPassword(res.data.new_password);
      toast.success(payload.enabled === false ? 'Portal disabled' : 'Portal updated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Portal update failed');
    } finally {
      setPortalBusy(false);
    }
  };

  const handleOpenPortalAsCustomer = async () => {
    // The tab has to be opened inside the click handler, before any await, or
    // the browser treats it as an unsolicited popup and blocks it.
    const tab = window.open('', '_blank');
    setPortalPreviewBusy(true);
    try {
      const { data } = await loginAsCustomerPortal(id);
      if (!data?.token) throw new Error(data?.message || 'Could not start portal session');
      const base = resolveCustomerPortalUrl(data.portal_url);
      // Token goes in the fragment so it stays out of server logs and Referer headers.
      const url = `${base}/dashboard#token=${encodeURIComponent(data.token)}`;
      if (tab) {
        tab.location = url;
      } else {
        toast.error('Allow pop-ups for this site to open the customer portal');
        return;
      }
      toast.success(`Opened portal as ${customer.company_name || customer.name} — read-only for ${data.ttl_minutes} min`);
    } catch (err) {
      if (tab) tab.close();
      toast.error(err.response?.data?.message || err.message || 'Could not open customer portal');
    } finally {
      setPortalPreviewBusy(false);
    }
  };

  const handleVerifyKyc = async () => {
    await verifyCustomerKyc(id);
    toast.success('KYC verified');
    load();
  };

  const customerActive = Number(customer.status ?? 1) === 1;

  const handleToggleStatus = async () => {
    const next = customerActive ? 0 : 1;
    if (!window.confirm(
      `${customerActive ? 'Deactivate' : 'Activate'} this customer?\n\nInactive customers will not appear in SO, quotation, support, or other pickers.`
    )) return;
    try {
      const { data } = await updateCustomerStatus(id, next);
      toast.success(data?.message || (next === 1 ? 'Customer activated' : 'Customer deactivated'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update customer status');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <button type="button" onClick={() => navigate('/lead-crm/customers')}
        className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2 flex-wrap">
            {customer.company_name || customer.customer_name}
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${customerActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
              {customerActive ? 'Active' : 'Inactive'}
            </span>
          </h1>
          <p className="text-gray-500 text-sm">Customer #{customer.customer_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <KycBadge status={customer.kyc_status || (customer.kyc_verified ? 'verified' : 'pending')} />
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
          <PermissionGate section="customers" action="edit">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleToggleStatus}
            >
              {customerActive ? 'Deactivate' : 'Activate'}
            </Button>
          </PermissionGate>
          <PermissionGate section="kyc_management" action="edit">
            {(customer.kyc_status !== 'verified' && !customer.kyc_verified) && (
              <Button variant="success" size="sm" onClick={handleVerifyKyc}>Verify KYC</Button>
            )}
          </PermissionGate>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-2 mb-4">
        {TABS.map((t, i) => (
          <button key={t} type="button" onClick={() => setTab(i)}
            className={`px-3 py-1.5 text-sm rounded-lg ${tab === i ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === TAB_PROFILE && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[
              ['Name', customer.contact_person_name || customer.customer_name], ['Company', customer.company_name],
              ['Email', customer.email], ['Phone', customer.customer_number || customer.phone],
              ['GST', customer.gst_number], ['PAN', customer.pan_number || customer.pan_card_number],
              ['Company Type', customer.company_type], ['Industry', customer.industry],
              ['Billing', typeof customer.billing_address === 'object'
                ? customer.billing_address?.address
                : customer.billing_address],
              ['City', customer.billing_city],
              ['State', customer.billing_state], ['Pincode', customer.billing_pincode],
              ['Shipping same as billing', customer.shipping_same !== false ? 'Yes' : 'No'],
              ...(customer.shipping_same === false ? [
                ['Shipping Address', customer.shipping_address],
                ['Shipping City', customer.shipping_city],
                ['Shipping State', customer.shipping_state],
                ['Shipping Pincode', customer.shipping_pincode],
              ] : []),
            ].map(([label, val]) => (
              <div key={label}><span className="text-gray-500">{label}</span><p className="font-medium">{val || '—'}</p></div>
            ))}
          </div>
          <ProfileFieldGrid
            title="Finance Contact"
            customer={customer}
            fields={[
              ['Name', 'finance_contact_name'],
              ['Email', 'finance_contact_email'],
              ['Mobile Number', 'finance_contact_mobile'],
            ]}
          />
          <ProfileFieldGrid
            title="Spoke Person"
            customer={customer}
            fields={[
              ['Name', 'spock_person_name'],
              ['Email', 'spock_person_email'],
              ['Mobile Number', 'spock_person_mobile'],
            ]}
          />
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Financial</h3>
            <p>
              <span className="text-gray-500">Security Deposit: </span>
              <span className="font-medium">{formatCurrency(customer.total_security_amount || 0)}</span>
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Total held from quotations. For full deposit history,{' '}
              <Link
                to={`/finance/security-deposits?customer_id=${customer.customer_id}`}
                className="text-blue-600 hover:underline"
              >
                view in Finance → Security Deposits
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {tab === TAB_ADDRESSES && (
        <CustomerAddressesTab
          customer={customer}
          savedAddresses={savedAddresses}
          loading={addressesLoading}
          onAddAddress={() => setAddressModal({ mode: 'add', kind: 'saved' })}
          onEditAddress={(item) => setAddressModal({
            mode: 'edit',
            kind: item.kind,
            addressId: item.customerAddressId || null,
            initial: item,
          })}
        />
      )}

      {tab === TAB_DOCUMENTS && <CustomerDocuments customerId={customer.customer_id} />}

      {tab === TAB_ASSETS && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <button
              type="button"
              onClick={() => { setAssetPage(1); setAssetView('active'); }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                assetView === 'active' ? 'border-green-500 bg-green-50' : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-500">Active (on rent)</p>
              <p className="text-2xl font-bold text-green-700">{assetCounts.active ?? 0}</p>
            </button>
            <button
              type="button"
              onClick={() => { setAssetPage(1); setAssetView('returned'); }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                assetView === 'returned' ? 'border-amber-500 bg-amber-50' : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-500">Returned</p>
              <p className="text-2xl font-bold text-amber-700">{assetCounts.returned ?? 0}</p>
            </button>
          </div>

          <SearchField
            value={assetSearchInput}
            onChange={(e) => setAssetSearchInput(e.target.value)}
            placeholder="Search TTSPL, serial, model, DC number…"
            className="max-w-md"
          />

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-gray-500">
              Delivery date from
              <input
                type="date"
                value={assetFrom}
                max={assetTo || undefined}
                onChange={(e) => setAssetFrom(e.target.value)}
                className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
              />
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              To
              <input
                type="date"
                value={assetTo}
                min={assetFrom || undefined}
                onChange={(e) => setAssetTo(e.target.value)}
                className="mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
              />
            </label>
            {(assetFrom || assetTo) && (
              <button
                type="button"
                onClick={() => { setAssetFrom(''); setAssetTo(''); }}
                className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Clear dates
              </button>
            )}
          </div>

          {assetsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
          ) : (
          <>
          <div className="grid gap-3 md:hidden">
            {assetView === 'active' ? (
              assetRows.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">No assets currently with this customer</p>
              ) : assetRows.map((lap) => (
                <div key={lap.serial_id || lap.ttspl_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => setTtsplOpen(lap.ttspl_id || lap.serial_number)} className="text-blue-600 font-mono text-sm font-semibold">{lap.ttspl_id || lap.serial_number}</button>
                    <div className="flex items-center gap-1">
                      {canEditCustomerAssets('customer_assets') && lap.serial_id ? (
                        <button
                          type="button"
                          title="Edit asset"
                          onClick={() => setAssetEdit(lap)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{lap.status || 'rented'}</span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-800">{lap.model_name || '—'}</p>
                  <p className="text-xs text-slate-500">SN: {lap.serial_number || '—'}</p>
                  <p className="text-xs text-slate-500">{laptopConfig(lap) || '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {lap.entity_code === 'gorefurbo'
                      ? <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700">Gorefurbo</span>
                      : <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">Rentfoxxy</span>}
                    {lap.dc_number && <span className="font-mono">DC {lap.dc_number}</span>}
                    {lap.dispatch_date && <span>Dispatch: {fmtAssetDate(lap.dispatch_date)}</span>}
                    {lap.delivered_at && <span>Delivered: {fmtAssetDate(lap.delivered_at)}</span>}
                    {lap.rent_monthly_rate && <span className="font-semibold text-slate-700">{formatCurrency(lap.rent_monthly_rate)}</span>}
                  </div>
                  <div className="pt-2 border-t border-slate-100"><PodLinks pdfPath={lap.dc_pdf_path} files={lap.pod_files} keyPrefix={lap.serial_id || lap.ttspl_id} /></div>
                </div>
              ))
            ) : (
              assetRows.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">No returned laptops for this customer</p>
              ) : assetRows.map((lap, i) => (
                <div key={lap.dc_number ? `${lap.dc_number}-${i}` : `ret-${i}`} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => setTtsplOpen(lap.ttspl_id || lap.serial_number)} className="text-blue-600 font-mono text-sm font-semibold">{lap.ttspl_id || lap.serial_number || '—'}</button>
                    <div className="flex items-center gap-1">
                      {canEditCustomerAssets('customer_assets') && lap.serial_id ? (
                        <button
                          type="button"
                          title="Edit asset"
                          onClick={() => setAssetEdit(lap)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">returned</span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-800">{lap.model_name || '—'}</p>
                  <p className="text-xs text-slate-500">SN: {lap.serial_number || '—'}</p>
                  <p className="text-xs text-slate-500">{laptopConfig(lap) || '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {lap.dc_number && <span className="font-mono">Return DC {lap.dc_number}</span>}
                    {lap.delivered_at && <span>Delivered to customer: {fmtAssetDate(lap.delivered_at)}</span>}
                    {lap.returned_at && <span>Returned: {fmtAssetDate(lap.returned_at)}</span>}
                    <span className="capitalize">{lap.pickup_type || 'return'}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-100"><PodLinks files={lap.pod_files} keyPrefix={lap.dc_number || `ret-${i}`} /></div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                <tr>
                  {(assetView === 'active'
                    ? ['#', 'TTSPL ID', 'Serial No', 'Model', 'Config', 'Entity', 'DC Number', 'Dispatch Date', 'Delivered Date', 'Monthly Rate', 'POD', 'Status', 'Actions']
                    : ['#', 'TTSPL ID', 'Serial No', 'Model', 'Config', 'Return DC', 'Delivered to Customer', 'Returned from Customer', 'Type', 'POD', 'Status', 'Actions']
                  ).map((h) => <th key={h} className="p-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {assetView === 'active' ? (
                  assetRows.length === 0 ? (
                    <tr><td colSpan={13} className="p-6 text-center text-gray-400">No assets currently with this customer</td></tr>
                  ) : assetRows.map((lap, i) => (
                    <tr key={lap.serial_id || lap.ttspl_id} className="border-t border-gray-100">
                      <td className="p-3 text-xs text-gray-400">{(assetPage - 1) * ASSET_PAGE_SIZE + i + 1}</td>
                      <td className="p-3">
                        <button type="button" onClick={() => setTtsplOpen(lap.ttspl_id || lap.serial_number)}
                          className="text-blue-600 hover:underline font-mono text-xs">
                          {lap.ttspl_id || lap.serial_number}
                        </button>
                      </td>
                      <td className="p-3 text-xs font-mono">{lap.serial_number || '—'}</td>
                      <td className="p-3">{lap.model_name || '—'}</td>
                      <td className="p-3 text-xs">{laptopConfig(lap) || '—'}</td>
                      <td className="p-3 text-xs">
                        {lap.entity_code === 'gorefurbo'
                          ? <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700">Gorefurbo</span>
                          : <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">Rentfoxxy</span>}
                      </td>
                      <td className="p-3 text-xs font-mono">{lap.dc_number || '—'}</td>
                      <td className="p-3 text-xs">{fmtAssetDate(lap.dispatch_date)}</td>
                      <td className="p-3 text-xs">{fmtAssetDate(lap.delivered_at)}</td>
                      <td className="p-3 text-xs">{lap.rent_monthly_rate ? formatCurrency(lap.rent_monthly_rate) : '—'}</td>
                      <td className="p-3 text-xs"><PodLinks pdfPath={lap.dc_pdf_path} files={lap.pod_files} keyPrefix={lap.serial_id || lap.ttspl_id} /></td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{lap.status || 'rented'}</span></td>
                      <td className="p-3">
                        {canEditCustomerAssets('customer_assets') && lap.serial_id ? (
                          <button
                            type="button"
                            title="Edit asset"
                            onClick={() => setAssetEdit(lap)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-teal-700"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  assetRows.length === 0 ? (
                    <tr><td colSpan={12} className="p-6 text-center text-gray-400">No returned laptops for this customer</td></tr>
                  ) : assetRows.map((lap, i) => (
                    <tr key={lap.dc_number ? `${lap.dc_number}-${i}` : `ret-${i}`} className="border-t border-gray-100">
                      <td className="p-3 text-xs text-gray-400">{(assetPage - 1) * ASSET_PAGE_SIZE + i + 1}</td>
                      <td className="p-3">
                        <button type="button" onClick={() => setTtsplOpen(lap.ttspl_id || lap.serial_number)}
                          className="text-blue-600 hover:underline font-mono text-xs">
                          {lap.ttspl_id || lap.serial_number || '—'}
                        </button>
                      </td>
                      <td className="p-3 text-xs font-mono">{lap.serial_number || '—'}</td>
                      <td className="p-3">{lap.model_name || '—'}</td>
                      <td className="p-3 text-xs">{laptopConfig(lap) || '—'}</td>
                      <td className="p-3 text-xs font-mono">{lap.dc_number || '—'}</td>
                      <td className="p-3 text-xs">{fmtAssetDate(lap.delivered_at)}</td>
                      <td className="p-3 text-xs">{fmtAssetDate(lap.returned_at)}</td>
                      <td className="p-3 text-xs capitalize">{lap.pickup_type || 'return'}</td>
                      <td className="p-3 text-xs"><PodLinks files={lap.pod_files} keyPrefix={lap.dc_number || `ret-${i}`} /></td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">returned</span></td>
                      <td className="p-3">
                        {canEditCustomerAssets('customer_assets') && lap.serial_id ? (
                          <button
                            type="button"
                            title="Edit asset"
                            onClick={() => setAssetEdit(lap)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-teal-700"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <ListPagination
            page={assetPage}
            totalPages={assetPagination.totalPages || 1}
            total={assetPagination.total || 0}
            pageSize={ASSET_PAGE_SIZE}
            onPageChange={setAssetPage}
          />

          <CustomerAssetActivityFeed activity={assetActivity} loading={assetActivityLoading} />
          </>
          )}
        </div>
      )}

      {tab === TAB_TICKETS && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 sm:max-w-xs">
            <p className="text-xs text-gray-500">Current Rental Amount / month</p>
            <p className="text-2xl font-bold text-slate-800">
              {formatCurrency(rentalSummary.total_monthly_rent || 0)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {rentalSummary.active_asset_count || 0} active asset(s)
            </p>
          </div>

          <SearchField
            value={ticketSearchInput}
            onChange={(e) => setTicketSearchInput(e.target.value)}
            placeholder="Search ticket #, TTSPL, name, phone…"
            className="max-w-md"
          />

          <div className="flex flex-wrap gap-2">
            {TICKET_STATUS_CHIPS.map((chip) => (
              <button
                key={chip.key || 'all'}
                type="button"
                onClick={() => setTicketStatus(chip.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  ticketStatus === chip.key
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {ticketsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                    <tr>
                      {['Ticket #', 'TTSPL', 'Type', 'Sub-type', 'Replacement', 'Status', 'Items', 'Created', 'Created By', 'Closed', 'Remark'].map((h) => (
                        <th key={h} className="p-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ticketRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-6 text-center text-gray-400">
                          No tickets for this customer
                        </td>
                      </tr>
                    ) : ticketRows.map((tk) => {
                      const typeLabel = tk.complaint_type_label || tk.ticket_category || 'complaint';
                      const subtype = tk.complaint_subtype || null;
                      const ttspl = tk.ttspl_list || tk.ttspl_id || null;
                      const remark = (tk.remarks || tk.top_level_remarks || tk.item_remarks || '').trim();
                      const replacements = Array.isArray(tk.replacements) ? tk.replacements : [];
                      const showReplacement = typeLabel === 'replacement' || replacements.length > 0;
                      return (
                        <tr key={tk.id} className="border-t border-gray-100">
                          <td className="p-3">
                            <Link
                              to={`/support/tickets/${tk.id}`}
                              className="text-blue-600 hover:underline font-mono text-xs"
                            >
                              {formatTicketNumber(tk.id)}
                            </Link>
                          </td>
                          <td className="p-3">
                            {ttspl ? (
                              <button
                                type="button"
                                onClick={() => setTtsplOpen(String(ttspl).split(',')[0].trim())}
                                className="text-blue-600 hover:underline font-mono text-xs text-left"
                                title={ttspl}
                              >
                                {ttspl}
                              </button>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${COMPLAINT_TYPE_BADGE[typeLabel] || 'bg-slate-100 text-slate-700'}`}>
                              {String(typeLabel).replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="p-3">
                            {subtype ? (
                              <span className={`px-2 py-0.5 rounded-full text-xs ${COMPLAINT_SUBTYPE_BADGE[tk.pickup_kind] || 'bg-slate-100 text-slate-700'}`}>
                                {subtype}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="p-3 min-w-[160px]">
                            {!showReplacement ? (
                              <span className="text-gray-400 text-xs">—</span>
                            ) : replacements.length === 0 ? (
                              <span className="text-xs text-amber-700">Replacement pending</span>
                            ) : (
                              <div className="space-y-1">
                                {replacements.map((r, idx) => (
                                  <div key={`${tk.id}-repl-${idx}`} className="text-xs text-slate-700">
                                    <button
                                      type="button"
                                      className="font-mono text-blue-600 hover:underline"
                                      onClick={() => r.old_ttspl && setTtsplOpen(r.old_ttspl)}
                                      disabled={!r.old_ttspl}
                                    >
                                      {r.old_ttspl || '—'}
                                    </button>
                                    <span className="mx-1 text-slate-400">→</span>
                                    {r.new_ttspl ? (
                                      <button
                                        type="button"
                                        className="font-mono text-emerald-700 hover:underline"
                                        onClick={() => setTtsplOpen(r.new_ttspl)}
                                      >
                                        {r.new_ttspl}
                                      </button>
                                    ) : (
                                      <span className="text-amber-700">pending</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${ticketStatusClass(tk.status)}`}>
                              {String(tk.status || '').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="p-3 text-xs">
                            {tk.open_item_count}/{tk.item_count} open
                          </td>
                          <td className="p-3 text-xs">{fmtAssetDate(tk.created_at)}</td>
                          <td className="p-3 text-xs">{tk.created_by_name || '—'}</td>
                          <td className="p-3 text-xs">{tk.closed_at ? fmtAssetDate(tk.closed_at) : '—'}</td>
                          <td className="p-3 max-w-[220px]">
                            {remark ? (
                              <p className="text-xs text-slate-600 line-clamp-3 whitespace-pre-wrap break-words" title={remark}>
                                {remark}
                              </p>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ListPagination
                page={ticketPage}
                totalPages={ticketPagination.totalPages || 1}
                total={ticketPagination.total || 0}
                pageSize={TICKET_PAGE_SIZE}
                onPageChange={setTicketPage}
              />
            </>
          )}
        </div>
      )}

      {tab === TAB_ORDERS && (
        <p className="text-sm text-gray-500 p-4 rounded-xl border border-gray-100 bg-white">
          Orders are managed in Operation Management. Link customer orders from sales orders module.
        </p>
      )}

      {tab === TAB_LEAD_ORIGIN && (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm">
          {customer.source_lead_id ? (
            <>
              <p>Converted from lead <Link to={`/lead-crm/leads/${customer.source_lead_id}`} className="text-blue-600">#{customer.source_lead_id}</Link></p>
              <p className="text-gray-500 mt-2">Stage at conversion: {customer.source_lead_stage || '—'}</p>
              <p className="text-gray-500">Onboarded: {customer.onboarded_at ? new Date(customer.onboarded_at).toLocaleString('en-IN') : '—'}</p>
            </>
          ) : (
            <p>Added directly on {new Date(customer.created_at).toLocaleDateString('en-IN')}</p>
          )}
        </div>
      )}

      {tab === TAB_PORTAL && (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-4">
          <PermissionGate section="customers" action="edit">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Portal status</p>
                <p className={`text-xs mt-1 ${customer.portal_enabled ? 'text-green-600' : 'text-gray-500'}`}>
                  {customer.portal_enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${customer.portal_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {customer.portal_enabled ? 'Active' : 'Inactive'}
              </span>
            </div>

            {customer.portal_enabled && (
              <p className="text-sm text-gray-600">
                Last login:{' '}
                {customer.portal_last_login
                  ? new Date(customer.portal_last_login).toLocaleString('en-IN')
                  : 'Never'}
              </p>
            )}

            <p className="text-xs text-gray-500">Customer portal URL: {PORTAL_URL}</p>

            <div className="flex flex-wrap gap-2 pt-2">
              {!customer.portal_enabled ? (
                <button
                  type="button"
                  disabled={portalBusy}
                  onClick={() => handlePortalAction({ enabled: true })}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50"
                >
                  Enable Portal Access
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={() => handlePortalAction({ reset_password: true })}
                    className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
                  >
                    Reset Password
                  </button>
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={() => handlePortalAction({ send_login_email: true })}
                    className="px-4 py-2 text-sm border border-teal-200 text-teal-700 rounded-lg disabled:opacity-50"
                  >
                    Send Login Email
                  </button>
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={() => handlePortalAction({ enabled: false })}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50"
                  >
                    Disable Portal
                  </button>
                </>
              )}
            </div>
          </PermissionGate>
          {!customer.portal_enabled && (
            <p className="text-xs text-gray-500">Enable portal access to let this customer view invoices, laptops, and raise support tickets.</p>
          )}

          {isSuperAdmin && (
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-medium">Open portal as this customer</p>
              <p className="text-xs text-gray-500">
                Opens the customer portal in a new tab exactly as {customer.company_name || customer.name} sees it,
                without needing their password. The session is read-only, expires in an hour, and is logged against your
                account. Raising tickets and changing the password stay disabled.
              </p>
              <button
                type="button"
                disabled={portalPreviewBusy}
                onClick={handleOpenPortalAsCustomer}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg disabled:opacity-50"
              >
                {portalPreviewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                {portalPreviewBusy ? 'Opening…' : 'Login to Customer Portal'}
              </button>
            </div>
          )}
        </div>
      )}

      <CustomerFormDrawer open={editOpen} customer={customer} onClose={() => setEditOpen(false)} onSaved={load} />
      <CustomerAddressModal
        open={Boolean(addressModal)}
        mode={addressModal?.mode || 'add'}
        kind={addressModal?.kind || 'saved'}
        customer={customer}
        addressId={addressModal?.addressId}
        initial={addressModal?.initial}
        onClose={() => setAddressModal(null)}
        onSaved={load}
      />
      <CustomerAssetEditModal
        open={Boolean(assetEdit)}
        customerId={customer.customer_id}
        asset={assetEdit}
        onClose={() => setAssetEdit(null)}
        onSaved={refreshAssetsTab}
      />
      <TtsplHistoryDrawer ttsplId={ttsplOpen} open={!!ttsplOpen} onClose={() => setTtsplOpen(null)} />
      {newPassword && <PasswordModal password={newPassword} onClose={() => setNewPassword(null)} />}
    </div>
  );
}
