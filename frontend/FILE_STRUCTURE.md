# Frontend File Structure

React CRM frontend (`laptop-refurbishment-frontend`) — Create React App with Tailwind CSS, React Router, and Axios.

> Generated structure excludes `node_modules/`, `build/`, and `dist/`.

## Directory tree

```
frontend/
├── public/
│   ├── index.html
│   ├── rentfoxxy-logo.png
│   └── sample-customers.csv
├── src/
│   ├── components/
│   │   ├── support/
│   │   │   ├── components/
│   │   │   │   ├── CommentThread.jsx
│   │   │   │   ├── DetailSidebar.jsx
│   │   │   │   ├── ItemStepper.jsx
│   │   │   │   ├── OtpInput.jsx
│   │   │   │   ├── ReplacementPanel.jsx
│   │   │   │   ├── TicketCard.jsx
│   │   │   │   └── TicketEditPanel.jsx
│   │   │   ├── support.css
│   │   │   ├── SupportApp.jsx
│   │   │   ├── SupportDashboard.jsx
│   │   │   ├── SupportLayout.jsx
│   │   │   ├── SupportSettings.jsx
│   │   │   ├── SupportShell.jsx
│   │   │   ├── SupportTechnicians.jsx
│   │   │   ├── SupportTicketCreate.jsx
│   │   │   ├── SupportTicketDetail.jsx
│   │   │   ├── SupportTicketList.jsx
│   │   │   ├── SupportTicketsView.jsx
│   │   │   └── utils.js
│   │   ├── BarcodeScanner.jsx
│   │   ├── ChipLevelRepairPanel.jsx
│   │   ├── CustomerInventory.jsx
│   │   ├── Customers.jsx
│   │   ├── DiagnosisForm.jsx
│   │   ├── Dispatch.jsx
│   │   ├── FollowUps.jsx
│   │   ├── Inventory.jsx
│   │   ├── LeadDetail.jsx
│   │   ├── LeadList.jsx
│   │   ├── ManagerDashboard.jsx
│   │   ├── Orders.jsx
│   │   ├── PartsInventory.jsx
│   │   ├── Procurement.jsx
│   │   ├── QC1Form.jsx
│   │   ├── QCOrders.jsx
│   │   ├── QuotationAccept.jsx
│   │   ├── Reports.jsx
│   │   ├── Sales.jsx
│   │   ├── SoftwareChecklist.jsx
│   │   └── Warehouse.jsx
│   ├── constants/
│   │   └── leadStages.js
│   ├── context/
│   │   └── AuthContext.js
│   ├── router/
│   │   ├── ProtectedRoute.jsx
│   │   └── SupportProtectedRoute.jsx
│   ├── utils/
│   │   ├── api.js
│   │   └── supportAccess.js
│   ├── App.css
│   ├── App.jsx
│   ├── index.css
│   └── index.js
├── .env
├── .gitignore
├── package.json
├── package-lock.json
├── postcss.config.js
└── tailwind.config.js
```

## Root

| File | Purpose |
|------|---------|
| `package.json` | Dependencies and scripts (`start`, `build`, `test`) |
| `package-lock.json` | Locked dependency versions |
| `postcss.config.js` | PostCSS (Tailwind + Autoprefixer) |
| `tailwind.config.js` | Tailwind CSS configuration |
| `.gitignore` | Git ignore rules |
| `.env` | Environment variables (API URL, etc.) |

## `public/`

Static assets served as-is by the dev server and copied into the production build.

| File | Purpose |
|------|---------|
| `index.html` | HTML shell; React mounts into `#root` |
| `rentfoxxy-logo.png` | Brand logo |
| `sample-customers.csv` | Sample data for customer import |

## `src/` — Application entry

| File | Purpose |
|------|---------|
| `index.js` | React DOM entry; renders `<App />` |
| `index.css` | Global styles (Tailwind directives) |
| `App.jsx` | Main app shell, routing, and CRM views |
| `App.css` | App-level component styles |

## `src/router/`

| File | Purpose |
|------|---------|
| `ProtectedRoute.jsx` | Auth guard for CRM routes |
| `SupportProtectedRoute.jsx` | Auth guard for support module routes |

## `src/context/`

| File | Purpose |
|------|---------|
| `AuthContext.js` | Authentication state and helpers |

## `src/utils/`

| File | Purpose |
|------|---------|
| `api.js` | Axios instance and API helpers |
| `supportAccess.js` | Support module access checks |

## `src/constants/`

| File | Purpose |
|------|---------|
| `leadStages.js` | Lead pipeline stage definitions |

## `src/components/` — CRM feature views

| File | Purpose |
|------|---------|
| `BarcodeScanner.jsx` | Barcode scanning UI |
| `ChipLevelRepairPanel.jsx` | Chip-level repair workflow |
| `CustomerInventory.jsx` | Customer inventory view |
| `Customers.jsx` | Customer management |
| `DiagnosisForm.jsx` | Device diagnosis form |
| `Dispatch.jsx` | Dispatch operations |
| `FollowUps.jsx` | Lead follow-ups |
| `Inventory.jsx` | Inventory management |
| `LeadDetail.jsx` | Single lead detail view |
| `LeadList.jsx` | Lead listing |
| `ManagerDashboard.jsx` | Manager dashboard |
| `Orders.jsx` | Orders management |
| `PartsInventory.jsx` | Parts inventory |
| `Procurement.jsx` | Procurement workflow |
| `QC1Form.jsx` | QC stage 1 form |
| `QCOrders.jsx` | QC orders list |
| `QuotationAccept.jsx` | Quotation acceptance flow |
| `Reports.jsx` | Reporting views |
| `Sales.jsx` | Sales module |
| `SoftwareChecklist.jsx` | Software checklist |
| `Warehouse.jsx` | Warehouse operations |

## `src/components/support/` — Support ticket module

| File | Purpose |
|------|---------|
| `SupportApp.jsx` | Support module root |
| `SupportShell.jsx` | Support layout shell |
| `SupportLayout.jsx` | Support page layout |
| `SupportDashboard.jsx` | Support dashboard |
| `SupportTicketList.jsx` | Ticket list |
| `SupportTicketsView.jsx` | Tickets overview |
| `SupportTicketDetail.jsx` | Single ticket detail |
| `SupportTicketCreate.jsx` | Create ticket |
| `SupportTechnicians.jsx` | Technician management |
| `SupportSettings.jsx` | Support settings |
| `support.css` | Support-specific styles |
| `utils.js` | Support helpers |

### `src/components/support/components/`

| File | Purpose |
|------|---------|
| `CommentThread.jsx` | Ticket comment thread |
| `DetailSidebar.jsx` | Ticket detail sidebar |
| `ItemStepper.jsx` | Multi-step item wizard |
| `OtpInput.jsx` | OTP input component |
| `ReplacementPanel.jsx` | Replacement workflow panel |
| `TicketCard.jsx` | Ticket card in lists |
| `TicketEditPanel.jsx` | Ticket edit panel |

## Excluded from tree

| Path | Notes |
|------|-------|
| `node_modules/` | npm dependencies (not committed) |
| `build/` | Production build output (`npm run build`) |

## File counts

| Area | Files |
|------|-------|
| Root config | 6 |
| `public/` | 3 |
| `src/` (entry + styles) | 4 |
| `src/router/` | 2 |
| `src/context/` | 1 |
| `src/utils/` | 2 |
| `src/constants/` | 1 |
| `src/components/` (CRM) | 21 |
| `src/components/support/` | 14 |
| `src/components/support/components/` | 7 |
| **Total (source + config)** | **61** |
