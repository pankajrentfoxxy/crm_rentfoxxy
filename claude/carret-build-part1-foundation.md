# Carret — Build Prompt, Part 1 of 6: Foundation

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy`
**Branch:** create `carret-foundation` **off `new_stagging_crm`** (head `10c2778a`). Promote to `new_crm_rentfoxxy` after sign-off; never commit to production directly.
**⚠️ `new_stagging_crm` is connected to the same LIVE database as production.** Part 1 writes no migration and no backend code, so this is not a risk *here* — but it is the reason rule 4 below is absolute, and it governs every later part.

---

## Why this is six prompts and not one

A single prompt covering the whole redesign will not survive contact with any agent, Claude Code included — it runs out of context halfway through, starts inventing file paths, and you get a half-migrated app on a live database. The split below is by dependency, not by size. Each part is independently runnable and independently revertible.

| Part | Scope | Touches DB? |
|---|---|---|
| **0** | The three money leaks — BL1, V2, BL3 | Yes, 3 small backend fixes |
| **1** | **Foundation** — tokens, densities, primitives, shells, permission-driven navigation, canonical status lists | **No. Frontend + one read-only query.** |
| 2 | Stock — asset record, the timeline component, the event read model | Yes |
| 3 | Move — DC, guard gate with `at_gate`, delivery, tracking | Yes |
| 4 | Sell — leads, quotations, orders, two entities; retire the legacy chain | Yes |
| 5 | Procure & Produce — PO, GRN, floor pipeline, QC | Yes |
| 6 | Money, then Serve (support v2) | Yes |

**Part 1 writes no migration and changes no data.** It builds the system everything else is drawn in, and it produces the *proposed* status mapping as a document for human approval — it does not apply it. That is deliberate: you do not migrate a live database inside the same prompt that is rewriting your CSS.

---

## HARD RULES — these override anything else in this document

1. **Inspect the existing codebase before writing anything.** Every claim in the "what already exists" section below was verified on `new_stagging_crm` at `10c2778a`. If what you find differs, stop and report the difference rather than working around it.
2. **Do not create a duplicate flow.** If a component, hook, helper or endpoint already exists, extend it. This codebase's central problem is that everything exists twice — do not make it three times.
3. **Do not create parallel APIs.** Part 1 adds **no** backend endpoints.
4. **Do not run any migration.** Do not write to `vendor_serial_numbers`, `tickets`, `support_tickets`, `delivery_challan_lines` or any other table. The only SQL in this part is a `SELECT` you run and paste into a document.
5. **Do not delete any route or page.** Part 1 *inventories* the unreachable routes into three buckets and hands the list over. Deletion is a human decision.
6. **Do not touch `backend/`** except to read it. If a task below seems to need a backend change, it belongs in a later part — report it and move on.
7. Old and new must coexist. Every existing screen keeps working while the new system is built beside it, behind a flag.

---

## Context: what already exists (verified on `new_stagging_crm` at `10c2778a`)

Read these before starting. They are the ground truth this part is built on.

**Frontend**
- `frontend/tailwind.config.js` — 9 lines. `theme.extend` is `{}`. There is no design system today.
- `frontend/src/components/ui/primitives.jsx` — 433 lines, 11 exports. `ResponsiveTable` is used in 9 of 133 files; `EmptyState` is used in 0.
- `frontend/src/layout/Layout.jsx` — 1,605 lines. Thirteen accordion `useState`s, three dead renderers, a non-collapsible `w-64` sidebar, a static topbar title.
- `frontend/src/config/menuConfig.js` — 512 lines, 13 `MENU_GROUPS`. `isPartsManagementRoute()` hardcodes 8 route prefixes. All four Production children point at `/floor-pipeline/tickets?stage=X`.
- Roughly **64 routed pages are unreachable from the menu**, including three purchase-type pages and the vendor billing overview.
- The support module's own sidebar (`components/support/SupportShell.jsx:81-95`) gates on `user?.role` directly rather than on the permission matrix.

**Backend (read-only for this part)**
- `middleware/checkSectionPermission.js` — the section matrix. This is the permission source of truth going forward.
- `services/dataScopeService.js:8-28` — `SO_VIEW_SECTIONS`, `SO_SERIAL_EDIT_SECTIONS`. The section names you need are here.
- Known defect, **do not fix in this part**: `routes/vendorManagement.js:24-27` defines `authorize` as `checkSectionPermission('vendor_management','view')` and uses it to gate create, edit and delete. Part 6 fixes it. Part 1 must not model the frontend on it.

**Reference documents — read all three before starting:**
- `claude/flow-audit.md` — 141 findings with file:line. Finding IDs are cited throughout this prompt.
- `claude/pre-redesign-decisions.md` — the seven decisions and their reasoning.
- `claude/bypass-register.md` — the enumerated asset-status bypass list. Not used in Part 1, but read it so you know what Part 2 will change.

---

# PHASE 1 — The token system

Create `frontend/src/styles/carret.css`. **Paste the block below verbatim.** Do not "tidy" it, do not convert the tokens to Tailwind-only, do not move the dark declarations into the light block.

Two things in here look redundant and are not:

- Every token is declared on bare `:root` **before** any media query or `[data-theme]` block redefines it. A colour whose only definition lives inside `@media (prefers-color-scheme: dark)` is undefined for viewers on the default "system" setting, and you get one theme's text on the other theme's ground.
- The dark block is guarded `:root:not([data-theme="light"])` and then repeated under `:root[data-theme="dark"]`. The guard makes an explicit light choice beat a dark OS; the repeat makes the toggle win in the other direction. Both are needed.

```css
/* =====================================================================
   CARRET — token system
   Light ("paper") is the base and the one that prints.
   Dark ("graphite") is a selected theme: its steps are re-picked against
   the dark ground, not dimmed versions of the light ones.
   ===================================================================== */
:root{
  color-scheme: light;

  /* --- surfaces --- */
  --ground:        #EFEFEB;
  --surface:       #FBFAF6;
  --surface-2:     #F4F3ED;
  --surface-3:     #EAE9E1;
  --surface-sunk:  #E3E2D9;

  /* --- ink --- */
  --ink:           #14151A;
  --ink-2:         #4A4E55;
  --ink-3:         #7E848B;
  --ink-inverse:   #FBFAF6;

  /* --- rules --- */
  --rule:          #E2DED2;
  --rule-2:        #CBC6B8;
  --rule-strong:   #14151A;

  /* --- accent: one navy ink, used for interaction only --- */
  --accent:        #0F4C81;
  --accent-hover:  #0B3C68;
  --accent-soft:   #DFE9F2;
  --accent-ink:    #FFFFFF;

  /* --- entity edge (Decision 1 / 7) -------------------------------
     4px left edge on any record belonging to one book.
     NEVER used for state. NEVER recolours a surface.
     The sale-book label comes from config, not from this file — the
     marketplace brand name is not settled, and renaming it later must
     cost one string, not a repaint.                                  */
  --entity-rental: #E2571F;   /* RentFoxxy */
  --entity-sale:   #16605A;   /* placeholder until the brand lands */

  /* --- lifecycle families (Decision 3) -----------------------------
     FOUR chromatic families, not twelve statuses. Validated against
     #FBFAF6: lightness band PASS, chroma floor PASS, CVD separation
     PASS (worst pair 10.2 protan), normal-vision floor PASS (18.4),
     contrast PASS. Re-run the validator before changing any of them.  */
  --lc-idle:       #0C5EA6;   /* in_stock                              */
  --lc-earning:    #0E6B3E;   /* rented, on_demo                       */
  --lc-moving:     #AD8200;   /* reserved, dispatch_ready, at_gate, in_transit */
  --lc-offcycle:   #D05F97;   /* qc_failed, in_repair, returned        */
  --lc-closed:     #6E6C68;   /* sold, scrapped — deliberately neutral */

  --lc-idle-soft:     #E0EAF4;
  --lc-earning-soft:  #DFEDE5;
  --lc-moving-soft:   #F2EBD6;
  --lc-offcycle-soft: #F7E4EE;
  --lc-closed-soft:   #E8E7E3;

  /* --- reserved alert palette -------------------------------------
     Separate from the lifecycle families and NEVER reused as a chart
     series. Always shipped with an icon and a word.                  */
  --alert-good:    #1F7A3D;
  --alert-warn:    #8A6410;
  --alert-serious: #B4531C;
  --alert-crit:    #A62015;

  /* --- type --- */
  --font-ui:    "Archivo", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono:  "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;

  /* --- density: DESK (default) ------------------------------------
     The three shells set --density on their own root. Never set a
     hard pixel size on a component; read these.                      */
  --d-base:      13px;   /* body text                    */
  --d-sm:        11.5px;
  --d-lg:        15px;
  --d-row:       28px;   /* table row / list row height  */
  --d-tap:       28px;   /* minimum interactive target   */
  --d-gap:       4px;    /* base spacing unit            */
  --d-pad-x:     12px;
  --d-pad-y:     6px;
  --d-radius:    3px;
}

/* --- density: FIELD (support technician, tablet) --- */
[data-density="field"]{
  --d-base: 15px;  --d-sm: 13px;   --d-lg: 17px;
  --d-row: 40px;   --d-tap: 40px;  --d-gap: 6px;
  --d-pad-x: 16px; --d-pad-y: 10px; --d-radius: 4px;
}

/* --- density: FLOOR (guard, bench technician) --- */
[data-density="floor"]{
  --d-base: 17px;  --d-sm: 14px;   --d-lg: 21px;
  --d-row: 52px;   --d-tap: 48px;  --d-gap: 8px;
  --d-pad-x: 20px; --d-pad-y: 14px; --d-radius: 5px;
}

/* --- theme: GRAPHITE, for viewers on system-dark --- */
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --ground:#0D1014; --surface:#161B21; --surface-2:#1D242B; --surface-3:#242D35;
    --surface-sunk:#0A0D11;
    --ink:#E7EAED; --ink-2:#9AA3AC; --ink-3:#6A737C; --ink-inverse:#0D1014;
    --rule:#242C34; --rule-2:#333D46; --rule-strong:#E7EAED;
    --accent:#5AA0E0; --accent-hover:#7AB4E9; --accent-soft:#12283C; --accent-ink:#0D1014;
    --entity-rental:#F07341; --entity-sale:#3E9187;
    --lc-idle:#3E88CC; --lc-earning:#2E9A64; --lc-moving:#B78A1E; --lc-offcycle:#C86FA0;
    --lc-closed:#7C848B;
    --lc-idle-soft:#12253A; --lc-earning-soft:#10281C; --lc-moving-soft:#2A2312;
    --lc-offcycle-soft:#30192A; --lc-closed-soft:#1E2329;
    --alert-good:#3FA06B; --alert-warn:#C9971F; --alert-serious:#D2673A; --alert-crit:#E0524B;
  }
}
/* --- theme: GRAPHITE, chosen explicitly --- */
:root[data-theme="dark"]{
  color-scheme: dark;
  --ground:#0D1014; --surface:#161B21; --surface-2:#1D242B; --surface-3:#242D35;
  --surface-sunk:#0A0D11;
  --ink:#E7EAED; --ink-2:#9AA3AC; --ink-3:#6A737C; --ink-inverse:#0D1014;
  --rule:#242C34; --rule-2:#333D46; --rule-strong:#E7EAED;
  --accent:#5AA0E0; --accent-hover:#7AB4E9; --accent-soft:#12283C; --accent-ink:#0D1014;
  --entity-rental:#F07341; --entity-sale:#3E9187;
  --lc-idle:#3E88CC; --lc-earning:#2E9A64; --lc-moving:#B78A1E; --lc-offcycle:#C86FA0;
  --lc-closed:#7C848B;
  --lc-idle-soft:#12253A; --lc-earning-soft:#10281C; --lc-moving-soft:#2A2312;
  --lc-offcycle-soft:#30192A; --lc-closed-soft:#1E2329;
  --alert-good:#3FA06B; --alert-warn:#C9971F; --alert-serious:#D2673A; --alert-crit:#E0524B;
}

@media (prefers-reduced-motion: reduce){
  *{animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important}
}
```

### Fonts

Add to `frontend/public/index.html`, before the app stylesheet:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
```

Both faces carry real fallback stacks in the tokens above. **Never** set a font family anywhere but through `--font-ui` / `--font-mono`.

### The colour rules, stated once

- **Accent is for interaction only.** Links, focus rings, primary buttons, the selected tab. It never encodes state.
- **Lifecycle families encode asset state.** Four hues plus neutral. A chip is `background: var(--lc-*-soft)`, `color: var(--lc-*)`, plus **a word and a glyph, always**. The dark-mode pairs sit in the 6–8 CVD floor band, which is legal only with that secondary encoding — so the word is not optional and neither is the glyph.
- **The alert palette is reserved.** Never a chart series, never a lifecycle family, never decorative.
- **The entity edge is neither.** A 4px left border and nothing else.
- **Text always wears an ink token.** A value never takes the colour of the thing it describes.

---

# PHASE 2 — Tailwind

Rewrite `frontend/tailwind.config.js` to expose the tokens. It maps; it does not define. Every value is `var(--token)`, so themes and densities keep working through Tailwind classes.

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground:'var(--ground)',
        surface:{ DEFAULT:'var(--surface)', 2:'var(--surface-2)', 3:'var(--surface-3)', sunk:'var(--surface-sunk)' },
        ink:{ DEFAULT:'var(--ink)', 2:'var(--ink-2)', 3:'var(--ink-3)', inverse:'var(--ink-inverse)' },
        rule:{ DEFAULT:'var(--rule)', 2:'var(--rule-2)', strong:'var(--rule-strong)' },
        accent:{ DEFAULT:'var(--accent)', hover:'var(--accent-hover)', soft:'var(--accent-soft)', ink:'var(--accent-ink)' },
        entity:{ rental:'var(--entity-rental)', sale:'var(--entity-sale)' },
        lc:{
          idle:'var(--lc-idle)', earning:'var(--lc-earning)', moving:'var(--lc-moving)',
          offcycle:'var(--lc-offcycle)', closed:'var(--lc-closed)',
          'idle-soft':'var(--lc-idle-soft)', 'earning-soft':'var(--lc-earning-soft)',
          'moving-soft':'var(--lc-moving-soft)', 'offcycle-soft':'var(--lc-offcycle-soft)',
          'closed-soft':'var(--lc-closed-soft)',
        },
        alert:{ good:'var(--alert-good)', warn:'var(--alert-warn)', serious:'var(--alert-serious)', crit:'var(--alert-crit)' },
      },
      fontFamily:{ ui:'var(--font-ui)', mono:'var(--font-mono)' },
      fontSize:{ d:'var(--d-base)', 'd-sm':'var(--d-sm)', 'd-lg':'var(--d-lg)' },
      spacing:{ 'd':'var(--d-gap)', 'd-x':'var(--d-pad-x)', 'd-y':'var(--d-pad-y)' },
      height:{ row:'var(--d-row)', tap:'var(--d-tap)' },
      minHeight:{ tap:'var(--d-tap)' },
      borderRadius:{ d:'var(--d-radius)' },
    },
  },
  plugins: [],
};
```

**Lint rule to add and enforce from this point on:** no hex literal, no `rgb()`, no `text-gray-500`, no `bg-blue-600` anywhere in `src/`. Add an ESLint rule or a CI grep. Every colour comes from a token. This is the one rule that decides whether dark mode still works in six months.

---

# PHASE 3 — Primitives

Rebuild `frontend/src/components/ui/primitives.jsx` into a directory, `frontend/src/components/carret/`. Keep the existing file exporting from the new one so nothing breaks while screens migrate.

Every component below reads density from CSS variables. **No component may hardcode a pixel size.**

### Core

| Component | Notes |
|---|---|
| `<StatusChip status entity? />` | Takes a **canonical** status string (Phase 6). Resolves its family, renders soft background + family ink + glyph + word. Never colour alone. Unknown status renders neutral with the raw string and a dev-mode console warning — it must be visible, not silently swallowed. |
| `<EntityEdge entity />` | 4px left border. `entity` is `rental \| sale`. Label text comes from `config/entities.js`, never hardcoded. |
| `<DataTable columns rows />` | Replaces `ResponsiveTable`. Sticky header, `height: var(--d-row)`, tabular numerals on numeric columns, horizontal scroll in its own container so the page body never scrolls sideways, keyboard row navigation, and a real `<EmptyState>` when `rows` is empty. |
| `<Timeline events />` | **The most important new component.** Renders the event stream for any entity: date, actor, event, reference. Groups by day. Handles a 200-event history without pagination jank. Part 2 wires it to real data; Part 1 builds it against a fixture. |
| `<StatTile label value delta? family? />` | Tabular numerals. `family` tints the value, never the whole tile. No tile without a real figure behind it. |
| `<DocumentHeader docNumber type entity status actions />` | The header every document screen shares — DC, SO, GRN, invoice, ticket. One component, one layout, so a challan and an invoice do not drift apart. |
| `<Money value currency="INR" />` | `₹` prefix, Indian digit grouping (`1,23,456`), tabular numerals, negative in `--alert-crit` with a minus sign, never parentheses. |
| `<DocNumber value />` | Monospace, never wraps mid-number, click-to-copy. |
| `<DateTime value format />` | One place that formats dates. `DD MMM YY` by default; never a raw ISO string on screen. |
| `<FilterBar />` | One row above content. Filters **combine** — vendor + period returns the intersection, not the last one clicked. |
| `<EmptyState title body action? />` | Currently used zero times. It should be used everywhere a list can be empty. |
| `<ScanPanel expected onScan />` | Floor density only. Large input, autofocus, per-unit expected/scanned/matched list, audible and visual confirm. Built here, used by the gate in Part 3. |
| `<Drawer />` `<ConfirmDialog />` | Focus trap, `Esc` closes, focus returns to the trigger. |

### Rules that apply to all of them

- Keyboard focus is always visibly styled. `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`.
- Nothing has a `min-width` wider than a phone screen.
- Any text that can outgrow its container wraps or scrolls **in that container**. Clipped text is a bug, not a style.
- Repeated things share one object: cards in a row have identical edges, baselines and inner padding.
- Not everything is a card. Border, fill, radius and shadow are spent by role, to lift the one thing that needs lifting.

---

# PHASE 4 — The three shells

Create `frontend/src/shells/`. All three share every component from Phase 3; they differ only in `data-density`, chrome and navigation depth.

**`<DeskShell>`** — `data-density="desk"`. Collapsible sidebar (fixes the `w-64` non-collapsible sidebar), topbar with the **actual page title** (currently static), global search, breadcrumb, theme toggle. Replaces `Layout.jsx`. Delete the three dead renderers and collapse the thirteen accordion `useState`s into one `useState(openSection)` — thirteen booleans is why only one section can be open at a time by accident.

**`<FieldShell>`** — `data-density="field"`. Support technician. Bottom tab bar, no sidebar, one task per screen, back always visible. Offline-tolerant: queue writes, show a pending badge, reconcile on reconnect.

**`<GateShell>`** — `data-density="floor"`. Guard. Scan-first: the scanner input holds focus at all times. No sidebar, no breadcrumb, no search. Two modes only, **Outward** and **Inward**, switched by a single control. High contrast; legible in daylight and in the dark.

A `<DensityProvider>` sets `data-density` on the shell root. A screen never sets its own density — it is a property of who is using it, not of what it shows.

---

# PHASE 5 — Navigation generated from the permission matrix

This is the phase that fixes ~64 unreachable pages and makes role-aware navigation possible (findings X3, X6, U26).

**Replace `menuConfig.js` with a declarative tree** where every leaf carries the section and action it requires:

```js
// frontend/src/config/navigation.js
export const SECTIONS = [
  { key:'procure', label:'Procure', items:[
      { to:'/vendor-management/purchase-orders', label:'Purchase Orders', section:'vendor_management', action:'view' },
      { to:'/vendor-management/grn',             label:'GRN',             section:'vendor_management', action:'view' },
      // …
  ]},
  { key:'produce', label:'Produce', items:[ /* floor pipeline, QC1, QC2, parts, repairs */ ]},
  { key:'stock',   label:'Stock',   items:[ /* assets, carrets, availability, purchase types */ ]},
  { key:'sell',    label:'Sell',    items:[ /* leads, quotations, orders — entity is a filter INSIDE, not a branch */ ]},
  { key:'move',    label:'Move',    items:[ /* challans, gate, courier, delivery, tracking */ ]},
  { key:'serve',   label:'Serve',   items:[ /* support — placeholder until Part 6 */ ]},
  { key:'money',   label:'Money',   items:[ /* invoices, vendor bills, credit notes, payments */ ]},
  { key:'control', label:'Control', items:[ /* roles, masters, audit, settings */ ]},
];
```

Rules:

1. **The menu renders from this file and nothing else.** No hardcoded route-prefix helpers — delete `isPartsManagementRoute()` and its eight prefixes.
2. **Visibility is decided by `usePermission(section, action)`**, which reads the same section matrix the backend enforces. Not `user.role`. A section with no visible children does not render.
3. **The RentFoxxy / Gorefurbo split lives inside Sell**, as a filter on the list screens — never as two menu branches. One laptop crossing books must not cross sections.
4. Every leaf's `to` must resolve to a real route. **Build a CI check that fails if a route in the router has no navigation entry and is not on the explicit `UNREACHABLE_BY_DESIGN` allowlist.** That check is what stops this from happening again.

### The route inventory (deliverable, not a deletion)

Produce `docs/route-inventory.md` listing every routed path, sorted into exactly three buckets:

- **A — Legacy chain.** Belongs to `/api/sales` (`Orders.jsx`, `Sales.jsx`, `QCOrders.jsx`, `Dispatch.jsx` and anything only they reach). Retired in Part 4.
- **B — True duplicate.** A reachable page already does this. Candidate for deletion.
- **C — Finished work, no menu entry.** The three purchase-type pages, the vendor billing overview page, and similar. These get a navigation entry in this part.

**Do not delete anything.** Bucket B goes to a human.

---

# PHASE 6 — Canonical status lists

The deliverable that makes the state palette mean something. **Produce documents and a constants file. Write no migration.**

### 6.1 — Measure

Run against the live database, **read-only**, and paste the output into `docs/status-census.md`:

```sql
-- assets
SELECT COALESCE(inventory_status,'<null>') AS inventory_status,
       COALESCE(qc_status,'<null>')        AS qc_status,
       count(*)
  FROM vendor_serial_numbers
 WHERE deleted_at IS NULL
 GROUP BY 1,2 ORDER BY 3 DESC;

-- delivery challans
SELECT COALESCE(status,'<null>'), COALESCE(movement_type,'<null>'), count(*)
  FROM delivery_challan_lines GROUP BY 1,2 ORDER BY 3 DESC;

-- production tickets
SELECT COALESCE(t.status,'<null>'), COALESCE(s.stage_name,'<null>'), count(*)
  FROM tickets t LEFT JOIN stages s ON s.stage_id = t.current_stage_id
 GROUP BY 1,2 ORDER BY 3 DESC;

-- support
SELECT COALESCE(status,'<null>'), count(*) FROM support_tickets GROUP BY 1 ORDER BY 2 DESC;
SELECT COALESCE(status,'<null>'), count(*) FROM support_ticket_items GROUP BY 1 ORDER BY 2 DESC;
```

You cannot plan a mapping without the real distribution. The counts decide which strays matter.

### 6.2 — The canonical asset list

Create `frontend/src/config/statuses.js` and `backend/constants/statuses.js` from the same source. Twelve canonical values in four families plus closed:

| Canonical | Family | Means |
|---|---|---|
| `in_stock` | idle | On the shelf, QC-passed, attachable |
| `reserved` | moving | Attached to a sales order |
| `dispatch_ready` | moving | On a challan, not yet through the gate |
| `at_gate` | moving | **New (Decision 4).** In the guard's custody, either direction |
| `in_transit` | moving | Scanned out, not yet delivered |
| `rented` | earning | With a customer, rent accruing |
| `on_demo` | earning | With a customer on demo |
| `sold` | closed | Title transferred |
| `returned` | offcycle | Back in the building, awaiting QC |
| `in_repair` | offcycle | Out for repair or on the bench |
| `qc_failed` | offcycle | Failed QC, needs a decision |
| `scrapped` | closed | Terminal |

### 6.3 — The proposed mapping

Write `docs/status-mapping-proposal.md`. Every stray value found in 6.1, its count, its proposed canonical target, and the reasoning:

| Stray | Proposed | Why |
|---|---|---|
| `out_stock` | `rented` | Read in 12 places as "deployed"; written by no current code — an ERP import artefact |
| `passed` | `in_stock` | A `qc_status` value that leaked into `inventory_status` |
| `out_for_repare` | `in_repair` | Spelling variant of an existing family |
| `out_for_return` | `returned` | |
| `repared` | `in_stock` | Repair completed, back on the shelf |
| `replace` | `returned` | Awaiting replacement handling |
| `qc_reject` | `qc_failed` | |
| `require_for_parts` | `scrapped` | Harvested for parts — terminal |
| `send_to_qc_check` | `qc_failed` | Pending a QC decision |
| `missing` | **ASK** | Is a missing laptop written off, or still owed by someone? A business answer, not a technical one. |
| `deleted` | **ASK** | Script-written. Are these real assets or test rows? |

**The two marked ASK go to a human before anything is decided.** Do not guess and do not default them.

Also in this document, for later parts (do not implement now):

- The migration must preserve the original value (`extra.legacy_status`) so the mapping stays auditable.
- It must write an `inventory_status_transitions` row per change with `reason = 'canonicalisation'`, so the migration appears in the asset's own timeline rather than as an unexplained jump.
- **The CHECK constraint goes on last**, after the 32 state-machine bypasses are closed (finding I3). Adding it earlier converts thirty-two existing bugs into production 500s.

### 6.4 — The display map

`statusFamily(status)` returns `idle | earning | moving | offcycle | closed`. One function, used by `<StatusChip>`, every chart series and every row stripe. An unrecognised status returns `closed` **and warns in development** — silence is how twenty statuses accumulated in the first place.

---

# PHASE 7 — One proving screen

Build exactly one screen end to end in the new system so the foundation is proven before six more parts are built on it: **the asset record at `/stock/assets/:ttspl`**.

It uses `DocumentHeader`, `StatusChip`, `EntityEdge`, `StatTile`, `Timeline`, `DataTable`, `Money`, `DocNumber`, `DateTime` — that is, almost every primitive. It reads from existing endpoints only. The `Timeline` runs on a fixture until Part 2.

Ship it behind `REACT_APP_CARRET=1` at `/carret/stock/assets/:ttspl`, beside the existing page. Nothing is replaced in this part.

---

# ACCEPTANCE TESTS

Part 1 is done when all of these pass. Each is checkable, not a matter of opinion.

1. **Token coverage.** `grep -rEn "#[0-9a-fA-F]{6}|rgb\(|text-(gray|blue|red|green|yellow)-[0-9]" frontend/src/components/carret frontend/src/shells` returns nothing.
2. **Three themes, not two.** The proving screen renders correctly with `data-theme="light"`, with `data-theme="dark"`, and with **no attribute at all** under both OS settings. The third case is the one that breaks; test it explicitly.
3. **Three densities.** The same screen renders at `desk`, `field` and `floor` with no layout break and no clipped text. At `floor`, every interactive target measures ≥ 44px.
4. **No horizontal page scroll** at 390px width on any shell. Tables scroll inside their own container.
5. **Navigation is generated.** Adding a leaf to `navigation.js` makes it appear; removing a permission makes it disappear. No component reads `user.role` to decide visibility.
6. **The route check runs.** CI fails when a route exists with no navigation entry and no allowlist entry. Prove it by adding a dummy route.
7. **Chip integrity.** Every `<StatusChip>` renders a glyph and a word. Rendering an unknown status produces a visible neutral chip and a console warning, never a blank.
8. **Palette holds.** Re-running the validator on `#0C5EA6,#0E6B3E,#AD8200,#D05F97` against `#FBFAF6`, and on `#3E88CC,#2E9A64,#B78A1E,#C86FA0` against `#0D1014`, still passes every check.
9. **Nothing broke.** Every existing route renders exactly as before. `REACT_APP_CARRET=0` returns the app to its current state completely.
10. **No backend diff.** `git diff --stat new_crm_rentfoxxy..carret-foundation -- backend/` is empty except for `backend/constants/statuses.js`.
11. **No data touched.** No migration file added. No `UPDATE`, `INSERT` or `DELETE` run against the live database.

---

# BLOCKERS — stop and ask, do not decide

1. **`missing` and `deleted`** asset statuses (6.3). Business answers required.
2. **The sale book's brand name and colours.** `--entity-sale: #16605A` is a placeholder and the label comes from config. Do not hardcode "Gorefurbo" anywhere in a component.
3. **Bucket B of the route inventory** — anything you believe is a true duplicate. List it; do not delete it.
4. **Any existing component you believe should be deleted rather than migrated.** Say so; do not delete it in this part.
5. **Anything in "what already exists" that does not match what you find.** Report the difference rather than adapting around it — the audit is the shared map and a divergence means the map is wrong.
