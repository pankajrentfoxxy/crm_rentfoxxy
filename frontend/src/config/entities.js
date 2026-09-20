/**
 * The two books (Decision 1 / 7).
 *
 * BLOCKER 2 of Part 1: the sale book's brand name is not settled. Nothing in a
 * component may hardcode "Gorefurbo" or the colour — the label is read from
 * here and the colour from --entity-sale, so renaming later costs one string
 * and one token rather than a repaint.
 *
 * `code` stays `gorefurbo` in the database regardless of what the marketplace
 * is finally called. The display name is the thing that changes.
 */
export const ENTITY = {
  RENTAL: 'rental',
  SALE: 'sale',
};

export const ENTITIES = {
  [ENTITY.RENTAL]: {
    key: ENTITY.RENTAL,
    /** entity_code as stored */
    code: 'rentfoxxy',
    label: 'RentFoxxy',
    /** CSS var for the 4px left edge. Never used for state, never fills a surface. */
    edgeVar: '--entity-rental',
  },
  [ENTITY.SALE]: {
    key: ENTITY.SALE,
    code: 'gorefurbo',
    // Placeholder until the brand lands — see BLOCKER 2.
    label: 'Gorefurbo',
    edgeVar: '--entity-sale',
  },
};

/** Accepts either the UI key (rental|sale) or the stored code (rentfoxxy|gorefurbo). */
export function resolveEntity(entity) {
  const key = String(entity || '').toLowerCase();
  if (ENTITIES[key]) return ENTITIES[key];
  const byCode = Object.values(ENTITIES).find((e) => e.code === key);
  return byCode || null;
}

export function entityLabel(entity) {
  return resolveEntity(entity)?.label || '';
}
