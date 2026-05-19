import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, Loader2, X, RefreshCw, Pencil, Plus, MapPin, Upload, Search
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Customers({ api }) {
    const { user } = useAuth();
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState(null);
    const [editModal, setEditModal] = useState(null);
    const [addModal, setAddModal] = useState(false);
    const [uploadModal, setUploadModal] = useState(false);

    // Admin, Manager, Sales: edit profile and add customer. Sales: add/update address. Admin only: bulk upload
    const isAdmin = user?.role === 'admin';
    const canEditProfile = ['admin', 'manager', 'sales'].includes(user?.role) || user?.permissions?.includes('customers_edit') || user?.permissions?.includes('sales_access');
    const canEditAddress = canEditProfile;
    const canAddCustomer = canEditProfile;
    const canBulkUpload = isAdmin;

    const loadCustomers = React.useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/sales/customers');
            setCustomers(data.customers || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => {
        loadCustomers();
    }, [loadCustomers]);

    const filteredCustomers = useMemo(() => {
        const q = (search || '').trim().toLowerCase();
        if (!q) return customers;
        return customers.filter((c) => {
            const name = (c.name || '').toLowerCase();
            const company = (c.company_name || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const gst = (c.gst_no || '').toLowerCase();
            const addrPersons = (c.addresses || []).map((a) => (a.concern_person || '').toLowerCase()).join(' ');
            const addrText = (c.addresses || []).map((a) => (a.address || '').toLowerCase()).join(' ');
            return name.includes(q) || company.includes(q) || email.includes(q) || phone.includes(q) || gst.includes(q) || addrPersons.includes(q) || addrText.includes(q);
        });
    }, [customers, search]);

    return (
        <div className="space-y-5 max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        Customers
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">View and manage customer details. Admin, Manager, and Sales can add and edit customers.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={loadCustomers} className="p-2 rounded-lg hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    {canAddCustomer && (
                        <button onClick={() => setAddModal(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors">
                            <Plus className="w-4 h-4" /> Add Customer
                        </button>
                    )}
                    {canBulkUpload && (
                        <button onClick={() => setUploadModal(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium transition-colors">
                            <Upload className="w-4 h-4" /> Upload CSV
                        </button>
                    )}
                </div>
            </div>

            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by name, company, email, phone, GST, or address..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        />
                    </div>
                    {search && (
                        <button onClick={() => setSearch('')} className="text-sm text-slate-600 hover:text-slate-800 px-3 py-2">
                            Clear
                        </button>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Company</th>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Email / Phone</th>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">GST</th>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Addresses</th>
                                <th className="px-4 py-3 w-24 text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" /></td></tr>
                            ) : filteredCustomers.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">{search ? 'No customers match your search.' : 'No customers yet. Add manually or upload CSV (Admin).'}</td></tr>
                            ) : (
                                filteredCustomers.map((c) => (
                                    <React.Fragment key={c.customer_id}>
                                        <tr className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                                            <td className="px-4 py-3 text-slate-600">{c.company_name || '-'}</td>
                                            <td className="px-4 py-3 text-slate-600">
                                                <div>{c.email || '-'}</div>
                                                <div className="text-xs">{c.phone || '-'}</div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 text-xs">{c.gst_no || '-'}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${(c.type || 'New') === 'New' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                                    {c.type || 'New'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => setExpandedId(expandedId === c.customer_id ? null : c.customer_id)}
                                                    className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
                                                >
                                                    <MapPin className="w-4 h-4" />
                                                    {(c.addresses || []).length} address(es)
                                                </button>
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => setEditModal(c)}
                                                    className="text-slate-500 hover:text-indigo-600 p-1 transition-colors"
                                                    title={canEditProfile ? 'Edit customer' : 'View / Edit addresses'}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                        {expandedId === c.customer_id && (c.addresses || []).length > 0 && (
                                            <tr className="border-t border-slate-100 bg-slate-50/50">
                                                <td colSpan={7} className="p-4">
                                                    <div className="space-y-2">
                                                        {(c.addresses || []).map((addr) => (
                                                            <div key={addr.customer_address_id} className="bg-white p-3 rounded-lg border text-sm">
                                                                <div className="font-medium">{addr.concern_person || 'Contact'}</div>
                                                                <div className="text-gray-600">{addr.address} {addr.pincode ? `- ${addr.pincode}` : ''}</div>
                                                                <div className="text-gray-500 text-xs">{addr.mobile_no || '-'}</div>
                                                                <div className="flex gap-1 mt-1">
                                                                    {addr.is_head_office && <span className="text-xs bg-amber-100 text-amber-700 px-1 rounded">Head Office</span>}
                                                                    {addr.address_type && <span className="text-xs bg-slate-100 text-slate-600 px-1 rounded">{addr.address_type}</span>}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {editModal && (
                <CustomerEditModal
                    customer={editModal}
                    onClose={() => setEditModal(null)}
                    api={api}
                    onRefresh={loadCustomers}
                    canEditProfile={canEditProfile}
                    canEditAddress={canEditAddress}
                />
            )}
            {addModal && (
                <CustomerAddModal onClose={() => setAddModal(false)} api={api} onRefresh={loadCustomers} />
            )}
            {uploadModal && (
                <CustomerUploadModal onClose={() => setUploadModal(false)} api={api} onRefresh={loadCustomers} />
            )}
        </div>
    );
}

function CustomerEditModal({ customer, onClose, api, onRefresh, canEditProfile, canEditAddress }) {
    const [form, setForm] = useState({
        name: customer.name || '',
        company_name: customer.company_name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        gst_no: customer.gst_no || '',
        type: customer.type || 'New'
    });
    const [addresses, setAddresses] = useState(customer.addresses || []);
    const [saving, setSaving] = useState(false);
    const [addingAddr, setAddingAddr] = useState(false);

    const refetchAddresses = React.useCallback(async () => {
        try {
            const { data } = await api.get(`/sales/customers/${customer.customer_id}`);
            setAddresses(data.customer?.addresses || []);
        } catch (_) {}
    }, [api, customer.customer_id]);

    const handleSaveProfile = async () => {
        if (!canEditProfile) return;
        setSaving(true);
        try {
            await api.put(`/sales/customers/${customer.customer_id}`, form);
            onRefresh();
            onClose();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="font-bold">Customer Details</h3>
                    <button onClick={onClose}><X className="w-5 h-5" /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                        <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">GST No</label>
                        <input value={form.gst_no} onChange={e => setForm(f => ({ ...f, gst_no: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full border rounded px-3 py-2" disabled={!canEditProfile}>
                            <option value="New">New</option>
                            <option value="Existing">Existing</option>
                        </select>
                    </div>
                    {canEditProfile && (
                        <button onClick={handleSaveProfile} disabled={saving} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Profile'}
                        </button>
                    )}

                    <div className="border-t pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-gray-700">Addresses</label>
                            {canEditAddress && (
                                <button type="button" onClick={() => setAddingAddr(true)} className="text-blue-600 text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> Add</button>
                            )}
                        </div>
                        <div className="space-y-2">
                            {addresses.map((addr) => (
                                <AddressEditRow key={addr.customer_address_id} addr={addr} customerId={customer.customer_id} api={api} onSaved={refetchAddresses} canEdit={canEditAddress} />
                            ))}
                            {addingAddr && (
                                <AddressAddRow customerId={customer.customer_id} api={api} onSaved={() => { setAddingAddr(false); refetchAddresses(); }} onCancel={() => setAddingAddr(false)} />
                            )}
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800">Close</button>
                </div>
            </div>
        </div>
    );
}

function AddressAddRow({ customerId, api, onSaved, onCancel }) {
    const [form, setForm] = useState({ concern_person: '', mobile_no: '', address: '', pincode: '', is_head_office: false, address_type: 'Shipping' });
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!form.address?.trim()) return alert('Address is required');
        setSaving(true);
        try {
            await api.post(`/sales/customers/${customerId}/addresses`, form);
            onSaved();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-gray-50 p-3 rounded-lg">
            <input placeholder="Contact Person" value={form.concern_person} onChange={e => setForm(f => ({ ...f, concern_person: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
            <input placeholder="Mobile" value={form.mobile_no} onChange={e => setForm(f => ({ ...f, mobile_no: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
            <input placeholder="Address *" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
            <input placeholder="Pincode" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
            <select value={form.address_type} onChange={e => setForm(f => ({ ...f, address_type: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm">
                <option value="Billing">Billing</option>
                <option value="Shipping">Shipping</option>
            </select>
            <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={form.is_head_office} onChange={e => setForm(f => ({ ...f, is_head_office: e.target.checked }))} /> Head Office</label>
            <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Add</button>
                <button onClick={onCancel} className="px-2 py-1 border rounded text-xs">Cancel</button>
            </div>
        </div>
    );
}

function AddressEditRow({ addr, customerId, api, onSaved, canEdit }) {
    const [edit, setEdit] = useState(false);
    const [form, setForm] = useState({
        concern_person: addr.concern_person || '',
        mobile_no: addr.mobile_no || '',
        address: addr.address || '',
        pincode: addr.pincode || '',
        is_head_office: addr.is_head_office || false,
        address_type: addr.address_type || 'Shipping'
    });
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/sales/customers/${customerId}/addresses/${addr.customer_address_id}`, form);
            setEdit(false);
            onSaved?.();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setSaving(false);
        }
    };

    if (edit && canEdit) {
        return (
            <div className="bg-gray-50 p-3 rounded-lg">
                <input placeholder="Contact" value={form.concern_person} onChange={e => setForm(f => ({ ...f, concern_person: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
                <input placeholder="Mobile" value={form.mobile_no} onChange={e => setForm(f => ({ ...f, mobile_no: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
                <input placeholder="Address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
                <input placeholder="Pincode" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm" />
                <select value={form.address_type} onChange={e => setForm(f => ({ ...f, address_type: e.target.value }))} className="w-full border rounded px-2 py-1 mb-2 text-sm">
                    <option value="Billing">Billing</option>
                    <option value="Shipping">Shipping</option>
                </select>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_head_office} onChange={e => setForm(f => ({ ...f, is_head_office: e.target.checked }))} /> Head Office</label>
                <div className="mt-2 flex gap-2">
                    <button onClick={handleSave} disabled={saving} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Save</button>
                    <button onClick={() => setEdit(false)} className="px-2 py-1 border rounded text-xs">Cancel</button>
                </div>
            </div>
        );
    }
    return (
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
            <div>
                <div className="font-medium">{addr.concern_person || '-'}</div>
                <div className="text-sm text-gray-600">{addr.address} {addr.pincode ? `- ${addr.pincode}` : ''}</div>
                {addr.address_type && <span className="text-xs bg-slate-100 text-slate-600 px-1 rounded">{addr.address_type}</span>}
            </div>
            {canEdit && (
                <button onClick={() => setEdit(true)} className="text-blue-600 hover:text-blue-800"><Pencil className="w-4 h-4" /></button>
            )}
        </div>
    );
}

function CustomerAddModal({ onClose, api, onRefresh }) {
    const [form, setForm] = useState({
        name: '', company_name: '', email: '', phone: '', gst_no: '', type: 'Existing',
        concern_person: '', mobile_no: '', address: '', pincode: '', address_type: 'Shipping'
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return alert('Name is required');
        setSaving(true);
        try {
            const { data } = await api.post('/sales/customers', {
                name: form.name,
                company_name: form.company_name || null,
                email: form.email || null,
                phone: form.phone || null,
                gst_no: form.gst_no || null,
                type: form.type || 'Existing'
            });
            const cid = data.customer?.customer_id;
            if (cid && (form.address || form.concern_person)) {
                await api.post(`/sales/customers/${cid}/addresses`, {
                    concern_person: form.concern_person || null,
                    mobile_no: form.mobile_no || null,
                    address: form.address || '',
                    pincode: form.pincode || null,
                    is_head_office: true,
                    address_type: form.address_type || 'Shipping'
                });
            }
            onRefresh();
            onClose();
        } catch (e) {
            alert('Failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="font-bold">Add Customer</h3>
                    <button onClick={onClose}><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded px-3 py-2" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                        <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">GST No</label>
                        <input value={form.gst_no} onChange={e => setForm(f => ({ ...f, gst_no: e.target.value }))} className="w-full border rounded px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full border rounded px-3 py-2">
                            <option value="New">New</option>
                            <option value="Existing">Existing</option>
                        </select>
                    </div>
                    <div className="border-t pt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Address (optional)</label>
                        <input placeholder="Contact Person" value={form.concern_person} onChange={e => setForm(f => ({ ...f, concern_person: e.target.value }))} className="w-full border rounded px-3 py-2 mb-2" />
                        <input placeholder="Mobile" value={form.mobile_no} onChange={e => setForm(f => ({ ...f, mobile_no: e.target.value }))} className="w-full border rounded px-3 py-2 mb-2" />
                        <input placeholder="Address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="w-full border rounded px-3 py-2 mb-2" />
                        <input placeholder="Pincode" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} className="w-full border rounded px-3 py-2 mb-2" />
                        <select value={form.address_type} onChange={e => setForm(f => ({ ...f, address_type: e.target.value }))} className="w-full border rounded px-3 py-2 mb-2">
                            <option value="Billing">Billing</option>
                            <option value="Shipping">Shipping</option>
                        </select>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            {saving ? 'Adding...' : 'Add Customer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function CustomerUploadModal({ onClose, api, onRefresh }) {
    const [file, setFile] = useState(null);
    const [addToExisting, setAddToExisting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState(null);

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file) return alert('Select a CSV file');
        setUploading(true);
        setResult(null);
        try {
            const url = addToExisting ? '/sales/customers/upload?add_to_existing=true' : '/sales/customers/upload';
            const { data } = await api.postForm(url, { file });
            setResult(data);
            onRefresh();
        } catch (e) {
            alert('Upload failed: ' + (e.response?.data?.message || e.message));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="font-bold">Upload Customer CSV</h3>
                    <button onClick={onClose}><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleUpload} className="p-4 space-y-4">
                    <p className="text-sm text-gray-600">Columns: name, company_name, email, phone, gst_no, type, concern_person, mobile_no, address, pincode, address_type</p>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={addToExisting} onChange={e => setAddToExisting(e.target.checked)} className="rounded" />
                        <span>Add addresses to existing customers (when email/phone matches)</span>
                    </label>
                    <div className="text-xs text-gray-600 space-y-1 bg-gray-50 p-3 rounded-lg">
                        <p><strong>concern_person</strong> = Name or role of the person to contact at that address (e.g. Rajesh Kumar, Warehouse Manager). Do not use &quot;Head Office&quot; or &quot;Contact Person&quot;.</p>
                        <p><strong>address_type</strong> = Billing or Shipping (for accounting/billing purposes).</p>
                        <p><strong>Head Office</strong> = Auto-set for the first address of each customer (not a CSV column).</p>
                        <p><strong>Multiple addresses</strong> = Add one row per address with the same email/phone. Each row can have different concern_person, mobile_no, address, pincode, address_type.</p>
                    </div>
                    <a href="/sample-customers.csv" download="sample-customers.csv" className="text-blue-600 text-sm underline block mb-2">Download sample file</a>
                    <div>
                        <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0])} className="w-full text-sm" />
                    </div>
                    {result && (
                        <div className="p-3 bg-green-50 rounded-lg text-sm text-green-800 space-y-1">
                            <p><strong>Total rows:</strong> {result.totalRows ?? '-'}</p>
                            <p><strong>Imported:</strong> {result.imported ?? 0} customers, {result.addressesAdded ?? 0} addresses</p>
                            {(result.skippedDuplicate > 0 || result.skippedNoKey > 0) && (
                                <p className="text-amber-700"><strong>Skipped:</strong> {result.skippedDuplicate ?? 0} duplicates, {result.skippedNoKey ?? 0} no key (need email/phone/name)</p>
                            )}
                            {result.addressesAddedToExisting > 0 && <p>Added {result.addressesAddedToExisting} addresses to existing customers</p>}
                            {result.failed > 0 && <p className="text-red-600">Failed: {result.failed}</p>}
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
                        <button type="submit" disabled={uploading} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                            {uploading ? 'Uploading...' : 'Upload'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
