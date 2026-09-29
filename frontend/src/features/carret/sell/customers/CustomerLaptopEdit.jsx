import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DateTime, Drawer, Field, FormGrid, Input, Notice, Section,
} from '../../../../components/carret';
import { assetCalendarYmd } from '../../../lead-crm/leadCrmUtils';
import { errMsg, fetchCustomerAssetActivity, updateCustomerLaptop } from './customersApi';

/**
 * Correct a laptop's record with this customer — configuration, rent per month,
 * challan number and dates (PATCH /customers/:id/laptops/:serialId, section
 * customer_assets edit; each edit is logged in customer_asset_activity and
 * listed under "Recent laptop edits").
 */
const SPEC = [['brand', 'Brand'], ['model', 'Model'], ['processor', 'Processor'], ['generation', 'Generation'], ['ram', 'RAM'], ['storage', 'Storage'], ['gpu', 'GPU'], ['screen_size', 'Screen size']];

function formFor(a) {
  const returned = a.lifecycle === 'returned' || a.status === 'returned' || a.returned_at != null;
  return {
    returned,
    brand: a.brand || '', model: a.model_name || a.model || '', processor: a.processor || '', generation: a.generation || '',
    ram: a.ram || '', storage: a.storage || '', gpu: a.gpu || '', screen_size: a.screen_size || '',
    rent_monthly_rate: a.rent_monthly_rate != null && a.rent_monthly_rate !== '' ? String(a.rent_monthly_rate) : '',
    dc_number: a.dc_number || '',
    dispatched_at: assetCalendarYmd(a.dispatch_date),
    delivered_at: assetCalendarYmd(a.delivered_at),
    returned_at: returned ? assetCalendarYmd(a.returned_at) : '',
  };
}

export function LaptopEditDrawer({ customerId, laptop, kind, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(laptop ? { ...formFor(laptop), returned: kind === 'returned' } : null); }, [laptop, kind]);
  if (!laptop || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const rate = f.rent_monthly_rate.trim();
  const rateBad = rate !== '' && !(Number(rate) >= 0);
  const datesBad = f.returned && f.delivered_at && f.returned_at && f.returned_at < f.delivered_at;

  const save = async () => {
    if (rateBad || datesBad) return;
    setBusy(true);
    const body = Object.fromEntries(SPEC.map(([k]) => [k, f[k].trim()]));
    body.dc_number = f.dc_number.trim();
    body.rent_monthly_rate = rate === '' ? null : rate;
    body.delivered_at = f.delivered_at || null;
    if (f.returned) {
      body.lifecycle = 'returned';
      if (body.dc_number) body.return_dc_number = body.dc_number;
      body.returned_at = f.returned_at || null;
    } else {
      body.dispatched_at = f.dispatched_at || null;
    }
    try {
      const { data } = await updateCustomerLaptop(customerId, laptop.serial_id, body);
      toast.success(data?.message || 'Laptop updated');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(errMsg(e, 'Update failed')); } finally { setBusy(false); }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Edit ${laptop.ttspl_id || laptop.serial_number}`}
      width="38rem"
      footer={<Button variant="primary" disabled={busy || rateBad || datesBad} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>}
    >
      <div className="c-stack">
        <Section title="Configuration">
          <FormGrid cols={2}>
            {SPEC.map(([k, label]) => <Field key={k} label={label}><Input value={f[k]} onChange={set(k)} /></Field>)}
          </FormGrid>
        </Section>
        <Section title={f.returned ? 'Rental and return' : 'Rental'}>
          <FormGrid cols={2}>
            <Field label={f.returned ? 'Return challan' : 'Delivery challan'}><Input value={f.dc_number} onChange={set('dc_number')} placeholder={f.returned ? 'RDC001744' : 'DC/26-27/0910'} /></Field>
            <Field label="Rent / month" error={rateBad ? 'A number, 0 or more' : undefined} hint="Leave empty to clear"><Input type="number" min="0" step="0.01" value={f.rent_monthly_rate} onChange={set('rent_monthly_rate')} /></Field>
            {!f.returned && <Field label="Dispatched"><Input type="date" value={f.dispatched_at} onChange={set('dispatched_at')} /></Field>}
            <Field label="Delivered"><Input type="date" value={f.delivered_at} onChange={set('delivered_at')} /></Field>
            {f.returned && <Field label="Returned" error={datesBad ? 'Before the delivery date' : undefined}><Input type="date" value={f.returned_at} onChange={set('returned_at')} /></Field>}
          </FormGrid>
          <div style={{ marginTop: '12px' }}>
            <Notice tone="info">{f.returned
              ? 'Delivered is when the laptop reached this customer; returned is when it came back.'
              : 'Billing starts from the delivery date. It can be in the future for a laptop still on the way.'}
            </Notice>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

export function LaptopActivity({ customerId, refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchCustomerAssetActivity(customerId, { limit: 15 }).then(({ data }) => setRows(data.activity || [])).catch(() => setRows([]));
  }, [customerId, refreshKey]);
  if (!rows || rows.length === 0) return null;
  return (
    <Section title="Recent laptop edits">
      <ul className="c-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap" style={{ gap: '8px' }}>
            <span className="font-mono">{r.ttspl_id || r.serial_number}</span>
            <span className="text-ink-2">{r.description || r.action}</span>
            <span className="text-ink-3">· {r.actor_name} · <DateTime value={r.created_at} /></span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

