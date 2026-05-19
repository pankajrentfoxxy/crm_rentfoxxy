import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus, ShoppingCart, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useLocation } from 'react-router-dom';

export default function Sales({ api }) {
    const location = useLocation();
    const [specs, setSpecs] = useState({ brands: [], processors: [], generations: [], rams: [], storages: [], models: [], gpus: [], screen_sizes: [] });
    const [filters, setFilters] = useState({ brand: '', processor: '', generation: '', ram: '', storage: '', model: '', gpu: '', screen_size: '' });
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [cart, setCart] = useState([]);
    const [manualItem, setManualItem] = useState({ brand: '', processor: '', generation: '', ram: '', storage: '', model: '', quantity: 1, unit_price: '' });
    const [catalogOptions, setCatalogOptions] = useState({ brands: [], processors: [], generations: [], rams: [], storages: [], models: [] });
    const [customerId, setCustomerId] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const [customers, setCustomers] = useState([]);
    const [customer, setCustomer] = useState({ name: '', email: '', phone: '', gst_no: '' });
    const [linkedCustomerId, setLinkedCustomerId] = useState(null);
    const [customerAddresses, setCustomerAddresses] = useState([]);
    const [message, setMessage] = useState('');
    const [orderType, setOrderType] = useState('Rent');
    const [lockinMonths, setLockinMonths] = useState(0);
    const [securityAmount, setSecurityAmount] = useState(0);
    const [useRentAsSecurity, setUseRentAsSecurity] = useState(false);
    const [orderEstimateId, setOrderEstimateId] = useState('');
    const [showCustomerSection, setShowCustomerSection] = useState(true);
    const [showProcurement, setShowProcurement] = useState(false);
    const GST_PERCENT = 18;

    const loadSpecs = useCallback(async () => {
        try {
            const { data } = await api.get('/inventory/specs');
            setSpecs(data.specs || { brands: [], processors: [], generations: [], rams: [], storages: [], models: [], gpus: [], screen_sizes: [] });
        } catch (err) {
            console.error(err);
        }
    }, [api]);

    const loadCustomers = useCallback(async (searchTerm = '') => {
        try {
            const params = (searchTerm || customerSearch).trim() ? `?search=${encodeURIComponent((searchTerm || customerSearch).trim())}` : '';
            const { data } = await api.get(`/sales/customers${params}`);
            setCustomers(data.customers || []);
        } catch (err) {
            console.error(err);
        }
    }, [api, customerSearch]);

    const loadCatalogOptions = useCallback(async (selected = {}) => {
        try {
            const params = new URLSearchParams();
            ['brand', 'processor', 'generation', 'ram', 'storage', 'model'].forEach((key) => {
                if (selected[key]) params.append(key, selected[key]);
            });
            const query = params.toString();
            const { data } = await api.get(`/inventory/catalog/options${query ? `?${query}` : ''}`);
            setCatalogOptions(data.options || { brands: [], processors: [], generations: [], rams: [], storages: [], models: [] });
        } catch (err) {
            console.error(err);
        }
    }, [api]);

    useEffect(() => {
        loadSpecs();
        loadCatalogOptions();
        const params = new URLSearchParams(location.search);
        const custParam = params.get('customerId');
        if (custParam) setCustomerId(custParam);
    }, [loadSpecs, loadCatalogOptions, location.search]);

    useEffect(() => {
        const t = setTimeout(() => loadCustomers(customerSearch), customerSearch ? 300 : 0);
        return () => clearTimeout(t);
    }, [customerSearch, loadCustomers]);

    useEffect(() => {
        if (!customerId) {
            setLinkedCustomerId(null);
            setCustomerAddresses([]);
            setCustomer({ name: '', email: '', phone: '', gst_no: '' });
            return;
        }
        const cust = customers.find(c => String(c.customer_id) === String(customerId));
        if (cust) {
            setLinkedCustomerId(cust.customer_id);
            setCustomer({
                name: cust.company_name || cust.name || '',
                email: cust.email || '',
                phone: cust.phone || '',
                gst_no: cust.gst_no || ''
            });
            setCustomerAddresses(cust.addresses || []);
        } else {
            api.get(`/sales/customers/${customerId}`).then(({ data }) => {
                const c = data.customer;
                if (c) {
                    setLinkedCustomerId(c.customer_id);
                    setCustomer({
                        name: c.company_name || c.name || '',
                        email: c.email || '',
                        phone: c.phone || '',
                        gst_no: c.gst_no || ''
                    });
                    setCustomerAddresses(c.addresses || []);
                }
            }).catch(() => {});
        }
    }, [customerId, customers, api]);

    useEffect(() => {
        if (!customerAddresses.length) return;
        const defaultAddress = customerAddresses.find((row) => row.is_head_office) || customerAddresses[0];
        if (!defaultAddress) return;
        setCart((prev) => prev.map((item) => {
            if ((item.delivery_mode || 'Office') === 'WFH') return item;
            if (item.customer_address_id) return item;
            return { ...item, customer_address_id: String(defaultAddress.customer_address_id) };
        }));
    }, [customerAddresses]);


    const handleSearch = async () => {
        setLoading(true);
        setMessage('');
        try {
            const params = new URLSearchParams(filters);
            const { data } = await api.get(`/inventory/available?${params.toString()}`);
            setResults(data.items || []);
        } catch (err) {
            setMessage('Search failed');
        } finally {
            setLoading(false);
        }
    };

    const addToCart = (item) => {
        setCart((prev) => {
            const key = `${item.brand || ''}|${item.model || item.preferred_model || ''}|${item.generation || ''}|${item.processor || ''}|${item.ram || ''}|${item.storage || ''}|${item.gpu || ''}|${item.screen_size || ''}`;
            const existingIndex = prev.findIndex((row) => {
                const rowKey = `${row.brand || ''}|${row.model || row.preferred_model || ''}|${row.generation || ''}|${row.processor || ''}|${row.ram || ''}|${row.storage || ''}|${row.gpu || ''}|${row.screen_size || ''}`;
                return rowKey === key && !row.manual;
            });

            if (existingIndex === -1) {
                return [
                    ...prev,
                    {
                        ...item,
                        quantity: 1,
                        unit_price: item.unit_price || '',
                        maxQty: item.available_count || 1,
                        delivery_mode: 'Office',
                        customer_address_id: '',
                        delivery_contact_name: '',
                        delivery_contact_phone: '',
                        delivery_address: '',
                        delivery_pincode: '',
                        proposed_delivery_date: '',
                        is_wfh: false,
                        shipping_charge: 0,
                        estimate_id: '',
                        destination_pincode: ''
                    }
                ];
            }

            return prev.map((row, idx) => {
                if (idx !== existingIndex) return row;
                const currentQty = parseInt(row.quantity, 10) || 1;
                const maxQty = parseInt(row.maxQty, 10) || 1;
                const nextQty = Math.min(currentQty + 1, maxQty);
                return { ...row, quantity: nextQty };
            });
        });
    };

    const removeFromCart = (index) => {
        setCart(prev => prev.filter((_, idx) => idx !== index));
    };

    const handleAddManual = () => {
        if (!manualItem.brand || !manualItem.processor || !manualItem.generation || !manualItem.ram || !manualItem.storage) {
            setMessage('Brand, processor, generation, RAM, and storage are required for manual item');
            return;
        }
        setCart(prev => [
            ...prev,
            {
                ...manualItem,
                manual: true,
                delivery_mode: 'Office',
                customer_address_id: '',
                delivery_contact_name: '',
                delivery_contact_phone: '',
                delivery_address: '',
                delivery_pincode: '',
                proposed_delivery_date: '',
                is_wfh: false,
                shipping_charge: 0,
                estimate_id: '',
                destination_pincode: ''
            }
        ]);
        setManualItem({ brand: '', processor: '', generation: '', ram: '', storage: '', model: '', quantity: 1, unit_price: '' });
    };

    const buildOrderItems = useMemo(() => {
        return cart.map(item => ({
            brand: item.brand,
            processor: item.processor,
            generation: item.generation || null,
            ram: item.ram,
            storage: item.storage,
            quantity: parseInt(item.quantity, 10) || 1,
            model: [item.model || item.preferred_model || '', item.generation ? `Gen ${item.generation}` : ''].filter(Boolean).join(' ').trim(),
            unit_price: item.unit_price || 0,
            inventory_ids: item.inventory_ids ? item.inventory_ids.slice(0, parseInt(item.quantity, 10) || 1) : undefined,
            delivery_mode: item.delivery_mode || (item.is_wfh ? 'WFH' : 'Office'),
            customer_address_id: item.delivery_mode === 'WFH' ? null : (item.customer_address_id && !isNaN(parseInt(item.customer_address_id, 10)) ? parseInt(item.customer_address_id, 10) : null),
            is_wfh: item.delivery_mode === 'WFH',
            shipping_charge: item.delivery_mode === 'WFH' ? (parseFloat(item.shipping_charge) || 0) : 0,
            delivery_contact_name: item.delivery_mode === 'WFH' ? (item.delivery_contact_name || '') : '',
            delivery_contact_phone: item.delivery_mode === 'WFH' ? (item.delivery_contact_phone || '') : '',
            delivery_address: item.delivery_mode === 'WFH' ? (item.delivery_address || '') : '',
            delivery_pincode: item.delivery_mode === 'WFH' ? (item.delivery_pincode || '') : '',
            proposed_delivery_date: item.proposed_delivery_date || null
        }));
    }, [cart]);

    const subtotal = useMemo(
        () => cart.reduce((sum, item) => sum + ((parseFloat(item.unit_price) || 0) * (parseInt(item.quantity, 10) || 1)), 0),
        [cart]
    );
    const itemsGst = useMemo(() => subtotal * 0.18, [subtotal]);
    const shippingSubtotal = useMemo(
        () => cart.reduce((sum, item) => sum + ((item.delivery_mode === 'WFH') ? (parseFloat(item.shipping_charge) || 0) : 0), 0),
        [cart]
    );
    const shippingGst = useMemo(() => shippingSubtotal * 0.18, [shippingSubtotal]);
    const effectiveSecurity = useMemo(
        () => useRentAsSecurity ? subtotal : (parseFloat(securityAmount) || 0),
        [useRentAsSecurity, subtotal, securityAmount]
    );
    const grandTotal = useMemo(
        () => subtotal + itemsGst + effectiveSecurity + shippingSubtotal + shippingGst,
        [subtotal, itemsGst, effectiveSecurity, shippingSubtotal, shippingGst]
    );

    const handleCreateOrder = async () => {
        if (!customer.name) {
            setMessage('Customer name is required');
            return;
        }
        if (cart.length === 0) {
            setMessage('Add at least one item to cart');
            return;
        }
        for (const [idx, item] of cart.entries()) {
            const mode = item.delivery_mode || 'Office';
            if (mode === 'Office' && !item.customer_address_id) {
                setMessage(`Select office address for laptop #${idx + 1}`);
                return;
            }
            if (mode === 'WFH') {
                if (!item.delivery_contact_name || !item.delivery_contact_phone || !item.delivery_address || !item.delivery_pincode) {
                    setMessage(`WFH details missing for laptop #${idx + 1}`);
                    return;
                }
                if ((parseFloat(item.shipping_charge) || 0) <= 0) {
                    setMessage(`WFH shipping charge required for laptop #${idx + 1}`);
                    return;
                }
            }
        }
        try {
            let custId = linkedCustomerId;
            if (!custId) {
                const customerRes = await api.post('/sales/customers', {
                    ...customer,
                    company_name: customer.name
                });
                custId = customerRes.data.customer?.customer_id;
            }
            if (!custId) {
                setMessage('Failed to create customer');
                return;
            }
            const lockinDays = Math.round((parseFloat(lockinMonths) || 0) * 30);
            const orderRes = await api.post('/sales/orders', {
                customer_id: custId,
                lead_type: 'Direct',
                order_type: orderType,
                estimate_id: orderEstimateId || null,
                lockin_period_days: lockinDays,
                security_amount: useRentAsSecurity ? subtotal : (parseFloat(securityAmount) || 0),
                items: buildOrderItems
            });
            setMessage(`Order created: ${orderRes.data.order_id} (${orderRes.data.status})`);
            setCart([]);
            setOrderEstimateId('');
        } catch (err) {
            setMessage(err.response?.data?.message || 'Failed to create order');
        }
    };

    const handleManualSelectChange = async (field, value) => {
        const order = ['brand', 'processor', 'generation', 'ram', 'storage', 'model'];
        const resetMap = {};
        const fieldIdx = order.indexOf(field);
        order.forEach((name, idx) => {
            if (idx > fieldIdx) resetMap[name] = '';
        });
        const nextManual = { ...manualItem, ...resetMap, [field]: value };
        setManualItem(nextManual);
        const selected = {};
        order.forEach((name) => {
            if (nextManual[name]) selected[name] = nextManual[name];
        });
        await loadCatalogOptions(selected);
    };

    return (
        <div className="space-y-5 max-w-6xl mx-auto">
            <div>
                <h1 className="text-xl font-semibold text-slate-800">Sales Order Builder</h1>
                <p className="text-sm text-slate-500 mt-0.5">Search inventory and create orders. Select customer from Customer table.</p>
            </div>

            {message && (
                <div className="py-2.5 px-3 text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg">{message}</div>
            )}

            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                <button
                    onClick={() => setShowCustomerSection(!showCustomerSection)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                    <span className="flex items-center gap-2">
                        {showCustomerSection ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        Customer
                    </span>
                </button>
                {showCustomerSection && (
                <div className="px-4 pb-4 pt-0 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4">
                    <input
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Search customer by name, company, email, phone..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                    />
                    <select
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                    >
                        <option value="">Select Customer</option>
                        {customers.map(c => (
                            <option key={c.customer_id} value={c.customer_id}>
                                {(c.company_name || c.name)} {c.email ? `• ${c.email}` : ''}
                            </option>
                        ))}
                    </select>
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Customer Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="GST (optional)" value={customer.gst_no} onChange={(e) => setCustomer({ ...customer, gst_no: e.target.value })} />
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                        <option value="Rent">Rent</option>
                        <option value="Sales">Sales</option>
                        <option value="Demo">Demo</option>
                    </select>
                    <input
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Lock-in Period (months)"
                        type="number"
                        min="0"
                        step="0.5"
                        value={lockinMonths}
                        onChange={(e) => setLockinMonths(e.target.value)}
                    />
                    <div className="flex flex-col gap-1">
                        <input
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="Security Amount"
                            type="number"
                            min="0"
                            value={useRentAsSecurity ? subtotal : securityAmount}
                            onChange={(e) => setSecurityAmount(e.target.value)}
                            disabled={useRentAsSecurity}
                        />
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={useRentAsSecurity}
                                onChange={(e) => {
                                    setUseRentAsSecurity(e.target.checked);
                                    if (!e.target.checked) setSecurityAmount(0);
                                }}
                                className="rounded border-slate-300"
                            />
                            <span className="text-[10px] text-slate-500">Security = Rent total (excl. GST)</span>
                        </label>
                    </div>
                    <input
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        placeholder="Estimate ID"
                        value={orderEstimateId}
                        onChange={(e) => setOrderEstimateId(e.target.value)}
                    />
                </div>
                </div>
                )}
            </div>

            <div className="border border-slate-200 rounded-lg bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-slate-700">Search Available Inventory</h3>
                    <button onClick={handleSearch} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                        <Search className="w-4 h-4" /> Search
                    </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })}>
                        <option value="">Any Brand</option>
                        {specs.brands?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.processor} onChange={(e) => setFilters({ ...filters, processor: e.target.value })}>
                        <option value="">Any Processor</option>
                        {specs.processors?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.ram} onChange={(e) => setFilters({ ...filters, ram: e.target.value })}>
                        <option value="">Any RAM</option>
                        {specs.rams?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.storage} onChange={(e) => setFilters({ ...filters, storage: e.target.value })}>
                        <option value="">Any Storage</option>
                        {specs.storages?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.generation} onChange={(e) => setFilters({ ...filters, generation: e.target.value })}>
                        <option value="">Any Generation</option>
                        {specs.generations?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.model} onChange={(e) => setFilters({ ...filters, model: e.target.value })}>
                        <option value="">Any Model</option>
                        {specs.models?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.gpu} onChange={(e) => setFilters({ ...filters, gpu: e.target.value })}>
                        <option value="">Any GPU</option>
                        {specs.gpus?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={filters.screen_size} onChange={(e) => setFilters({ ...filters, screen_size: e.target.value })}>
                        <option value="">Any Screen Size</option>
                        {specs.screen_sizes?.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                </div>
                <div className="mt-4 bg-gray-50 border rounded-lg">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-gray-500">
                                <th className="p-2 text-left">Brand</th>
                                <th className="p-2 text-left">Model</th>
                                <th className="p-2 text-left">Processor</th>
                                <th className="p-2 text-left">Generation</th>
                                <th className="p-2 text-left">RAM</th>
                                <th className="p-2 text-left">Storage</th>
                                <th className="p-2 text-left">GPU</th>
                                <th className="p-2 text-left">Screen</th>
                                <th className="p-2 text-left">Available</th>
                                <th className="p-2 text-left">Unit Price</th>
                                <th className="p-2 text-left">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(item => (
                                <tr key={`${item.brand}-${item.model}-${item.processor}-${item.generation}-${item.ram}-${item.storage}-${item.gpu}-${item.screen_size}`} className="border-t">
                                    <td className="p-2">{item.brand}</td>
                                    <td className="p-2">{item.model || '-'}</td>
                                    <td className="p-2">{item.processor}</td>
                                    <td className="p-2">{item.generation || '-'}</td>
                                    <td className="p-2">{item.ram}</td>
                                    <td className="p-2">{item.storage}</td>
                                    <td className="p-2">{item.gpu || '-'}</td>
                                    <td className="p-2">{item.screen_size || '-'}</td>
                                    <td className="p-2 text-xs text-gray-500">{item.available_count}</td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            min="0"
                                            className="border rounded px-2 py-1 w-24"
                                            value={item.unit_price || ''}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setResults(prev => prev.map(r =>
                                                    r === item ? { ...r, unit_price: value } : r
                                                ));
                                            }}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <button onClick={() => addToCart(item)} className="text-xs text-blue-600 font-semibold">Add</button>
                                    </td>
                                </tr>
                            ))}
                            {results.length === 0 && !loading && (
                                <tr><td colSpan="11" className="p-3 text-center text-gray-500">No inventory found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                <button
                    onClick={() => setShowProcurement(!showProcurement)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                    <span className="flex items-center gap-2">
                        {showProcurement ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Plus className="w-4 h-4" />
                        Add Procurement Item (Out of Stock)
                    </span>
                </button>
                {showProcurement && (
                <div className="px-4 pb-4 pt-0 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-4">
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.brand} onChange={(e) => handleManualSelectChange('brand', e.target.value)}>
                        <option value="">Brand *</option>
                        {catalogOptions.brands.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.processor} onChange={(e) => handleManualSelectChange('processor', e.target.value)}>
                        <option value="">Processor *</option>
                        {catalogOptions.processors.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.generation} onChange={(e) => handleManualSelectChange('generation', e.target.value)}>
                        <option value="">Generation *</option>
                        {catalogOptions.generations.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.ram} onChange={(e) => handleManualSelectChange('ram', e.target.value)}>
                        <option value="">RAM *</option>
                        {catalogOptions.rams.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.storage} onChange={(e) => handleManualSelectChange('storage', e.target.value)}>
                        <option value="">Storage *</option>
                        {catalogOptions.storages.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={manualItem.model} onChange={(e) => handleManualSelectChange('model', e.target.value)}>
                        <option value="">Model (optional)</option>
                        {catalogOptions.models.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Qty" type="number" min="1" value={manualItem.quantity} onChange={(e) => setManualItem({ ...manualItem, quantity: e.target.value })} />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Unit Price ₹" value={manualItem.unit_price} onChange={(e) => setManualItem({ ...manualItem, unit_price: e.target.value })} />
                </div>
                <div className="mt-4">
                    <button onClick={handleAddManual} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                        <Plus className="w-4 h-4" /> Add to Cart
                    </button>
                </div>
                </div>
                )}
            </div>

            <div className="border border-slate-200 rounded-lg bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4" /> Cart Items
                    </h3>
                    <button onClick={handleCreateOrder} className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Create Order</button>
                </div>
                <div className="space-y-2">
                    {cart.map((item, index) => (
                        <div key={`${item.brand}-${index}`} className="flex items-center justify-between border rounded-lg p-2">
                            <div className="text-sm">
                                <div className="font-semibold">{item.brand} {item.processor}{item.generation ? ` ${item.generation}` : ''} {item.ram} {item.storage}</div>
                                <div className="text-xs text-gray-500">
                                    Gen: {item.generation || '-'} | {item.model || '-'} | Qty: {item.quantity}{item.maxQty ? ` / ${item.maxQty}` : ''} | Unit: ₹{item.unit_price || 0}
                                </div>
                                <div className="text-xs text-gray-500">
                                    GST {GST_PERCENT}%: ₹{((((parseFloat(item.unit_price) || 0) * (parseInt(item.quantity, 10) || 1)) * 0.18).toFixed(2))}
                                </div>
                                <div className="mt-2 grid grid-cols-1 md:grid-cols-7 gap-2">
                                    <select
                                        className="border rounded px-2 py-1 text-xs"
                                        value={item.delivery_mode || 'Office'}
                                        onChange={(e) => {
                                            const mode = e.target.value;
                                            const defaultAddress = customerAddresses.find((row) => row.is_head_office) || customerAddresses[0];
                                            setCart(prev => prev.map((cartItem, i) => i === index ? {
                                                ...cartItem,
                                                delivery_mode: mode,
                                                is_wfh: mode === 'WFH',
                                                customer_address_id: mode === 'Office' ? (cartItem.customer_address_id || (defaultAddress ? String(defaultAddress.customer_address_id) : '')) : '',
                                                shipping_charge: mode === 'WFH' ? (parseFloat(cartItem.shipping_charge) || 0) : 0,
                                                delivery_contact_name: mode === 'WFH' ? (cartItem.delivery_contact_name || '') : '',
                                                delivery_contact_phone: mode === 'WFH' ? (cartItem.delivery_contact_phone || '') : '',
                                                delivery_address: mode === 'WFH' ? (cartItem.delivery_address || '') : '',
                                                delivery_pincode: mode === 'WFH' ? (cartItem.delivery_pincode || '') : ''
                                            } : cartItem));
                                        }}
                                    >
                                        <option value="Office">Office</option>
                                        <option value="WFH">WFH</option>
                                    </select>
                                    {(item.delivery_mode || 'Office') === 'Office' ? (
                                        <>
                                            <select
                                                className="border rounded px-2 py-1 text-xs md:col-span-3"
                                                value={item.customer_address_id || ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, customer_address_id: value } : cartItem));
                                                }}
                                            >
                                                <option value="">Select office address</option>
                                                {customerAddresses.map((row) => (
                                                    <option key={row.customer_address_id} value={row.customer_address_id}>
                                                        {row.is_head_office ? '[Head Office] ' : ''}{row.concern_person || 'Contact'} - {row.address} {row.pincode ? `(${row.pincode})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                type="date"
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Delivery"
                                                value={item.proposed_delivery_date || ''}
                                                onChange={(e) => setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, proposed_delivery_date: e.target.value } : cartItem))}
                                                title="Customer proposed delivery date"
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <input
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Shipping charge"
                                                type="number"
                                                min="0"
                                                value={item.shipping_charge ?? 0}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, shipping_charge: value } : cartItem));
                                                }}
                                            />
                                            <input
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Name"
                                                value={item.delivery_contact_name || ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, delivery_contact_name: value } : cartItem));
                                                }}
                                            />
                                            <input
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Phone"
                                                value={item.delivery_contact_phone || ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, delivery_contact_phone: value } : cartItem));
                                                }}
                                            />
                                            <input
                                                className="border rounded px-2 py-1 text-xs md:col-span-2"
                                                placeholder="Address"
                                                value={item.delivery_address || ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, delivery_address: value } : cartItem));
                                                }}
                                            />
                                            <input
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Pincode"
                                                value={item.delivery_pincode || ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, delivery_pincode: value } : cartItem));
                                                }}
                                            />
                                            <input
                                                type="date"
                                                className="border rounded px-2 py-1 text-xs"
                                                placeholder="Delivery"
                                                value={item.proposed_delivery_date || ''}
                                                onChange={(e) => setCart(prev => prev.map((cartItem, i) => i === index ? { ...cartItem, proposed_delivery_date: e.target.value } : cartItem))}
                                                title="Customer proposed delivery date"
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => removeFromCart(index)} className="text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {cart.length === 0 && <div className="text-sm text-gray-500">No items in cart.</div>}
                </div>
                <div className="mt-4 border-t pt-3 text-sm text-gray-700 space-y-1">
                    <div>Subtotal: ₹{subtotal.toFixed(2)}</div>
                    <div>Items GST (18%): ₹{itemsGst.toFixed(2)}</div>
                    <div>Security Amount: ₹{effectiveSecurity.toFixed(2)}{useRentAsSecurity ? ' (Rent total)' : ''}</div>
                    <div>Shipping Charge (WFH items): ₹{shippingSubtotal.toFixed(2)}</div>
                    <div>Shipping GST (18%): ₹{shippingGst.toFixed(2)}</div>
                    <div className="font-bold">Grand Total: ₹{grandTotal.toFixed(2)}</div>
                </div>
            </div>
        </div>
    );
}
