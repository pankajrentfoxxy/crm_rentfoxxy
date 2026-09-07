-- One customer credit note can cover every returned laptop, like an invoice.
ALTER TABLE customer_credit_notes
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN customer_credit_notes.line_items IS
  'Per-laptop unused-rental lines on a customer-level credit note';

UPDATE customer_credit_notes
   SET line_items = jsonb_build_array(
         jsonb_strip_nulls(jsonb_build_object(
           'serial_id', serial_id,
           'ttspl_id', CASE
             WHEN jsonb_typeof(COALESCE(ttspl_ids, '[]'::jsonb)) = 'array'
              AND jsonb_array_length(COALESCE(ttspl_ids, '[]'::jsonb)) > 0
             THEN ttspl_ids ->> 0
             ELSE NULL
           END,
           'amount', amount,
           'quantity', quantity,
           'unit_rate', unit_rate,
           'from_date', from_date,
           'to_date', to_date,
           'rent_start', from_date,
           'rent_end', to_date,
           'return_dc_number', return_dc_number,
           'support_ticket_id', support_ticket_id,
           'brand', 'Laptop rental',
           'model', 'Unused prepaid days',
           'days_in_month', quantity
         ))
       )
 WHERE COALESCE(jsonb_array_length(line_items), 0) = 0
   AND (serial_id IS NOT NULL OR COALESCE(amount, 0) > 0);
