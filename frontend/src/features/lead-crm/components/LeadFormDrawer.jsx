import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  COMPANY_TYPES, GENERATIONS, INQUIRY_TYPES, LAPTOP_BRANDS, LEAD_SOURCES,
  PROCESSORS, RAM_OPTIONS, STORAGE_OPTIONS, USE_CASES,
} from '../leadConstants';
import { INDIAN_STATES } from '../../../constants/indianStates';
import { createLead, getUsers, updateLeadBasic, updateLeadProfile } from '../leadCrmApi';
import toast from 'react-hot-toast';

const emptyForm = () => ({
  company_name: '', company_brand: '', name: '', designation: '', email: '', phone: '', whatsapp_number: '',
  source: '', inquiry_type: 'rental', city: '', state: '', pincode: '',
  brand: '', processor: '', generation: '', ram: '', storage: '',
  quantity_required: '', monthly_budget: '', rental_duration: '', use_case: '',
  company_type: '', company_size: '', industry: '', annual_revenue: '', gst_number: '', pan_number: '',
  assigned_user_id: '', follow_up_date: '', follow_up_time: '', personal_remarks: '',
});

export default function LeadFormDrawer({ open, lead, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const isEdit = !!lead;

  useEffect(() => {
    if (open) {
      getUsers().then((r) => setUsers((r.data?.users || r.data || []).filter((u) => ['sales', 'manager', 'admin'].includes(u.role)))).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (lead) {
      setForm({
        ...emptyForm(),
        company_name: lead.companyName || '',
        company_brand: lead.companyBrand || '',
        name: lead.name || '',
        designation: lead.designation || '',
        email: lead.email || '',
        phone: lead.phone || '',
        whatsapp_number: lead.whatsappNumber || '',
        source: lead.source || '',
        inquiry_type: lead.inquiryType || 'rental',
        city: lead.city || '',
        state: lead.state || '',
        pincode: lead.pincode || '',
        brand: lead.brand || '',
        processor: lead.processor || '',
        generation: lead.generation || '',
        ram: lead.ram || '',
        storage: lead.storage || '',
        quantity_required: lead.quantityRequired ?? '',
        monthly_budget: lead.monthlyBudget ?? '',
        rental_duration: lead.rentalDuration ?? '',
        use_case: lead.useCase || '',
        company_type: lead.companyType || '',
        company_size: lead.companySize ?? '',
        industry: lead.industry || '',
        annual_revenue: lead.annualRevenue || '',
        gst_number: lead.gstNumber || '',
        pan_number: lead.panNumber || '',
        assigned_user_id: lead.assignedUserId || '',
        follow_up_date: lead.followUpDate ? String(lead.followUpDate).slice(0, 10) : '',
        follow_up_time: lead.followUpTime ? String(lead.followUpTime).slice(0, 5) : '',
        personal_remarks: lead.personalRemarks || '',
      });
    } else if (open) {
      setForm(emptyForm());
    }
    setErrors({});
  }, [lead, open]);

  if (!open) return null;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const validate = () => {
    const e = {};
    if (!form.company_name?.trim()) e.company_name = 'Company name is required';
    if (!form.phone?.trim()) e.phone = 'Phone is required';
    else if (!/^\d{10}$/.test(form.phone.replace(/\D/g, '').slice(-10))) e.phone = 'Enter 10-digit phone';
    if (!form.source) e.source = 'Source is required';
    if (!form.inquiry_type) e.inquiry_type = 'Inquiry type is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        quantity_required: form.quantity_required ? parseInt(form.quantity_required, 10) : null,
        monthly_budget: form.monthly_budget ? parseFloat(form.monthly_budget) : null,
        rental_duration: form.rental_duration ? parseInt(form.rental_duration, 10) : null,
        company_size: form.company_size ? parseInt(form.company_size, 10) : null,
        assigned_user_id: form.assigned_user_id || null,
      };
      if (isEdit) {
        await updateLeadBasic(lead.leadId, {
          name: payload.name,
          company_name: payload.company_name,
          company_brand: payload.company_brand,
          email: payload.email,
          phone: payload.phone,
          city: payload.city,
        });
        await updateLeadProfile(lead.leadId, payload);
        toast.success('Lead updated');
      } else {
        const created = await createLead({
          name: payload.name || payload.company_name,
          company_name: payload.company_name,
          company_brand: payload.company_brand,
          email: payload.email,
          phone: payload.phone,
          city: payload.city,
          source: payload.source,
          brand: payload.brand,
          processor: payload.processor,
          generation: payload.generation,
          ram: payload.ram,
          storage: payload.storage,
          personal_remarks: payload.personal_remarks,
          assigned_user_id: payload.assigned_user_id,
        });
        const newId = created.data?.lead?.leadId || created.data?.lead_id;
        if (newId) {
          await updateLeadProfile(newId, payload);
        }
        toast.success('Lead added');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, opts = {}) => (
    <div>
      <label className="text-xs text-gray-500">{label}{opts.required ? ' *' : ''}</label>
      {opts.type === 'select' ? (
        <select value={form[key]} onChange={(e) => set(key, e.target.value)} onBlur={validate}
          className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${errors[key] ? 'border-red-400' : 'border-gray-200'}`}>
          <option value="">Select</option>
          {(opts.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : opts.type === 'textarea' ? (
        <textarea value={form[key]} onChange={(e) => set(key, e.target.value)} rows={opts.rows || 2}
          className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      ) : (
        <input type={opts.type || 'text'} value={form[key]} onChange={(e) => set(key, e.target.value)} onBlur={validate}
          className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${errors[key] ? 'border-red-400' : 'border-gray-200'}`} />
      )}
      {errors[key] && <p className="text-xs text-red-500 mt-0.5">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-[560px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Lead' : 'Add Lead'}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Basic Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('company_name', 'Company Name', { required: true })}
              {field('company_brand', 'Brand')}
              {field('name', 'Contact Name', { required: true })}
              {field('designation', 'Designation')}
              {field('email', 'Email', { type: 'email' })}
              {field('phone', 'Phone', { required: true })}
              {field('whatsapp_number', 'WhatsApp')}
              {field('source', 'Source', { type: 'select', options: LEAD_SOURCES, required: true })}
              {field('inquiry_type', 'Inquiry Type', { type: 'select', options: INQUIRY_TYPES, required: true })}
              {field('city', 'City')}
              {field('state', 'State', { type: 'select', options: INDIAN_STATES })}
              {field('pincode', 'Pincode')}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Requirement</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('brand', 'Laptop Brand', { type: 'select', options: LAPTOP_BRANDS })}
              {field('processor', 'Processor', { type: 'select', options: PROCESSORS })}
              {field('generation', 'Generation', { type: 'select', options: GENERATIONS })}
              {field('ram', 'RAM', { type: 'select', options: RAM_OPTIONS })}
              {field('storage', 'Storage', { type: 'select', options: STORAGE_OPTIONS })}
              {field('quantity_required', 'Quantity', { type: 'number' })}
              {field('monthly_budget', 'Monthly Budget (₹)', { type: 'number' })}
              {field('rental_duration', 'Rental Duration (months)', { type: 'number' })}
              {field('use_case', 'Use Case', { type: 'select', options: USE_CASES })}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Company Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('company_type', 'Company Type', { type: 'select', options: COMPANY_TYPES })}
              {field('company_size', 'Company Size', { type: 'number' })}
              {field('industry', 'Industry')}
              {field('annual_revenue', 'Annual Revenue')}
              {field('gst_number', 'GST Number')}
              {field('pan_number', 'PAN Number')}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">CRM Assignment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Assign To</label>
                <select value={form.assigned_user_id} onChange={(e) => set('assigned_user_id', e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Auto-assign</option>
                  {users.map((u) => <option key={u.user_id || u.userId} value={u.user_id || u.userId}>{u.name}</option>)}
                </select>
              </div>
              {field('follow_up_date', 'Follow-up Date', { type: 'date' })}
              {field('follow_up_time', 'Follow-up Time', { type: 'time' })}
              <div className="sm:col-span-2">{field('personal_remarks', 'Initial Remarks', { type: 'textarea' })}</div>
            </div>
          </section>
        </div>
        <div className="flex gap-2 justify-end p-4 border-t border-gray-100 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
