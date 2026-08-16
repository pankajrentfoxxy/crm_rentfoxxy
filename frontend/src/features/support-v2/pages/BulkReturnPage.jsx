import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { searchCustomers, getCustomerContext, getCustomerAssets, previewBulkReturn, createBulkReturn } from '../supportV2Api';
import { indianMobile, SUPPORT_V2_BASE } from '../supportV2Utils';

const STEPS = ['Customer & site', 'Assets', 'Lock-in', 'Schedule'];
const REASONS = [
  { value: 'END_OF_CONTRACT', label: 'End of contract' },
  { value: 'CUSTOMER_REQUEST', label: 'Customer requested' },
];

function lockInEnd(asset) {
  if (!asset.rent_start_date || !asset.locking_period) return null;
  const d = new Date(asset.rent_start_date);
  d.setMonth(d.getMonth() + Number(asset.locking_period));
  return d;
}

export default function BulkReturnPage() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [context, setContext] = useState(null);
  const [assets, setAssets] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [reason, setReason] = useState('END_OF_CONTRACT');
  const [selected, setSelected] = useState([]);
  const [capacity, setCapacity] = useState(25);
  const [targetDate, setTargetDate] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      searchCustomers(q.trim()).then((r) => setHits(r.data?.rows || [])).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pickCustomer = (c) => {
    setCustomer(c);
    setQ('');
    setHits([]);
    setSelected([]);
    getCustomerContext(c.customer_id).then((r) => setContext(r.data?.context || null)).catch(() => setContext(null));
    getCustomerAssets(c.customer_id).then((r) => setAssets(r.data?.rows || [])).catch(() => setAssets([]));
  };

  const atSite = assets;
  const selectedAssets = assets.filter((a) => selected.includes(a.serial_id));
  const runningValue = selectedAssets.reduce((s, a) => s + Number(a.rent_monthly_rate || 0), 0);
  const lockedAssets = selectedAssets.filter((a) => {
    const end = lockInEnd(a);
    return end && end > new Date();
  });

  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(customer && reason && indianMobile(customer.phone || context?.contacts?.[0]?.phone));
    if (step === 1) return selected.length > 0;
    return true;
  }, [step, customer, reason, selected, context]);

  const goNext = async () => {
    if (step === 2) {
      try {
        const r = await previewBulkReturn({
          customer_id: customer.customer_id,
          site_id: siteId || null,
          serial_ids: selected,
          vehicle_capacity: Number(capacity) || 25,
        });
        setPreview(r.data);
      } catch {
        setPreview({
          asset_count: selected.length,
          group_count: Math.ceil(selected.length / Math.max(1, Number(capacity) || 25)),
          vehicle_capacity: Number(capacity) || 25,
        });
      }
    }
    setStep((s) => s + 1);
  };

  const toggle = (id) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const r = await createBulkReturn({
        customer_id: customer.customer_id,
        site_id: siteId || null,
        reason,
        serial_ids: selected,
        target_date: targetDate || null,
        vehicle_capacity: Number(capacity) || 25,
        contact_name: customer.name || customer.company_name,
        contact_phone: customer.phone || context?.contacts?.[0]?.phone,
        contact_email: customer.email,
      });
      toast.success(`${r.data.asset_count} assets → ${r.data.group_count} work orders`);
      nav(`${SUPPORT_V2_BASE}/tickets/${r.data.ticket_id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Bulk return failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <PageHeader title="Bulk return" subtitle="One request ticket, work orders grouped by site and vehicle capacity." />
      <div className="flex gap-2 text-[12px]">
        {STEPS.map((label, i) => (
          <span key={label} className={`px-2 py-1 rounded ${i === step ? 'bg-sup-accentSoft text-sup-accent font-semibold' : 'text-sup-muted'}`}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-4 space-y-3 text-[13px]">
          <label className="block font-semibold">
            Customer *
            <input
              value={customer ? (customer.company_name || customer.name) : q}
              onChange={(e) => { setCustomer(null); setQ(e.target.value); }}
              placeholder="Search name, id, phone"
              className="mt-1 w-full rounded-md border border-sup-line px-2 py-1.5"
            />
          </label>
          {hits.map((c) => (
            <button key={c.customer_id} type="button" className="block text-left w-full py-1 underline" onClick={() => pickCustomer(c)}>
              {c.company_name || c.name} #{c.customer_id}
            </button>
          ))}
          <label className="block font-semibold">
            Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
              <option value="">All / unspecified</option>
              {(context?.sites || []).map((s) => (
                <option key={s.customer_address_id} value={s.customer_address_id}>
                  {s.address || s.pincode || s.customer_address_id}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold">
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          {context?.overdue_invoices > 0 && (
            <p className="text-pri1">This customer has {context.overdue_invoices} overdue invoice(s). Accounts will be notified — the return is not blocked.</p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-4 space-y-2 text-[13px]">
          <div className="flex justify-between items-center">
            <button type="button" className="underline text-sup-accent" onClick={() => setSelected(atSite.map((a) => a.serial_id))}>
              Select all at site
            </button>
            <span className="font-semibold">{selected.length} selected · ₹{runningValue.toLocaleString('en-IN')}/mo</span>
          </div>
          {atSite.map((a) => (
            <label key={a.serial_id} className="flex items-center gap-2 py-1 border-b border-sup-lineSoft">
              <input type="checkbox" checked={selected.includes(a.serial_id)} onChange={() => toggle(a.serial_id)} />
              <span className="font-mono">{a.ttspl_id || a.serial_number}</span>
              <span className="text-sup-muted">{[a.brand, a.model].filter(Boolean).join(' ')}</span>
              <span className="ml-auto">₹{Number(a.rent_monthly_rate || 0).toLocaleString('en-IN')}</span>
            </label>
          ))}
          {!atSite.length && <p className="text-sup-muted">No deployed assets.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-4 space-y-2 text-[13px]">
          {lockedAssets.length ? (
            <>
              <p className="font-semibold text-pri1">{lockedAssets.length} asset(s) are inside lock-in.</p>
              <p>An early-termination approval will be created and those work orders stay in DRAFT until a lead approves or waives the charge.</p>
              <ul className="list-disc pl-5">
                {lockedAssets.map((a) => (
                  <li key={a.serial_id}>{a.ttspl_id || a.serial_id} · lock-in to {lockInEnd(a)?.toLocaleDateString('en-IN')}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>No lock-in on the selected assets. Work orders will open for assignment.</p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-4 space-y-3 text-[13px]">
          <label className="block font-semibold">
            Target date
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
          </label>
          <label className="block font-semibold">
            Vehicle capacity
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
          </label>
          <p className="font-semibold">
            {selected.length} assets → {preview?.group_count || Math.ceil(selected.length / Math.max(1, Number(capacity) || 25))} work orders
            {targetDate ? ` on ${new Date(targetDate).toLocaleDateString('en-IN')}` : ''}.
          </p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
        {step < 3 ? (
          <Button disabled={!canContinue} onClick={goNext}>Continue</Button>
        ) : (
          <Button loading={saving} onClick={submit}>Create bulk return</Button>
        )}
      </div>
    </div>
  );
}
