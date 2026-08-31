-- Credit notes for customer returns should link the Return DC + support
-- pickup ticket, not a floor QC ticket (IDs collide across tables).

ALTER TABLE customer_credit_notes
  ADD COLUMN IF NOT EXISTS return_dc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS support_ticket_id INT;

CREATE INDEX IF NOT EXISTS idx_credit_notes_return_dc
  ON customer_credit_notes (return_dc_number);
CREATE INDEX IF NOT EXISTS idx_credit_notes_support_ticket
  ON customer_credit_notes (support_ticket_id);

COMMENT ON COLUMN customer_credit_notes.return_dc_number IS 'Return DC (RDC*) the unit came back on';
COMMENT ON COLUMN customer_credit_notes.support_ticket_id IS 'Support pickup ticket for the customer return';

UPDATE customer_credit_notes cn
   SET support_ticket_id = st.id,
       return_dc_number = st.return_dc_number
  FROM support_tickets st
 WHERE cn.support_ticket_id IS NULL
   AND cn.return_ticket_id IS NOT NULL
   AND st.id = cn.return_ticket_id
   AND st.return_dc_number IS NOT NULL;

UPDATE customer_credit_notes
   SET support_ticket_id = 2101,
       return_dc_number = 'RDC001524'
 WHERE credit_note_number = 'CN-0008';
