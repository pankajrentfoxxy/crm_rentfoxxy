-- 406: Sales order drafts.
--
-- "Save as draft" on the new sales-order form. A draft is the form as the
-- salesperson left it (JSON), not a sales order: it takes no SO number (the
-- FY series stays gap-free), opens no dispatch workflow and sends nothing.
-- Creating the order from a draft deletes the draft in the same transaction.
-- Additive only.

CREATE TABLE IF NOT EXISTS sales_order_drafts (
  draft_id         SERIAL PRIMARY KEY,
  created_by       INT,
  customer_id      INT,
  customer_name    TEXT,
  quotation_type   VARCHAR(20),
  quotation_number VARCHAR(60),
  total            NUMERIC(14,2) DEFAULT 0,
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_drafts_created_by
  ON sales_order_drafts (created_by, updated_at DESC);
