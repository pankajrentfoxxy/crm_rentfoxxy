import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, Drawer, Field, FormGrid, Input, Notice, Select, Textarea,
} from '../../../../components/carret';
import FitmentPicker from './FitmentPicker';
import {
  PART_CATEGORIES, catalogFitmentFields, createPart, errMsg, fitmentFromPart, partCategory, updatePart,
} from './partsApi';

const blank = () => ({
  part_name: '', category: 'general', part_type: '', description: '', model_number: '', pin_size: '', part_sku: '',
  quantity: '', min_threshold: '5', warranty_months: '0', cost: '', location_code: '', vendor: '',
  is_consumable: false, notes: '', fitment: { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] },
});

const fromPart = (p) => ({
  part_name: p.part_name || '',
  category: partCategory(p),
  part_type: p.part_type && p.part_type !== partCategory(p) ? p.part_type : '',
  description: p.description || '',
  model_number: p.model_number || '',
  pin_size: p.pin_size || '',
  part_sku: p.part_sku || '',
  quantity: '',
  min_threshold: p.min_threshold != null ? String(p.min_threshold) : '5',
  warranty_months: p.warranty_months != null ? String(p.warranty_months) : '0',
  cost: p.cost != null ? String(p.cost) : '',
  location_code: p.location_code || '',
  vendor: p.vendor || '',
  is_consumable: Boolean(p.is_consumable),
  notes: p.notes || '',
  fitment: fitmentFromPart(p),
});

/**
 * Add or edit a catalogue part. Opening quantity creates that many tracked
 * units (PRT ids) with the part — the backend no longer writes a bare number.
 */
export default function PartFormDrawer({ open, part, onClose, onSaved }) {
  const editing = Boolean(part?.part_id);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setF(editing ? fromPart(part) : blank()); }, [open, editing, part]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const qty = f.quantity === '' ? 0 : Number(f.quantity);
  const invalid = !f.part_name.trim()
    || (f.cost !== '' && !(Number(f.cost) >= 0))
    || (!editing && (!Number.isInteger(qty) || qty < 0 || qty > 500))
    || (f.fitment.fitment === 'specific' && !f.fitment.fits_laptop_brand);

  const save = async () => {
    setBusy(true);
    const body = {
      part_name: f.part_name.trim(),
      category: f.category,
      part_type: f.part_type.trim() || f.category,
      description: f.description.trim(),
      model_number: f.model_number.trim(),
      pin_size: f.pin_size.trim(),
      part_sku: f.part_sku.trim(),
      min_threshold: f.min_threshold === '' ? undefined : Number(f.min_threshold),
      warranty_months: f.warranty_months === '' ? undefined : Number(f.warranty_months),
      cost: f.cost === '' ? undefined : Number(f.cost),
      location_code: f.location_code.trim(),
      vendor: f.vendor.trim(),
      is_consumable: f.is_consumable,
      notes: f.notes.trim(),
      ...catalogFitmentFields(f.fitment),
    };
    try {
      if (editing) {
        const { data } = await updatePart(part.part_id, body);
        toast.success('Part saved');
        onSaved?.(data.part, []);
      } else {
        const { data } = await createPart({ ...body, quantity: qty });
        toast.success(data.message || 'Part added');
        onSaved?.(data.part, data.units || []);
      }
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
      title={editing ? `Edit — ${part.part_name}` : 'Add a part to the catalogue'}
      width="40rem"
      footer={<Button variant="primary" disabled={busy || invalid} onClick={save}>{busy ? 'Saving…' : editing ? 'Save part' : 'Add part'}</Button>}
    >
      <div className="c-stack">
        <Field label="Part name" required><Input value={f.part_name} onChange={set('part_name')} /></Field>
        <FormGrid cols={2}>
          <Field label="Category" required><Select value={f.category} onChange={set('category')} options={PART_CATEGORIES} /></Field>
          <Field label="Part type" hint="Optional finer type, e.g. DDR4, 65W"><Input value={f.part_type} onChange={set('part_type')} /></Field>
          <Field label="Model number"><Input value={f.model_number} onChange={set('model_number')} /></Field>
          <Field label="Pin size"><Input value={f.pin_size} onChange={set('pin_size')} placeholder="e.g. 4.5 mm, 30-pin" /></Field>
          <Field label="SKU"><Input value={f.part_sku} onChange={set('part_sku')} /></Field>
          <Field label="Vendor / supplier"><Input value={f.vendor} onChange={set('vendor')} /></Field>
        </FormGrid>
        <Field label="Specifications"><Input value={f.description} onChange={set('description')} placeholder="e.g. DDR4, 2666MHz, SODIMM" /></Field>
        <FitmentPicker label="Default fitment (pre-fills at GRN and when units are added)" value={f.fitment} onChange={set('fitment')} />
        <FormGrid cols={3}>
          <Field label="Unit cost (₹)"><Input type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} /></Field>
          <Field label="Minimum stock" hint="Low-stock warning below this"><Input type="number" min="0" value={f.min_threshold} onChange={set('min_threshold')} /></Field>
          <Field label="Warranty (months)"><Input type="number" min="0" value={f.warranty_months} onChange={set('warranty_months')} /></Field>
          <Field label="Shelf / location"><Input value={f.location_code} onChange={set('location_code')} placeholder="Shelf A-3" /></Field>
          {!editing && (
            <Field label="Opening stock" hint="Units on the shelf now (0–500)">
              <Input type="number" min="0" max="500" value={f.quantity} onChange={set('quantity')} />
            </Field>
          )}
        </FormGrid>
        <Checkbox label="Consumable (paste, screws, cables) — counted, not tracked unit by unit" checked={f.is_consumable} onChange={set('is_consumable')} />
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {!editing && qty > 0 && (
          <Notice tone="info">{qty} unit(s) get a Part ID each, at the shelf and cost above. Add serial numbers later from the part, or use Add units instead.</Notice>
        )}
      </div>
    </Drawer>
  );
}
