# ERP Sales Management → MERN CRM Migration Plan

## Scope (from Laravel ERP)

| ERP feature | Route | CRM target |
|-------------|-------|------------|
| Quotation list | `quotations/view-quotation` | `/operation-management/quotations` |
| Add quotation | `quotations/add-quotation` | `POST /api/sales-management/quotations` |
| Quotation status | `quotations/update-quotation-status` | `PATCH /api/sales-management/quotations/:number/status` |
| SO list | `sales-order/view-so` | `GET /api/sales-management/sales-orders` |
| SO from quote / without quote | `add-so`, `add-so-without-qoute` | `POST /api/sales-management/sales-orders` |
| DC list | `delivery-challan/view-dc` | `GET /api/sales-management/delivery-challans` |
| Add DC | `delivery-challan/add-dc` | `POST /api/sales-management/delivery-challans` |
| Return DC list | `return-dc/view-return-dc` | `GET /api/sales-management/return-dc` |
| Shipping address | `quotations/shipping-address/store` | `POST /api/sales-management/customers/:id/shipping-address` |

## Workflow

```
Quotation (EST-*) → approve → Sales Order (SO-*) → Delivery Challan (DC-*) → Delivery POD
                                                                    ↓
                                              Pickup close → Return DC (RDC*) on support ticket
```

## CRM vs ERP — what already exists

| Area | CRM today | ERP sales module |
|------|-----------|------------------|
| Leads + rental quote email | `leads` + `leadQuotationService` | Separate `quotations` CRUD |
| Customers | `customers` table | ERP `customers` |
| Fulfillment orders | `orders` + `order_items` (Rent/Sales/Demo pipeline) | `sales_orders` (document) |
| Delivery | Dispatch tracking on order items | `delivery_challans` + delivery register |
| Return | Support tickets | `return_dc_number` on `complaints_ticket` |

**Strategy:** Add parallel **document tables** (`sales_quotations`, `sales_order_lines`, `delivery_challan_lines`) — do not replace CRM `orders` until integration phase.

## Database tables (migration `042_sales_management_module.sql`)

- `sm_document_sequences` — EST / SO / DC / RDC counters
- `sales_quotations` — one row per line item (grouped by `quotation_number`)
- `sales_order_lines` — one row per line item (grouped by `sales_order_number`)
- `delivery_challan_lines` — one row per shipped line (grouped by `dc_number`)
- `sm_courier_details` — courier name + AWB

## Implementation phases

### Phase 1 — Foundation (this PR)
- [x] Schema migration
- [x] Document number service
- [x] Quotation list / create / detail / status APIs
- [x] Sales order list / create APIs
- [x] Delivery challan list / create APIs
- [x] Return DC list API (from support + inventory linkage)
- [ ] Frontend pages (quotation list, add forms)

### Phase 2 — Parity with ERP UI
- PDF generation (reuse `leadQuotationService` pattern)
- Email notifications
- Customer approve/reject via token link
- Serial picker from CRM inventory / ERP sync
- Decrement quotation qty on SO create; SO qty on DC create

### Phase 3 — Delivery register & OTP
- `statusDeliveryRegister`, OTP send/verify
- POD upload, delivered/rejected serial JSON
- Rent device creation on delivery

### Phase 4 — Integration
- Optional: push SO/DC to ERP API
- Link CRM `orders` ↔ `sales_order_lines`
- Unified customer (`customers` + `existing_customer`)

## RBAC sections (add to permission matrix)

- `sales_quotations`, `sales_orders_doc`, `delivery_challans`, `return_dc`

## Key ERP helpers to port

| Helper | CRM equivalent |
|--------|----------------|
| `getQuotationQty` | `SUM(quantity)` on `sales_quotations` by number |
| `getSalesOrderQty` | `SUM(quantity)` on `sales_order_lines` |
| `getModelsByQuotationNeeded` | Inventory serials matching quote specs |
| `getAllSerialPairsFromChallanSS` | Query `delivery_challan_lines` serial JSON |
| `updateLastRDCNumber` | `sm_document_sequences` type `rdc` |
