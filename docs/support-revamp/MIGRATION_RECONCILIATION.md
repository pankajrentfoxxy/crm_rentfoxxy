# Support v2 migration — reconciliation

Generated: 2026-08-17T10:55:28.131Z (apply)

## Counts
| Legacy | Count | New | Count | Match |
|---|---|---|---|---|
| support_tickets (all) | 2903 | support_tickets_v2 | 2903 | merged 0 pickups/replacements into parents |
| support_ticket_items | 3144 | assets + work orders | 1100 + 2047 | see notes |
| support_replacement_orders | 93 | replacement WO pairs | 93 | ✓ |

## Pickup type resolution
| Rule | Fired | Confidence |
|---|---|---|
| 1 · has service_dc_number | 2 | HIGH |
| 2 · credit note within 7 days | 0 | HIGH |
| 3 · replacement pickup_item_id | 92 | HIGH |
| 4 · explicit pickup_type | 1840 | MEDIUM |
| 5 · awaiting_service_return history | 0 | MEDIUM |
| 6 · serial returned/in_stock, not assigned | 0 | LOW |
| 7 · fallback | 0 | LOW |
| orphan empty pickup ticket | 0 | LOW |

## Needs human review (LOW confidence) — 0 rows
| Legacy item | Ticket | Customer | Serial | Assigned type | Why |
|---|---|---|---|---|---|
