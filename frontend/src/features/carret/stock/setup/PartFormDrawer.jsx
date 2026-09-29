import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, Drawer, Field, FormGrid, Input, Notice, Textarea,
} from '../../../../components/carret';
import PartStructureFields, { specsForKind } from './PartStructureFields';
import {
  catalogFitmentFields, createPart, errMsg, fitmentFromPart, isStructured, partCategory, updatePart,
} from './partsApi';
import { kindSchema, normalizePartStructure } from '../../../../constants/partNaming';

const UNSET = { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] };

const blank = () => ({
  structure: { category: '', kind: '', specs: {}, fitment: UNSET, name_override: false, own_name: '' },
  model_number: '', pin_size: '', part_sku: '',
  quantity: '', min_threshold: '5', warranty_months: '0', cost: '', location_code: '', vendor: '',
  is_consumable: false, notes: '',
});

const fromPart = (p) => {
  const category = partCategory(p);
  const kind = kindSchema(category, p.part_type) ? p.part_type : '';
  const specs = p.specs && typeof p.specs === 'object' ? p.specs : {};
  return {
    structure: {
      category,
      kind,
      // A part from before the redesign keeps its old name for search (_was).
      specs: { ...specsForKind(category, kind, specs), ...(isStructured(p) ? {} : { _was: specs._was || p.part_name }) },
      fitment: fitmentFromPart(p),
      name_override: Boolean(p.name_override),
      own_name: p.name_override ? p.part_name || '' : '',
    },
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
  };
};

/** The structure in the shape backend normalizePartStructure takes. */
const structureBody = (s) => ({
  category: s.category,
  kind: s.kind,
  specs: s.specs,
  name_override: Boolean(s.name_override),
  part_name: s.name_override ? s.own_name : '',
  ...catalogFitmentFields(s.fitment),
});

/**
 * Add or edit a catalogue part. The part is category + what it is + its
 * details + which laptops it fits; the name is generated from those (or
 * typed, if "Use my own name" is ticked). The same structure twice is the
 * same part — the backend refuses it and so does the form, live.
 * Opening quantity creates that many tracked units (PRT ids) with the part.
 */
export default function PartFormDrawer({ open, part, parts = [], onClose, onSaved }) {
  const editing = Boolean(part?.part_id);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setF(editing ? fromPart(part) : blank()); }, [open, editing, part]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const setStructure = (structure) => setF((s) => ({
    ...s,
    structure,
    // Consumables and tools are counted, not tracked unit by unit — default it for a new part.
    is_consumable: !editing && structure.category !== s.structure.category
      ? ['consumable', 'tools'].includes(structure.category) : s.is_consumable,
  }));

  const check = useMemo(() => normalizePartStructure(structureBody(f.structure)), [f.structure]);
  const duplicate = useMemo(() => (check.ok
    ? (parts || []).find((p) => p.spec_key && p.spec_key === check.value.spec_key && !p.archived && p.part_id !== part?.part_id)
    : null), [check, parts, part]);

  const qty = f.quantity === '' ? 0 : Number(f.quantity);
  const missing = [
    ...(check.ok ? [] : check.errors),
    f.cost !== '' && !(Number(f.cost) >= 0) && 'unit cost must be zero or more',
    !editing && (!Number.isInteger(qty) || qty < 0 || qty > 500) && 'opening stock must be 0–500',
    duplicate && 'this part is already in the catalogue',
  ].filter(Boolean);

  const save = async () => {
    setBusy(true);
    const body = {
      ...structureBody(f.structure),
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
    };
    try {
      if (editing) {
        const { data } = await updatePart(part.part_id, body);
        toast.success(`Saved — ${data.part?.part_name || 'part'}`);
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

  const legacy = editing && !isStructured(part);
  const newName = check.value.part_name;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit — ${part.part_name}` : 'Add a part to the catalogue'}
      width="42rem"
      footer={(
        <>
          {missing.length > 0 && <span className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginRight: 'auto' }}>Still needed: {missing.join('; ')}.</span>}
          <Button variant="primary" disabled={busy || missing.length > 0} onClick={save}>{busy ? 'Saving…' : editing ? 'Save part' : 'Add part'}</Button>
        </>
      )}
    >
      <div className="c-stack">
        {legacy && (
          <Notice tone="warn" title="This part was added before part names were generated">
            Choose what it is and its details. Its name becomes {newName ? <b>{newName}</b> : 'the generated name'}; the old name “{part.part_name}” stays searchable.
          </Notice>
        )}
        <PartStructureFields value={f.structure} onChange={setStructure} generated={check.value.generated_name} />
        {duplicate && (
          <Notice tone="warn" title={`Already in the catalogue: ${duplicate.part_name}`}>
            Same category, details and fits (part #{duplicate.part_id}). Add units to that part instead.
          </Notice>
        )}
        <FormGrid cols={2}>
          <Field label="Part number (on the label)" hint="Maker's number, e.g. a battery's WDX0R"><Input value={f.model_number} onChange={set('model_number')} /></Field>
          <Field label="Pin / connector"><Input value={f.pin_size} onChange={set('pin_size')} placeholder="e.g. 30-pin eDP, 4.5 mm" /></Field>
          <Field label="SKU"><Input value={f.part_sku} onChange={set('part_sku')} /></Field>
          <Field label="Vendor / supplier"><Input value={f.vendor} onChange={set('vendor')} /></Field>
        </FormGrid>
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
        <Checkbox label="Counted, not tracked unit by unit (paste, screws, cables)" checked={f.is_consumable} onChange={set('is_consumable')} />
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {!editing && qty > 0 && (
          <Notice tone="info">{qty} unit(s) get a Part ID each, at the shelf and cost above. Add serial numbers later from the part, or use Add units instead.</Notice>
        )}
      </div>
    </Drawer>
  );
}
