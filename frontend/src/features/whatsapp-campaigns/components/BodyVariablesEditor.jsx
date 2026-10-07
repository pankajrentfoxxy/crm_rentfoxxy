import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/primitives';

const MAX = 10;

/**
 * Edits template body variables: entry i fills {{i+1}} from a file column or fixed text.
 * value: [{ source: 'column', key } | { source: 'static', value }]
 * columns (optional): [{ key, label }] detected in the uploaded file — shown as a dropdown.
 */
export default function BodyVariablesEditor({ value = [], onChange, columns = null, disabled = false }) {
  const update = (i, patch) => onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const add = () => onChange([...value, { source: 'column', key: '' }]);
  const remove = (i) => onChange(value.filter((_, idx) => idx !== i));
  const columnOptions = (columns || []).filter((c) => c.key !== 'mobile');

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-slate-500">This template has no body variables.</p>}
      {value.map((v, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-12 font-mono text-sm text-slate-600">{`{{${i + 1}}}`}</span>
          <select
            value={v.source}
            disabled={disabled}
            onChange={(e) => update(i, e.target.value === 'static' ? { source: 'static', value: '', key: undefined } : { source: 'column', key: '', value: undefined })}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm min-h-[40px]"
          >
            <option value="column">Column from file</option>
            <option value="static">Fixed text</option>
          </select>
          {v.source === 'column' ? (
            columnOptions.length ? (
              <select
                value={v.key || ''}
                disabled={disabled}
                onChange={(e) => update(i, { key: e.target.value })}
                className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2 py-2 text-sm min-h-[40px]"
              >
                <option value="">Choose column…</option>
                {columnOptions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            ) : (
              <input
                value={v.key || ''}
                disabled={disabled}
                onChange={(e) => update(i, { key: e.target.value })}
                placeholder="Column header, e.g. Name or OrderNumber"
                className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[40px]"
              />
            )
          ) : (
            <input
              value={v.value || ''}
              disabled={disabled}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="Same text for every contact"
              className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[40px]"
            />
          )}
          {!disabled && (
            <button type="button" onClick={() => remove(i)} className="p-2 text-slate-400 hover:text-red-600" aria-label={`Remove {{${i + 1}}}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && value.length < MAX && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add variable</Button>
      )}
    </div>
  );
}
