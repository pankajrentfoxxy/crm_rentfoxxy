import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Truck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import VendorSearchSelect from '../../vendor-management/components/VendorSearchSelect';
import { fetchVendor } from '../../vendor-management/vendorManagementApi';
import { fetchDiagnosisFailedTickets, createOutForRepairDc } from '../vendorRepairApi';
import { ticketStatusLabel } from '../floorPipelineUi';

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export default function DiagnosisFailedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canProcess = WAREHOUSE_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vendor_id: '',
    vendor_name: '',
    vendor_address: '',
    contact_person: '',
    contact_mobile: '',
    expected_return_date: '',
    remarks: '',
    warehouse_name: '',
    warehouse_address: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchDiagnosisFailedTickets();
      setRows(data.data || []);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.ticket_id)));
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.ticket_id)),
    [rows, selected]
  );

  const onVendorChange = async (vendorId) => {
    if (!vendorId) {
      setForm((f) => ({ ...f, vendor_id: '' }));
      return;
    }
    try {
      const { data } = await fetchVendor(vendorId);
      const vendor = data?.data;
      setForm((f) => ({
        ...f,
        vendor_id: vendorId,
        vendor_name: vendor?.business_name || vendor?.f_name || f.vendor_name,
        vendor_address: [vendor?.address, vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(', ') || f.vendor_address,
        contact_person: vendor?.contact_person || vendor?.f_name || f.contact_person,
        contact_mobile: vendor?.mobile || vendor?.phone || f.contact_mobile,
      }));
    } catch {
      setForm((f) => ({ ...f, vendor_id: vendorId }));
    }
  };

  const submitOutForRepair = async () => {
    if (!selectedRows.length) {
      toast.error('Select at least one laptop');
      return;
    }
    if (!form.vendor_name.trim() || !form.vendor_address.trim()) {
      toast.error('Vendor name and address are required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await createOutForRepairDc({
        ticket_ids: selectedRows.map((r) => r.ticket_id),
        vendor_id: form.vendor_id || undefined,
        vendor_name: form.vendor_name.trim(),
        vendor_address: form.vendor_address.trim(),
        contact_person: form.contact_person.trim() || undefined,
        contact_mobile: form.contact_mobile.trim() || undefined,
        expected_return_date: form.expected_return_date || undefined,
        remarks: form.remarks.trim() || undefined,
        warehouse_name: form.warehouse_name.trim() || undefined,
        warehouse_address: form.warehouse_address.trim() || undefined,
      });
      toast.success(data.message || 'Vendor DC created');
      setModalOpen(false);
      navigate(`/floor-pipeline/vendor-repair-dc/${encodeURIComponent(data.dc_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create DC');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Diagnosis Failed</h1>
          <p className="text-sm text-slate-500">Laptops requiring external vendor diagnosis or repair</p>
        </div>
        {canProcess ? (
          <button
            type="button"
            disabled={!selected.size}
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            <Truck className="w-4 h-4" />
            Out for Repair ({selected.size || 0})
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {canProcess ? (
                  <th className="p-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                  </th>
                ) : null}
                <th className="p-3">Ticket</th>
                <th className="p-3">TTSPL</th>
                <th className="p-3">Configuration</th>
                <th className="p-3">Status</th>
                <th className="p-3">Failure reason</th>
                <th className="p-3">Location</th>
                <th className="p-3">Created</th>
                <th className="p-3">Prev. technician</th>
                <th className="p-3">Prev. stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticket_id} className="border-t hover:bg-slate-50/80">
                  {canProcess ? (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.ticket_id)}
                        onChange={() => toggleOne(r.ticket_id)}
                        aria-label={`Select ticket ${r.ticket_id}`}
                      />
                    </td>
                  ) : null}
                  <td className="p-3">
                    <Link to={`/floor-pipeline/tickets/${r.ticket_id}`} className="font-mono text-blue-700 hover:underline">
                      #{r.ticket_id}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{r.ttspl_id || '—'}</td>
                  <td className="p-3 text-xs max-w-[220px]">{r.configuration || '—'}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900">
                      {ticketStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="p-3 text-xs max-w-[200px]">{r.diagnosis_failed_reason || '—'}</td>
                  <td className="p-3 text-xs">{r.current_location || '—'}</td>
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-3 text-xs">{r.previous_technician_name || '—'}</td>
                  <td className="p-3 text-xs">{r.previous_stage_name || '—'}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={canProcess ? 10 : 9} className="p-8 text-center text-slate-500">
                    No laptops in Diagnosis Failed
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Out for Repair</h2>
            <p className="text-xs text-slate-500">{selectedRows.length} laptop(s) selected — a Vendor Delivery Challan will be generated.</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
              <VendorSearchSelect value={form.vendor_id} onChange={onVendorChange} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor name</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor address</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[70px]" value={form.vendor_address} onChange={(e) => setForm({ ...form, vendor_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contact person</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mobile</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.contact_mobile} onChange={(e) => setForm({ ...form, contact_mobile: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expected return date</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.expected_return_date} onChange={(e) => setForm({ ...form, expected_return_date: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[60px]" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={submitOutForRepair} className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Creating…' : 'Generate Vendor DC'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
