import React, { useState, useEffect } from 'react';
import {
    Package, Search, Plus, AlertTriangle,
    MapPin, Edit2, Archive, X
} from 'lucide-react';
import api from '../utils/api';

// Create/Edit Modal Component
function PartModal({ isOpen, onClose, onSave, initialData }) {
    const [formData, setFormData] = useState({
        part_name: '',
        part_type: 'general',
        quantity: 0,
        vendor: '',
        cost: '',
        location_code: ''
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData({ part_name: '', part_type: 'general', quantity: 0, vendor: '', cost: '', location_code: '' });
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        await onSave(formData);
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex justify-between items-start mb-6">
                    <h3 className="text-xl font-bold">{initialData ? 'Edit Part' : 'Add New Part'}</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Part Name</label>
                        <input
                            type="text" required
                            className="w-full border rounded-lg p-2"
                            value={formData.part_name}
                            onChange={e => setFormData({ ...formData, part_name: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select
                                className="w-full border rounded-lg p-2"
                                value={formData.part_type}
                                onChange={e => setFormData({ ...formData, part_type: e.target.value })}
                            >
                                <option value="general">General</option>
                                <option value="display">Display</option>
                                <option value="battery">Battery</option>
                                <option value="keyboard">Keyboard</option>
                                <option value="storage">Storage</option>
                                <option value="memory">RAM</option>
                                <option value="cooling">Cooling</option>
                                <option value="input">Touchpad/Input</option>
                                <option value="camera">Camera</option>
                                <option value="network">Network</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Location Code</label>
                            <input
                                type="text"
                                className="w-full border rounded-lg p-2 font-mono"
                                placeholder="ABC-123"
                                value={formData.location_code || ''}
                                onChange={e => setFormData({ ...formData, location_code: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                            <input
                                type="number" min="0" required
                                className="w-full border rounded-lg p-2"
                                value={formData.quantity}
                                onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
                                disabled={initialData} // Use restock for updates
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cost (₹)</label>
                            <input
                                type="number" step="0.01" min="0"
                                className="w-full border rounded-lg p-2"
                                value={formData.cost}
                                onChange={e => setFormData({ ...formData, cost: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                        <input
                            type="text"
                            className="w-full border rounded-lg p-2"
                            value={formData.vendor || ''}
                            onChange={e => setFormData({ ...formData, vendor: e.target.value })}
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                        <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            {loading ? 'Saving...' : 'Save Part'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Restock Modal
function RestockModal({ isOpen, onClose, onSave, part }) {
    const [quantity, setQuantity] = useState(0);
    const [loading, setLoading] = useState(false);

    if (!isOpen || !part) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        await onSave(part.part_id, quantity);
        setLoading(false);
        setQuantity(0);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                <h3 className="text-xl font-bold mb-2">Update Stock</h3>
                <p className="text-gray-600 mb-6">Updating inventory for <span className="font-bold text-gray-900">{part.part_name}</span></p>

                <form onSubmit={handleSubmit}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Adjustment (+/-)</label>
                    <input
                        type="number" required autoFocus
                        className="w-full border rounded-lg p-3 text-lg mb-6"
                        placeholder="+5 or -2"
                        value={quantity}
                        onChange={e => setQuantity(parseInt(e.target.value))}
                    />

                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                        <button type="submit" disabled={loading} className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                            Update
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Main Component
export default function PartsInventory() {
    const [parts, setParts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPart, setEditingPart] = useState(null);
    const [restockingPart, setRestockingPart] = useState(null);

    useEffect(() => {
        loadParts();
    }, []);

    const loadParts = async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/parts');
            setParts(data.parts);
        } catch (error) {
            console.error('Failed to load parts:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUpdate = async (data) => {
        try {
            if (editingPart) {
                await api.put(`/parts/${editingPart.part_id}`, data);
            } else {
                await api.post('/parts', data);
            }
            loadParts();
            setShowAddModal(false);
            setEditingPart(null);
        } catch (error) {
            alert('Failed to save part: ' + error.message);
        }
    };

    const handleRestock = async (id, qty) => {
        try {
            await api.put(`/parts/${id}/quantity`, { quantity: qty });
            loadParts();
            setRestockingPart(null);
        } catch (error) {
            alert('Failed to update stock: ' + error.message);
        }
    };

    const filteredParts = parts.filter(p =>
        p.part_name.toLowerCase().includes(search.toLowerCase()) ||
        p.location_code?.toLowerCase().includes(search.toLowerCase()) ||
        p.part_type.toLowerCase().includes(search.toLowerCase())
    );

    // Stats
    const totalItems = parts.reduce((sum, p) => sum + p.quantity, 0);
    const lowStock = parts.filter(p => p.quantity > 0 && p.quantity < 5).length;
    const outOfStock = parts.filter(p => p.quantity === 0).length;

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Loading inventory...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold">Parts Inventory</h2>
                    <p className="text-gray-600">Manage procurement and assembly stock</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" /> Add Part
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-4">
                    <div className="p-3 bg-blue-100 rounded-lg"><Package className="w-6 h-6 text-blue-600" /></div>
                    <div>
                        <div className="text-2xl font-bold text-blue-900">{totalItems}</div>
                        <div className="text-sm text-blue-600">Total Items in Stock</div>
                    </div>
                </div>
                <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 flex items-center gap-4">
                    <div className="p-3 bg-yellow-100 rounded-lg"><AlertTriangle className="w-6 h-6 text-yellow-600" /></div>
                    <div>
                        <div className="text-2xl font-bold text-yellow-900">{lowStock}</div>
                        <div className="text-sm text-yellow-600">Low Stock Items</div>
                    </div>
                </div>
                <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-4">
                    <div className="p-3 bg-red-100 rounded-lg"><Archive className="w-6 h-6 text-red-600" /></div>
                    <div>
                        <div className="text-2xl font-bold text-red-900">{outOfStock}</div>
                        <div className="text-sm text-red-600">Out of Stock</div>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search by part name, type, or location code..."
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 font-semibold text-gray-600">Part Info</th>
                            <th className="px-6 py-4 font-semibold text-gray-600">Location</th>
                            <th className="px-6 py-4 font-semibold text-gray-600">Stock Level</th>
                            <th className="px-6 py-4 font-semibold text-gray-600">Value</th>
                            <th className="px-6 py-4 text-right font-semibold text-gray-600">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredParts.map(part => (
                            <tr key={part.part_id} className="hover:bg-gray-50">
                                <td className="px-6 py-4">
                                    <div className="font-bold text-gray-900">{part.part_name}</div>
                                    <div className="text-xs text-gray-500 capitalize">{part.part_type} • {part.vendor}</div>
                                </td>
                                <td className="px-6 py-4">
                                    {part.location_code ? (
                                        <div className="flex items-center gap-1 font-mono text-sm bg-gray-100 w-fit px-2 py-1 rounded">
                                            <MapPin className="w-3 h-3 text-gray-500" />
                                            {part.location_code}
                                        </div>
                                    ) : (
                                        <span className="text-gray-400 text-sm italic">No Loc.</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${part.quantity === 0 ? 'bg-red-100 text-red-700' :
                                            part.quantity < 5 ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-green-100 text-green-700'
                                            }`}>
                                            {part.quantity} units
                                        </span>
                                        {part.quantity === 0 && <span className="text-red-500 text-xs font-medium">Restock Needed</span>}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-gray-600">
                                    ₹{part.cost}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setRestockingPart(part)}
                                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg tooltip"
                                            title="Update Stock"
                                        >
                                            <Archive className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => { setEditingPart(part); setShowAddModal(true); }}
                                            className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg"
                                            title="Edit Details"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredParts.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                    No parts found matching your search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add/Edit Modal */}
            <PartModal
                isOpen={showAddModal}
                onClose={() => { setShowAddModal(false); setEditingPart(null); }}
                onSave={handleCreateUpdate}
                initialData={editingPart}
            />

            {/* Restock Modal */}
            <RestockModal
                isOpen={!!restockingPart}
                onClose={() => setRestockingPart(null)}
                onSave={handleRestock}
                part={restockingPart}
            />
        </div>
    );
}
