/** Small shared bits for the Carret Sell screens. */
import { getBackendOrigin } from '../../../utils/api';

/** Any of these grants "create a sales order" — same list the backend's soCreate reads. */
export const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
export const SO_CREATE_SECTIONS = SO_SECTIONS;

export function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** A stored pdf_path is absolute, or relative to the backend origin (same rule as the old pages). */
export function pdfUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}`;
}

export function openPdf(path) {
  const url = pdfUrl(path);
  if (url) window.open(url, '_blank', 'noopener');
}
