import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button } from '../../../components/ui/primitives';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import {
  getCustomer, getCustomerLaptops, updateCustomer, verifyCustomerKyc, enableCustomerPortal,
} from '../leadCrmApi';
import { formatCurrency } from '../leadCrmUtils';
import { getBackendOrigin } from '../../../utils/api';
import CustomerDocuments from '../components/CustomerDocuments';
import CustomerFormDrawer from '../components/CustomerFormDrawer';

const TABS = ['Profile', 'Documents', 'Assets', 'Orders', 'Lead Origin', 'Portal Access'];

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

function PodLinks({ files, keyPrefix }) {
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
  const [laptops, setLaptops] = useState([]);
  const [returnedLaptops, setReturnedLaptops] = useState([]);
  const [assetView, setAssetView] = useState('active');
  const [tab, setTab] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [ttsplOpen, setTtsplOpen] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [newPassword, setNewPassword] = useState(null);

  const load = React.useCallback(async () => {
    try {
      const res = await getCustomer(id);
      setCustomer(res.data?.customer);
      const lapRes = await getCustomerLaptops(id);
      setLaptops(lapRes.data?.active || lapRes.data?.laptops || []);
      setReturnedLaptops(lapRes.data?.returned || []);
    } catch {
      toast.error('Failed to load customer');
    }
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

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

      {tab === 0 && (
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

      {tab === 1 && <CustomerDocuments customerId={customer.customer_id} />}

      {tab === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <button
              type="button"
              onClick={() => setAssetView('active')}
              className={`rounded-xl border p-4 text-left transition-colors ${
                assetView === 'active' ? 'border-green-500 bg-green-50' : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-500">Active (on rent)</p>
              <p className="text-2xl font-bold text-green-700">{laptops.length}</p>
            </button>
            <button
              type="button"
              onClick={() => setAssetView('returned')}
              className={`rounded-xl border p-4 text-left transition-colors ${
                assetView === 'returned' ? 'border-amber-500 bg-amber-50' : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-500">Returned</p>
              <p className="text-2xl font-bold text-amber-700">{returnedLaptops.length}</p>
            </button>
          </div>

          {/* Mobile asset cards */}
          <div className="grid gap-3 md:hidden">
            {assetView === 'active' ? (
              laptops.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">No assets currently with this customer</p>
              ) : laptops.map((lap) => (
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
                  <div className="pt-2 border-t border-slate-100"><PodLinks files={lap.pod_files} keyPrefix={lap.serial_id || lap.ttspl_id} /></div>
                </div>
              ))
            ) : (
              returnedLaptops.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">No returned laptops for this customer</p>
              ) : returnedLaptops.map((lap, i) => (
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
                    ? ['TTSPL ID', 'Serial No', 'Model', 'Config', 'Entity', 'DC Number', 'Delivered Date', 'Monthly Rate', 'POD', 'Status']
                    : ['TTSPL ID', 'Serial No', 'Model', 'Config', 'Return DC', 'Returned Date', 'Type', 'POD', 'Status']
                  ).map((h) => <th key={h} className="p-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {assetView === 'active' ? (
                  laptops.length === 0 ? (
                    <tr><td colSpan={10} className="p-6 text-center text-gray-400">No assets currently with this customer</td></tr>
                  ) : laptops.map((lap) => (
                    <tr key={lap.serial_id || lap.ttspl_id} className="border-t border-gray-100">
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
                      <td className="p-3 text-xs"><PodLinks files={lap.pod_files} keyPrefix={lap.serial_id || lap.ttspl_id} /></td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">{lap.status || 'rented'}</span></td>
                    </tr>
                  ))
                ) : (
                  returnedLaptops.length === 0 ? (
                    <tr><td colSpan={9} className="p-6 text-center text-gray-400">No returned laptops for this customer</td></tr>
                  ) : returnedLaptops.map((lap, i) => (
                    <tr key={lap.dc_number ? `${lap.dc_number}-${i}` : `ret-${i}`} className="border-t border-gray-100">
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
        </div>
      )}

      {tab === 3 && (
        <p className="text-sm text-gray-500 p-4 rounded-xl border border-gray-100 bg-white">
          Orders are managed in Operation Management. Link customer orders from sales orders module.
        </p>
      )}

      {tab === 4 && (
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

      {tab === 5 && (
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
      <TtsplHistoryDrawer ttsplId={ttsplOpen} open={!!ttsplOpen} onClose={() => setTtsplOpen(null)} />
      {newPassword && <PasswordModal password={newPassword} onClose={() => setNewPassword(null)} />}
    </div>
  );
}
