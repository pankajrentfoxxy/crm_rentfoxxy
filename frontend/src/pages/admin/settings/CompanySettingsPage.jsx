import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

const FIELDS = [
  ['legal_name', 'Legal Name'],
  ['gstin', 'GSTIN'],
  ['pan', 'PAN'],
  ['state_code', 'State Code'],
  ['hsn_code', 'HSN Code'],
  ['address', 'Registered Address'],
  ['logo_url', 'Logo URL (uploads/...)'],
];

function CompanyCard({ company, onSaved }) {
  const [form, setForm] = useState(company);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/companies/${company.code}`, form);
      toast.success(`${company.code} updated`);
      onSaved(res.data?.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const isGore = company.code === 'gorefurbo';
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${isGore ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {company.code}
          </span>
          <span className="text-xs text-gray-500">
            DC: {company.dc_prefix} · INV: {company.invoice_prefix}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {isGore ? 'Sales' : 'Rental · Demo'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(([key, label]) => (
          <label key={key} className={`text-sm ${key === 'address' ? 'sm:col-span-2' : ''}`}>
            <span className="text-gray-500 text-xs">{label}</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              value={form[key] || ''}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <div className="flex justify-end mt-4">
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function CompanySettingsPage() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/companies');
      setCompanies(res.data?.data || []);
    } catch {
      toast.error('Failed to load companies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSaved = (updated) => {
    if (!updated) return;
    setCompanies((prev) => prev.map((c) => (c.code === updated.code ? updated : c)));
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Company / Entity Settings</h1>
      <p className="text-gray-500 text-sm mb-6">
        Each legal entity has its own GSTIN and document number series. Sales documents run under
        <strong> Gorefurbo</strong>; rental &amp; demo run under <strong>Rentfoxxy</strong>.
      </p>
      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {companies.map((c) => (
            <CompanyCard key={c.code} company={c} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
