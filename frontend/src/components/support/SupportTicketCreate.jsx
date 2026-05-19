import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import { formatAddress } from './utils';
import './support.css';

const emptyRow = () => ({
    customer_inventory_id: '',
    serial_number: '',
    unique_serial_number: '',
    brand: '',
    model: '',
    ram: '',
    storage: '',
    generation: '',
    item_type: 'complaint',
    issue_category_id: '',
    remarks: '',
    assigned_to: ''
});

function useIsMobile() {
    const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const onResize = () => setMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return mobile;
}

export default function SupportTicketCreate() {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [step, setStep] = useState(0);
    const [customerQuery, setCustomerQuery] = useState('');
    const [customers, setCustomers] = useState([]);
    const [customer, setCustomer] = useState(null);
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [rows, setRows] = useState([emptyRow()]);
    const [saving, setSaving] = useState(false);
    const [searching, setSearching] = useState(false);
    const [priority, setPriority] = useState('normal');
    const [ticketPhone, setTicketPhone] = useState('');
    const [ticketAltPhone, setTicketAltPhone] = useState('');
    const [ticketEmail, setTicketEmail] = useState('');
    const [ticketAddress, setTicketAddress] = useState('');
    const [duplicateWarning, setDuplicateWarning] = useState(null);

    useEffect(() => {
        api.get('/support/categories').then((r) => setCategories(r.data.categories || []));
        api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || []));
    }, []);

    useEffect(() => {
        if (!customerQuery.trim()) {
            setCustomers([]);
            return;
        }
        const t = setTimeout(async () => {
            setSearching(true);
            try {
                const { data } = await api.get(`/support/customers?search=${encodeURIComponent(customerQuery)}`);
                setCustomers(data.items || []);
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [customerQuery]);

    const pickCustomer = async (c) => {
        setCustomer(c);
        setCustomerQuery(c.customer_name || '');
        setCustomers([]);
        const [detailRes, assetsRes] = await Promise.all([
            api.get(`/support/customers/${c.customer_id}`),
            api.get(`/support/customers/${c.customer_id}/assets`)
        ]);
        const picked = detailRes.data.customer || c;
        setCustomer(picked);
        setTicketPhone(picked.contact_person_number || picked.customer_number || '');
        setTicketEmail(picked.email || '');
        setAssets(assetsRes.data.assets || []);
        if (isMobile) setStep(1);
    };

    const updateRow = (idx, patch) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };

    const onAssetPick = (idx, assetId) => {
        const asset = assets.find((a) => String(a.id) === String(assetId));
        if (!asset) return;
        updateRow(idx, {
            customer_inventory_id: asset.id,
            serial_number: asset.serial_number,
            unique_serial_number: asset.unique_serial_number,
            model: asset.model_name,
            brand: asset.model_name?.split(' ')[0] || '',
            ram: asset.ram,
            storage: asset.storage,
            generation: asset.generation
        });
        if (customer?.customer_id) {
            api.get(`/support/tickets/check-duplicate?customer_id=${customer.customer_id}&serial=${encodeURIComponent(asset.unique_serial_number || asset.serial_number || '')}`)
                .then((r) => setDuplicateWarning(r.data.duplicate || null))
                .catch(() => setDuplicateWarning(null));
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!customer) {
            alert('Select a customer');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                customer_id: customer.customer_id,
                customer_name: customer.customer_name,
                customer_phone: customer.contact_person_number || customer.customer_number,
                priority,
                ticket_phone_override: ticketPhone,
                ticket_alt_phone: ticketAltPhone,
                ticket_email: ticketEmail,
                ticket_address: ticketAddress,
                items: rows.map((r) => ({
                    ...r,
                    issue_category_id: r.issue_category_id ? Number(r.issue_category_id) : null,
                    assigned_to: r.assigned_to ? Number(r.assigned_to) : null
                }))
            };
            const { data } = await api.post('/support/tickets', payload);
            navigate(`/support/tickets/${data.ticket.id}`);
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to create ticket');
        } finally {
            setSaving(false);
        }
    };

    const customerStep = (
        <section className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Search customer</label>
            <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-3 min-h-[44px]"
                placeholder="Name or customer ID"
            />
            {searching && <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />}
            <ul className="border border-slate-200 rounded-lg divide-y max-h-48 overflow-auto">
                {customers.map((c) => (
                    <li key={c.customer_id}>
                        <button
                            type="button"
                            onClick={() => pickCustomer(c)}
                            className="w-full text-left px-3 py-3 min-h-[44px] hover:bg-slate-50"
                        >
                            <span className="font-medium">{c.customer_name}</span>
                            <span className="text-xs text-slate-500 ml-2">#{c.customer_id}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {duplicateWarning && (
                <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-sm text-amber-900">
                    This machine already has an open ticket — #{duplicateWarning.id}. You can still create a new ticket.
                </div>
            )}
            {customer && (
                <div className="border border-slate-200 rounded-xl p-4 bg-white text-sm space-y-3">
                    <div className="flex justify-between gap-2">
                        <p className="font-medium">{customer.customer_name}</p>
                        <button type="button" className="text-[#534AB7] min-h-[44px] px-2" onClick={() => setCustomer(null)}>Change</button>
                    </div>
                    <p className="text-slate-600">{customer.contact_person_number || customer.customer_number}</p>
                    <p className="text-slate-500">{formatAddress(customer.billing_address || customer.shipping_address)}</p>
                    <label className="block">Phone for this ticket
                        <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={ticketPhone} onChange={(e) => setTicketPhone(e.target.value)} />
                    </label>
                    <label className="block">Alt phone
                        <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={ticketAltPhone} onChange={(e) => setTicketAltPhone(e.target.value)} />
                    </label>
                    <label className="block">Email
                        <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={ticketEmail} onChange={(e) => setTicketEmail(e.target.value)} />
                    </label>
                    <label className="block">Address
                        <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={ticketAddress} onChange={(e) => setTicketAddress(e.target.value)} />
                    </label>
                    <label className="block">Priority
                        <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </label>
                </div>
            )}
        </section>
    );

    const machinesStep = (
        <section className="space-y-4">
            {rows.map((row, idx) => (
                <article key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                    <div className="flex justify-between items-center">
                        <h3 className="font-semibold text-sm">Machine {idx + 1}</h3>
                        {rows.length > 1 && (
                            <button type="button" onClick={() => setRows((r) => r.filter((_, i) => i !== idx))} className="p-2 min-h-[44px] min-w-[44px]">
                                <Trash2 className="w-4 h-4 text-red-600" />
                            </button>
                        )}
                    </div>
                    <select
                        className="w-full border rounded-lg px-3 py-3 min-h-[44px]"
                        value={row.customer_inventory_id}
                        onChange={(e) => onAssetPick(idx, e.target.value)}
                    >
                        <option value="">Select serial / machine #</option>
                        {assets.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.unique_serial_number || a.serial_number} — {a.model_name}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-600">
                        {[row.brand, row.model, row.generation, row.ram, row.storage].filter(Boolean).join(' · ') || 'Specs appear after selection'}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                        <select
                            className="border rounded-lg px-3 py-3 min-h-[44px]"
                            value={row.item_type}
                            onChange={(e) => updateRow(idx, { item_type: e.target.value })}
                        >
                            <option value="complaint">Complaint</option>
                            <option value="pickup">Pickup</option>
                        </select>
                        <select
                            className="border rounded-lg px-3 py-3 min-h-[44px]"
                            value={row.issue_category_id}
                            onChange={(e) => updateRow(idx, { issue_category_id: e.target.value })}
                        >
                            <option value="">Issue category</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <textarea
                        className="w-full border rounded-lg px-3 py-2 min-h-[80px]"
                        placeholder="Remarks"
                        value={row.remarks}
                        onChange={(e) => updateRow(idx, { remarks: e.target.value })}
                    />
                    <select
                        className="w-full border rounded-lg px-3 py-3 min-h-[44px]"
                        value={row.assigned_to}
                        onChange={(e) => updateRow(idx, { assigned_to: e.target.value })}
                    >
                        <option value="">Assign technician (optional)</option>
                        {technicians.map((t) => (
                            <option key={t.user_id} value={t.user_id}>{t.name}</option>
                        ))}
                    </select>
                </article>
            ))}
            <button
                type="button"
                onClick={() => setRows((r) => [...r, emptyRow()])}
                className="inline-flex items-center gap-2 text-indigo-700 text-sm font-medium min-h-[44px] px-2"
            >
                <Plus className="w-4 h-4" /> Add machine row
            </button>
        </section>
    );

    return (
        <form onSubmit={submit} className="space-y-6 max-w-3xl">
            <h1 className="text-xl font-bold">Create support ticket</h1>

            {isMobile ? (
                <>
                    {step === 0 && customerStep}
                    {step === 1 && machinesStep}
                    <div className="flex gap-2">
                        {step > 0 && (
                            <button type="button" onClick={() => setStep(step - 1)} className="flex-1 border rounded-lg py-3 min-h-[44px]">
                                Back
                            </button>
                        )}
                        {step < 1 ? (
                            <button type="button" disabled={!customer} onClick={() => setStep(1)} className="flex-1 bg-indigo-600 text-white rounded-lg py-3 min-h-[44px] disabled:opacity-50">
                                Next
                            </button>
                        ) : (
                            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-3 min-h-[44px]">
                                {saving ? 'Saving…' : 'Create ticket'}
                            </button>
                        )}
                    </div>
                </>
            ) : (
                <>
                    {customerStep}
                    {machinesStep}
                    <button type="submit" disabled={saving} className="bg-indigo-600 text-white px-6 py-3 rounded-lg min-h-[44px]">
                        {saving ? 'Saving…' : 'Create ticket'}
                    </button>
                </>
            )}
        </form>
    );
}
