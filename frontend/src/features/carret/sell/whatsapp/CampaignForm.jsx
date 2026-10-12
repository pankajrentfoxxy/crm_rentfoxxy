import React from 'react';
import {
  Button, Field, FormGrid, Input, Select, Textarea,
} from '../../../../components/carret';

/**
 * Campaign settings — name, Interakt template, header media, body variables
 * and the preview-only body text. The rules (EMPTY_CAMPAIGN, toCampaignForm,
 * validateCampaignForm) are the old feature's, imported by the pages, so a
 * campaign saved from either screen passes the same checks.
 *
 * section: 'details' (step 1), 'template' (step 2) or 'all' (edit on the record).
 */
const MAX_VARS = 10;

export function BodyVariablesEditor({ value = [], onChange, columns = null, disabled = false }) {
  const update = (i, patch) => onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const add = () => onChange([...value, { source: 'column', key: '' }]);
  const remove = (i) => onChange(value.filter((_, idx) => idx !== i));
  const columnOptions = (columns || []).filter((c) => c.key !== 'mobile').map((c) => ({ value: c.key, label: c.label }));

  return (
    <div className="c-stack" style={{ gap: 8 }}>
      {value.length === 0 && <p className="text-ink-3 font-ui m-0" style={{ fontSize: 'var(--d-sm)' }}>This template has no body variables.</p>}
      {value.map((v, i) => (
        <div key={i} className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <span className="text-ink-2 font-ui" style={{ width: 48, fontWeight: 600 }}>{`{{${i + 1}}}`}</span>
          <div style={{ width: '12rem' }}>
            <Select
              aria-label={`{{${i + 1}}} source`}
              value={v.source}
              disabled={disabled}
              onChange={(e) => update(i, e.target.value === 'static'
                ? { source: 'static', value: '', key: undefined }
                : { source: 'column', key: '', value: undefined })}
              options={[{ value: 'column', label: 'Column from file' }, { value: 'static', label: 'Fixed text' }]}
            />
          </div>
          <div style={{ flex: '1 1 12rem', minWidth: '12rem' }}>
            {v.source === 'column' ? (
              columnOptions.length ? (
                <Select aria-label={`{{${i + 1}}} column`} value={v.key || ''} disabled={disabled} onChange={(e) => update(i, { key: e.target.value })} placeholder="Choose column…" options={columnOptions} />
              ) : (
                <Input aria-label={`{{${i + 1}}} column`} value={v.key || ''} disabled={disabled} onChange={(e) => update(i, { key: e.target.value })} placeholder="Column header, e.g. Name or OrderNumber" />
              )
            ) : (
              <Input aria-label={`{{${i + 1}}} text`} value={v.value || ''} disabled={disabled} onChange={(e) => update(i, { value: e.target.value })} placeholder="Same text for every contact" />
            )}
          </div>
          {!disabled && <Button variant="quiet" onClick={() => remove(i)} aria-label={`Remove {{${i + 1}}}`}>Remove</Button>}
        </div>
      ))}
      {!disabled && value.length < MAX_VARS && (
        <div><Button variant="quiet" onClick={add}>+ Add variable</Button></div>
      )}
    </div>
  );
}

export default function CampaignForm({
  form, onChange, errors = {}, section = 'all', columns = null, disabled = false,
}) {
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.value });
  return (
    <div className="c-stack">
      {section !== 'template' && (
        <FormGrid cols={2}>
          <Field label="Campaign name" required error={errors.name}>
            <Input autoFocus={section === 'details'} value={form.name} onChange={set('name')} disabled={disabled} placeholder="October New Offer" maxLength={150} />
          </Field>
        </FormGrid>
      )}
      {section !== 'details' && (
        <>
          <FormGrid cols={3}>
            <Field label="WhatsApp template name" required span={2} error={errors.template_name} hint="Must match the approved template in Interakt exactly">
              <Input value={form.template_name} onChange={set('template_name')} disabled={disabled} placeholder="new_offer" />
            </Field>
            <Field label="Template language" required error={errors.language_code}>
              <Input value={form.language_code} onChange={set('language_code')} disabled={disabled} placeholder="en" />
            </Field>
            <Field label="Header media URL (optional)" span={3} error={errors.header_media_url} hint="Public https:// image, video or PDF used in the template header">
              <Input value={form.header_media_url} onChange={set('header_media_url')} disabled={disabled} placeholder="https://example.com/offer.jpg" />
            </Field>
          </FormGrid>
          <Field
            label="Template body variables"
            error={errors.body_variables}
            hint="{{1}} defaults to the Name column. Add one entry per variable in the approved template, in order."
          >
            <BodyVariablesEditor
              value={form.body_variables}
              onChange={(body_variables) => onChange({ ...form, body_variables })}
              columns={columns}
              disabled={disabled}
            />
          </Field>
          <Field label="Template body text (for preview only)" hint="Paste the approved body, e.g. Hi {{1}}, we have a special offer for you… It is not sent — Interakt uses the approved template.">
            <Textarea rows={4} value={form.preview_body} onChange={set('preview_body')} disabled={disabled} maxLength={1024} />
          </Field>
        </>
      )}
    </div>
  );
}
