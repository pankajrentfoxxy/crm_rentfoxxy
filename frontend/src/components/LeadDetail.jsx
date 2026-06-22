import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Calendar, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, MessageSquarePlus, X, Trash2, ArrowLeft, Pencil, Save, Send, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
    STATUSES_WITHOUT_STAGE_CHOICE,
    stagesForStatus
} from '../constants/leadStages';

const STATUS_OPTIONS = ['Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected', 'Call Back', 'Demo', 'Deal'];
const toDateTimeLocalValue = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const INITIAL_RESEARCH_FORM = {
    industry: '',
    pincode: '',
    cin: '',
    entity_type: '',
    roc: '',
    revenue: '',
    employees: '',
    gst: '',
    address: '',
    city: '',
    state: '',
    departments: '',
    website: '',
    linkedin_url: '',
    facebook_url: '',
    twitter_url: '',
    technologies: '',
    annual_revenue: '',
    total_funding: '',
    latest_funding: '',
    latest_funding_amount: '',
    subsidiary_of: '',
    summary: ''
};

const mapResearchToForm = (research) => {
    const raw = (research && typeof research.rawResponse === 'object' && research.rawResponse) ? research.rawResponse : {};
    return {
        cin: research?.cin || raw.cin || '',
        industry: raw.industry || research?.industry || '',
        pincode: raw.pincode || research?.pincode || '',
        entity_type: research?.entityType || raw.entity_type || raw.entityType || '',
        roc: research?.roc || raw.roc || '',
        revenue: research?.revenue || raw.revenue || '',
        employees: research?.employees || raw.employees || '',
        gst: research?.gst || raw.gst || '',
        address: research?.address || raw.address || '',
        city: research?.city || raw.city || '',
        state: research?.state || raw.state || '',
        departments: Array.isArray(raw.departments) ? raw.departments.join(', ') : (raw.departments || ''),
        website: raw.website || '',
        linkedin_url: raw.linkedin_url || '',
        facebook_url: raw.facebook_url || '',
        twitter_url: raw.twitter_url || '',
        technologies: Array.isArray(raw.technologies) ? raw.technologies.join(', ') : (raw.technologies || ''),
        annual_revenue: raw.annual_revenue || '',
        total_funding: raw.total_funding || '',
        latest_funding: raw.latest_funding || '',
        latest_funding_amount: raw.latest_funding_amount || '',
        subsidiary_of: raw.subsidiary_of || '',
        summary: raw.summary || ''
    };
};

export default function LeadDetail({ api }) {
    const { user } = useAuth();
    const { id } = useParams();
    const [searchParams] = useSearchParams();
    const fromPage = searchParams.get('fromPage');
    const [lead, setLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('Cold');
    const [leadStageSelect, setLeadStageSelect] = useState('');
    const [config, setConfig] = useState({ brand: '', processor: '', generation: '', ram: '', storage: '' });
    const [specs, setSpecs] = useState({ brands: [], processors: [], generations: [], rams: [], storages: [] });
    const [followUpDate, setFollowUpDate] = useState('');
    const [researchForm, setResearchForm] = useState(INITIAL_RESEARCH_FORM);
    const [editingResearch, setEditingResearch] = useState(false);
    const [savingResearch, setSavingResearch] = useState(false);
    const [editingBasic, setEditingBasic] = useState(false);
    const [savingBasic, setSavingBasic] = useState(false);
    const [basicForm, setBasicForm] = useState({
        name: '',
        company_name: '',
        company_brand: '',
        email: '',
        phone: '',
        city: '',
        personal_remarks: ''
    });
    const [addressForm, setAddressForm] = useState({ concern_person: '', mobile_no: '', address: '', pincode: '', address_type: 'Shipping' });
    const [savingAddress, setSavingAddress] = useState(false);
    const [remarksOpen, setRemarksOpen] = useState(false);
    const [remarkText, setRemarkText] = useState('');
    const [editingPersonalRemarks, setEditingPersonalRemarks] = useState(false);
    const [savingPersonalRemarks, setSavingPersonalRemarks] = useState(false);
    const [savingRemark, setSavingRemark] = useState(false);
    const [deletingRemarkId, setDeletingRemarkId] = useState(null);
    const [expandedSections, setExpandedSections] = useState({ status: true, followup: true, addresses: false, personalRemarks: true, remarks: true });
    const navigate = useNavigate();

    const [quotationOpen, setQuotationOpen] = useState(false);
    const [quotationSending, setQuotationSending] = useState(false);
    const [quotation, setQuotation] = useState({
        to_email: '',
        bill_company: '',
        bill_phone: '',
        bill_email: '',
        bill_gstin: '',
        bill_address: '',
        ship_same: true,
        ship_company: '',
        ship_phone: '',
        ship_email: '',
        ship_gstin: '',
        ship_address: '',
        quantity: '1',
        monthly_rate: '',
        lockin_months: '6',
        security_months: '1',
        place_of_supply: 'Haryana (06)',
        hsn_sac: '363684',
        c2_processor: '',
        c2_ram: '',
        c2_storage: '',
        c2_monthly_rate: '',
        c1_brand: '',
        c1_processor: '',
        c1_generation: '',
        c1_ram: '',
        c1_storage: '',
        cc_emails: ''
    });

    const formatQuotationWhen = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    };

    const toggleSection = (key) => {
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/leads/${id}`);
            setLead(data.lead);
            setStatus(data.lead.status);
            const st = data.lead.status;
            const opts = stagesForStatus(st);
            setLeadStageSelect(
                data.lead.leadStage ||
                    (STATUSES_WITHOUT_STAGE_CHOICE.includes(st) ? st : opts[0] || '')
            );
            setFollowUpDate(toDateTimeLocalValue(data.lead.followUpDate));
            setConfig({
                brand: data.lead.brand || '',
                processor: data.lead.processor || '',
                generation: data.lead.generation || '',
                ram: data.lead.ram || '',
                storage: data.lead.storage || ''
            });
            setResearchForm(mapResearchToForm(data.lead.research));
            setBasicForm({
                name: data.lead.name || '',
                company_name: data.lead.companyName || '',
                company_brand: data.lead.companyBrand ?? data.lead.company_brand ?? '',
                email: data.lead.email || '',
                phone: data.lead.phone || '',
                city: data.lead.city || '',
                personal_remarks: data.lead.personalRemarks ?? data.lead.personal_remarks ?? ''
            });
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [api, id]);

    useEffect(() => {
        loadLead();
    }, [loadLead]);

    useEffect(() => {
        api.get('/inventory/catalog/options').then(({ data }) => {
            setSpecs(data.options || { brands: [], processors: [], generations: [], rams: [], storages: [] });
        }).catch(() => {});
    }, [api]);

    const handleStatusUpdate = async () => {
        let leadStagePayload = null;
        if (STATUSES_WITHOUT_STAGE_CHOICE.includes(status)) {
            leadStagePayload = status;
        } else if (stagesForStatus(status).length > 0) {
            if (!leadStageSelect) {
                alert('Please select a lead stage');
                return;
            }
            leadStagePayload = leadStageSelect;
        }

        try {
            await api.put(`/leads/${id}/status`, {
                status,
                lead_stage: leadStagePayload,
                brand: config.brand || undefined,
                processor: config.processor || undefined,
                generation: config.generation || undefined,
                ram: config.ram || undefined,
                storage: config.storage || undefined
            });
            loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to update status');
        }
    };

    const handleFollowUp = async () => {
        try {
            await api.put(`/leads/${id}/follow-up`, {
                follow_up_date: followUpDate ? new Date(followUpDate).toISOString() : null
            });
            loadLead();
        } catch (err) {
            alert('Failed to update follow-up');
        }
    };

    const formatLeadAddressLine = (row) => {
        if (!row) return '';
        const base = (row.address || '').trim();
        const pc = row.pincode ? String(row.pincode).trim() : '';
        return [base, pc].filter(Boolean).join(', ');
    };

    const openQuotationModal = async () => {
        if (!lead) return;
        const research = lead.research || {};
        const gst = research.gst || research.GST || '';
        const addrs = lead.addresses || [];
        const billing = addrs.find((a) => String(a.address_type || '').toLowerCase() === 'billing');
        const shipping = addrs.find((a) => String(a.address_type || '').toLowerCase() === 'shipping');
        const first = addrs[0];
        const pref = billing || shipping || first;
        const addrLine = pref ? formatLeadAddressLine(pref) : '';

        let ccEmails = '';
        let fromAddress = '';
        try {
            const { data } = await api.get('/leads/quotation-email-config');
            ccEmails = (data.cc_recipients || []).join(', ');
            fromAddress = data.from_address || '';
        } catch {
            const fallback = ['pankaj@rentfoxxy.com', 'shivam@rentfoxxy.com', 'pradeep@rentfoxxy.com'];
            ccEmails = [...fallback, user?.email].filter(Boolean).join(', ');
        }

        setQuotation({
            to_email: lead.email || '',
            bill_company: lead.companyName || lead.name || '',
            bill_phone: lead.phone || pref?.mobile_no || '',
            bill_email: lead.email || '',
            bill_gstin: gst,
            bill_address: addrLine,
            ship_same: addrs.length <= 1,
            ship_company: lead.companyName || lead.name || '',
            ship_phone: lead.phone || pref?.mobile_no || '',
            ship_email: lead.email || '',
            ship_gstin: gst,
            ship_address: shipping ? formatLeadAddressLine(shipping) : addrLine,
            quantity: '1',
            monthly_rate: '',
            lockin_months: '6',
            security_months: '1',
            place_of_supply: 'Haryana (06)',
            hsn_sac: '363684',
            c2_processor: '',
            c2_ram: '',
            c2_storage: '',
            c2_monthly_rate: '',
            c1_brand: lead.brand || config.brand || '',
            c1_processor: lead.processor || config.processor || '',
            c1_generation: lead.generation || config.generation || '',
            c1_ram: lead.ram || config.ram || '',
            c1_storage: lead.storage || config.storage || '',
            cc_emails: ccEmails,
            mail_from: fromAddress,
        });
        setQuotationOpen(true);
    };

    const applySavedAddress = (which, row) => {
        const line = formatLeadAddressLine(row);
        const phone = row?.mobile_no || lead?.phone || '';
        if (which === 'bill') {
            setQuotation((q) => ({
                ...q,
                bill_address: line,
                bill_phone: q.bill_phone || phone
            }));
        } else {
            setQuotation((q) => ({
                ...q,
                ship_address: line,
                ship_phone: q.ship_phone || phone
            }));
        }
    };

    const handleSendQuotation = async () => {
        if (!lead) return;
        const to = (quotation.to_email || '').trim();
        if (!to) {
            alert('Customer email (To) is required');
            return;
        }
        if (!quotation.bill_address.trim()) {
            alert('Bill To address is required. Add an address under Addresses or type it in the quotation form.');
            return;
        }
        if (!quotation.ship_same && !quotation.ship_address.trim()) {
            alert('Ship To address is required, or check “Same as Bill To”.');
            return;
        }
        const rate = parseFloat(quotation.monthly_rate);
        if (!Number.isFinite(rate) || rate <= 0) {
            alert('Enter a valid monthly rental rate (per laptop).');
            return;
        }

        setQuotationSending(true);
        try {
            await api.post(`/leads/${id}/send-quotation`, {
                to_email: to,
                bill_to: {
                    company_name: quotation.bill_company,
                    phone: quotation.bill_phone,
                    email: quotation.bill_email,
                    gstin: quotation.bill_gstin,
                    address: quotation.bill_address
                },
                ship_same_as_bill: quotation.ship_same,
                ship_to: quotation.ship_same
                    ? undefined
                    : {
                          company_name: quotation.ship_company || quotation.bill_company,
                          phone: quotation.ship_phone,
                          email: quotation.ship_email,
                          gstin: quotation.ship_gstin,
                          address: quotation.ship_address
                      },
                quantity: parseInt(quotation.quantity, 10) || 1,
                monthly_rate: rate,
                lockin_months: parseInt(quotation.lockin_months, 10) || 6,
                security_months: parseInt(quotation.security_months, 10) || 1,
                place_of_supply: quotation.place_of_supply,
                hsn_sac: quotation.hsn_sac || '363684',
                config_one: {
                    brand: quotation.c1_brand,
                    processor: quotation.c1_processor,
                    generation: quotation.c1_generation,
                    ram: quotation.c1_ram,
                    storage: quotation.c1_storage
                },
                config_two: {
                    processor: quotation.c2_processor?.trim() || undefined,
                    ram: quotation.c2_ram?.trim() || undefined,
                    storage: quotation.c2_storage?.trim() || undefined,
                    monthly_rate: quotation.c2_monthly_rate ? parseFloat(quotation.c2_monthly_rate) : undefined
                },
                cc_emails: quotation.cc_emails?.trim() || undefined,
                cc_recipients: quotation.cc_emails
                    ? quotation.cc_emails.split(/[,;]/).map((e) => e.trim()).filter(Boolean)
                    : undefined,
            });
            alert('Quotation sent. PDF attached; CC includes team, you, and any extra addresses entered.');
            setQuotationOpen(false);
            loadLead();
        } catch (err) {
            alert(err.response?.data?.message || err.message || 'Failed to send quotation');
        } finally {
            setQuotationSending(false);
        }
    };

    const handleResearch = async () => {
        try {
            await api.post(`/leads/${id}/research`);
            loadLead();
        } catch (err) {
            alert('Failed to run research');
        }
    };

    const handleResearchField = (key, value) => {
        setResearchForm(prev => ({ ...prev, [key]: value }));
    };

    const handleSaveResearch = async () => {
        setSavingResearch(true);
        try {
            await api.put(`/leads/${id}/research`, {
                ...researchForm,
                departments: researchForm.departments
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                technologies: researchForm.technologies
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean)
            });
            setEditingResearch(false);
            loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to save company research');
        } finally {
            setSavingResearch(false);
        }
    };

    const handleGoToSales = () => {
        navigate(`/sales?leadId=${id}`);
    };

    const handleSavePersonalRemarks = async () => {
        setSavingPersonalRemarks(true);
        try {
            const payload = { personal_remarks: basicForm.personal_remarks ?? '' };
            const { data } = await api.put(`/leads/${id}/basic`, payload);
            setEditingPersonalRemarks(false);
            if (data?.lead) {
                const pr = data.lead.personalRemarks ?? data.lead.personal_remarks ?? '';
                setLead(prev => ({ ...prev, personalRemarks: pr, personal_remarks: pr }));
                setBasicForm(prev => ({ ...prev, personal_remarks: pr }));
            }
            await loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to update personal remarks');
        } finally {
            setSavingPersonalRemarks(false);
        }
    };

    const handleSaveBasic = async () => {
        setSavingBasic(true);
        try {
            const payload = {
                name: basicForm.name,
                company_name: basicForm.company_name,
                company_brand: basicForm.company_brand,
                email: basicForm.email,
                phone: basicForm.phone,
                city: basicForm.city,
                personal_remarks: basicForm.personal_remarks ?? ''
            };
            const { data } = await api.put(`/leads/${id}/basic`, payload);
            setEditingBasic(false);
            if (data?.lead) {
                const pr = data.lead.personalRemarks ?? data.lead.personal_remarks ?? basicForm.personal_remarks ?? '';
                setLead(prev => ({ ...prev, personalRemarks: pr, personal_remarks: pr }));
                setBasicForm(prev => ({ ...prev, personal_remarks: pr }));
            }
            await loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to update lead details');
        } finally {
            setSavingBasic(false);
        }
    };

    const handleAddAddress = async () => {
        if (!addressForm.address.trim()) {
            alert('Address is required');
            return;
        }
        setSavingAddress(true);
        try {
            await api.post(`/leads/${id}/addresses`, addressForm);
            setAddressForm({ concern_person: '', mobile_no: '', address: '', pincode: '', address_type: 'Shipping' });
            loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to add address');
        } finally {
            setSavingAddress(false);
        }
    };

    const handleDeleteAddress = async (addressId) => {
        const confirmDelete = window.confirm('Delete this address?');
        if (!confirmDelete) return;
        try {
            await api.delete(`/leads/${id}/addresses/${addressId}`);
            loadLead();
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete address');
        }
    };

    const handleAddRemark = async () => {
        if (!remarkText.trim()) return;
        setSavingRemark(true);
        try {
            const { data } = await api.post(`/leads/${id}/remarks`, { note: remarkText.trim() });
            setLead(prev => ({ ...prev, remarks: [data.remark, ...(prev.remarks || [])] }));
            setRemarkText('');
            setRemarksOpen(false);
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to add remark');
        } finally {
            setSavingRemark(false);
        }
    };

    const handleDeleteRemark = async (remarkId) => {
        setDeletingRemarkId(remarkId);
        try {
            await api.delete(`/leads/${id}/remarks/${remarkId}`);
            setLead(prev => ({ ...prev, remarks: (prev.remarks || []).filter(r => r.remarkId !== remarkId) }));
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to delete remark');
        } finally {
            setDeletingRemarkId(null);
        }
    };

    if (loading) return <div className="text-center py-12">Loading lead...</div>;
    if (!lead) return <div className="text-center py-12">Lead not found</div>;

    const backToLeadsUrl = fromPage && parseInt(fromPage, 10) > 1 ? `/leads?page=${fromPage}` : '/leads';

    return (
        <div className="space-y-6">
            <div className="mb-4">
                <button
                    onClick={() => navigate(backToLeadsUrl)}
                    className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium text-sm"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {fromPage && parseInt(fromPage, 10) > 1 ? `Back to Leads (page ${fromPage})` : 'Back to Leads'}
                </button>
            </div>
            <div className="bg-white border rounded-xl p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold">{lead.name}</h2>
                        <p className="text-gray-600">{lead.companyName || 'No company name'}</p>
                    </div>
                    <div className="flex gap-2">
                        {['admin', 'manager', 'sales'].includes(user?.role) && (
                            <button
                                onClick={() => setEditingBasic(prev => !prev)}
                                className="flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg"
                            >
                                {editingBasic ? 'Cancel Edit' : 'Edit Lead'}
                            </button>
                        )}
                        <button onClick={loadLead} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
                            <RefreshCw className="w-4 h-4" />
                            Refresh
                        </button>
                    </div>
                </div>
                {['admin', 'manager', 'sales'].includes(user?.role) && editingBasic && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                        <div>
                            <label className="text-xs text-gray-500">Name</label>
                            <input
                                value={basicForm.name}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Company Name</label>
                            <input
                                value={basicForm.company_name}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, company_name: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Company Brand</label>
                            <input
                                value={basicForm.company_brand}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, company_brand: e.target.value }))}
                                placeholder="Lead company brand name (e.g. Tata, Infosys)"
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Email</label>
                            <input
                                value={basicForm.email}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, email: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">Phone</label>
                            <input
                                value={basicForm.phone}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, phone: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500">City</label>
                            <input
                                value={basicForm.city}
                                onChange={(e) => setBasicForm(prev => ({ ...prev, city: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <button
                                onClick={handleSaveBasic}
                                disabled={savingBasic}
                                className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
                            >
                                {savingBasic ? 'Saving...' : 'Save Lead Details'}
                            </button>
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
                    <div>
                        <div className="text-gray-500">Lead stage</div>
                        <div className="font-semibold">{lead.leadStage || '—'}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">Company Brand</div>
                        <div className="font-semibold">{lead.companyBrand ?? lead.company_brand ?? '-'}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">Email</div>
                        <div className="font-semibold">{lead.email || '-'}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">Phone</div>
                        <div className="font-semibold">{lead.phone || '-'}</div>
                    </div>
                    <div>
                        <div className="text-gray-500">Assigned To</div>
                        <div className="font-semibold">{lead.assignedUser?.name || '-'}</div>
                    </div>
                </div>
                {lead.isDuplicate && (
                    <div className="mt-3 text-sm text-amber-700 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Marked as duplicate lead.
                    </div>
                )}
            </div>

            {/* Collapsible: Status Update, Follow-up, Addresses */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border rounded-xl overflow-hidden">
                    <button
                        onClick={() => toggleSection('status')}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                        <span className="font-semibold">Status Update</span>
                        {expandedSections.status ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    </button>
                    {expandedSections.status && (
                        <div className="px-4 pb-4 space-y-3 border-t">
                            <select
                                value={status}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setStatus(v);
                                    if (STATUSES_WITHOUT_STAGE_CHOICE.includes(v)) setLeadStageSelect(v);
                                    else {
                                        const o = stagesForStatus(v);
                                        setLeadStageSelect(o[0] || '');
                                    }
                                }}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                            >
                                {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                            {stagesForStatus(status).length > 0 && !STATUSES_WITHOUT_STAGE_CHOICE.includes(status) && (
                                <div>
                                    <label className="text-xs font-medium text-gray-500">Lead stage (reason)</label>
                                    <select
                                        value={leadStageSelect}
                                        onChange={(e) => setLeadStageSelect(e.target.value)}
                                        className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                                    >
                                        {stagesForStatus(status).map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {STATUSES_WITHOUT_STAGE_CHOICE.includes(status) && (
                                <p className="text-xs text-gray-500">Lead stage is set automatically to <strong>{status}</strong>.</p>
                            )}
                            <div className="text-xs font-medium text-gray-500 mb-1">Laptop config (requirement)</div>
                            <div className="grid grid-cols-2 gap-2">
                                <select value={config.brand} onChange={(e) => setConfig(c => ({ ...c, brand: e.target.value }))} className="border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="">Brand</option>
                                    {specs.brands?.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <select value={config.processor} onChange={(e) => setConfig(c => ({ ...c, processor: e.target.value }))} className="border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="">Processor</option>
                                    {specs.processors?.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <select value={config.generation} onChange={(e) => setConfig(c => ({ ...c, generation: e.target.value }))} className="border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="">Generation</option>
                                    {specs.generations?.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                                <select value={config.ram} onChange={(e) => setConfig(c => ({ ...c, ram: e.target.value }))} className="border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="">RAM</option>
                                    {specs.rams?.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <select value={config.storage} onChange={(e) => setConfig(c => ({ ...c, storage: e.target.value }))} className="border rounded-lg px-2 py-1.5 text-sm col-span-2">
                                    <option value="">Storage</option>
                                    {specs.storages?.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <button onClick={handleStatusUpdate} className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm flex items-center justify-center gap-2">
                                <CheckCircle className="w-4 h-4" /> Update Status
                            </button>
                        </div>
                    )}
                </div>

                <div className="bg-white border rounded-xl overflow-hidden">
                    <button
                        onClick={() => toggleSection('followup')}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                        <span className="font-semibold">Follow-up &amp; quotation</span>
                        {expandedSections.followup ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    </button>
                    {expandedSections.followup && (
                        <div className="px-4 pb-4 space-y-4 border-t pt-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/60">
                                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Follow-up</div>
                                    <input
                                        type="datetime-local"
                                        value={followUpDate}
                                        onChange={(e) => setFollowUpDate(e.target.value)}
                                        className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleFollowUp}
                                        className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm flex items-center justify-center gap-2"
                                    >
                                        <Calendar className="w-4 h-4" /> Set Follow-up
                                    </button>
                                </div>
                                <div className="border border-amber-200 rounded-lg p-3 space-y-2 bg-amber-50/50">
                                    <div className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Quotation</div>
                                    <p className="text-[11px] text-gray-600 leading-snug">
                                        Send branded email + proforma PDF from <span className="font-medium">sales@rentfoxxy.com</span> (team CC). Specs below are optional except monthly rent; brand is optional.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={openQuotationModal}
                                        className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-2 text-sm flex items-center justify-center gap-2 font-medium"
                                    >
                                        <Send className="w-4 h-4" /> Send quotation
                                    </button>
                                    {(lead.quotationLastSentAt || lead.quotation_last_sent_at) && (
                                        <div className="text-[11px] space-y-1 pt-1 border-t border-amber-100">
                                            <div className="text-gray-600">
                                                Last sent
                                                {lead.quotationLastEstimateNo || lead.quotation_last_estimate_no
                                                    ? ` · ${lead.quotationLastEstimateNo || lead.quotation_last_estimate_no}`
                                                    : ''}
                                                <span className="block text-gray-500">
                                                    {formatQuotationWhen(lead.quotationLastSentAt || lead.quotation_last_sent_at)}
                                                </span>
                                            </div>
                                            {(lead.quotationAcceptedAt || lead.quotation_accepted_at) ? (
                                                <div>
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 font-semibold">
                                                        <CheckCircle className="w-3 h-3" />
                                                        Quotation accepted
                                                    </span>
                                                    <span className="block text-gray-500">
                                                        {formatQuotationWhen(lead.quotationAcceptedAt || lead.quotation_accepted_at)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-amber-800">Awaiting customer acceptance</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-white border rounded-xl overflow-hidden">
                    <button
                        onClick={() => toggleSection('addresses')}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                        <span className="font-semibold">Addresses</span>
                        <span className="flex items-center gap-1">
                            {(lead.addresses || []).length > 0 && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{(lead.addresses || []).length}</span>}
                            {expandedSections.addresses ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                        </span>
                    </button>
                    {expandedSections.addresses && (
                        <div className="px-4 pb-4 space-y-3 border-t">
                            <div className="grid grid-cols-2 gap-2">
                                <input value={addressForm.concern_person} onChange={(e) => setAddressForm(prev => ({ ...prev, concern_person: e.target.value }))} placeholder="Concern Person" className="border rounded-lg px-3 py-2 text-sm" />
                                <input value={addressForm.mobile_no} onChange={(e) => setAddressForm(prev => ({ ...prev, mobile_no: e.target.value }))} placeholder="Mobile No" className="border rounded-lg px-3 py-2 text-sm" />
                            </div>
                            <textarea value={addressForm.address} onChange={(e) => setAddressForm(prev => ({ ...prev, address: e.target.value }))} placeholder="Address" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
                            <div className="flex gap-2">
                                <input value={addressForm.pincode} onChange={(e) => setAddressForm(prev => ({ ...prev, pincode: e.target.value }))} placeholder="Pincode" className="border rounded-lg px-3 py-2 text-sm flex-1" />
                                <select value={addressForm.address_type} onChange={(e) => setAddressForm(prev => ({ ...prev, address_type: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
                                    <option value="Billing">Billing</option>
                                    <option value="Shipping">Shipping</option>
                                </select>
                                <button onClick={handleAddAddress} disabled={savingAddress} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
                                    {savingAddress ? '...' : 'Add'}
                                </button>
                            </div>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {(lead.addresses || []).map((row) => (
                                    <div key={row.address_id} className="border rounded-lg p-2 text-sm flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{row.concern_person || 'Contact'}</div>
                                            <div className="text-gray-600 text-xs truncate">{row.address}</div>
                                        </div>
                                        <button onClick={() => handleDeleteAddress(row.address_id)} className="text-red-600 text-xs shrink-0">Delete</button>
                                    </div>
                                ))}
                                {(!lead.addresses || lead.addresses.length === 0) && <div className="text-sm text-gray-500">No addresses yet.</div>}
                            </div>
                        </div>
                    )}
                </div>

                {/* Personal Remarks - dedicated section */}
                <div className="bg-white border rounded-xl overflow-hidden">
                    <button
                        onClick={() => toggleSection('personalRemarks')}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                        <span className="font-semibold">Personal Remarks</span>
                        {expandedSections.personalRemarks ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    </button>
                    {expandedSections.personalRemarks && (
                        <div className="px-4 pb-4 border-t">
                            {editingPersonalRemarks ? (
                                <div className="mt-3 space-y-2">
                                    <textarea
                                        value={basicForm.personal_remarks ?? ''}
                                        onChange={(e) => setBasicForm(prev => ({ ...prev, personal_remarks: e.target.value }))}
                                        placeholder="Sales notes about this lead..."
                                        rows={3}
                                        className="w-full border rounded-lg px-3 py-2 text-sm"
                                    />
                                    <div className="flex gap-2">
                                        <button onClick={handleSavePersonalRemarks} disabled={savingPersonalRemarks} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">
                                            <Save className="w-3.5 h-3.5" /> {savingPersonalRemarks ? 'Saving...' : 'Save'}
                                        </button>
                                        <button onClick={() => setEditingPersonalRemarks(false)} disabled={savingPersonalRemarks} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3 flex items-start justify-between gap-2">
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap flex-1">{(lead.personalRemarks ?? lead.personal_remarks ?? '').trim() || '-'}</div>
                                    <button onClick={() => setEditingPersonalRemarks(true)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit personal remarks"><Pencil className="w-4 h-4" /></button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Remarks section - always visible list */}
            <div className="bg-white border rounded-xl overflow-hidden">
                <button
                    onClick={() => toggleSection('remarks')}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                >
                    <span className="font-semibold">Remarks</span>
                    <span className="flex items-center gap-1">
                        {(lead.remarks || []).length > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{(lead.remarks || []).length}</span>}
                        {expandedSections.remarks ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    </span>
                </button>
                {expandedSections.remarks && (
                    <div className="px-4 pb-4 border-t">
                        <div className="flex items-center justify-between mt-3 mb-2">
                            <span className="text-sm text-gray-500">Customer queries</span>
                            <button onClick={() => setRemarksOpen(true)} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
                                <MessageSquarePlus className="w-4 h-4" /> Add Remark
                            </button>
                        </div>
                        {(lead.remarks || []).length === 0 ? (
                            <div className="text-sm text-gray-500 py-2">No remarks yet. Click &quot;Add Remark&quot; to note customer queries.</div>
                        ) : (
                            <div className="space-y-2">
                                {(lead.remarks || []).map((r) => (
                                    <div key={r.remarkId} className="border rounded-lg p-3 text-sm flex justify-between gap-3 bg-amber-50/50">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-gray-800">{r.note}</div>
                                            <div className="text-xs text-gray-500 mt-1">{new Date(r.createdAt).toLocaleString()} {r.userName && `· ${r.userName}`}</div>
                                        </div>
                                        <button onClick={() => handleDeleteRemark(r.remarkId)} disabled={deletingRemarkId === r.remarkId} className="text-red-600 hover:text-red-700 shrink-0 p-1" title="Delete">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quotation modal */}
            {quotationOpen && lead && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200">
                        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-gray-900">Send quotation</h3>
                                <p className="text-xs text-gray-500">Proforma invoice PDF · Rent / lock-in / security</p>
                            </div>
                            <button type="button" onClick={() => setQuotationOpen(false)} className="p-1 rounded hover:bg-gray-100">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3 text-sm">
                            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-gray-700 leading-relaxed">
                                <div className="font-semibold text-slate-900">From (on PDF)</div>
                                TRUETECH SERVICES PRIVATE LIMITED · UNIT NO-429, 4TH FLOOR JMD MEGAPOLIS · SEC-48, SOHNA ROAD, GURGAON · GSTIN: 06AAHCT0310N1ZG
                            </div>

                            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-gray-700 leading-relaxed mb-3">
                                <div className="font-semibold text-slate-900 mb-2">Specs on PDF &amp; email — all optional</div>
                                <p className="text-[11px] text-gray-600 mb-2">Leave blank to use the values saved on the lead / status laptop config. <strong>Brand is not required.</strong></p>
                                <div className="grid grid-cols-2 gap-2">
                                    <input placeholder="Brand (optional)" className="border rounded-lg px-2 py-1.5 text-xs col-span-2" value={quotation.c1_brand} onChange={(e) => setQuotation((q) => ({ ...q, c1_brand: e.target.value }))} />
                                    <input placeholder="Processor" className="border rounded-lg px-2 py-1.5 text-xs col-span-2" value={quotation.c1_processor} onChange={(e) => setQuotation((q) => ({ ...q, c1_processor: e.target.value }))} />
                                    <input placeholder="Generation" className="border rounded-lg px-2 py-1.5 text-xs" value={quotation.c1_generation} onChange={(e) => setQuotation((q) => ({ ...q, c1_generation: e.target.value }))} />
                                    <input placeholder="RAM" className="border rounded-lg px-2 py-1.5 text-xs" value={quotation.c1_ram} onChange={(e) => setQuotation((q) => ({ ...q, c1_ram: e.target.value }))} />
                                    <input placeholder="Storage" className="border rounded-lg px-2 py-1.5 text-xs col-span-2" value={quotation.c1_storage} onChange={(e) => setQuotation((q) => ({ ...q, c1_storage: e.target.value }))} />
                                </div>
                            </div>

                            <label className="block">
                                <span className="text-xs text-gray-600">To email (customer)</span>
                                <input
                                    type="email"
                                    className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                    value={quotation.to_email}
                                    onChange={(e) => setQuotation((q) => ({ ...q, to_email: e.target.value }))}
                                    placeholder="customer@company.com"
                                />
                            </label>

                            <label className="block">
                                <span className="text-xs text-gray-600">CC recipients</span>
                                <input
                                    type="text"
                                    className="mt-0.5 w-full border rounded-lg px-3 py-2 text-sm"
                                    value={quotation.cc_emails}
                                    onChange={(e) => setQuotation((q) => ({ ...q, cc_emails: e.target.value }))}
                                    placeholder="team@rentfoxxy.com, you@rentfoxxy.com"
                                />
                                <span className="text-[10px] text-gray-500 block mt-1">
                                    Pre-filled with default team CC and your login email. Remove any name you do not want copied on this send.
                                </span>
                            </label>

                            <div className="border-t border-gray-100 pt-2 space-y-2">
                                <div className="font-semibold text-xs text-gray-800">Bill To</div>
                                {(lead.addresses || []).length >= 1 && (
                                    <select
                                        className="w-full border rounded-lg px-2 py-1.5 text-xs"
                                        defaultValue=""
                                        onChange={(e) => {
                                            const id = e.target.value;
                                            if (!id) return;
                                            const row = lead.addresses.find((a) => String(a.address_id) === id);
                                            if (row) applySavedAddress('bill', row);
                                            e.target.value = '';
                                        }}
                                    >
                                        <option value="">Fill Bill To from saved address…</option>
                                        {(lead.addresses || []).map((a) => (
                                            <option key={a.address_id} value={a.address_id}>
                                                {(a.address_type || 'Address') + ' — ' + (a.address || '').slice(0, 42)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                <input
                                    placeholder="Company name"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={quotation.bill_company}
                                    onChange={(e) => setQuotation((q) => ({ ...q, bill_company: e.target.value }))}
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        placeholder="Phone"
                                        className="border rounded-lg px-3 py-2"
                                        value={quotation.bill_phone}
                                        onChange={(e) => setQuotation((q) => ({ ...q, bill_phone: e.target.value }))}
                                    />
                                    <input
                                        placeholder="Email"
                                        className="border rounded-lg px-3 py-2"
                                        value={quotation.bill_email}
                                        onChange={(e) => setQuotation((q) => ({ ...q, bill_email: e.target.value }))}
                                    />
                                </div>
                                <input
                                    placeholder="GSTIN (optional)"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={quotation.bill_gstin}
                                    onChange={(e) => setQuotation((q) => ({ ...q, bill_gstin: e.target.value }))}
                                />
                                <textarea
                                    placeholder="Full Bill To address (required if not using saved addresses)"
                                    rows={3}
                                    className="w-full border rounded-lg px-3 py-2 text-xs"
                                    value={quotation.bill_address}
                                    onChange={(e) => setQuotation((q) => ({ ...q, bill_address: e.target.value }))}
                                />
                            </div>

                            <label className="flex items-center gap-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={quotation.ship_same}
                                    onChange={(e) => setQuotation((q) => ({ ...q, ship_same: e.target.checked }))}
                                />
                                Ship To same as Bill To
                            </label>

                            {!quotation.ship_same && (
                                <div className="border-t border-gray-100 pt-2 space-y-2">
                                    <div className="font-semibold text-xs text-gray-800">Ship To</div>
                                    {(lead.addresses || []).length >= 2 && (
                                        <select
                                            className="w-full border rounded-lg px-2 py-1.5 text-xs"
                                            defaultValue=""
                                            onChange={(e) => {
                                                const id = e.target.value;
                                                if (!id) return;
                                                const row = lead.addresses.find((a) => String(a.address_id) === id);
                                                if (row) applySavedAddress('ship', row);
                                                e.target.value = '';
                                            }}
                                        >
                                            <option value="">Fill Ship To from saved address…</option>
                                            {(lead.addresses || []).map((a) => (
                                                <option key={a.address_id} value={a.address_id}>
                                                    {(a.address_type || 'Address') + ' — ' + (a.address || '').slice(0, 42)}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <input
                                        placeholder="Company name"
                                        className="w-full border rounded-lg px-3 py-2"
                                        value={quotation.ship_company}
                                        onChange={(e) => setQuotation((q) => ({ ...q, ship_company: e.target.value }))}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            placeholder="Phone"
                                            className="border rounded-lg px-3 py-2"
                                            value={quotation.ship_phone}
                                            onChange={(e) => setQuotation((q) => ({ ...q, ship_phone: e.target.value }))}
                                        />
                                        <input
                                            placeholder="Email"
                                            className="border rounded-lg px-3 py-2"
                                            value={quotation.ship_email}
                                            onChange={(e) => setQuotation((q) => ({ ...q, ship_email: e.target.value }))}
                                        />
                                    </div>
                                    <input
                                        placeholder="GSTIN (optional)"
                                        className="w-full border rounded-lg px-3 py-2"
                                        value={quotation.ship_gstin}
                                        onChange={(e) => setQuotation((q) => ({ ...q, ship_gstin: e.target.value }))}
                                    />
                                    <textarea
                                        placeholder="Full Ship To address"
                                        rows={3}
                                        className="w-full border rounded-lg px-3 py-2 text-xs"
                                        value={quotation.ship_address}
                                        onChange={(e) => setQuotation((q) => ({ ...q, ship_address: e.target.value }))}
                                    />
                                </div>
                            )}

                            <div className="border border-dashed border-orange-200 rounded-lg p-3 bg-orange-50/40 space-y-2">
                                <div className="text-xs font-semibold text-[#c2410c]">Optional: Configuration 2 (email only)</div>
                                <p className="text-[11px] text-gray-600 leading-snug">
                                    Fills a second column in the customer email like your standard template. Leave blank for a single-configuration table. If you enter any field here, <strong>monthly rent for Config 2</strong> is required.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        placeholder="Processor (e.g. i7 - 13th Gen)"
                                        className="border rounded-lg px-3 py-2 text-xs col-span-2"
                                        value={quotation.c2_processor}
                                        onChange={(e) => setQuotation((q) => ({ ...q, c2_processor: e.target.value }))}
                                    />
                                    <input
                                        placeholder="RAM"
                                        className="border rounded-lg px-3 py-2 text-xs"
                                        value={quotation.c2_ram}
                                        onChange={(e) => setQuotation((q) => ({ ...q, c2_ram: e.target.value }))}
                                    />
                                    <input
                                        placeholder="Storage"
                                        className="border rounded-lg px-3 py-2 text-xs"
                                        value={quotation.c2_storage}
                                        onChange={(e) => setQuotation((q) => ({ ...q, c2_storage: e.target.value }))}
                                    />
                                    <input
                                        placeholder="Monthly rent (₹)"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        className="border rounded-lg px-3 py-2 text-xs col-span-2"
                                        value={quotation.c2_monthly_rate}
                                        onChange={(e) => setQuotation((q) => ({ ...q, c2_monthly_rate: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-2">
                                <label className="block col-span-2 sm:col-span-1">
                                    <span className="text-xs text-gray-600">Qty (laptops)</span>
                                    <input
                                        type="number"
                                        min={1}
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.quantity}
                                        onChange={(e) => setQuotation((q) => ({ ...q, quantity: e.target.value }))}
                                    />
                                </label>
                                <label className="block col-span-2 sm:col-span-1">
                                    <span className="text-xs text-gray-600">Monthly rent / unit (₹)</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.monthly_rate}
                                        onChange={(e) => setQuotation((q) => ({ ...q, monthly_rate: e.target.value }))}
                                    />
                                </label>
                                <label className="block col-span-2 sm:col-span-1">
                                    <span className="text-xs text-gray-600">Lock-in (months)</span>
                                    <input
                                        type="number"
                                        min={1}
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.lockin_months}
                                        onChange={(e) => setQuotation((q) => ({ ...q, lockin_months: e.target.value }))}
                                    />
                                </label>
                                <label className="block col-span-2 sm:col-span-1">
                                    <span className="text-xs text-gray-600">Security deposit</span>
                                    <select
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.security_months}
                                        onChange={(e) => setQuotation((q) => ({ ...q, security_months: e.target.value }))}
                                    >
                                        <option value="1">1 month of rent</option>
                                        <option value="2">2 months of rent</option>
                                    </select>
                                </label>
                                <label className="block col-span-2">
                                    <span className="text-xs text-gray-600">Place of supply</span>
                                    <input
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.place_of_supply}
                                        onChange={(e) => setQuotation((q) => ({ ...q, place_of_supply: e.target.value }))}
                                    />
                                </label>
                                <label className="block col-span-2">
                                    <span className="text-xs text-gray-600">HSN/SAC</span>
                                    <input
                                        className="mt-0.5 w-full border rounded-lg px-3 py-2"
                                        value={quotation.hsn_sac}
                                        onChange={(e) => setQuotation((q) => ({ ...q, hsn_sac: e.target.value }))}
                                    />
                                </label>
                            </div>

                            <div className="text-[11px] text-gray-500 rounded-lg border border-amber-100 bg-amber-50/50 p-2">
                                <div><strong>To:</strong> customer email above</div>
                                <div><strong>CC:</strong> {quotation.cc_emails || '—'}</div>
                                {quotation.mail_from ? (
                                    <div className="mt-1">From: <code className="text-gray-700">{quotation.mail_from}</code></div>
                                ) : null}
                            </div>

                            <div className="flex justify-end gap-2 pt-1">
                                <button type="button" onClick={() => setQuotationOpen(false)} className="px-4 py-2 border rounded-lg text-sm">
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSendQuotation}
                                    disabled={quotationSending}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                >
                                    {quotationSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    Send email
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Remarks side panel - for adding new */}
            {remarksOpen && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setRemarksOpen(false)} />
                    <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="font-bold">Add Remark</h3>
                            <button onClick={() => { setRemarksOpen(false); setRemarkText(''); }} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-4 flex-1 flex flex-col gap-3">
                            <textarea
                                value={remarkText}
                                onChange={(e) => setRemarkText(e.target.value)}
                                placeholder="Customer query or note..."
                                className="w-full border rounded-lg px-3 py-2 min-h-[120px]"
                                rows={4}
                            />
                            <button
                                onClick={handleAddRemark}
                                disabled={savingRemark || !remarkText.trim()}
                                className="self-end px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                            >
                                {savingRemark ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                        <div className="p-4 border-t max-h-48 overflow-y-auto">
                            <div className="text-xs font-semibold text-gray-500 mb-2">Existing remarks</div>
                            {(lead.remarks || []).length === 0 ? (
                                <div className="text-sm text-gray-500">No remarks yet.</div>
                            ) : (
                                <div className="space-y-2">
                                    {(lead.remarks || []).map((r) => (
                                        <div key={r.remarkId} className="border rounded-lg p-2 text-sm flex justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-gray-700">{r.note}</div>
                                                <div className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleString()} {r.userName && `· ${r.userName}`}</div>
                                            </div>
                                            <button onClick={() => handleDeleteRemark(r.remarkId)} disabled={deletingRemarkId === r.remarkId} className="text-red-600 hover:text-red-700 shrink-0">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white border rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold">Company Research</h3>
                    <div className="flex gap-2">
                        <button onClick={handleResearch} className="text-sm bg-gray-100 px-3 py-2 rounded-lg">
                            Run Research
                        </button>
                        <button
                            onClick={() => setEditingResearch(prev => !prev)}
                            className="text-sm bg-blue-100 text-blue-700 px-3 py-2 rounded-lg"
                        >
                            {editingResearch ? 'Cancel Edit' : 'Edit Info'}
                        </button>
                    </div>
                </div>
                {editingResearch ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            {Object.entries(researchForm).map(([key, value]) => (
                                <div key={key} className={key === 'summary' || key === 'address' ? 'md:col-span-2' : ''}>
                                    <label className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</label>
                                    {key === 'summary' || key === 'address' ? (
                                        <textarea
                                            value={value}
                                            onChange={(e) => handleResearchField(key, e.target.value)}
                                            rows={3}
                                            className="w-full border rounded-lg px-3 py-2"
                                        />
                                    ) : (
                                        <input
                                            value={value}
                                            onChange={(e) => handleResearchField(key, e.target.value)}
                                            className="w-full border rounded-lg px-3 py-2"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={handleSaveResearch}
                            disabled={savingResearch}
                            className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
                        >
                            {savingResearch ? 'Saving...' : 'Save Company Info'}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div><span className="text-gray-500">CIN:</span> {researchForm.cin || '-'}</div>
                        <div><span className="text-gray-500">Industry:</span> {researchForm.industry || '-'}</div>
                        <div><span className="text-gray-500">Pincode:</span> {researchForm.pincode || '-'}</div>
                        <div><span className="text-gray-500">Entity:</span> {researchForm.entity_type || '-'}</div>
                        <div><span className="text-gray-500">ROC:</span> {researchForm.roc || '-'}</div>
                        <div><span className="text-gray-500">Revenue:</span> {researchForm.revenue || '-'}</div>
                        <div><span className="text-gray-500">Employees:</span> {researchForm.employees || '-'}</div>
                        <div><span className="text-gray-500">GST:</span> {researchForm.gst || '-'}</div>
                        <div><span className="text-gray-500">Departments:</span> {researchForm.departments || '-'}</div>
                        <div><span className="text-gray-500">Website:</span> {researchForm.website || '-'}</div>
                        <div><span className="text-gray-500">LinkedIn:</span> {researchForm.linkedin_url || '-'}</div>
                        <div><span className="text-gray-500">Facebook:</span> {researchForm.facebook_url || '-'}</div>
                        <div><span className="text-gray-500">Twitter:</span> {researchForm.twitter_url || '-'}</div>
                        <div><span className="text-gray-500">Technologies:</span> {researchForm.technologies || '-'}</div>
                        <div><span className="text-gray-500">Annual Revenue:</span> {researchForm.annual_revenue || '-'}</div>
                        <div><span className="text-gray-500">Total Funding:</span> {researchForm.total_funding || '-'}</div>
                        <div><span className="text-gray-500">Latest Funding:</span> {researchForm.latest_funding || '-'}</div>
                        <div><span className="text-gray-500">Latest Funding Amount:</span> {researchForm.latest_funding_amount || '-'}</div>
                        <div><span className="text-gray-500">Subsidiary Of:</span> {researchForm.subsidiary_of || '-'}</div>
                        <div className="md:col-span-2"><span className="text-gray-500">Address:</span> {researchForm.address || '-'}</div>
                        <div><span className="text-gray-500">City:</span> {researchForm.city || '-'}</div>
                        <div><span className="text-gray-500">State:</span> {researchForm.state || '-'}</div>
                        <div className="md:col-span-2"><span className="text-gray-500">Summary:</span> {researchForm.summary || '-'}</div>
                    </div>
                )}
            </div>

            {/* Activities - after Company Research */}
            <div className="bg-white border rounded-xl p-6">
                <h3 className="font-bold mb-3">Activities</h3>
                <div className="space-y-3">
                    {lead.activities?.map(activity => (
                        <div key={activity.activityId} className="border rounded-lg p-3 text-sm">
                            <div className="font-semibold">
                                {activity.action === 'quotation_sent'
                                    ? 'Quotation sent to customer'
                                    : activity.action === 'quotation_accepted'
                                    ? 'Quotation accepted by customer'
                                    : activity.action === 'status_updated'
                                    ? `Status: ${activity.statusFrom || '?'} → ${activity.statusTo || '-'}` +
                                      (activity.stageTo ? ` · Stage: ${activity.stageTo}` : '')
                                    : activity.action}
                            </div>
                            {activity.action === 'quotation_sent' && activity.user?.name && (
                                <div className="text-gray-600 text-xs mt-1">By {activity.user.name}</div>
                            )}
                            {activity.action === 'status_updated' && (
                                <>
                                    {(activity.stageFrom || activity.stageTo) && (
                                        <div className="text-gray-600 text-xs mt-1">
                                            Stage: {activity.stageFrom || '—'} → {activity.stageTo || '—'}
                                        </div>
                                    )}
                                    <div className="text-gray-600">Notes: {activity.notes || '-'}</div>
                                    <div className="text-gray-600">Updated by: {activity.user?.name || '-'}</div>
                                </>
                            )}
                            {activity.action !== 'status_updated' && activity.notes && (
                                <div className="text-gray-600">{activity.notes}</div>
                            )}
                            <div className="text-xs text-gray-400">{new Date(activity.createdAt).toLocaleString()}</div>
                        </div>
                    ))}
                    {(!lead.activities || lead.activities.length === 0) && (
                        <div className="text-sm text-gray-500">No activity yet.</div>
                    )}
                </div>
            </div>

            {lead.status === 'Deal' && (
                <div className="bg-white border rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-bold">Create Order</h3>
                            <p className="text-sm text-gray-500">Proceed to Sales Order page to select inventory or create procurement.</p>
                        </div>
                        <button
                            onClick={handleGoToSales}
                            className="bg-green-600 text-white rounded-lg px-4 py-2 font-semibold"
                        >
                            Go to Sales
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
