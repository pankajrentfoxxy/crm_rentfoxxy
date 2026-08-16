# Support API migration

Old writes return **410** unless `SUPPORT_LEGACY_WRITES=true` (dual-run only). GETs on `/api/support` still work for the read-only legacy UI.

| Old | New |
|---|---|
| `GET /api/support/tickets` | `GET /api/support/v2/tickets` |
| `GET /api/support/tickets/:id` | `GET /api/support/v2/tickets/:id` |
| `POST /api/support/tickets` | `POST /api/support/v2/tickets` |
| `PATCH /api/support/tickets/:id` | `PATCH /api/support/v2/tickets/:id` |
| `POST /api/support/tickets/:id/close` | `POST /api/support/v2/tickets/:id/close` |
| `POST /api/support/tickets/:id/cancel` | `POST /api/support/v2/tickets/:id/cancel` |
| `POST /api/support/tickets/:id/assign-all` | `POST /api/support/v2/tickets/:id/assign` |
| `POST /api/support/items/:id/work-done` | `POST /api/support/v2/work-orders/:woId/complete` |
| `POST /api/support/items/:id/set-outcome` | work-order `outcome` on complete |
| `POST /api/support/items/:id/picked-up` | `POST /api/support/v2/work-orders/:woId/complete` (`REPAIR_PICKUP` / `RETURN_PICKUP`) |
| `POST /api/support/tickets/:id/pickup` | `POST /api/support/v2/tickets/:id/work-orders` `wo_type=REPAIR_PICKUP` |
| `POST /api/support/tickets/:id/replacements` | `POST /api/support/v2/lines/:lineId/replacement` |
| `POST /api/support/items/:id/move-to-replacement` | same replacement create |
| `PATCH /api/support/replacement-orders/:id` | `PATCH /api/support/v2/replacements/:id` |
| `POST /api/support/replacement-orders/:id/deliver` | complete `REPLACEMENT_DELIVERY` work order |
| `GET /api/support/dashboard` | `GET /api/support/v2/dashboard` |
| `GET /api/support/badges` | `GET /api/support/v2/badges` |
| `GET /api/support/settings` | `GET /api/support/v2/settings` |
| `PUT /api/support/settings` | `PATCH /api/support/v2/settings` |
| `GET /api/support/categories` | `GET /api/support/v2/taxonomy/catalog/tree` |
| `GET /api/support-parts/*` | `GET /api/support/v2/parts/*` |
| Customer portal tickets | `/api/customer-portal/v2/*` |

Public CSAT: `GET/POST /api/support/v2/public/csat/:token`.
