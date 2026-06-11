import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import {
  getCustomer, getCustomerLaptops, updateCustomer, verifyCustomerKyc,
} from '../leadCrmApi';
import { formatCurrency } from '../leadCrmUtils';
import CustomerDocuments from '../components/CustomerDocuments';
import CustomerFormDrawer from '../components/CustomerFormDrawer';

const TABS = ['Profile', 'Documents', 'Laptops', 'Orders', 'Lead Origin', 'Portal Access'];

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [laptops, setLaptops] = useState([]);
  const [tab, setTab] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [ttsplOpen, setTtsplOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getCustomer(id);
      setCustomer(res.data?.customer);
      const lapRes = await getCustomerLaptops(id);
      setLaptops(lapRes.data?.laptops || []);
    } catch {
      toast.error('Failed to load customer');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!customer) return <div className="p-6 text-center text-gray-400">Loading...</div>;

  const togglePortal = async () => {
    await updateCustomer(id, { portal_enabled: !customer.portal_enabled });
    toast.success('Portal access updated');
    load();
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
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditOpen(true)} className="px-3 py-1.5 text-sm border rounded-lg">Edit</button>
          <PermissionGate section="customer_documents" action="edit">
            {!customer.kyc_verified && (
              <button type="button" onClick={handleVerifyKyc}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg">Verify KYC</button>
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
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 text-left">
              <tr>
                {['TTSPL ID', 'Model', 'Config', 'Dispatch', 'Status'].map((h) => <th key={h} className="p-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {laptops.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-gray-400">No laptops on record</td></tr>
              ) : laptops.map((lap) => (
                <tr key={lap.id || lap.ttspl_id} className="border-t border-gray-100">
                  <td className="p-3">
                    <button type="button" onClick={() => setTtsplOpen(lap.ttspl_id || lap.serial_number)}
                      className="text-blue-600 hover:underline font-mono text-xs">
                      {lap.ttspl_id || lap.serial_number}
                    </button>
                  </td>
                  <td className="p-3">{lap.model_name || '—'}</td>
                  <td className="p-3 text-xs">{[lap.processor, lap.ram, lap.storage].filter(Boolean).join(' · ')}</td>
                  <td className="p-3 text-xs">{lap.dispatch_date ? new Date(lap.dispatch_date).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="p-3">{lap.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={!!customer.portal_enabled} onChange={togglePortal} />
              Portal enabled
            </label>
          </PermissionGate>
          <p className="text-xs text-gray-500">
            {customer.portal_enabled ? 'Customer can access the vendor portal.' : 'Portal access is disabled.'}
          </p>
        </div>
      )}

      <CustomerFormDrawer open={editOpen} customer={customer} onClose={() => setEditOpen(false)} onSaved={load} />
      <TtsplHistoryDrawer ttsplId={ttsplOpen} open={!!ttsplOpen} onClose={() => setTtsplOpen(null)} />
    </div>
  );
}
