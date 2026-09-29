import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, FormGrid, Input, KeyValue, Money, Notice,
} from '../../../../components/carret';
import { pdfUrl } from '../../sell/sellShared';
import { uploadDcEway, uploadDcInvoice, uploadSaleOrderInvoice } from './gstApi';
import {
  NumberHistory, REPLACE_REASON_MIN, ReplaceReason, SharedInvoiceConfirm, errCode, errMsg, fmt, invoiceSub, isReplacing,
} from './gstShared';

/**
 * Attach drawers for the Invoice & e-way queue. Each posts to the endpoint the
 * challan page and the old queue screens use. A number already on file is only
 * changed through an explicit replace with a reason (MD7); the server refuses
 * anything else, so the drawer shows the reason box as soon as the typed number
 * differs from the one on file.
 */

const FileLink = ({ path, children }) => (path ? <a href={pdfUrl(path)} target="_blank" rel="noreferrer">{children}</a> : null);

function useSharedAsk(key) {
  const [ask, setAsk] = useState(null);
  const [share, setShare] = useState(false);
  useEffect(() => { setAsk(null); setShare(false); }, [key]);
  return { ask, setAsk, share, setShare };
}

async function submitWithGuards({ send, sharedState, onSaved, onClose, setBusy }) {
  setBusy(true);
  try {
    const { data } = await send();
    toast.success(data?.message || 'Saved');
    onSaved?.();
    onClose?.();
  } catch (e) {
    if (errCode(e) === 'SHARED_INVOICE_CONFIRM') {
      sharedState.setAsk({ message: errMsg(e) });
    } else {
      toast.error(errMsg(e, 'Could not save'));
    }
  } finally {
    setBusy(false);
  }
}

/** DC invoice (Zoho / e-invoice number + PDF), and the e-way bill when the laptops are worth ≥ the threshold. */
export function DcInvoiceDrawer({ row, onClose, onSaved }) {
  const [f, setF] = useState({ number: '', file: null, eway: '', ewayFile: null, reason: '' });
  const [busy, setBusy] = useState(false);
  const shared = useSharedAsk(row?.dc_number);
  useEffect(() => {
    if (row) setF({ number: row.einvoice_number || '', file: null, eway: row.eway_bill_number || '', ewayFile: null, reason: '' });
  }, [row]);

  const needsEway = Boolean(row?.requires_eway_bill);
  const changes = useMemo(() => [
    isReplacing(row?.einvoice_number, f.number) && { label: 'Invoice number', from: row.einvoice_number, to: f.number.trim() },
    needsEway && isReplacing(row?.eway_bill_number, f.eway) && { label: 'E-way bill', from: row.eway_bill_number, to: f.eway.trim() },
  ].filter(Boolean), [row, f.number, f.eway, needsEway]);

  const problems = [];
  if (!f.number.trim()) problems.push('Enter the invoice number');
  if (!f.file && !row?.einvoice_pdf_path) problems.push('Attach the invoice PDF or image');
  if (needsEway && !f.eway.trim()) problems.push('Enter the e-way bill number');
  if (needsEway && !f.ewayFile && !row?.eway_bill_pdf_path) problems.push('Attach the e-way bill');
  if (changes.length && f.reason.trim().length < REPLACE_REASON_MIN) problems.push('Give a reason for replacing');

  const save = () => {
    const fd = new FormData();
    fd.append('einvoice_number', f.number.trim());
    if (f.file) fd.append('einvoice_pdf', f.file);
    if (needsEway) {
      fd.append('eway_bill_number', f.eway.trim());
      if (f.ewayFile) fd.append('eway_bill_pdf', f.ewayFile);
    }
    if (changes.length) {
      fd.append('replace', '1');
      fd.append('replace_reason', f.reason.trim());
    }
    if (shared.share) fd.append('share_invoice', '1');
    submitWithGuards({ send: () => uploadDcInvoice(row.dc_number, fd), sharedState: shared, onSaved, onClose, setBusy });
  };

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={`Invoice — ${row?.dc_number || ''}`}
      width="36rem"
      footer={(
        <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
          <Button variant="primary" onClick={save} disabled={busy || problems.length > 0 || (shared.ask && !shared.share)}>
            {busy ? 'Saving…' : (changes.length ? 'Replace and save' : 'Save to the challan')}
          </Button>
          {problems[0] && <span className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{problems[0]}</span>}
        </div>
      )}
    >
      {row && (
        <div className="c-stack">
          <KeyValue cols={2} items={[
            { label: 'Customer', value: row.customer_name },
            { label: 'Sales order', value: row.sales_order_number },
            { label: 'Invoice value', value: row.invoice ? <Money value={row.invoice.grand_total} /> : <><Money value={row.amount} /> (estimate)</> },
            { label: 'Taxable + GST', value: invoiceSub(row) },
            { label: 'Laptops worth (e-way rule)', value: row.eway_value != null ? fmt(row.eway_value) : null },
            { label: 'E-way bill', value: needsEway ? 'Required' : 'Not required' },
          ]}
          />
          {needsEway && <Notice tone="warn" title="E-way bill required">The laptops on this challan are worth the e-way threshold or more — attach its number and document too.</Notice>}
          <FormGrid cols={2}>
            <Field label="Invoice number" required hint="The Zoho / e-invoice number">
              <Input className="font-mono" value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} />
            </Field>
            <Field label="Invoice PDF or image" required={!row.einvoice_pdf_path} hint={row.einvoice_pdf_path ? <FileLink path={row.einvoice_pdf_path}>Current file</FileLink> : null}>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
            </Field>
            {needsEway && (
              <Field label="E-way bill number" required>
                <Input className="font-mono" value={f.eway} onChange={(e) => setF((x) => ({ ...x, eway: e.target.value }))} />
              </Field>
            )}
            {needsEway && (
              <Field label="E-way bill document" required={!row.eway_bill_pdf_path} hint={row.eway_bill_pdf_path ? <FileLink path={row.eway_bill_pdf_path}>Current file</FileLink> : null}>
                <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, ewayFile: e.target.files?.[0] || null }))} />
              </Field>
            )}
          </FormGrid>
          <ReplaceReason changes={changes} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
          <SharedInvoiceConfirm ask={shared.ask} checked={shared.share} onChange={shared.setShare} />
          <NumberHistory docType="delivery_challan" docNumber={row.dc_number} />
        </div>
      )}
    </Drawer>
  );
}

/** Value e-way bill on a challan that needs no invoice (demo / rental over the threshold). */
export function DcEwayDrawer({ row, onClose, onSaved }) {
  const [f, setF] = useState({ number: '', date: '', vehicle: '', file: null, reason: '' });
  const [busy, setBusy] = useState(false);
  const noShare = useSharedAsk(row?.dc_number);
  useEffect(() => {
    if (row) {
      setF({
        number: row.eway_bill_number || '',
        date: row.eway_bill_date ? String(row.eway_bill_date).slice(0, 10) : '',
        vehicle: row.vehicle_number || '',
        file: null,
        reason: '',
      });
    }
  }, [row]);

  const needsVehicle = row?.dispatch_mode === 'inhouse' || row?.dispatch_mode === 'porter';
  const changes = useMemo(() => [
    isReplacing(row?.eway_bill_number, f.number) && { label: 'E-way bill', from: row.eway_bill_number, to: f.number.trim() },
  ].filter(Boolean), [row, f.number]);

  const problems = [];
  if (!f.number.trim()) problems.push('Enter the e-way bill number');
  if (!f.file && !row?.eway_bill_pdf_path) problems.push('Attach the e-way bill document');
  if (needsVehicle && !f.vehicle.trim()) problems.push('Enter the vehicle number');
  if (changes.length && f.reason.trim().length < REPLACE_REASON_MIN) problems.push('Give a reason for replacing');

  const save = () => {
    const fd = new FormData();
    fd.append('eway_bill_number', f.number.trim());
    if (f.date) fd.append('eway_bill_date', f.date);
    if (f.file) fd.append('eway_bill_pdf', f.file);
    if (f.vehicle.trim()) fd.append('vehicle_number', f.vehicle.trim().toUpperCase());
    if (changes.length) {
      fd.append('replace', '1');
      fd.append('replace_reason', f.reason.trim());
    }
    submitWithGuards({ send: () => uploadDcEway(row.dc_number, fd), sharedState: noShare, onSaved, onClose, setBusy });
  };

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={`E-way bill — ${row?.dc_number || ''}`}
      width="34rem"
      footer={(
        <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
          <Button variant="primary" onClick={save} disabled={busy || problems.length > 0}>
            {busy ? 'Saving…' : (changes.length ? 'Replace and save' : 'Save e-way bill')}
          </Button>
          {problems[0] && <span className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{problems[0]}</span>}
        </div>
      )}
    >
      {row && (
        <div className="c-stack">
          <KeyValue cols={2} items={[
            { label: 'Customer', value: row.customer_name },
            { label: 'Sales order', value: row.sales_order_number },
            { label: 'Laptops worth (e-way rule)', value: fmt(row.eway_value ?? row.amount) },
            { label: 'Laptops', value: row.laptops },
          ]}
          />
          <FormGrid cols={2}>
            <Field label="E-way bill number" required>
              <Input className="font-mono" value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} />
            </Field>
            <Field label="E-way bill date">
              <Input type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} />
            </Field>
            {needsVehicle && (
              <Field label="Vehicle number" required hint="Part B — we carry the goods ourselves">
                <Input className="font-mono" value={f.vehicle} onChange={(e) => setF((x) => ({ ...x, vehicle: e.target.value }))} />
              </Field>
            )}
            <Field label="E-way bill document" required={!row.eway_bill_pdf_path} hint={row.eway_bill_pdf_path ? <FileLink path={row.eway_bill_pdf_path}>Current file</FileLink> : null}>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
            </Field>
          </FormGrid>
          <ReplaceReason changes={changes} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
          <NumberHistory docType="delivery_challan" docNumber={row.dc_number} />
        </div>
      )}
    </Drawer>
  );
}

/** Sale-in-place order: the Zoho invoice is attached against the sales order (no challan exists). */
export function SaleInvoiceDrawer({ row, onClose, onSaved }) {
  const [f, setF] = useState({ number: '', file: null, reason: '' });
  const [busy, setBusy] = useState(false);
  const shared = useSharedAsk(row?.sales_order_number);
  useEffect(() => { if (row) setF({ number: row.sale_invoice_number || '', file: null, reason: '' }); }, [row]);

  const changes = useMemo(() => [
    isReplacing(row?.sale_invoice_number, f.number) && { label: 'Invoice number', from: row.sale_invoice_number, to: f.number.trim() },
  ].filter(Boolean), [row, f.number]);

  const problems = [];
  if (!f.number.trim()) problems.push('Enter the Zoho invoice number');
  if (changes.length && f.reason.trim().length < REPLACE_REASON_MIN) problems.push('Give a reason for replacing');

  const save = () => {
    const fd = new FormData();
    fd.append('sale_invoice_number', f.number.trim());
    if (f.file) fd.append('sale_invoice_pdf', f.file);
    if (changes.length) {
      fd.append('replace', '1');
      fd.append('replace_reason', f.reason.trim());
    }
    if (shared.share) fd.append('share_invoice', '1');
    submitWithGuards({ send: () => uploadSaleOrderInvoice(row.sales_order_number, fd), sharedState: shared, onSaved, onClose, setBusy });
  };

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={`Invoice — ${row?.sales_order_number || ''}`}
      width="34rem"
      footer={(
        <div className="flex items-center flex-wrap" style={{ gap: '10px' }}>
          <Button variant="primary" onClick={save} disabled={busy || problems.length > 0 || (shared.ask && !shared.share)}>
            {busy ? 'Saving…' : (changes.length ? 'Replace and save' : 'Attach invoice')}
          </Button>
          {problems[0] && <span className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{problems[0]}</span>}
        </div>
      )}
    >
      {row && (
        <div className="c-stack">
          <KeyValue cols={2} items={[
            { label: 'Customer', value: row.customer_name },
            { label: 'Laptops', value: row.qty },
            { label: 'Invoice value', value: row.invoice ? <Money value={row.invoice.grand_total} /> : <Money value={row.order_value} /> },
            { label: 'Taxable + GST', value: invoiceSub(row) },
          ]}
          />
          <FormGrid cols={2}>
            <Field label="Zoho invoice number" required>
              <Input className="font-mono" value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} />
            </Field>
            <Field label="Invoice PDF or image" hint={row.has_pdf ? 'A file is on record; a new one replaces it' : null}>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setF((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
            </Field>
          </FormGrid>
          <ReplaceReason changes={changes} value={f.reason} onChange={(v) => setF((x) => ({ ...x, reason: v }))} />
          <SharedInvoiceConfirm ask={shared.ask} checked={shared.share} onChange={shared.setShare} />
          <NumberHistory docType="sales_order" docNumber={row.sales_order_number} />
        </div>
      )}
    </Drawer>
  );
}
