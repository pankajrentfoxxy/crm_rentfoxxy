# Customer Portal APIs (curl)

All endpoints used by the `crm_new_stagging_crm` customer portal.

QA base (nginx → API **5010**):

```bash
export BASE=http://157.173.221.119:8011
```

You can also hit the backend directly:

```bash
export BASE=http://157.173.221.119:5010
```

Auth: most routes need a customer portal Bearer token (`cp_token` in the browser).

```bash
export TOKEN='PASTE_TOKEN_HERE'
```

---

## Auth

### 1. Unified login (what the portal actually calls)

`POST /api/auth/login`

Used by `AuthContext.login`. Body is email + password only.

```bash
curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "customer@example.com",
    "password": "your-password"
  }'
```

Success (customer account) returns `token` and `customer`. Save the token:

```bash
export TOKEN="$(curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"your-password"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')"
```

CRM / vendor accounts get `portal: "crm"` or `"vendor"` plus `redirect_url` instead of a customer token.

### 2. Dedicated customer-portal login (backend only)

`POST /api/customer-portal/login`

Exists on the API. The current portal UI does **not** call this; it uses unified login above.

```bash
curl -sS -X POST "$BASE/api/customer-portal/login" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "customer@example.com",
    "password": "your-password"
  }'
```

### 3. Session check / profile

`GET /api/customer-portal/me`

Called on app load and on Profile / Create Ticket.

```bash
curl -sS "$BASE/api/customer-portal/me" \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Logout

`POST /api/customer-portal/logout`

```bash
curl -sS -X POST "$BASE/api/customer-portal/logout" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Dashboard

### 5. KPI dashboard

`GET /api/customer-portal/dashboard`

Used by Dashboard.

```bash
curl -sS "$BASE/api/customer-portal/dashboard" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Profile

### 6. Change password

`POST /api/customer-portal/change-password`

Used by Profile. Blocked for impersonated (admin preview) sessions.

```bash
curl -sS -X POST "$BASE/api/customer-portal/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "current_password": "old-password",
    "new_password": "new-password"
  }'
```

---

## Laptops

### 7. List laptops

`GET /api/customer-portal/laptops`

Used by My Laptops, Create Ticket (`limit=200`), and FilterBar.

| Query | Values / notes |
|---|---|
| `lifecycle` | `active` (default) or `returned` |
| `search` | TTSPL, serial, brand, model, DC |
| `date_from` / `date_to` | `YYYY-MM-DD` |
| `page` | default `1` |
| `limit` | default `20` |

```bash
# Currently with me
curl -sS "$BASE/api/customer-portal/laptops?lifecycle=active&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Returned
curl -sS "$BASE/api/customer-portal/laptops?lifecycle=returned&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Search + date range
curl -sS --get "$BASE/api/customer-portal/laptops" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'lifecycle=active' \
  --data-urlencode 'search=TTSPL-123' \
  --data-urlencode 'date_from=2026-07-01' \
  --data-urlencode 'date_to=2026-08-31' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=20'

# Create-ticket dropdown
curl -sS "$BASE/api/customer-portal/laptops?limit=200" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Orders

### 8. List orders

`GET /api/customer-portal/orders`

Used by Orders list.

| Query | Values |
|---|---|
| `order_type` | `standard`, `replacement` |
| `entity_scope` | `rental`, `sale` |
| `order_status` | `active`, `pending`, `dispatched`, `delivered`, `cancelled` |
| `delivery_status` | `not_dispatched`, `in_transit`, `delivered` |
| `search` | SO number |
| `date_from` / `date_to` | `YYYY-MM-DD` |
| `page` / `limit` | pagination |

```bash
curl -sS "$BASE/api/customer-portal/orders?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Dashboard “Active Orders” / “Pending Orders”
curl -sS "$BASE/api/customer-portal/orders?order_status=active&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -sS --get "$BASE/api/customer-portal/orders" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'order_type=standard' \
  --data-urlencode 'entity_scope=rental' \
  --data-urlencode 'order_status=delivered' \
  --data-urlencode 'delivery_status=delivered' \
  --data-urlencode 'search=SO/26-27/1023' \
  --data-urlencode 'date_from=2026-07-01' \
  --data-urlencode 'date_to=2026-08-31' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=20'
```

### 9. Order detail

`GET /api/customer-portal/orders/:soNumber`

SO numbers contain slashes — encode them (`SO/26-27/1023` → `SO%2F26-27%2F1023`).

```bash
curl -sS "$BASE/api/customer-portal/orders/SO%2F26-27%2F1023" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Invoices

### 10. List invoices

`GET /api/customer-portal/invoices`

Used by Dashboard (all) and Invoices tabs.

| Query | Values |
|---|---|
| `status` | omit for all, or `draft`, `sent`, `paid` |

```bash
curl -sS "$BASE/api/customer-portal/invoices" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/invoices?status=sent" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/invoices?status=paid" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/invoices?status=draft" \
  -H "Authorization: Bearer $TOKEN"
```

### 11. Invoice detail

`GET /api/customer-portal/invoices/:invoiceId`

```bash
curl -sS "$BASE/api/customer-portal/invoices/123" \
  -H "Authorization: Bearer $TOKEN"
```

### 12. Download invoice PDF

`GET /api/customer-portal/invoices/:invoiceId/pdf`

Used by Dashboard and Invoices (`downloadInvoicePdf`).

```bash
curl -sS "$BASE/api/customer-portal/invoices/123/pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -o invoice-123.pdf
```

---

## Credit notes

### 13. List credit notes

`GET /api/customer-portal/credit-notes`

```bash
curl -sS "$BASE/api/customer-portal/credit-notes" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Deliveries

### 14. List deliveries

`GET /api/customer-portal/deliveries`

Used by Deliveries list and Dashboard (`limit=5`).

| Query | Values |
|---|---|
| `status` | `pending`, `in_transit`, `delivered`, `rejected` |
| `search` | DC / SO / AWB |
| `date_from` / `date_to` | `YYYY-MM-DD` |
| `page` / `limit` | pagination |

```bash
curl -sS "$BASE/api/customer-portal/deliveries?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Dashboard recent + KPI links
curl -sS "$BASE/api/customer-portal/deliveries?limit=5" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/deliveries?status=in_transit&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/deliveries?status=delivered&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

### 15. Delivery detail

`GET /api/customer-portal/deliveries/:dcNumber`

DC numbers contain slashes — encode them.

```bash
curl -sS "$BASE/api/customer-portal/deliveries/DC%2F26-27%2F1001" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Support tickets

### 16. Create ticket / return request

`POST /api/customer-portal/tickets`

Used by Create Support Ticket. Blocked for impersonated sessions.

`ticket_type` values in the UI:

- `Laptop Not Working`
- `Display Issue`
- `Keyboard Issue`
- `Battery Issue`
- `Software Issue`
- `Replacement Request`
- `Return Request`
- `Other`

Server maps those to `complaint` / `replacement` / `pickup`. Description must be at least 20 characters. `Return Request` needs `ttspl_id` and pickup address.

```bash
# Normal complaint
curl -sS -X POST "$BASE/api/customer-portal/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": "Screen flickering",
    "description": "The laptop screen flickers after 10 minutes of use.",
    "ticket_type": "Display Issue",
    "ttspl_id": "TTSPL-123",
    "photos": []
  }'

# Return / pickup (queued for review — response may have request_id)
curl -sS -X POST "$BASE/api/customer-portal/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": "Laptop return request",
    "description": "Please collect this laptop. Contract ended last week.",
    "ticket_type": "Return Request",
    "ttspl_id": "TTSPL-123",
    "photos": [],
    "pickup_address": {
      "name": "Acme Pvt Ltd",
      "phone": "9876543210",
      "address": "B-12 Omaxe City Centre, Sohna Road",
      "city": "Gurugram",
      "state": "Haryana",
      "pincode": "122018",
      "landmark": "Near metro"
    }
  }'
```

### 17. List tickets

`GET /api/customer-portal/tickets`

Used by Support Tickets and Dashboard (`limit=5`).

| Query | Values |
|---|---|
| `ticket_type` | `complaint`, `pickup`, `replacement` |
| `status` | `open`, `in_progress`, `closed`, `cancelled` |
| `stage` | `received`, `in_progress`, `picked_up`, `at_service_centre`, `replacement_in_progress`, `out_for_delivery`, `resolved`, `closed` |
| `search` | ticket number or subject |
| `ttspl` | TTSPL id |
| `serial` | serial number |
| `date_from` / `date_to` | `YYYY-MM-DD` |
| `page` / `limit` | pagination |

```bash
curl -sS "$BASE/api/customer-portal/tickets?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Dashboard recent + KPI links
curl -sS "$BASE/api/customer-portal/tickets?limit=5" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/tickets?status=open&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/tickets?ticket_type=pickup&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customer-portal/tickets?ticket_type=replacement&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"

curl -sS --get "$BASE/api/customer-portal/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'ticket_type=complaint' \
  --data-urlencode 'status=open' \
  --data-urlencode 'stage=in_progress' \
  --data-urlencode 'search=flicker' \
  --data-urlencode 'ttspl=TTSPL-123' \
  --data-urlencode 'serial=ABC123' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=20'
```

### 18. Ticket detail

`GET /api/customer-portal/tickets/:ticketId`

```bash
curl -sS "$BASE/api/customer-portal/tickets/456" \
  -H "Authorization: Bearer $TOKEN"
```

### 19. Pending support requests (awaiting review)

`GET /api/customer-portal/support-requests`

Used by Support Tickets for return requests that are not tickets yet.

```bash
curl -sS "$BASE/api/customer-portal/support-requests" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Quick index

| # | Method | Path | Portal page |
|---|---|---|---|
| 1 | `POST` | `/api/auth/login` | Login |
| 2 | `POST` | `/api/customer-portal/login` | Backend only (not used by UI) |
| 3 | `GET` | `/api/customer-portal/me` | App load, Profile, Create Ticket |
| 4 | `POST` | `/api/customer-portal/logout` | Logout |
| 5 | `GET` | `/api/customer-portal/dashboard` | Dashboard |
| 6 | `POST` | `/api/customer-portal/change-password` | Profile |
| 7 | `GET` | `/api/customer-portal/laptops` | Laptops, Create Ticket |
| 8 | `GET` | `/api/customer-portal/orders` | Orders |
| 9 | `GET` | `/api/customer-portal/orders/:soNumber` | Order detail |
| 10 | `GET` | `/api/customer-portal/invoices` | Dashboard, Invoices |
| 11 | `GET` | `/api/customer-portal/invoices/:invoiceId` | Invoice detail |
| 12 | `GET` | `/api/customer-portal/invoices/:invoiceId/pdf` | Invoice PDF |
| 13 | `GET` | `/api/customer-portal/credit-notes` | Credit Notes |
| 14 | `GET` | `/api/customer-portal/deliveries` | Dashboard, Deliveries |
| 15 | `GET` | `/api/customer-portal/deliveries/:dcNumber` | Delivery detail |
| 16 | `POST` | `/api/customer-portal/tickets` | Create Ticket |
| 17 | `GET` | `/api/customer-portal/tickets` | Dashboard, Support Tickets |
| 18 | `GET` | `/api/customer-portal/tickets/:ticketId` | Ticket detail |
| 19 | `GET` | `/api/customer-portal/support-requests` | Support Tickets |

Header for every authenticated call:

```http
Authorization: Bearer <cp_token>
Content-Type: application/json
```
