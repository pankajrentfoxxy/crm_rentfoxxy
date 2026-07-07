import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button, SearchField, ListPagination } from '../../../components/ui/primitives';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import {
  getCustomer, getCustomerLaptops, getCustomerAddresses, verifyCustomerKyc, enableCustomerPortal,
} from '../leadCrmApi';
import { formatCurrency } from '../leadCrmUtils';
import { getBackendOrigin } from '../../../utils/api';
import CustomerDocuments from '../components/CustomerDocuments';
import CustomerFormDrawer from '../components/CustomerFormDrawer';
import CustomerAddressesTab from '../components/CustomerAddressesTab';
import CustomerAddressModal from '../components/CustomerAddressModal';

const TABS = ['Profile', 'Addresses', 'Documents', 'Assets', 'Orders', 'Lead Origin', 'Portal Access'];
const TAB_PROFILE = 0;
const TAB_ADDRESSES = 1;
const TAB_DOCUMENTS = 2;
const TAB_ASSETS = 3;
const ASSET_PAGE_SIZE = 25;

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
const PORTAL_URL = process.env.REACT_APP_CUSTOMER_PORTAL_URL || 'http://localhost:3002';

function customerField(customer, key) {
  if (!customer) return '';
  return customer[key] || customer.details?.[key] || '';
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
  }, [id, assetView, assetPage, assetSearch]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);

  useEffect(() => {
    if (tab !== TAB_ASSETS) return;
    loadAssets();
  }, [tab, loadAssets]);

  useEffect(() => {
    if (tab !== TAB_ADDRESSES) return;
    loadAddresses();
  }, [tab, loadAddresses]);

  useEffect(() => { setAssetPage(1); }, [assetSearch, assetView]);

  const load = useCallback(async () => {
    await loadCustomer();
    if (tab === TAB_ASSETS) await loadAssets();
    if (tab === TAB_ADDRESSES) await loadAddresses();
  }, [loadCustomer, loadAssets, loadAddresses, tab]);

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

  const handleVerifyKyc = async () => {
    await verifyCustomerKyc(id);
    toast.success('KYC verified');
    load();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <button type="button" onClick={() => navigate('/lead-crm/customers')}
        className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{customer.company_name || customer.customer_name}</h1>
          <p className="text-gray-500 text-sm">Customer #{customer.customer_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <KycBadge status={customer.kyc_status || (customer.kyc_verified ? 'verified' : 'pending')} />
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
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
              ['Name', customer.customer_name], ['Company', customer.company_name],
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
            title="Spock Person"
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
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{lap.status || 'rented'}</span>
                  </div>
                  <p className="text-sm text-slate-800">{lap.model_name || '—'}</p>
                  <p className="text-xs text-slate-500">SN: {lap.serial_number || '—'}</p>
                  <p className="text-xs text-slate-500">{laptopConfig(lap) || '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {lap.entity_code === 'gorefurbo'
                      ? <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700">Gorefurbo</span>
                      : <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">Rentfoxxy</span>}
                    {lap.dc_number && <span className="font-mono">DC {lap.dc_number}</span>}
                    {(lap.delivered_at || lap.dispatch_date) && <span>{new Date(lap.delivered_at || lap.dispatch_date).toLocaleDateString('en-IN')}</span>}
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
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">returned</span>
                  </div>
                  <p className="text-sm text-slate-800">{lap.model_name || '—'}</p>
                  <p className="text-xs text-slate-500">SN: {lap.serial_number || '—'}</p>
                  <p className="text-xs text-slate-500">{laptopConfig(lap) || '—'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {lap.dc_number && <span className="font-mono">Return DC {lap.dc_number}</span>}
                    {lap.delivered_at && <span>{new Date(lap.delivered_at).toLocaleDateString('en-IN')}</span>}
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
                    ? ['#', 'TTSPL ID', 'Serial No', 'Model', 'Config', 'Entity', 'DC Number', 'Delivered Date', 'Monthly Rate', 'POD', 'Status']
                    : ['#', 'TTSPL ID', 'Serial No', 'Model', 'Config', 'Return DC', 'Returned Date', 'Type', 'POD', 'Status']
                  ).map((h) => <th key={h} className="p-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {assetView === 'active' ? (
                  assetRows.length === 0 ? (
                    <tr><td colSpan={11} className="p-6 text-center text-gray-400">No assets currently with this customer</td></tr>
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
                      <td className="p-3 text-xs">{(lap.delivered_at || lap.dispatch_date) ? new Date(lap.delivered_at || lap.dispatch_date).toLocaleDateString('en-IN') : '—'}</td>
                      <td className="p-3 text-xs">{lap.rent_monthly_rate ? formatCurrency(lap.rent_monthly_rate) : '—'}</td>
                      <td className="p-3 text-xs"><PodLinks pdfPath={lap.dc_pdf_path} files={lap.pod_files} keyPrefix={lap.serial_id || lap.ttspl_id} /></td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{lap.status || 'rented'}</span></td>
                    </tr>
                  ))
                ) : (
                  assetRows.length === 0 ? (
                    <tr><td colSpan={10} className="p-6 text-center text-gray-400">No returned laptops for this customer</td></tr>
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
                      <td className="p-3 text-xs">{lap.delivered_at ? new Date(lap.delivered_at).toLocaleDateString('en-IN') : '—'}</td>
                      <td className="p-3 text-xs capitalize">{lap.pickup_type || 'return'}</td>
                      <td className="p-3 text-xs"><PodLinks files={lap.pod_files} keyPrefix={lap.dc_number || `ret-${i}`} /></td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">returned</span></td>
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
          </>
          )}
        </div>
      )}

      {tab === 4 && (
        <p className="text-sm text-gray-500 p-4 rounded-xl border border-gray-100 bg-white">
          Orders are managed in Operation Management. Link customer orders from sales orders module.
        </p>
      )}

      {tab === 5 && (
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

      {tab === 6 && (
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
      <TtsplHistoryDrawer ttsplId={ttsplOpen} open={!!ttsplOpen} onClose={() => setTtsplOpen(null)} />
      {newPassword && <PasswordModal password={newPassword} onClose={() => setNewPassword(null)} />}
    </div>
  );
}
