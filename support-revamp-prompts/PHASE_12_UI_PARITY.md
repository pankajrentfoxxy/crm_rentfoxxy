# PHASE 12 — UI parity: make the support module look like the mockup

> Read `00_MASTER_CONTEXT.md` first.
> **Branch:** `support_revamp`
> **Reference:** `docs/support-revamp/support-ui-mockup.html` — open it in a browser, side by side
> with the running app, for the whole of this phase.
> **Scope:** styling only. **No behaviour, no API, no schema, no permission changes.** If you find
> yourself editing a controller, a route or a query in this phase, stop — you have gone out of scope.

---

## 12.1 Diagnosis — why it does not match today

The tokens are correct and they are being used. I audited the branch:

- `tailwind.config.js` — all `pri1..pri4` and `sup.*` tokens present ✓
- `components/ui/supportPrimitives.jsx` — exists, 22 exports, correct tokens ✓
- Stock Tailwind palette classes inside `features/support-v2/`: **0 occurrences** ✓
- Design token classes inside `features/support-v2/`: **524 occurrences** ✓

So the problem is not the pages' own markup. It is this:

> **22 of the 36 support-v2 files import the shared CRM `components/ui/primitives.jsx`, which is
> still styled in the old CRM look.** Only 19 import `supportPrimitives.jsx`.

Every `Button`, `PageHeader`, `Badge`, `EmptyState`, `ResponsiveTable` and `ListPagination` on
every support screen is therefore rendering as CRM-blue, `rounded-xl`, 44px-tall furniture sitting
inside otherwise-correct petrol/ink chrome. That hybrid is exactly what reads as "not the same".

Evidence from `components/ui/primitives.jsx`:
```js
const BTN_VARIANTS = {
  primary:   'bg-blue-600 text-white hover:bg-blue-700 …',   // mockup: bg-sup-accent #134B60
  secondary: 'bg-white text-slate-700 border border-slate-300 …',
  subtle:    'bg-blue-50 text-blue-700 …',
};
const BTN_SIZES = { sm: 'text-xs px-3 min-h-[36px]', md: 'text-sm px-4 min-h-[44px]', … };
// Card:        'bg-white border border-slate-200 rounded-2xl shadow-sm'
// PageHeader:  renders a blue rounded icon chip — the mockup has no icon chip at all
// EmptyState:  'rounded-2xl border-slate-200', slate-300 icon, slate-400 hint
// SearchField: 'border-slate-200 rounded-lg py-2 text-sm min-h-[44px]'
```

Import counts of what is being pulled from the wrong file:
`Button` ×21 · `PageHeader` ×14 · `EmptyState` ×5 · `ResponsiveTable` ×3 · `Badge` ×2 · `ListPagination` ×1

**Second cause:** the module rail in `SupportV2Shell.jsx` is `bg-white` with `text-sup-ink2` links.
The mockup rail is a dark ink slab (`#0E1116`) with light text and a teal active pill. That single
element sets the tone for the whole module, and right now it is inverted.

**Third cause:** geometry and density. The CRM primitives are built for large touch targets on
phones — `rounded-xl`/`rounded-2xl`, `min-h-[44px]`, `text-sm`. The mockup is an ops console —
6px/10px radii, 30px controls, 12px text. Even with the right colours, the wrong geometry reads as
a different product.

---

## 12.2 The rule for this phase

> **Do not edit `components/ui/primitives.jsx`.**

Seventeen other feature modules import it — leads, sales pipeline, dispatch, floor pipeline,
inventory, vendor management, customer billing, finance. Restyling it would silently change all of
them, which is a far bigger blast radius than this phase is allowed.

Instead: **add support-scoped equivalents to `supportPrimitives.jsx`, then repoint the 22 imports.**
Same component names, same props, so the change in each page is one import line.

---

## 12.3 The geometry spec

Extract from the mockup. Every number below is a measurement, not a preference.

| Element | Value |
|---|---|
| Page container | `p-4 md:p-6 max-w-[1600px] mx-auto` |
| Body background | `bg-sup-canvas` (#F4F6F8) |
| Card radius | **10px** (`rounded-[10px]`) — not `rounded-2xl` |
| Card border / shadow | `border border-sup-line shadow-sup` |
| Card header | `px-[15px] py-3 border-b border-sup-lineSoft`, title `text-[12.5px] font-semibold` |
| Card body | `p-[15px]` |
| Control radius | **6px** (`rounded-md`) |
| Button height | `sm` 25px · `md` **30px** · `lg` 34px · `touch` min-h-44px (mobile only) |
| Button text | `text-[12px] font-medium` (weight 550 → use `font-medium`) |
| Input height | **31px**, `text-[12.5px]`, `rounded-md`, `border-sup-line` |
| Select height | **28px** in filter bars, 31px in forms |
| Filter chip | `h-7 px-2.5 rounded-full text-[11.5px]` |
| Table `th` | `text-[9.5px] uppercase tracking-[0.09em] text-sup-faint font-semibold px-2.5 py-2 bg-sup-canvas border-b border-sup-line` |
| Table `td` | `px-2.5 py-[9px] border-b border-sup-lineSoft` |
| Row hover | `hover:bg-[#FAFBFC]` · selected `bg-sup-accentSoft` |
| Priority spine | `border-l-[3px]` on the row / card |
| H1 | `text-[19px] font-bold tracking-[-0.025em]` |
| Eyebrow | `text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold` |
| Subtitle | `text-[12px] text-sup-muted` |
| KPI label | `text-[10px] uppercase tracking-[0.08em] text-sup-faint font-semibold` |
| KPI value | `text-[27px] font-bold tracking-[-0.035em] tabular-nums` |
| KPI hint | `text-[11px] text-sup-muted` |
| Pill | `h-[19px] px-[7px] rounded-full text-[10.5px] font-semibold` |
| Tag | `h-[18px] px-1.5 rounded text-[10px] font-semibold font-mono uppercase whitespace-nowrap` |
| Section divider | hairline `bg-sup-line` + `text-[9.5px] uppercase tracking-[0.13em] text-sup-faint font-bold` |

**Mobile exception.** On the technician screens (`BucketPage`, `MyBucketPage`, `JobExecutionPage`,
`RequestPartSheet`, `ConditionGradingSheet`, `WarehouseReceiptPage`) buttons use `size="touch"` and
inputs get `min-h-[44px]`. Field staff use these one-handed. Desktop density does not apply there —
compare against the phone frames in the mockup, not the desktop screens.

---

## 12.4 Add the support-scoped primitives

Append to `frontend/src/components/ui/supportPrimitives.jsx`. Keep the existing 22 exports as they
are — they are correct.

```jsx
/* ═══════════════ SUPPORT-SCOPED OVERRIDES ═══════════════
   Same names and props as components/ui/primitives.jsx, restyled to the
   support console spec. Support-v2 must import these, never the CRM ones.
   ════════════════════════════════════════════════════════ */
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const SUP_BTN = {
  primary:   'bg-sup-accent text-white hover:bg-[#0F3E50] active:bg-[#0C3242] border border-sup-accent',
  secondary: 'bg-white text-sup-ink2 border border-sup-line hover:bg-sup-canvas2',
  ghost:     'bg-transparent text-sup-ink2 border border-transparent hover:bg-sup-canvas2',
  success:   'bg-sup-ok text-white hover:bg-[#166341] border border-sup-ok',
  danger:    'bg-white text-pri1 border border-pri1-ring hover:bg-pri1-bg',
  subtle:    'bg-sup-accentSoft text-sup-accent border border-transparent hover:bg-[#D5E9EC]',
};
const SUP_BTN_SIZE = {
  sm:    'h-[25px] px-[9px] text-[11.5px] gap-1.5',
  md:    'h-[30px] px-3 text-[12px] gap-1.5',
  lg:    'h-[34px] px-3.5 text-[12.5px] gap-2',
  touch: 'min-h-[44px] px-4 text-[13px] gap-2',   // technician / mobile screens only
};

export function Button({
  variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight,
  loading = false, disabled, className = '', children, ...props
}) {
  return (
    <button
      type={props.type || 'button'}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors
        select-none disabled:opacity-45 disabled:cursor-not-allowed
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sup-accent2
        ${SUP_BTN[variant] || SUP_BTN.primary} ${SUP_BTN_SIZE[size] || SUP_BTN_SIZE.md} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null)}
      {children}
      {IconRight && !loading ? <IconRight className="w-3.5 h-3.5 shrink-0" /> : null}
    </button>
  );
}

const SUP_BADGE = {
  gray:   'bg-sup-canvas2 text-sup-ink2',
  blue:   'bg-sup-accentSoft text-sup-accent',
  green:  'bg-sup-okBg text-sup-ok',
  amber:  'bg-pri3-bg text-pri3',
  orange: 'bg-pri2-bg text-pri2',
  red:    'bg-pri1-bg text-pri1',
  purple: 'bg-sup-canvas2 text-sup-ink2',
  outline:'bg-transparent border border-sup-line text-sup-muted',
};
export function Badge({ tone = 'gray', className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 h-[19px] px-[7px] rounded-full
                      text-[10.5px] font-semibold whitespace-nowrap
                      ${SUP_BADGE[tone] || SUP_BADGE.gray} ${className}`}>
      {children}
    </span>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white border border-sup-line rounded-[10px] shadow-sup ${className}`} {...props}>
      {children}
    </div>
  );
}
export function CardHeader({ title, actions, className = '', children }) {
  return (
    <div className={`flex items-center gap-2.5 px-[15px] py-3 border-b border-sup-lineSoft ${className}`}>
      {title && <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-sup-ink">{title}</span>}
      {children}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
export function CardBody({ className = '', children }) {
  return <div className={`p-[15px] ${className}`}>{children}</div>;
}

/** No icon chip. Eyebrow + tight title + muted subtitle, exactly as the mockup. */
export function PageHeader({ title, subtitle, eyebrow, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-3 flex-wrap mb-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">{eyebrow}</div>
        )}
        <h1 className="text-[19px] font-bold tracking-[-0.025em] text-sup-ink leading-tight">{title}</h1>
        {subtitle && <p className="text-[12px] text-sup-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, alarm = false, active = false, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left w-full bg-white border rounded-[10px] px-3.5 py-3
        ${alarm ? 'border-pri1-ring bg-[#FEF7F8]' : 'border-sup-line'}
        ${active ? 'ring-2 ring-sup-accent2' : ''}
        ${onClick ? 'hover:border-sup-accent2 transition-colors' : ''}`}
    >
      <div className="text-[10px] uppercase tracking-[0.08em] text-sup-faint font-semibold">{label}</div>
      <div className={`text-[27px] font-bold tracking-[-0.035em] tabular-nums mt-1
                       ${alarm ? 'text-pri1' : 'text-sup-ink'}`}>{value}</div>
      {hint && <div className="text-[11px] text-sup-muted mt-0.5">{hint}</div>}
    </Tag>
  );
}

export function EmptyState({ icon: Icon, title = 'Nothing here', hint, action }) {
  return (
    <div className="text-center py-10 px-4">
      {Icon && <Icon className="w-8 h-8 text-sup-faint mx-auto mb-2.5" strokeWidth={1.5} />}
      <p className="text-[12.5px] font-semibold text-sup-ink2">{title}</p>
      {hint && <p className="text-[11.5px] text-sup-muted mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionLoader({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-sup-muted">
      <Loader2 className="w-6 h-6 animate-spin text-sup-accent2" />
      <p className="text-[11.5px] mt-2.5">{label}</p>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, className = '', touch = false }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sup-faint pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border border-sup-line rounded-md pl-9 pr-3 text-[11.5px] bg-white
                    text-sup-ink placeholder:text-sup-faint
                    focus:outline focus:outline-2 focus:outline-offset-[-1px] focus:outline-sup-accent2
                    ${touch ? 'min-h-[44px]' : 'h-7'}`}
      />
    </div>
  );
}

export function ListPagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={page <= 1}
              onClick={() => onPageChange(page - 1)} aria-label="Previous page">
        <ChevronLeft className="w-3.5 h-3.5" />
      </Button>
      <span className="font-mono tabular-nums text-[11px] text-sup-muted">{page} / {totalPages}</span>
      <Button size="sm" variant="secondary" disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)} aria-label="Next page">
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
```

### `DataTable` — the support table
The CRM `ResponsiveTable` is close but wrong on density and has no `rowClassName`, which the
priority spine needs. Add `DataTable` with the same props plus `rowClassName`, and use it everywhere
in support-v2.

```jsx
export function DataTable({
  columns, rows, keyField, loading, empty, onRowClick, renderCard, rowClassName,
}) {
  if (loading) return <SectionLoader />;
  if (!rows?.length) return empty || <EmptyState title="No records" />;
  return (
    <>
      {/* mobile */}
      <div className="md:hidden p-3 space-y-2.5">
        {rows.map(r => (
          <div key={r[keyField]} onClick={() => onRowClick?.(r)} role={onRowClick ? 'button' : undefined}>
            {renderCard ? renderCard(r) : null}
          </div>
        ))}
      </div>
      {/* desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key}
                    className={`text-left text-[9.5px] uppercase tracking-[0.09em] text-sup-faint
                                font-semibold px-2.5 py-2 bg-sup-canvas border-b border-sup-line
                                ${c.className || ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r[keyField]}
                  onClick={() => onRowClick?.(r)}
                  className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-[#FAFBFC]
                              ${rowClassName ? rowClassName(r) : ''}`}>
                {columns.map(c => (
                  <td key={c.key} className={`px-2.5 py-[9px] border-b border-sup-lineSoft align-middle
                                              text-[12px] text-sup-ink ${c.className || ''}`}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

---

## 12.5 Repoint the 22 imports

In each of these files, change the import source and nothing else:

```
components/ConditionGradingSheet.jsx     components/CreateWorkOrderModal.jsx
components/InitiateReplacementModal.jsx  components/ReplacementPair.jsx
components/RequestPartSheet.jsx          components/ResolveLineModal.jsx
pages/ApprovalsPage.jsx        pages/BucketPage.jsx        pages/BulkReturnPage.jsx
pages/CommandCentrePage.jsx    pages/DispatchBoardPage.jsx pages/JobExecutionPage.jsx
pages/MyBucketPage.jsx         pages/NewTicketPage.jsx     pages/PartsQueuePage.jsx
pages/ReportsPage.jsx          pages/SettingsPage.jsx      pages/SlaAdminPage.jsx
pages/TaxonomyAdminPage.jsx    pages/TicketDetailPage.jsx  pages/TicketQueuePage.jsx
pages/WarehouseReceiptPage.jsx
```

```diff
- import { Button, PageHeader, EmptyState, ResponsiveTable, ListPagination } from '../../../components/ui/primitives';
+ import { Button, PageHeader, EmptyState, DataTable, ListPagination } from '../../../components/ui/supportPrimitives';
```
Merge with the existing `supportPrimitives` import in the same file rather than having two.
Rename `ResponsiveTable` → `DataTable` at the call sites (3 files) and add `rowClassName` where the
row carries a priority.

### Then lock it shut
`frontend/src/features/support-v2/__tests__/ui-parity.test.js` (or an ESLint
`no-restricted-imports` rule scoped to that directory — either is fine, do one):

```js
// 1. No support-v2 file may import the CRM primitives
// 2. No support-v2 file may use a stock Tailwind palette class
const BANNED = /\b(bg|text|border|ring|from|to|divide|outline)-(slate|gray|zinc|neutral|stone|blue|indigo|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|red|rose|pink|fuchsia|purple|violet)-[0-9]{2,3}\b/;
```
Allow-list `bg-white`, `text-white`, `bg-black/40` (modal backdrop) and `border-transparent`.

This is the test that stops the drift coming back the next time someone adds a screen.

---

## 12.6 Fix the rail

`SupportV2Shell.jsx`. The rail is currently white; the mockup rail is a dark ink slab. This is the
highest-impact single change in the phase.

```jsx
<aside className="hidden md:flex w-[216px] shrink-0 flex-col bg-sup-ink text-[#C9D0DA] sticky top-0 h-screen overflow-y-auto">
  {/* brand */}
  <div className="flex items-center gap-2.5 px-4 pt-4 pb-3.5 border-b border-white/[0.08]">
    <span className="grid place-items-center w-6 h-6 rounded-[5px] bg-sup-accent2 text-white text-[12px] font-bold shrink-0">R</span>
    <div className="min-w-0">
      <div className="text-[13px] font-semibold text-white tracking-[-0.01em] leading-none">Rentfoxxy</div>
      <div className="text-[10px] uppercase tracking-[0.06em] text-[#7C8798] mt-[3px]">Support console</div>
    </div>
  </div>

  {/* group label */}
  <div className="px-2 py-2.5">
    <div className="px-2 pt-3 pb-1.5 text-[9.5px] uppercase tracking-[0.1em] text-[#69748A] font-semibold">
      Work
    </div>
    …
  </div>
</aside>
```

`NavItem`:
```jsx
<NavLink to={to} className={({ isActive }) =>
  `flex items-center gap-2.5 px-2 py-[6.5px] rounded-md text-[12.5px] w-full transition-colors
   ${isActive ? 'bg-sup-accent2 text-white font-medium' : 'text-[#C0C8D4] hover:bg-white/[0.06] hover:text-white'}`
}>
  <Icon className="w-[15px] h-[15px] shrink-0 opacity-85" />
  <span className="flex-1 truncate">{label}</span>
  {badge > 0 && (
    <span className={`font-mono tabular-nums text-[10.5px] px-1.5 rounded-[9px]
      ${danger ? 'bg-pri1 text-white' : isActive ? 'bg-black/[0.22] text-white' : 'bg-white/[0.12] text-white'}`}>
      {badge}
    </span>
  )}
</NavLink>
```

Footer (user + logout) keeps the dark treatment: name `text-white`, role `text-[#7C8798]`,
logout link `text-[#C0C8D4] hover:text-white`. **The logout must not be `text-pri1`** — crimson is
reserved for P1 and nothing else. That is currently violated.

Mobile top bar stays white; only the desktop rail is dark.

---

## 12.7 Turn `FoundationPage` into the real styleguide

There is already a `pages/FoundationPage.jsx` and a "Design system" nav item. Make it the parity
reference so anyone can check a component without opening the mockup:

Sections, each showing the live component with its spec printed beside it:
1. **Priority** — all four `PriorityChip`s and four spined rows
2. **SLA** — `SlaChip` in all five states (ok / warn / risk / breached / paused), with a live ticker
3. **Status** — every `TICKET_STATUS_META` and `WO_STATUS_META` pill, every `WO_TYPE_META` tag
4. **Buttons** — every variant × every size, including `touch`, plus loading and disabled
5. **Badges** — every tone
6. **Typography** — H1, eyebrow, subtitle, card title, table header, mono identifier, KPI value
7. **Forms** — input, select, textarea, filter chip, checkbox, all at spec height
8. **Table** — a 3-row `DataTable` with a priority spine
9. **Cards** — Card/CardHeader/CardBody, StatCard normal and alarm, KpiTile
10. **Feedback** — EmptyState, SectionLoader, Modal, the four bar styles (ok/warn/hot/note)
11. **Colour tokens** — every `pri*` and `sup.*` swatch with its hex printed

Put a one-line header at the top: "This page is the contract. If a screen disagrees with this page,
the screen is wrong."

---

## 12.8 Screen-by-screen pass

After the import swap and the rail, walk every screen with the mockup open beside it. For each,
these are the specific things that will still be off:

| Screen | Mockup ref | Check |
|---|---|---|
| Command centre | S1 | 4 KPI tiles, first one alarm-styled · SLA-risk table with spines · priority stacked bar + legend · capacity rows with bars · 3 bottom cards. **"Pending part" must be `text-pri2` labelled "SLA running"** while the others say "SLA paused" |
| Ticket queue | S2 | Saved-view chips with counts · one filter row · spined rows · classification chain in one line · Work-orders column · footer with bulk actions + pagination |
| New ticket | S3–S6 | 4-step stepper with done/current states · context panel on the right · asset grid with the repeat badge in `pri1` · one card per machine with 3 selects · suggestion strip in `okBg` · right rail "What will happen" |
| Ticket detail | S7 | Spined header card · two SLA clocks top-right · 7 tabs · asset-line cards with Reported/Found side by side · WO cards · right rail (Timeline / Costs / Quick actions) |
| Resolve modal | S8 | Section order: found → codes → actions chips → notes with counter → parts → time |
| Dispatch board | S10 | Left rail of unassigned jobs · grid of technician columns × time rows · priority-tinted job blocks · 3 insight cards below |
| Bucket | S11 | Dark top strip with progress bar · 4 tabs · job cards with spine + live SLA chip · bottom tab bar · **`size="touch"` buttons** |
| Job execution | S12/S13 | Sticky progress header · checklist rows with done/current/pending states · OTP boxes · Complete disabled with the reason shown |
| Parts queue | S14 | Filter chips · priority-sorted rows with inherited spine · approve modal with the info bar |
| Approvals | S16 | Spined rows · type tag · waiting time in `pri1` past 4 h |
| SLA & breaches | S17 | 4 KPIs · breaches-by-reason bars · breach table · policies table with contractual rows in `accentSoft` |
| Taxonomy | S18 | Tree with n1/n2/n3 indents (0/30/52px) · selected row in `accentSoft` · right detail panel with toggles |
| Reports | S20 | Horizontal bars only — no pies, no donuts |

### Things that are wrong in more than one place — fix globally
- **Identifiers not monospace.** Every ticket number, WO number, TTSPL id, serial, document number,
  amount, count and countdown is `font-mono tabular-nums`. Grep for places rendering
  `ticket_number` / `wo_number` / `ttspl_id` without `<Mono>`.
- **`rounded-xl` / `rounded-2xl`** anywhere in support-v2 → 10px cards, 6px controls.
- **`min-h-[44px]`** on desktop screens → 30px. Keep it only on the six mobile files listed in §12.3.
- **Crimson used for anything other than P1** — errors, logout, delete buttons. Danger buttons are
  outline style (`SUP_BTN.danger`), not solid crimson.
- **Icon chips** on page headers (a blue rounded square behind an icon) — remove them all.

---

## 12.9 What NOT to change

- `components/ui/primitives.jsx` — untouched
- Any other feature module
- The global `Layout.jsx` — support-v2 renders standalone at `/support/*` and does not use it
- Any backend file
- Any permission, route path, API contract or query
- `tailwind.config.js` — already correct

---

## VERIFICATION CHECKLIST — Phase 12

**Automated**
- [ ] `grep -rl "components/ui/primitives'" frontend/src/features/support-v2` returns **nothing**
- [ ] The banned-class test passes (no stock Tailwind palette in support-v2)
- [ ] `grep -rE "rounded-(xl|2xl)" frontend/src/features/support-v2` returns nothing
- [ ] `grep -rE "min-h-\[44px\]" frontend/src/features/support-v2` returns only the six mobile files
- [ ] No other feature module's files changed — `git diff --name-only` touches only
      `features/support-v2/**`, `components/ui/supportPrimitives.jsx` and the shell

**Visual — do this with the mockup open side by side, one screen at a time**
- [ ] Rail is dark ink with a teal active pill and light text
- [ ] Every primary button is petrol (#134B60), 30px tall, 6px radius — no blue, no pill shapes
- [ ] Every card is 10px radius with the `shadow-sup` shadow
- [ ] No page header has an icon chip
- [ ] Every identifier on every screen is monospace with tabular numerals
- [ ] Crimson appears **only** as P1 priority and SLA breach — nowhere else
- [ ] Take a screenshot of each of the 13 screens above next to its mockup counterpart and attach
      them to the phase report

**Behaviour did not change**
- [ ] `npm test` green — same tests passing as before the phase, none skipped
- [ ] Every permission check still behaves: re-run the Phase 0 access test (grant one section to one
      user, confirm the nav shows exactly one item)
- [ ] Ticket queue sort order unchanged · wizard still blocks on unclassified machines ·
      resolve modal still blocks without codes
- [ ] `npm run build` clean, no new warnings

**Styleguide**
- [ ] `/support/foundation` renders all 11 sections
- [ ] Every component on a real screen can be found on that page looking identical
