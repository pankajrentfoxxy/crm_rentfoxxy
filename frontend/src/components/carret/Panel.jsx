import React from 'react';
import { resolveEntity } from '../../config/entities';

/**
 * The card a list lives in: an optional toolbar (normally a FilterBar) on top,
 * the table or its loading/empty state below, one frame around both.
 *
 * The toolbar stays mounted while the body swaps between loading, error and
 * rows — which is what keeps the search box focused while someone types.
 *
 * `entity` draws the book's 4px left edge on the card (see EntityEdge): the
 * same edge, carried by the frame instead of an extra wrapper.
 */
export default function Panel({ toolbar, title, actions, entity, children, className = '' }) {
  const ent = entity ? resolveEntity(entity) : null;
  return (
    <section
      className={`c-card ${className}`}
      style={ent ? { borderLeft: `4px solid var(${ent.edgeVar})` } : undefined}
      data-entity={ent?.key}
    >
      {(title || actions) && (
        <div className="c-card-h">
          {title && <h3>{title}</h3>}
          {actions && <div className="flex items-center" style={{ gap: '8px' }}>{actions}</div>}
        </div>
      )}
      {toolbar}
      {children}
    </section>
  );
}
