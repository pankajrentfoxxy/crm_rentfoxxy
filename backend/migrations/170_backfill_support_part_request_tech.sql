-- Align open part requests with the complaint item's assigned technician.
UPDATE support_part_requests spr
SET assigned_to_tech = sti.assigned_to,
    updated_at = NOW()
FROM support_ticket_items sti
WHERE spr.support_item_id = sti.id
  AND sti.assigned_to IS NOT NULL
  AND spr.assigned_to_tech IS DISTINCT FROM sti.assigned_to
  AND spr.status IN ('pending', 'approved', 'challan_generated', 'issued', 'return_requested');

-- Draft challans should issue to the same technician as the linked requests.
UPDATE support_part_challans spc
SET issued_to = spr.assigned_to_tech,
    updated_at = NOW()
FROM support_part_requests spr
WHERE spr.challan_id = spc.id
  AND spc.status = 'draft'
  AND spc.issued_to IS DISTINCT FROM spr.assigned_to_tech
  AND spr.status IN ('approved', 'challan_generated');
