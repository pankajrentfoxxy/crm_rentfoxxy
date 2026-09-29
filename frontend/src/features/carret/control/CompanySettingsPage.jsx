import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, EmptyState, Field, FormGrid, Input, KeyValue, Notice, Section, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { formatIndianMobileInput, indianMobileError } from '../../../utils/phoneValidation';
import { fetchCompanies, saveCompany } from './controlApi';
import { errMsg } from './controlShared';

/**
 * Control → Settings: the two legal entities (Rentfoxxy, Gorefurbo) — legal
 * name, GSTIN, PAN, contact, state code, HSN, registered address and logo that
 * every document prints. Same API as the old /settings/companies page
 * (company_settings: view to read, edit to save). The server checks GSTIN /
 * PAN / state code together, because they decide CGST+SGST vs IGST.
 *
 * An entity with no saved row shows what its documents print today; the first
 * save stores it.
 */
const FIELDS = [
  { key: 'legal_name', label: 'Legal name', required: true },
  { key: 'gstin', label: 'GSTIN', upper: true, hint: '15 characters. The first two digits are the state code.' },
  { key: 'pan', label: 'PAN', upper: true, hint: 'Characters 3–12 of the GSTIN.' },
  { key: 'state_code', label: 'GST state code', hint: 'Two digits, e.g. 06 for Haryana.' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone', phone: true },
  { key: 'hsn_code', label: 'HSN code' },
  { key: 'logo_url', label: 'Logo path', hint: 'assets/… or uploads/… on the server.' },
];
const ENTITY_ROLE = { rentfoxxy: 'Rental and demo documents', gorefurbo: 'Sales documents' };

function pick(c) {
  const out = {};
  FIELDS.forEach((f) => { out[f.key] = c[f.key] || ''; });
  out.address = c.address || '';
  return out;
}

function CompanyCard({ company, canEdit, onSaved }) {
  const [form, setForm] = useState(() => pick(company));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(pick(company)); }, [company]);

  const original = pick(company);
  const dirty = Object.keys(form).some((k) => String(form[k] || '') !== String(original[k] || ''));

  const set = (f, value) => setForm((p) => ({
    ...p,
    [f.key]: f.phone ? formatIndianMobileInput(value) : f.upper ? value.toUpperCase() : value,
  }));

  const save = async () => {
    if (!form.legal_name.trim()) { toast.error('Legal name is required'); return; }
    if (form.phone.trim()) {
      const e = indianMobileError(form.phone, { label: 'Phone' });
      if (e) { toast.error(e); return; }
    }
    setBusy(true);
    try {
      // Send only what changed: an empty field keeps the stored value on the server.
      const body = {};
      Object.keys(form).forEach((k) => { if (String(form[k] || '') !== String(original[k] || '')) body[k] = form[k].trim(); });
      const { data } = await saveCompany(company.code, body);
      toast.success(`${data.data?.legal_name || company.code} saved`);
      onSaved(data.data);
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={company.legal_name || company.code}
      actions={(
        <div className="flex items-center" style={{ gap: '8px' }}>
          <StatusChip status={company.saved === false ? 'draft' : company.active === false ? 'cancelled' : 'completed'} label={company.saved === false ? 'Defaults — not saved yet' : company.active === false ? 'Inactive' : 'Active'} />
          {canEdit && <Button variant="primary" disabled={busy || (!dirty && company.saved !== false)} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <KeyValue
          cols={4}
          items={[
            { label: 'Entity', value: company.code },
            { label: 'Used for', value: ENTITY_ROLE[company.code] || '—' },
            { label: 'DC prefix', value: <span className="font-mono">{company.dc_prefix}</span> },
            { label: 'Invoice prefix', value: <span className="font-mono">{company.invoice_prefix}</span> },
          ]}
        />
        {company.saved === false && (
          <Notice tone="warn" title="Not saved in the database yet">
            Documents print these default details today. {canEdit ? 'Check them and press Save to store them here.' : ''}
          </Notice>
        )}
        <FormGrid cols={2}>
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} required={f.required}>
              <Input
                value={form[f.key]}
                disabled={!canEdit}
                maxLength={f.phone ? 10 : undefined}
                inputMode={f.phone ? 'numeric' : undefined}
                onChange={(e) => set(f, e.target.value)}
                className={f.upper ? 'font-mono' : ''}
              />
            </Field>
          ))}
          <Field label="Registered address" span={2}>
            <Textarea rows={3} value={form.address} disabled={!canEdit} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </Field>
        </FormGrid>
      </div>
    </Section>
  );
}

export default function CompanySettingsPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('company_settings', 'edit');
  const [companies, setCompanies] = useState(null);

  useEffect(() => {
    fetchCompanies()
      .then(({ data }) => setCompanies(data.data || []))
      .catch((e) => { setCompanies([]); toast.error(errMsg(e, 'Could not load the entities')); });
  }, []);

  const onSaved = (row) => {
    if (!row) return;
    setCompanies((prev) => prev.map((c) => (c.code === row.code ? row : c)));
  };

  return (
    <DeskShell
      title="Company settings"
      breadcrumb="Control"
      subtitle="Each legal entity has its own GSTIN and document number series — sales run under Gorefurbo, rental and demo under Rentfoxxy."
    >
      <div className="c-stack">
        {!canEdit && <Notice tone="info">You can view these details. Changing them needs edit access to Company settings.</Notice>}
        {companies === null ? <EmptyState title="Loading…" /> : companies.length === 0 ? <EmptyState title="No entities" /> : (
          companies.map((c) => <CompanyCard key={c.code} company={c} canEdit={canEdit} onSaved={onSaved} />)
        )}
      </div>
    </DeskShell>
  );
}
