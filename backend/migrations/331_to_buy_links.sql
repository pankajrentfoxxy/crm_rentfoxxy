-- Procure to stock, step 2 (To-buy queue): a laptop shortfall raised by a
-- sales order is linked to the purchase order that fills it. Before this the
-- request row had no link, nothing ever closed it, and all 136 on QA sat at
-- "New". Part requests already carry spo_id.
ALTER TABLE sales_order_procurement_requests
  ADD COLUMN IF NOT EXISTS po_id INT REFERENCES vendor_purchase_orders(po_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_so_pr_po ON sales_order_procurement_requests (po_id);
