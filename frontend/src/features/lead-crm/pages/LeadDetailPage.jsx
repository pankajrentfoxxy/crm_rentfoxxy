import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  addLeadRemark, addLeadAddress, getLead, getLeadAddresses, getLeadConversion,
} from '../leadCrmApi';
import { STATUS_COLORS } from '../leadConstants';
import { formatConfig, formatCurrency, formatFollowUpDateTime, formatInquiry, relativeTime } from '../leadCrmUtils';
import ActivityFeed from '../components/ActivityFeed';
import FollowUpWidget from '../components/FollowUpWidget';
import LeadStatusModal from '../components/LeadStatusModal';
import LeadConvertModal from '../components/LeadConvertModal';
import LeadFormDrawer from '../components/LeadFormDrawer';
import { listQuotations } from '../../sales-pipeline/salesPipelineApi';
import { formatDate, QUOTE_STATUS_STYLES, typeLabel, TYPE_STYLES } from '../../sales-pipeline/salesPipelineUtils';

const TABS = ['Activity & Remarks', 'Lead Profile', 'Follow-ups', 'Quotations', 'Addresses'];

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [lead, setLead] = useState(null);
  const [conversion, setConversion] = useState(null);
  const [tab, setTab] = useState(0);
  const [remark, setRemark] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [leadQuotations, setLeadQuotations] = useState([]);
  const [quotationsLoading, setQuotationsLoading] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [addrForm, setAddrForm] = useState({ address: '', pincode: '', address_type: 'Shipping', concern_person: '', mobile_no: '' });

  const load = useCallback(async () => {
    try {
      const [leadRes, convRes] = await Promise.all([getLead(id), getLeadConversion(id)]);
      setLead(leadRes.data?.lead || leadRes.data);
      setConversion(convRes.data);
      const addrRes = await getLeadAddresses(id);
      setAddresses(addrRes.data?.addresses || []);
    } catch {
      toast.error('Failed to load lead');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof location.state?.focusTab === 'number') {
      setTab(location.state.focusTab);
    }
  }, [location.state?.focusTab]);

  useEffect(() => {
    if (tab !== 3 || !lead?.leadId) return;
    setQuotationsLoading(true);
    listQuotations({ source_lead_id: lead.leadId, limit: 50 })
      .then((res) => setLeadQuotations(res.data?.quotations || []))
      .catch(() => toast.error('Failed to load quotations'))
      .finally(() => setQuotationsLoading(false));
  }, [tab, lead?.leadId]);

  const navigateToQuotation = () => {
    const customerId = conversion?.customer_id || lead.customerId || null;
    if (!customerId) {
      toast('Note: Convert this lead to a customer first for full quotation details.', {
        icon: 'ℹ️',
        duration: 4000,
      });
    }
    navigate('/sales-pipeline/quotations', {
      state: {
        openForm: true,
        prefill: {
          customer_id: customerId,
          customer_name: lead.companyName || lead.name,
          lead_id: lead.leadId,
          lead_name: lead.name,
          email: lead.email,
          quotation_type: lead.inquiryType === 'sales' ? 'sale' : 'rental',
          line_items: lead.processor ? [{
            brand: lead.brand || '',
            processor: lead.processor || '',
            generation: lead.generation || '',
            ram: lead.ram || '',
            storage: lead.storage || '',
            quantity: lead.quantityRequired || 1,
            rate: lead.monthlyBudget || 0,
          }] : [],
        },
      },
    });
  };

  if (!lead) {
    return <div className="p-6 text-center text-gray-400">Loading...</div>;
  }

  const statusStyle = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;
  const canConvert = ['Deal', 'Demo'].includes(lead.status);

  const postRemark = async () => {
    if (!remark.trim()) return;
    await addLeadRemark(id, { note: remark });
    setRemark('');
    toast.success('Remark added');
    load();
  };

  const addAddress = async () => {
    await addLeadAddress(id, addrForm);
    toast.success('Address added');
    setAddrForm({ address: '', pincode: '', address_type: 'Shipping', concern_person: '', mobile_no: '' });
    load();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(location.state?.fromFollowUps ? '/lead-crm/follow-ups' : '/lead-crm/leads')}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {location.state?.fromFollowUps ? 'Back to Follow-ups' : 'Back to Leads'}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-2">
            {TABS.map((t, i) => (
              <button key={t} type="button" onClick={() => setTab(i)}
                className={`px-3 py-1.5 text-sm rounded-lg ${tab === i ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t}
              </button>
            ))}
          </div>

          {tab === 0 && (
            <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
              <div className="flex gap-2 mb-4">
                <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Add remark..."
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <button type="button" onClick={postRemark}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg">Post</button>
              </div>
              <ActivityFeed activities={lead.activities || []} remarks={lead.remarks || []} assignments={lead.assignments || []} />
            </div>
          )}

          {tab === 1 && (
            <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-4 text-sm">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Lead Profile</h3>
                <button type="button" onClick={() => setEditOpen(true)} className="text-blue-600 text-sm">Edit all</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">Company</span><p>{lead.companyName || '—'}</p></div>
                <div><span className="text-gray-500">Contact</span><p>{lead.name}</p></div>
                <div><span className="text-gray-500">Phone</span><p>{lead.phone}</p></div>
                <div><span className="text-gray-500">Inquiry</span><p>{formatInquiry(lead.inquiryType)}</p></div>
                <div><span className="text-gray-500">Config</span><p>{formatConfig(lead)}</p></div>
                <div><span className="text-gray-500">Qty / Budget</span>
                  <p>{lead.quantityRequired || '—'} · {formatCurrency(lead.monthlyBudget)}/mo</p></div>
                <div className="col-span-2"><span className="text-gray-500">Billing</span><p>{lead.billingAddress || '—'}</p></div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <FollowUpWidget leadId={lead.leadId} initialDate={lead.followUpDate} initialTime={lead.followUpTime} onSaved={load} />
          )}

          {tab === 3 && (
            <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
              <div className="flex justify-between mb-4">
                <h3 className="font-semibold text-sm">Quotations</h3>
                <button type="button" onClick={navigateToQuotation}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg">
                  <Send className="w-4 h-4" /> Send Quotation
                </button>
              </div>
              {quotationsLoading ? (
                <p className="text-gray-400 text-sm">Loading quotations…</p>
              ) : leadQuotations.length === 0 ? (
                <p className="text-gray-400 text-sm">No quotations yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase border-b">
                      <tr>
                        <th className="text-left py-2 pr-3">Quote #</th>
                        <th className="text-left py-2 pr-3">Date</th>
                        <th className="text-left py-2 pr-3">Customer</th>
                        <th className="text-left py-2 pr-3">Type</th>
                        <th className="text-left py-2 pr-3">Status</th>
                        <th className="text-left py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {leadQuotations.map((q) => (
                        <tr key={q.quotation_number}>
                          <td className="py-2 pr-3 font-mono text-blue-700">{q.quotation_number}</td>
                          <td className="py-2 pr-3">{formatDate(q.created_at || q.updated_at)}</td>
                          <td className="py-2 pr-3">{q.customer_name || '—'}</td>
                          <td className="py-2 pr-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[q.quotation_type] || 'bg-gray-100'}`}>
                              {typeLabel(q.quotation_type)}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[q.status] || 'bg-gray-100'}`}>
                              {q.status}
                            </span>
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/sales-pipeline/quotations/${q.quotation_number}`)}
                              className="text-blue-600 text-xs hover:underline"
                            >
                              View in Sales Pipeline
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 4 && (
            <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-3">
              {addresses.map((a) => (
                <div key={a.address_id} className="p-3 bg-gray-50 rounded-lg text-sm">
                  <p className="font-medium">{a.address_type}</p>
                  <p>{a.address}</p>
                  <p className="text-gray-500 text-xs">{a.concern_person} · {a.mobile_no}</p>
                </div>
              ))}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t">
                <input placeholder="Address" value={addrForm.address} onChange={(e) => setAddrForm((f) => ({ ...f, address: e.target.value }))}
                  className="border rounded-lg px-3 py-2 text-sm sm:col-span-2" />
                <input placeholder="Pincode" value={addrForm.pincode} onChange={(e) => setAddrForm((f) => ({ ...f, pincode: e.target.value }))}
                  className="border rounded-lg px-3 py-2 text-sm" />
                <select value={addrForm.address_type} onChange={(e) => setAddrForm((f) => ({ ...f, address_type: e.target.value }))}
                  className="border rounded-lg px-3 py-2 text-sm">
                  <option>Billing</option><option>Shipping</option>
                </select>
                <button type="button" onClick={addAddress} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg sm:col-span-2">Add Address</button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="sticky top-4 rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-4">
            <div className="text-center">
              <span className={`inline-block px-4 py-2 rounded-full text-lg font-bold ${statusStyle.bg} ${statusStyle.text}`}>
                {lead.status}
              </span>
              {lead.leadStage && <p className="text-sm text-gray-500 mt-2">{lead.leadStage}</p>}
            </div>
            <div className="space-y-2">
              <button type="button" onClick={() => setStatusOpen(true)}
                className="w-full py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Change Status</button>
              <button type="button" onClick={() => setTab(2)}
                className="w-full py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                {lead.followUpDate ? 'Update Follow-up' : 'Set Follow-up'}
              </button>
              <button type="button" onClick={navigateToQuotation}
                className="w-full py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Send Quotation</button>
              {canConvert && (
                <button type="button" onClick={() => setConvertOpen(true)}
                  className="w-full py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Convert to Customer
                </button>
              )}
            </div>
            <div className="text-sm space-y-2 border-t pt-3">
              <p><span className="text-gray-500">Lead ID:</span> #{lead.leadId}</p>
              <p><span className="text-gray-500">Created:</span> {new Date(lead.createdAt).toLocaleDateString('en-IN')}</p>
              <p><span className="text-gray-500">Last Activity:</span> {relativeTime(lead.lastActivityAt || lead.updatedAt)}</p>
              <p><span className="text-gray-500">Assigned:</span> {lead.assignedUser?.name || 'Unassigned'}</p>
              <p><span className="text-gray-500">Source:</span> {lead.source || '—'}</p>
              <p><span className="text-gray-500">Follow-up:</span> {formatFollowUpDateTime(lead.followUpDate, lead.followUpTime)}</p>
            </div>
            {conversion?.converted && (
              <div className="p-3 rounded-lg bg-green-50 text-sm border border-green-100">
                <p className="font-medium text-green-800">✅ Converted to Customer</p>
                <Link to={`/lead-crm/customers/${conversion.customer_id}`} className="text-blue-600 hover:underline">
                  {conversion.customer_name}
                </Link>
                <p className="text-xs text-gray-500 mt-1">{conversion.converted_at && new Date(conversion.converted_at).toLocaleDateString('en-IN')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <LeadStatusModal open={statusOpen} lead={lead} onClose={() => setStatusOpen(false)} onSaved={load} />
      <LeadConvertModal open={convertOpen} lead={lead} onClose={() => setConvertOpen(false)} />
      <LeadFormDrawer open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSaved={load} />
    </div>
  );
}
