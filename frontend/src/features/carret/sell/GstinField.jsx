import React, { useState } from 'react';
import { Field, Input } from '../../../components/carret';
import { gstinError } from './sellShared';

/**
 * GSTIN on a quotation / sales order. When it came from the customer record
 * it is locked — the record is where it changes. Otherwise it takes at most
 * 15 letters and digits, upper-cased, and says what is wrong when left.
 */
export default function GstinField({ value, onChange, locked, error, span }) {
  const [touched, setTouched] = useState(false);
  const msg = error || (touched ? gstinError(value) : '');
  const n = String(value || '').length;
  return (
    <Field
      label="GSTIN"
      span={span}
      error={msg || undefined}
      hint={locked ? 'From the customer record — change it there' : (n > 0 && n < 15 ? `${n} of 15 characters` : 'Leave empty if the customer is not GST-registered')}
    >
      <Input
        value={value}
        readOnly={locked}
        aria-readonly={locked || undefined}
        maxLength={15}
        className="font-mono"
        style={locked ? { background: 'var(--surface-2)', cursor: 'not-allowed' } : { textTransform: 'uppercase' }}
        onChange={(e) => { if (!locked) onChange(String(e.target.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15)); }}
        onBlur={() => setTouched(true)}
      />
    </Field>
  );
}
