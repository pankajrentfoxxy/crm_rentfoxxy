import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react';
import api from '../../utils/api';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../utils/phoneValidation';
import { assigneeOptionLabel, formatAddress } from './utils';
import PickupSetupForm from './components/PickupSetupForm';
import './support.css';

const CATEGORIES = [
    { id: 'complaint', title: 'Complaint', color: 'complaint' },
    { id: 'pickup', title: 'Pickup', color: 'pickup' },
    { id: 'replacement', title: 'Replacement', color: 'replacement' }
];

function useIsMobile() {
    const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const onResize = () => setMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return mobile;
}

function CategoryChips({ ticketCategory, setTicketCategory }) {
    return (
        <div className="support-category-chips">
            {CATEGORIES.map((cat) => (
                <button
                    key={cat.id}
                    type="button"
                    className={`support-category-chip ${cat.color} ${ticketCategory === cat.id ? 'active' : ''}`}
                    onClick={() => setTicketCategory(cat.id)}
                >
                    {cat.title}
                </button>
            ))}
        </div>
    );
}

function CustomerCard({
    customer,
    onClear,
    ticketPhone,
    setTicketPhone,
    ticketAltPhone,
    setTicketAltPhone,
    ticketEmail,
    setTicketEmail,
    ticketAddress,
    setTicketAddress,
    priority,
    setPriority,
    showContactExtra,
    setShowContactExtra
}) {
    return (
        <div className="support-customer-card support-customer-card-compact">
            <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{customer.customer_name}</p>
                    <p className="text-xs text-slate-500 truncate">{customer.contact_person_number || customer.customer_number}</p>
                </div>
                <button type="button" className="text-sm support-link shrink-0" onClick={onClear}>Change</button>
            </div>
            <div className="grid gap-2 mt-2 sm:grid-cols-2">
                <label className="support-label-compact">
                    <span className="support-label-text">Phone</span>
                    <input className="support-field support-field-compact" value={ticketPhone} onChange={(e) => setTicketPhone(formatIndianMobileInput(e.target.value))} maxLength={10} inputMode="numeric" />
                </label>
                <label className="support-label-compact">
                    <span className="support-label-text">Priority</span>
                    <select className="support-field support-field-compact" value={priority} onChange={(e) => setPriority(e.target.value)}>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </label>
            </div>
            <button type="button" className="support-optional-toggle mt-2" onClick={() => setShowContactExtra((v) => !v)}>
                {showContactExtra ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                More contact details
            </button>
            {showContactExtra && (
                <div className="grid gap-2 mt-2">
                    <label className="support-label-compact">
                        <span className="support-label-text">Alt phone</span>
                        <input className="support-field support-field-compact" value={ticketAltPhone} onChange={(e) => setTicketAltPhone(formatIndianMobileInput(e.target.value))} maxLength={10} inputMode="numeric" />
                    </label>
                    <label className="support-label-compact">
                        <span className="support-label-text">Email</span>
                        <input className="support-field support-field-compact" value={ticketEmail} onChange={(e) => setTicketEmail(e.target.value)} />
                    </label>
                    <label className="support-label-compact">
                        <span className="support-label-text">Address</span>
                        <input className="support-field support-field-compact" value={ticketAddress} onChange={(e) => setTicketAddress(e.target.value)} />
                    </label>
                </div>
            )}
        </div>
    );
}

function AssetCard({ asset, isOn, block, onToggle }) {
    return (
        <div className={`support-asset-card support-asset-card-compact ${isOn ? 'selected' : ''} ${block ? 'blocked' : ''}`}>
            <button type="button" className="support-asset-card-btn" onClick={onToggle} disabled={!!block}>
                <span className={`support-asset-check ${isOn ? 'on' : ''}`}>{isOn && <Check className="w-3.5 h-3.5" />}</span>
                <div className="text-left flex-1 min-w-0">
                    <p className="font-mono text-xs font-semibold truncate">{asset.unique_serial_number || asset.serial_number}</p>
                    <p className="text-[11px] text-slate-600 truncate">{asset.model_name}</p>
                </div>
            </button>
            {block && (
                <p className="support-asset-blocked">
                    <AlertTriangle className="w-3 h-3 inline" /> Open #{block.id}
                </p>
            )}
        </div>
    );
}

function CreateNav({ step, setStep, customer, saving, selectedCount, ticketCategory }) {
    const isPickup = ticketCategory === 'pickup';
    const lastStep = isPickup ? 2 : 2;
    return (
        <div className="support-create-nav">
            {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className="support-btn-outline flex-1">Back</button>
            )}
            {step < lastStep ? (
                <button type="button" disabled={step === 0 && !customer} onClick={() => setStep(step + 1)} className="support-btn-primary flex-1">
                    Next
                </button>
            ) : !isPickup ? (
                <button type="submit" disabled={saving || !selectedCount} className="support-btn-primary flex-1">
                    {saving ? 'Saving…' : 'Create'}
                </button>
            ) : null}
        </div>
    );
}

export default function SupportTicketCreate() {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [step, setStep] = useState(0);
    const [ticketCategory, setTicketCategory] = useState('complaint');
    const [customerQuery, setCustomerQuery] = useState('');
    const [customers, setCustomers] = useState([]);
    const [customer, setCustomer] = useState(null);
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [selected, setSelected] = useState({});
    const [bulkRemarks, setBulkRemarks] = useState('');
    const [showRemarks, setShowRemarks] = useState(false);
    const [defaultAssignee, setDefaultAssignee] = useState('');
    const [showContactExtra, setShowContactExtra] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searching, setSearching] = useState(false);
    const [priority, setPriority] = useState('normal');
    const [ticketPhone, setTicketPhone] = useState('');
    const [ticketAltPhone, setTicketAltPhone] = useState('');
    const [ticketEmail, setTicketEmail] = useState('');
    const [ticketAddress, setTicketAddress] = useState('');
    const [blocked, setBlocked] = useState({});
    const [machineSearch, setMachineSearch] = useState('');

    useEffect(() => {
        api.get('/support/categories').then((r) => setCategories(r.data.categories || [])).catch(() => setCategories([]));
        api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || [])).catch(() => setTechnicians([]));
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
        setSelected({});
        setBlocked({});
        setMachineSearch('');
        setShowRemarks(false);
        setShowContactExtra(false);
        const [detailRes, assetsRes] = await Promise.all([
            api.get(`/support/customers/${c.customer_id}`),
            api.get(`/support/customers/${c.customer_id}/assets`)
        ]);
        const picked = detailRes.data.customer || c;
        setCustomer(picked);
        setTicketPhone(picked.contact_person_number || picked.customer_number || '');
        setTicketEmail(picked.email || '');
        setTicketAddress(formatAddress(picked.shipping_address || picked.billing_address) || '');
        setAssets(assetsRes.data.assets || []);
        if (isMobile) setStep(1);
    };

    const checkAsset = async (asset) => {
        if (!customer?.customer_id) return null;
        const serial = asset.unique_serial_number || asset.serial_number || '';
        try {
            const { data } = await api.get(
                `/support/tickets/check-duplicate?customer_id=${customer.customer_id}&serial=${encodeURIComponent(serial)}`
            );
            return data.duplicate;
        } catch {
            return null;
        }
    };

    const toggleAsset = async (asset) => {
        const id = String(asset.id);
        if (selected[id]) {
            setSelected((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            setBlocked((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            return;
        }
        const dup = await checkAsset(asset);
        if (dup) {
            setBlocked((prev) => ({ ...prev, [id]: dup }));
            return;
        }
        if (ticketCategory === 'pickup') {
            setSelected({ [id]: { asset, remarks: '', issue_category_id: '' } });
            return;
        }
        setSelected((prev) => ({
            ...prev,
            [id]: { asset, remarks: '', issue_category_id: '' }
        }));
    };

    const updateMachineRemarks = (id, patch) => {
        setSelected((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    };

    const selectedList = useMemo(() => Object.values(selected), [selected]);
    const selectedCount = selectedList.length;
    const firstSelectedId = Object.keys(selected)[0];

    const filteredAssets = useMemo(() => {
        const q = machineSearch.trim().toLowerCase();
        if (!q) return assets;
        return assets.filter((asset) => {
            const haystack = [
                asset.unique_serial_number,
                asset.serial_number,
                asset.model_name,
                asset.ram,
                asset.storage,
                asset.generation,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [assets, machineSearch]);

    const pickupTicketStub = useMemo(() => {
        if (!customer) return null;
        return {
            customer_id: customer.customer_id,
            customer_name: customer.customer_name,
            customer_phone: ticketPhone,
            display_phone: ticketPhone,
            ticket_phone_override: ticketPhone,
        };
    }, [customer, ticketPhone]);

    const validateSupportPhones = () => {
        const phoneErr = indianMobileError(ticketPhone, { label: 'Phone' });
        if (phoneErr) return phoneErr;
        const altErr = indianMobileError(ticketAltPhone, { label: 'Alternate phone' });
        if (altErr) return altErr;
        return null;
    };

    const normalizedTicketPhone = () => (ticketPhone?.trim() ? normalizeIndianMobile(ticketPhone) : '');
    const normalizedAltPhone = () => (ticketAltPhone?.trim() ? normalizeIndianMobile(ticketAltPhone) : '');

    const submitPickupTicket = async (pickupPayload) => {
        if (!customer || !selectedCount) {
            alert('Select at least one laptop');
            return;
        }
        const phoneValidationError = validateSupportPhones();
        if (phoneValidationError) {
            alert(phoneValidationError);
            return;
        }
        setSaving(true);
        try {
            const machines = selectedList.map(({ asset }) => ({
                serial_number: asset.serial_number,
                unique_serial_number: asset.unique_serial_number,
                ttspl_id: asset.unique_serial_number,
                brand: asset.model_name?.split(' ')[0] || '',
                model: asset.model_name,
                ram: asset.ram,
                storage: asset.storage,
                generation: asset.generation,
            }));
            const { data } = await api.post('/support/tickets/pickup-ticket', {
                customer_id: customer.customer_id,
                customer_name: customer.customer_name,
                customer_phone: normalizedTicketPhone() || customer.contact_person_number || customer.customer_number,
                priority,
                ticket_phone_override: normalizedTicketPhone(),
                ticket_alt_phone: normalizedAltPhone() || null,
                ticket_email: ticketEmail,
                ticket_address: ticketAddress,
                machines,
                ...pickupPayload,
            });
            navigate(`/support/tickets/${data.ticket.id}`);
        } catch (err) {
            alert(err.response?.data?.message || 'Failed to create pickup ticket');
        } finally {
            setSaving(false);
        }
    };

    const buildItems = () =>
        selectedList.map(({ asset, remarks, issue_category_id }) => {
            const cat = categories.find((c) => String(c.id) === String(issue_category_id));
            return {
                // Deployed assets come from vendor_serial_numbers, not customer_inventory.
                customer_inventory_id: null,
                serial_number: asset.serial_number,
                unique_serial_number: asset.unique_serial_number,
                model: asset.model_name,
                brand: asset.model_name?.split(' ')[0] || '',
                ram: asset.ram,
                storage: asset.storage,
                generation: asset.generation,
                item_type: ticketCategory,
                issue_category_id: issue_category_id ? Number(issue_category_id) : null,
                issue_category_label: cat?.name || null,
                remarks: showRemarks ? (bulkRemarks || remarks) : '',
                assigned_to: defaultAssignee ? Number(defaultAssignee) : null
            };
        });

    const submit = async (e) => {
        e.preventDefault();
        if (ticketCategory === 'pickup') return;
        if (!customer) {
            alert('Select a customer');
            return;
        }
        if (!selectedCount) {
            alert('Select at least one machine');
            return;
        }
        const phoneValidationError = validateSupportPhones();
        if (phoneValidationError) {
            alert(phoneValidationError);
            return;
        }
        setSaving(true);
        try {
            const { data } = await api.post('/support/tickets', {
                customer_id: customer.customer_id,
                customer_name: customer.customer_name,
                customer_phone: customer.contact_person_number || customer.customer_number,
                ticket_category: ticketCategory,
                priority,
                ticket_phone_override: normalizedTicketPhone(),
                ticket_alt_phone: normalizedAltPhone() || null,
                ticket_email: ticketEmail,
                ticket_address: ticketAddress,
                items: buildItems()
            });
            navigate(`/support/tickets/${data.ticket.id}`);
        } catch (err) {
            const dup = err.response?.data?.duplicate;
            alert(
                dup
                    ? `Cannot create: machine already on open ticket #${dup.id}`
                    : err.response?.data?.message || 'Failed to create ticket'
            );
        } finally {
            setSaving(false);
        }
    };

    const customerStep = (
        <section className="support-create-section support-create-section-compact">
            <h2 className="support-create-section-title">Customer</h2>
            <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="support-field support-field-compact"
                placeholder="Search name, phone, or ID"
            />
            {searching && <Loader2 className="w-5 h-5 animate-spin text-[var(--support-primary)]" />}
            {customers.length > 0 && (
                <ul className="support-customer-list">
                    {customers.map((c) => (
                        <li key={c.customer_id}>
                            <button type="button" onClick={() => pickCustomer(c)} className="support-customer-pick">
                                <span className="font-medium">{c.customer_name}</span>
                                <span className="text-xs text-slate-500">#{c.customer_id}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {customer && (
                <CustomerCard
                    customer={customer}
                    ticketPhone={ticketPhone}
                    setTicketPhone={setTicketPhone}
                    ticketAltPhone={ticketAltPhone}
                    setTicketAltPhone={setTicketAltPhone}
                    ticketEmail={ticketEmail}
                    setTicketEmail={setTicketEmail}
                    ticketAddress={ticketAddress}
                    setTicketAddress={setTicketAddress}
                    priority={priority}
                    setPriority={setPriority}
                    showContactExtra={showContactExtra}
                    setShowContactExtra={setShowContactExtra}
                    onClear={() => {
                        setCustomer(null);
                        setSelected({});
                        setBlocked({});
                        setMachineSearch('');
                    }}
                />
            )}
        </section>
    );

    const categoryStep = (
        <section className="support-create-section support-create-section-compact">
            <h2 className="support-create-section-title">Type</h2>
            <CategoryChips ticketCategory={ticketCategory} setTicketCategory={setTicketCategory} />
        </section>
    );

    const machinesStep = (
        <section className="support-create-section support-create-section-compact">
            <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="support-create-section-title m-0">Machines</h2>
                <span className={`support-category-label ${ticketCategory}`}>{ticketCategory}</span>
            </div>

            {selectedCount > 0 && ticketCategory !== 'pickup' && (
                <div className="support-bulk-bar support-bulk-bar-compact">
                    <label className="support-label-compact flex-1">
                        <span className="support-label-text">Technician</span>
                        <select className="support-field support-field-compact" value={defaultAssignee} onChange={(e) => setDefaultAssignee(e.target.value)}>
                            <option value="">Unassigned</option>
                            {technicians.map((t) => (
                                <option key={t.user_id} value={t.user_id}>
                                  {assigneeOptionLabel(t)}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}

            {assets.length > 0 && (
                <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                        type="search"
                        value={machineSearch}
                        onChange={(e) => setMachineSearch(e.target.value)}
                        className="support-field support-field-compact w-full pl-9"
                        placeholder="Search TTSPL, serial, model…"
                    />
                </div>
            )}

            {!assets.length && (
                <p className="support-empty-msg">
                    No delivered machines for this customer. Only laptops already delivered (rented, demo, or sold) can have support tickets — not in-transit or reserved units.
                </p>
            )}
            {assets.length > 0 && !filteredAssets.length && (
                <p className="support-empty-msg">No machines match your search.</p>
            )}

            <div className="support-asset-grid support-asset-grid-compact">
                {filteredAssets.map((asset) => {
                    const id = String(asset.id);
                    return (
                        <AssetCard
                            key={id}
                            asset={asset}
                            isOn={!!selected[id]}
                            block={blocked[id]}
                            onToggle={() => toggleAsset(asset)}
                        />
                    );
                })}
            </div>

            {selectedCount > 0 && (
                <div className="support-optional-block">
                    <button type="button" className="support-optional-toggle" onClick={() => setShowRemarks((v) => !v)}>
                        {showRemarks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        Remarks (optional)
                    </button>
                    {showRemarks && (
                        <div className="support-optional-body">
                            <textarea
                                className="support-field support-field-compact w-full"
                                rows={2}
                                placeholder="Optional notes"
                                value={bulkRemarks}
                                onChange={(e) => setBulkRemarks(e.target.value)}
                            />
                            {ticketCategory === 'complaint' && selectedCount === 1 && firstSelectedId && (
                                <select
                                    className="support-field support-field-compact w-full mt-2"
                                    value={selected[firstSelectedId]?.issue_category_id || ''}
                                    onChange={(e) => updateMachineRemarks(firstSelectedId, { issue_category_id: e.target.value })}
                                >
                                    <option value="">Issue category (optional)</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}
                    <p className="support-selected-count">{selectedCount} selected{ticketCategory === 'pickup' ? ' — one Return DC for all selected laptops' : ''}</p>
                </div>
            )}

            {ticketCategory === 'pickup' && selectedCount >= 1 && pickupTicketStub && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                    <h3 className="support-create-section-title mb-3">Schedule pickup</h3>
                    <PickupSetupForm
                        ticket={pickupTicketStub}
                        customerId={customer?.customer_id}
                        selectedMachines={selectedList.map(({ asset }) => ({
                            serial_number: asset.serial_number,
                            unique_serial_number: asset.unique_serial_number,
                            ttspl_id: asset.unique_serial_number,
                            brand: asset.model_name?.split(' ')[0] || '',
                            model: asset.model_name,
                        }))}
                        onSubmit={submitPickupTicket}
                        saving={saving}
                        submitLabel={`Create Pickup Ticket + Return DC${selectedCount > 1 ? ` (${selectedCount} units)` : ''}`}
                    />
                </div>
            )}
        </section>
    );

    return (
        <form onSubmit={submit} className="support-create-page">
            <header className="support-create-header support-create-header-compact">
                <h1>New ticket</h1>
            </header>

            {isMobile ? (
                <>
                    <div className="support-create-steps">
                        {['Customer', 'Type', 'Machines'].map((label, i) => (
                            <span key={label} className={`support-create-step-dot ${step >= i ? 'done' : ''} ${step === i ? 'current' : ''}`}>
                                {label}
                            </span>
                        ))}
                    </div>
                    {step === 0 && customerStep}
                    {step === 1 && categoryStep}
                    {step === 2 && machinesStep}
                    {isMobile && ticketCategory === 'pickup' && step === 2 && selectedCount === 1 && pickupTicketStub && (
                        <div className="px-1 pb-2">
                            <PickupSetupForm
                                ticket={pickupTicketStub}
                                customerId={customer?.customer_id}
                                selectedAsset={selectedList[0]?.asset}
                                onSubmit={submitPickupTicket}
                                saving={saving}
                                submitLabel="Create Pickup Ticket + Return DC"
                            />
                        </div>
                    )}
                    <CreateNav step={step} setStep={setStep} customer={customer} saving={saving} selectedCount={selectedCount} ticketCategory={ticketCategory} />
                </>
            ) : (
                <>
                    {customerStep}
                    {categoryStep}
                    {machinesStep}
                    {ticketCategory !== 'pickup' && (
                        <button type="submit" disabled={saving || !customer || !selectedCount} className="support-btn-primary w-full sm:w-auto">
                            {saving ? 'Creating…' : `Create ticket (${selectedCount})`}
                        </button>
                    )}
                </>
            )}
        </form>
    );
}
