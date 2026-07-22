import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { sendLeadQuotation, fetchQuotationEmailConfig } from '../leadCrmApi';
import { LAPTOP_BRANDS, PROCESSORS, GENERATIONS, RAM_OPTIONS, STORAGE_OPTIONS } from '../leadConstants';
import toast from 'react-hot-toast';

const emptyLine = () => ({
  brand: '', processor: '', generation: '', ram: '', storage: '', qty: 1, rate: '', total: 0,
});

const DEFAULT_TERMS = 'Prices are exclusive of GST. Quotation valid for 7 days from date of issue.';

export default function QuotationSendModal({ open, lead, onClose, onSent }) {
  const [toEmail, setToEmail] = useState('');
  const [cc, setCc] = useState('');
  const [mailPreview, setMailPreview] = useState({ from: '', defaultCc: [] });
  const [subject, setSubject] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [validity, setValidity] = useState('');
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead && open) {
      setToEmail(lead.email || '');
      setSubject(`Laptop Rental Quotation — ${lead.companyName || lead.name}`);
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setValidity(d.toISOString().slice(0, 10));
      setLines([{
        brand: lead.brand || '',
        processor: lead.processor || '',
        generation: lead.generation || '',
        ram: lead.ram || '',
        storage: lead.storage || '',
        qty: lead.quantityRequired || 1,
        rate: lead.monthlyBudget || '',
        total: (lead.quantityRequired || 1) * (Number(lead.monthlyBudget) || 0),
      }]);
      fetchQuotationEmailConfig()
        .then((res) => {
          const data = res.data || {};
          setCc((data.cc_recipients || []).join(', '));
          setMailPreview({
            from: data.from_address || '',
            defaultCc: data.default_cc || [],
          });
        })
        .catch(() => setCc(''));
    }
  }, [lead, open]);

  if (!open || !lead) return null;

  const updateLine = (idx, key, value) => {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, [key]: value };
      if (key === 'qty' || key === 'rate') {
        next.total = (Number(next.qty) || 0) * (Number(next.rate) || 0);
      }
      return next;
    }));
  };

  const handleSend = async () => {
    if (!toEmail.trim()) {
      toast.error('Customer email is required');
      return;
    }
    setSaving(true);
    try {
      const res = await sendLeadQuotation(lead.leadId, {
        to_email: toEmail,
        cc_recipients: cc ? cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean) : [],
        subject,
        line_items: lines,
        notes,
        validity_date: validity,
        terms,
        bill_to: {
          company_name: lead.companyName || lead.name,
          address: lead.billingAddress || lead.research?.address || 'Address required',
          gstin: lead.gstNumber || lead.research?.gst || '',
          email: toEmail,
          phone: lead.phone || '',
        },
        ship_same_as_bill: true,
      });
      toast.success(`Quotation ${res.data.estimate_no || ''} sent`);
      onSent?.(res.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send quotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Send Quotation</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Customer Email</label>
              <input value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500">CC recipients</label>
              <input value={cc} onChange={(e) => setCc(e.target.value)}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Default team CC — edit to remove anyone" />
              <p className="text-[10px] text-gray-500 mt-1">
                Default team CC: {(mailPreview.defaultCc || []).join(', ') || '—'}. Your email is included automatically unless you remove it.
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-gray-100 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  {['Brand', 'Processor', 'Gen', 'RAM', 'Storage', 'Qty', 'Rate/mo', 'Total', ''].map((h) => (
                    <th key={h} className="p-2 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-t border-gray-100">
                    <td className="p-1"><select value={line.brand} onChange={(e) => updateLine(idx, 'brand', e.target.value)} className="w-full border rounded px-1 py-1">{LAPTOP_BRANDS.map((b) => <option key={b}>{b}</option>)}</select></td>
                    <td className="p-1"><select value={line.processor} onChange={(e) => updateLine(idx, 'processor', e.target.value)} className="w-full border rounded px-1 py-1">{PROCESSORS.map((p) => <option key={p}>{p}</option>)}</select></td>
                    <td className="p-1"><select value={line.generation} onChange={(e) => updateLine(idx, 'generation', e.target.value)} className="w-full border rounded px-1 py-1">{GENERATIONS.map((g) => <option key={g}>{g}</option>)}</select></td>
                    <td className="p-1"><select value={line.ram} onChange={(e) => updateLine(idx, 'ram', e.target.value)} className="w-full border rounded px-1 py-1">{RAM_OPTIONS.map((r) => <option key={r}>{r}</option>)}</select></td>
                    <td className="p-1"><select value={line.storage} onChange={(e) => updateLine(idx, 'storage', e.target.value)} className="w-full border rounded px-1 py-1">{STORAGE_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select></td>
                    <td className="p-1"><input type="number" min="1" value={line.qty} onChange={(e) => updateLine(idx, 'qty', e.target.value)} className="w-14 border rounded px-1 py-1" /></td>
                    <td className="p-1"><input type="number" value={line.rate} onChange={(e) => updateLine(idx, 'rate', e.target.value)} className="w-20 border rounded px-1 py-1" /></td>
                    <td className="p-1 text-gray-600">{line.total}</td>
                    <td className="p-1">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((l) => l.filter((_, i) => i !== idx))}>
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setLines((l) => [...l, emptyLine()])}
              className="mt-2 flex items-center gap-1 text-sm text-blue-600">
              <Plus className="w-4 h-4" /> Add Row
            </button>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quotation notes"
            rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Validity</label>
              <input type="date" value={validity} onChange={(e) => setValidity(e.target.value)}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={handleSend} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Sending...' : 'Send Quotation'}
          </button>
        </div>
      </div>
    </div>
  );
}
