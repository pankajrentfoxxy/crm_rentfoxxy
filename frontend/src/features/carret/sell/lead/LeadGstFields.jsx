import React, { useState } from 'react';
import { Button, Field, FormGrid, Input, Notice, Select } from '../../../../components/carret';
import { lookupGstin } from '../../../../utils/gstinLookup';
import { matchIndianState } from '../../../../constants/indianStates';
import { COMPANY_TYPES, cleanGstin, cleanPan } from '../customers/customerProfileShared';

/**
 * GSTIN on a lead, with "Look up GSTIN": the registered company name, trade
 * name, company type, PAN and billing address come from the GST record and are
 * kept on the lead, so the Deal / Demo conversion starts from them instead of
 * the salesperson typing them again. Same lookup as the customer profile.
 *
 * `value` holds gst_number, company_name, trade_name, company_type, pan_number
 * and the billing fields named by `addr` (the lead edit form uses
 * city / state / pincode, the convert form billing_city / …).
 */
export default function LeadGstFields({
  value, onChange, required = false,
  addr = { address: 'billing_address', city: 'city', state: 'state', pincode: 'pincode' },
}) {
  const [gst, setGst] = useState(null); // { status, info?, message? }
  const n = String(value.gst_number || '').length;

  const fetchGst = async () => {
    setGst({ status: 'loading' });
    try {
      const info = await lookupGstin(value.gst_number);
      setGst(info ? { status: 'found', info } : { status: 'error', message: 'No GST details found for this GSTIN.' });
    } catch (e) {
      setGst({ status: 'error', message: e?.response?.data?.message || e?.message || 'GSTIN lookup failed.' });
    }
  };
  const useGst = () => {
    const i = gst.info;
    onChange({
      company_name: i.company_name || i.trade_name || value.company_name,
      trade_name: i.trade_name || value.trade_name,
      company_type: i.company_type || value.company_type,
      pan_number: cleanPan(i.pan_number) || value.pan_number,
      [addr.address]: i.address || value[addr.address],
      [addr.city]: i.city || value[addr.city],
      [addr.state]: i.stateSelect || matchIndianState(i.state) || i.state || value[addr.state],
      [addr.pincode]: i.pincode || value[addr.pincode],
    });
    setGst(null);
  };

  const types = !value.company_type || COMPANY_TYPES.includes(value.company_type)
    ? COMPANY_TYPES : [value.company_type, ...COMPANY_TYPES];

  return (
    <div className="c-stack" style={{ gap: '12px' }}>
      <FormGrid cols={2}>
        <Field label="GSTIN" required={required} hint={n > 0 && n < 15 ? `${n} of 15 characters` : 'Look it up to fill the company and billing details'}>
          <Input className="font-mono" maxLength={15} value={value.gst_number} onChange={(e) => { onChange({ gst_number: cleanGstin(e.target.value) }); setGst(null); }} placeholder="15 characters" />
        </Field>
        <div style={{ alignSelf: 'end', paddingBottom: '2px' }}>
          <Button disabled={n !== 15 || gst?.status === 'loading'} onClick={fetchGst}>
            {gst?.status === 'loading' ? 'Looking up…' : 'Look up GSTIN'}
          </Button>
        </div>
      </FormGrid>
      {gst?.status === 'error' && <Notice tone="warn">{gst.message}</Notice>}
      {gst?.status === 'found' && (
        <Notice tone="info" title={gst.info.trade_name || gst.info.company_name} action={<Button onClick={useGst}>Use these details</Button>}>
          {[gst.info.company_name, gst.info.company_type, gst.info.pan_number && `PAN ${gst.info.pan_number}`].filter(Boolean).join(' · ')}
          <div>{[gst.info.address, gst.info.city, gst.info.state, gst.info.pincode].filter(Boolean).join(', ')}</div>
          {gst.info.status && String(gst.info.status).toLowerCase() !== 'active' && <div><b>GST status: {gst.info.status}</b></div>}
        </Notice>
      )}
      <FormGrid cols={2}>
        <Field label="Company (legal name)"><Input value={value.company_name} onChange={(e) => onChange({ company_name: e.target.value })} /></Field>
        <Field label="Trade name"><Input value={value.trade_name} onChange={(e) => onChange({ trade_name: e.target.value })} /></Field>
        <Field label="Company type"><Select value={value.company_type} onChange={(e) => onChange({ company_type: e.target.value })} placeholder="—" options={types} /></Field>
        <Field label="PAN"><Input className="font-mono" maxLength={10} value={value.pan_number} onChange={(e) => onChange({ pan_number: cleanPan(e.target.value) })} /></Field>
      </FormGrid>
    </div>
  );
}
