import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, FormGrid, Input, Notice, SearchSelect, Textarea,
} from '../../../../components/carret';
import FitmentPicker from './FitmentPicker';
import {
  CATEGORY_LABEL, addPartInstances, errMsg, fitsSummary, partCategory, splitSerials,
} from './partsApi';

const blankFit = () => ({ fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] });

/**
 * Add units by hand (stock found, bought over the counter, opening balance):
 * one Part ID per unit, serials optional. Units bought on a spare-parts PO come
 * in at GRN, not here.
 */
export default function AddUnitsDrawer({ open, part, parts = [], onClose, onAdded }) {
  const [partId, setPartId] = useState('');
  const [serials, setSerials] = useState('');
  const [qty, setQty] = useState('1');
  const [location, setLocation] = useState('');
  const [cost, setCost] = useState('');
  const [fit, setFit] = useState(blankFit);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPartId(part?.part_id ? String(part.part_id) : '');
    setSerials(''); setQty('1'); setCost(''); setFit(blankFit());
    setLocation(part?.location_code || '');
  }, [open, part]);

  const chosen = useMemo(() => part || parts.find((p) => String(p.part_id) === String(partId)) || null, [part, parts, partId]);
  const partOptions = useMemo(() => parts.filter((p) => !p.archived).map((p) => ({
    value: String(p.part_id),
    label: `${p.part_name} — ${CATEGORY_LABEL[partCategory(p)] || p.category}`,
    search: [p.model_number, p.part_sku, p.part_type, ...Object.values(p.specs || {}), ...(p.compatible_models || [])].filter(Boolean).join(' '),
  })), [parts]);

  const list = splitSerials(serials);
  const count = list.length || Number(qty) || 0;
  const dupes = list.length !== new Set(list.map((s) => s.toLowerCase())).size;
  const invalid = !chosen || count < 1 || count > 500 || dupes
    || (!list.length && !Number.isInteger(Number(qty)))
    || (cost !== '' && !(Number(cost) >= 0))
    || (fit.fitment === 'specific' && !fit.fits_laptop_brand);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        part_id: chosen.part_id,
        ...(list.length ? { serial_numbers: list } : { quantity: Number(qty) }),
        unit_cost: cost === '' ? undefined : Number(cost),
        location_code: location.trim() || undefined,
        ...(fit.fitment !== 'unset' ? fit : {}),
      };
      const { data } = await addPartInstances(body);
      toast.success(data.message || `${data.count} unit(s) added`);
      onAdded?.(data.created || [], chosen);
      onClose?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={part ? `Add units — ${part.part_name}` : 'Add units by hand'}
      width="36rem"
      footer={<Button variant="primary" disabled={busy || invalid} onClick={save}>{busy ? 'Adding…' : `Add ${count || ''} unit${count === 1 ? '' : 's'} to stock`}</Button>}
    >
      <div className="c-stack">
        {!part && (
          <Field label="Part" required>
            <SearchSelect value={partId} onChange={(e) => setPartId(e.target.value)} options={partOptions} placeholder="Choose the catalogue part…" />
          </Field>
        )}
        <Field
          label="Serial numbers"
          hint={list.length ? `${list.length} serial(s)${dupes ? ' — one is listed twice' : ''}` : 'One per line or comma-separated. Leave empty to add units without serials.'}
          error={dupes ? 'A serial is listed twice' : undefined}
        >
          <Textarea rows={4} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder={'SN-12345\nSN-12346'} />
        </Field>
        <FormGrid cols={3}>
          {!list.length && <Field label="How many" required><Input type="number" min="1" max="500" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>}
          <Field label="Shelf / location"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Shelf A-3" /></Field>
          <Field label="Unit cost (₹)" hint={chosen ? `Empty = part cost ₹${Number(chosen.cost || 0).toLocaleString('en-IN')}` : undefined}>
            <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </FormGrid>
        <FitmentPicker
          label="Fits laptops"
          value={fit}
          onChange={setFit}
        />
        {chosen && fit.fitment === 'unset' && (
          <Notice tone="info">Not tagged here = the part&apos;s default fitment ({fitsSummary(chosen)}).</Notice>
        )}
        <p className="text-ink-3">After adding you can print a QR label for each new unit.</p>
      </div>
    </Drawer>
  );
}
