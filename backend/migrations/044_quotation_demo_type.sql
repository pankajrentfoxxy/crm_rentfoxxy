-- Allow demo quotation type (ERP parity)
ALTER TABLE public.sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_quotation_type_check;
ALTER TABLE public.sales_quotations
  ADD CONSTRAINT sales_quotations_quotation_type_check
  CHECK (quotation_type IN ('sale', 'rental', 'demo'));
