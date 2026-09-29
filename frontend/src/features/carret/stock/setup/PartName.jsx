import React from 'react';
import { partCategoryLabel } from '../../../../constants/laptopConditions';

const chipStyle = {
  height: '20px',
  padding: '0 7px',
  fontSize: 'var(--d-sm)',
  background: 'var(--surface-3)',
  color: 'var(--ink-2)',
  border: '1px solid var(--rule)',
};

/** The part's category as a small neutral chip ("RAM", "Body / Casing"). */
export function CategoryChip({ category }) {
  const c = String(category || '').trim().toLowerCase();
  if (!c) return null;
  return <span className="c-chip font-ui" style={chipStyle}>{partCategoryLabel(c)}</span>;
}

/**
 * A part as staff should read it everywhere: the (generated) part name and
 * its category chip. Pass a part row, or name + category.
 */
export default function PartName({ part, name, category, suffix }) {
  const n = name ?? part?.part_name ?? '';
  const c = category ?? part?.category ?? '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span>{n}{suffix || ''}</span>
      <CategoryChip category={c} />
    </span>
  );
}
