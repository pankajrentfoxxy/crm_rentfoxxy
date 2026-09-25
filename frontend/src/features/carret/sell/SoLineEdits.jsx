import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, FormGrid, Input, Notice, Textarea, KeyValue,
} from '../../../components/carret';
import {
  getSoLineCancelEligibility, partialCancelSoLine, updateSoLineConfig, updateSoLineHsn, updateSoLineRate,
  updateSoShipping,
} from '../../sales-pipeline/salesPipelineApi';
import { usePermission } from '../../../hooks/usePermission';
import LineItemsEditor, { configText, firstMissing, fieldLabel } from './LineItemsEditor';
import { AddressFields, validateAddress } from './CustomerAddresses';

/**
 * Per-line corrections on a live order, each on the endpoint the old page used:
 * rate, configuration, HSN, and cancelling some units. They stay available after
 * a challan exists (the full edit form does not), which is why they are
 * separate. Who may do each mirrors the backend guards.
 */
export function useLineEditRights() {
  const { hasPermission, user } = usePermission();
  const admin = ['admin', 'super_admin'].includes(user?.role);
  const legacy = Array.isArray(user?.permissions) && user.permissions.includes('so_line_rate_config_edit');
  return {
    rateConfig: admin || legacy || ['sales_orders_replacement', 'replacement_so_laptop_qc', 'so_laptop_qc'].some((s) => hasPermission(s, 'edit')),
    hsn: admin,
    cancelUnits: admin || hasPermission('sales_order_cancel', 'edit'),
  };
}

export function LineEditDrawer({ mode, line, quotationType, onClose, onSaved }) {
  const [rate, setRate] = useState('');
  const [hsn, setHsn] = useState('');
  const [cfg, setCfg] = useState([]);
  const [elig, setElig] = useState(null);
  const [cancel, setCancel] = useState({ qty: 1, reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!line) return;
    setErr(null);
    setRate(line.rate || '');
    setHsn(line.hsn_code || '');
    setCfg([{
      line_id: line.id, brand: line.brand || '', model_name: line.model_name || '', processor: line.processor || '',
      generation: line.generation || '', ram: line.ram || '', storage: line.storage || '', gpu: line.gpu || '',
      screen_size: line.screen_size || '', quantity: line.main_qty ?? line.quantity ?? 1, rate: line.rate || 1,
    }]);
    setCancel({ qty: 1, reason: '' });
    setElig(null);
    if (mode === 'cancel') {
      getSoLineCancelEligibility(line.id)
        .then(({ data }) => setElig(data?.eligibility || data))
        .catch((e) => setElig({ error: e?.response?.data?.message || 'Could not check what can be cancelled.' }));
    }
  }, [line, mode]);

  const save = async () => {
    setBusy(true);
    try {
      if (mode === 'rate') {
        if (!(Number(rate) > 0)) throw new Error('Enter a rate above 0');
        await updateSoLineRate(line.id, { rate: Number(rate) });
        toast.success('Rate updated — order and challan PDFs regenerated');
      } else if (mode === 'hsn') {
        if (!/^\d{4,8}$/.test(hsn.trim())) throw new Error('HSN/SAC is 4 to 8 digits');
        await updateSoLineHsn(line.id, { hsn_code: hsn.trim() });
        toast.success('HSN updated');
      } else if (mode === 'config') {
        const miss = firstMissing(cfg, ['brand', 'model_name', 'processor', 'generation', 'ram', 'storage']);
        if (miss && miss.field !== 'rate') { setErr(miss); throw new Error(`${fieldLabel(miss.field)} is required`); }
        const c = cfg[0];
        await updateSoLineConfig(line.id, {
          brand: c.brand, model_name: c.model_name, processor: c.processor, generation: c.generation,
          ram: c.ram, storage: c.storage, gpu: c.gpu, screen_size: c.screen_size, quantity: Number(c.quantity),
        });
        toast.success('Configuration updated');
      } else if (mode === 'cancel') {
        const max = Number(elig?.cancellable_qty) || 0;
        if (!(Number(cancel.qty) >= 1 && Number(cancel.qty) <= max)) throw new Error(`Cancel between 1 and ${max}`);
        if (cancel.reason.trim().length < 3) throw new Error('Give a reason');
        await partialCancelSoLine(line.id, { cancel_qty: Number(cancel.qty), reason: cancel.reason.trim() });
        toast.success(`${cancel.qty} unit${Number(cancel.qty) === 1 ? '' : 's'} cancelled`);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  const titles = { rate: 'Change rate', hsn: 'Change HSN/SAC', config: 'Change configuration', cancel: 'Cancel units' };
  return (
    <Drawer
      open={Boolean(line && mode)}
      onClose={onClose}
      title={titles[mode] || ''}
      width={mode === 'config' ? '48rem' : '32rem'}
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={save} disabled={busy || (mode === 'cancel' && !elig?.can_cancel)}>{busy ? 'Saving…' : titles[mode]}</Button>
        </div>
      )}
    >
      {line && (
        <div className="c-stack">
          <Notice tone="info" title={configText(line)}>{`${line.main_qty ?? line.quantity} ordered`}</Notice>
          {mode === 'rate' && (
            <Field label={['sale', 'sales'].includes(quotationType) ? 'Price per laptop (₹)' : 'Monthly rent per laptop (₹)'} required hint="A one-month security deposit is recalculated to match.">
              <Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
          {mode === 'hsn' && (
            <Field label="HSN/SAC" required hint="4 to 8 digits.">
              <Input value={hsn} inputMode="numeric" onChange={(e) => setHsn(e.target.value.replace(/\D/g, ''))} className="font-mono" />
            </Field>
          )}
          {mode === 'config' && (
            <>
              <Notice tone="warn">Attached laptops are not changed. The quantity cannot go below what is already attached.</Notice>
              <LineItemsEditor lines={cfg} onChange={setCfg} quotationType={quotationType} required={['brand', 'model_name', 'processor', 'generation', 'ram', 'storage']} errors={err} />
            </>
          )}
          {mode === 'cancel' && (
            elig?.error ? <Notice tone="crit">{elig.error}</Notice> : !elig ? <span className="text-ink-3">Checking…</span> : (
              <>
                <KeyValue cols={3} items={[
                  { label: 'Ordered', value: elig.ordered_qty },
                  { label: 'Attached', value: elig.attached_qty },
                  { label: 'Delivered', value: elig.delivered_qty },
                  { label: 'In transit', value: elig.in_transit_qty },
                  { label: 'Locked', value: elig.locked_qty },
                  { label: 'Can cancel', value: elig.cancellable_qty },
                ]}
                />
                {elig.can_cancel ? (
                  <FormGrid cols={1}>
                    <Field label="Units to cancel" required hint="Attached laptops that are not yet on a challan go back to stock.">
                      <Input type="number" min="1" max={elig.cancellable_qty} value={cancel.qty} onChange={(e) => setCancel((c) => ({ ...c, qty: e.target.value }))} />
                    </Field>
                    <Field label="Reason" required><Textarea value={cancel.reason} onChange={(e) => setCancel((c) => ({ ...c, reason: e.target.value }))} /></Field>
                  </FormGrid>
                ) : <Notice tone="serious">Nothing on this line can be cancelled: every unit is delivered, in transit or on a challan.</Notice>}
              </>
            )
          )}
        </div>
      )}
    </Drawer>
  );
}

/** The order's shipping address and charge. Works after a challan exists too. */
export function ShippingEditDrawer({ open, so, address, charge, onClose, onSaved }) {
  const [a, setA] = useState(null);
  const [c, setC] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setA(address ? { ...address, zip_code: address.zip_code || address.pincode || '' } : null);
    setC(charge ?? '');
    setErrors({});
  }, [open, address, charge]);

  const save = async () => {
    const e = validateAddress(a);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (Number(c) < 0) { toast.error('Shipping cannot be negative'); return; }
    setBusy(true);
    try {
      const { data } = await updateSoShipping(so, { customer_shipping_address: { country: 'India', ...a }, shiping_charges: Number(c) || 0 });
      toast.success('Shipping updated');
      (data?.dc_address_skipped || []).forEach((dc) => toast(`${dc} already left or was delivered; its address was not changed.`));
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not update shipping.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Shipping address and charge"
      width="40rem"
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    >
      <div className="c-stack">
        <Notice tone="info">The charge is applied to every open challan; the address only to challans that have not left yet.</Notice>
        <Field label="Shipping charge (₹)"><Input type="number" min="0" step="0.01" value={c} onChange={(e) => setC(e.target.value)} /></Field>
        <AddressFields value={a} onChange={setA} errors={errors} />
      </div>
    </Drawer>
  );
}
