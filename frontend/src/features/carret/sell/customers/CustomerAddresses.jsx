import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Section, Select, StatusChip, Textarea,
} from '../../../../components/carret';
import { lookupAndResolvePincode } from '../../../../utils/pincodeLookup';
import { formatIndianMobileInput, normalizeIndianMobile } from '../../../../utils/phoneValidation';
import { matchIndianState } from '../../../../constants/indianStates';
import {
  addCustomerAddress, deleteCustomerAddress, errMsg, fetchCustomerAddresses, setDefaultCustomerAddress, updateCustomerAddress,
} from './customersApi';
import { STATE_OPTIONS, mobileProblem, pincodeProblem } from './customerProfileShared';

/**
 * Customer record → Addresses. The billing / shipping address on the profile
 * (edited in the profile drawer, because billing reads its state for GST) and
 * the saved delivery addresses quotations and challans pick from
 * (customer_addresses: add, edit, delete, make default).
 */
const EMPTY = { address: '', city: '', state: '', pincode: '', concern_person: '', mobile_no: '', address_type: 'Shipping' };
const ADDRESS_TYPES = ['Shipping', 'Billing', 'Head office', 'Branch', 'Warehouse'];
const line = (a) => [a.city, a.state, a.pincode].filter(Boolean).join(', ');

function addressErrors(f) {
  const e = {};
  if (!String(f.address || '').trim()) e.address = 'Required';
  if (!String(f.city || '').trim()) e.city = 'Required';
  const p = pincodeProblem(f.pincode);
  if (p) e.pincode = p;
  const m = mobileProblem(f.mobile_no);
  if (m) e.mobile_no = m;
  return e;
}

function AddressDrawer({ open, customerId, initial, onClose, onSaved }) {
  const [f, setF] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(initial ? {
      address: initial.address || '', city: initial.city || '', state: matchIndianState(initial.state) || initial.state || '',
      pincode: initial.pincode || '', concern_person: initial.concern_person || '', mobile_no: normalizeIndianMobile(initial.mobile_no || ''),
      address_type: initial.address_type || 'Shipping',
    } : EMPTY);
  }, [open, initial]);
  if (!open) return null;
  const errors = addressErrors(f);
  const shown = touched ? errors : {};
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const onPin = async (e) => {
    const v = String(e.target.value || '').replace(/\D/g, '').slice(0, 6);
    setF((x) => ({ ...x, pincode: v }));
    if (v.length !== 6) return;
    const { info } = await lookupAndResolvePincode(v);
    if (info) setF((x) => ({ ...x, city: x.city || info.city || '', state: x.state || matchIndianState(info.state) || info.state || '' }));
  };
  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    const body = {
      address: f.address.trim(), city: f.city.trim() || null, state: f.state || null, pincode: f.pincode.trim() || null,
      concern_person: f.concern_person.trim() || null, mobile_no: f.mobile_no ? normalizeIndianMobile(f.mobile_no) : null,
      address_type: f.address_type || 'Shipping',
    };
    try {
      if (initial?.customer_address_id) await updateCustomerAddress(customerId, initial.customer_address_id, body);
      else await addCustomerAddress(customerId, body);
      toast.success(initial ? 'Address updated' : 'Address added');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const types = ADDRESS_TYPES.includes(f.address_type) ? ADDRESS_TYPES : [f.address_type, ...ADDRESS_TYPES];
  const states = f.state && !STATE_OPTIONS.some((o) => o.value === f.state) ? [{ value: f.state, label: f.state }, ...STATE_OPTIONS] : STATE_OPTIONS;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={initial ? 'Edit delivery address' : 'Add delivery address'}
      footer={<Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save address'}</Button>}
    >
      <FormGrid cols={2}>
        <Field label="Address" required error={shown.address} span={2}><Textarea rows={3} value={f.address} onChange={set('address')} /></Field>
        <Field label="Pincode" error={shown.pincode}><Input inputMode="numeric" maxLength={6} value={f.pincode} onChange={onPin} /></Field>
        <Field label="City" required error={shown.city}><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><Select value={f.state} onChange={set('state')} placeholder="Select state" options={states} /></Field>
        <Field label="Kind"><Select value={f.address_type} onChange={set('address_type')} options={types} /></Field>
        <Field label="Contact person"><Input value={f.concern_person} onChange={set('concern_person')} /></Field>
        <Field label="Mobile" error={shown.mobile_no}><Input inputMode="numeric" maxLength={10} value={f.mobile_no} onChange={(e) => setF((x) => ({ ...x, mobile_no: formatIndianMobileInput(e.target.value) }))} /></Field>
      </FormGrid>
    </Drawer>
  );
}

export default function AddressesTab({ customer, canEdit, onEditProfile }) {
  const customerId = customer.customer_id;
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, row for edit
  const [deleting, setDeleting] = useState(null);
  const load = useCallback(() => {
    fetchCustomerAddresses(customerId).then(({ data }) => setRows(data.addresses || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const makeDefault = async (r) => {
    try { await setDefaultCustomerAddress(customerId, r.customer_address_id); toast.success('Default address set'); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    try { await deleteCustomerAddress(customerId, deleting.customer_address_id); toast.success('Address deleted'); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  const bill = [typeof customer.billing_address === 'object' ? customer.billing_address?.address : customer.billing_address, customer.billing_city, customer.billing_state, customer.billing_pincode].filter(Boolean).join(', ');
  const ship = customer.shipping_same === false
    ? [customer.shipping_address, customer.shipping_city, customer.shipping_state, customer.shipping_pincode].filter(Boolean).join(', ')
    : 'Same as billing';
  const cols = [
    { key: 'a', header: 'Address', render: (r) => r.address, sub: (r) => line(r) },
    { key: 't', header: 'Kind', render: (r) => (r.is_head_office ? <StatusChip status="default" label="Default" /> : (r.address_type || 'Shipping')) },
    { key: 'c', header: 'Contact', render: (r) => r.concern_person || '—', sub: (r) => r.mobile_no },
    ...(canEdit ? [{
      key: 'x',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap" style={{ gap: '6px' }} onClick={(e) => e.stopPropagation()} role="presentation">
          <Button variant="quiet" onClick={() => setEditing(r)}>Edit</Button>
          {!r.is_head_office && <Button variant="quiet" onClick={() => makeDefault(r)}>Make default</Button>}
          <Button variant="quiet" onClick={() => setDeleting(r)}>Delete</Button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="c-stack">
      <Section title="On the profile" actions={canEdit && <Button variant="quiet" onClick={onEditProfile}>Edit in profile…</Button>}>
        <KeyValue cols={2} items={[{ label: 'Billing address', value: bill }, { label: 'Shipping address', value: ship }]} />
      </Section>
      <Section title="Delivery addresses (for quotations and challans)" actions={canEdit && <Button onClick={() => setEditing({})}>Add address…</Button>}>
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.customer_address_id} empty={<EmptyState title="No saved delivery addresses" />} />
        )}
      </Section>
      <AddressDrawer
        open={Boolean(editing)}
        customerId={customerId}
        initial={editing && editing.customer_address_id ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this address?"
        body={deleting ? `${deleting.address}${line(deleting) ? `, ${line(deleting)}` : ''}. Quotations and challans already made keep their copy.` : ''}
        confirmLabel="Delete"
      />
    </div>
  );
}
