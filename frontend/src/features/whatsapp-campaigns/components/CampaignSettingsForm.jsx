import React from 'react';
import BodyVariablesEditor from './BodyVariablesEditor';

export const EMPTY_CAMPAIGN = {
  name: '',
  template_name: '',
  language_code: 'en',
  header_media_url: '',
  body_variables: [{ source: 'column', key: 'name' }],
  preview_body: '',
};

export function toCampaignForm(c) {
  return {
    name: c?.name || '',
    template_name: c?.template_name || '',
    language_code: c?.language_code || 'en',
    header_media_url: c?.header_media_url || '',
    body_variables: Array.isArray(c?.body_variables) ? c.body_variables : EMPTY_CAMPAIGN.body_variables,
    preview_body: c?.preview_body || '',
  };
}

/** Client-side checks that mirror the backend, so mistakes show before saving. */
export function validateCampaignForm(form, { section = 'all' } = {}) {
  const errors = {};
  if (section !== 'template' && !form.name.trim()) errors.name = 'Campaign name is required';
  if (section !== 'details') {
    if (!/^[a-z0-9_]{1,120}$/.test(form.template_name.trim())) {
      errors.template_name = 'Use the exact Interakt template name (lowercase letters, numbers and _)';
    }
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(form.language_code.trim())) errors.language_code = 'e.g. en, en_US, hi';
    const url = form.header_media_url.trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) errors.header_media_url = 'Must be a public https:// URL';
    form.body_variables.forEach((v, i) => {
      if (v.source === 'column' && !String(v.key || '').trim()) errors.body_variables = `{{${i + 1}}}: choose a column`;
      if (v.source === 'static' && !String(v.value || '').trim()) errors.body_variables = `{{${i + 1}}}: enter the fixed text`;
    });
  }
  return errors;
}

const Field = ({ label, hint, error, children }) => (
  <label className="block">
    <span className="text-sm font-medium text-slate-700">{label}</span>
    <div className="mt-1">{children}</div>
    {error ? <span className="text-xs text-red-600">{error}</span> : hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
  </label>
);

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] disabled:bg-slate-50';

/**
 * section: 'details' (step 1), 'template' (step 2) or 'all' (edit on detail page).
 */
export default function CampaignSettingsForm({
  form, onChange, errors = {}, section = 'all', columns = null, disabled = false,
}) {
  const set = (k) => (e) => onChange({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-4">
      {section !== 'template' && (
        <Field label="Campaign name" error={errors.name}>
          <input className={inputCls} value={form.name} onChange={set('name')} disabled={disabled} placeholder="October New Offer" maxLength={150} />
        </Field>
      )}
      {section !== 'details' && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Field label="WhatsApp template name" error={errors.template_name} hint="Must match the approved template in Interakt exactly">
                <input className={`${inputCls} font-mono`} value={form.template_name} onChange={set('template_name')} disabled={disabled} placeholder="new_offer" />
              </Field>
            </div>
            <Field label="Template language" error={errors.language_code}>
              <input className={`${inputCls} font-mono`} value={form.language_code} onChange={set('language_code')} disabled={disabled} placeholder="en" />
            </Field>
          </div>
          <Field label="Header media URL (optional)" error={errors.header_media_url} hint="Public https:// image/video/PDF used in the template header">
            <input className={inputCls} value={form.header_media_url} onChange={set('header_media_url')} disabled={disabled} placeholder="https://example.com/offer.jpg" />
          </Field>
          <div>
            <span className="text-sm font-medium text-slate-700">Template body variables</span>
            <p className="text-xs text-slate-500 mb-2">
              {'{{1}}'} defaults to the Name column. Add one entry per variable in the approved template, in order.
            </p>
            <BodyVariablesEditor
              value={form.body_variables}
              onChange={(body_variables) => onChange({ ...form, body_variables })}
              columns={columns}
              disabled={disabled}
            />
            {errors.body_variables && <span className="text-xs text-red-600">{errors.body_variables}</span>}
          </div>
          <Field label="Template body text (for preview only)" hint="Paste the approved body, e.g. Hi {{1}}, we have a special offer for you… It is not sent — Interakt uses the approved template.">
            <textarea className={`${inputCls} min-h-[96px]`} value={form.preview_body} onChange={set('preview_body')} disabled={disabled} maxLength={1024} />
          </Field>
        </>
      )}
    </div>
  );
}
