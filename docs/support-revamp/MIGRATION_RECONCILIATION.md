# Support v2 migration — reconciliation

Generated: 2026-08-17T19:04:36.465Z (apply)
Window: created_at >= 2026-07-01 OR status IN (open, in_progress)

## Counts
| Legacy | Count | New | Count | Match |
|---|---|---|---|---|
| support_tickets (all) | 673 | support_tickets_v2 | 673 | merged 0 pickups/replacements into parents |
| support_ticket_items | 830 | assets + work orders | 298 + 533 | see notes |
| support_replacement_orders | 59 | replacement WO pairs | 59 | ✓ |

## Pickup type resolution
| Rule | Fired | Confidence |
|---|---|---|
| 1 · has service_dc_number | 11 | HIGH |
| 2 · credit note within 7 days | 0 | HIGH |
| 3 · replacement pickup_item_id | 59 | HIGH |
| 4 · explicit pickup_type | 387 | MEDIUM |
| 5 · awaiting_service_return history | 0 | MEDIUM |
| 6 · serial returned/in_stock, not assigned | 0 | LOW |
| 7 · fallback | 0 | LOW |
| orphan empty pickup ticket | 0 | LOW |

## Needs human review (LOW confidence) — 0 rows
| Legacy item | Ticket | Customer | Serial | Assigned type | Why |
|---|---|---|---|---|---|
