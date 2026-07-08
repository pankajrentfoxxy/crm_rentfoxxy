import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Laptop,
  Pencil,
  Plus,
  PlusCircle,
  Trash2,
  X
} from 'lucide-react';
import {
  API_LIST_MAX,
  fetchPurchaseOrders,
  fetchPurchaseOrderFormMeta,
  createPurchaseOrder,
  fetchPurchaseOrder,
  patchPurchaseOrderStatus,
  uploadPurchaseOrderBills
} from '../vendorManagementApi';
import PoActivityPanel from '../components/PoActivityPanel';
import { getBackendOrigin } from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import {
  isManagerUser,
  isProcurementUser,
  mergeAssetCatalog,
  modelsForBrand,
  processorsForBrand,
  generationsForBrandProcessor,
  poStatusBadge,
  poTypeBadge
} from '../vendorMgmtUi';

/** Matches Laravel purchase-order-form.blade.php state list (Str::slug(_, '_)) */
const RAW_INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal'
];

const STATE_OPTIONS = RAW_INDIAN_STATES.map((name) => ({
  label: name,
  value: name.toLowerCase().replace(/\s+/g, '_')
}));

const LIST_PAGE_SIZE = 25;

function formatPoType(t) {
  if (!t) return '—';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer API `product_details` (Laravel-compatible alias populated by CRM list/getOne). */
function parseLineItems(po) {
  const raw = po?.product_details ?? po?.line_items;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseBillFiles(row) {
  const raw = row?.bill_files;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function filePublicUrl(p) {
  if (!p) return '#';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}${p.startsWith('/') ? p : `/${p}`}`;
}

function wordCount(str) {
  if (!str || !String(str).trim()) return 0;
  return String(str).trim().split(/\s+/).filter(Boolean).length;
}

function RemarkCell({ text }) {
  const [open, setOpen] = useState(false);
  const full = text || '';
  const preview = full.trim().split(/\s+/).slice(0, 4).join(' ');
  const long = wordCount(full) > 5;
  if (!full.trim()) return <span className="text-slate-400">—</span>;
  return (
    <div className="max-w-[14rem] text-slate-700 text-sm">
      <span>{open ? full : preview}{!open && long ? '…' : ''}</span>
      {long && (
        <button
          type="button"
          className="ml-1 text-orange-600 hover:underline text-xs font-semibold"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

/** CRM bill upload + vendor portal invoice + legacy bill_files */
function getPoBillInfo(row) {
  const crmFiles = parseBillFiles(row);
  if (row?.bill_name) {
    return {
      billName: row.bill_name,
      files: crmFiles.length ? crmFiles : (row.vendor_invoice_file ? [row.vendor_invoice_file] : []),
      source: row.vendor_invoice_number && !crmFiles.length ? 'vendor' : 'crm',
    };
  }
  if (row?.vendor_invoice_number) {
    return {
      billName: row.vendor_invoice_number,
      files: row.vendor_invoice_file ? [row.vendor_invoice_file] : [],
      source: 'vendor',
    };
  }
  if (crmFiles.length) {
    return { billName: 'Bill', files: crmFiles, source: 'crm' };
  }
  return { billName: null, files: [], source: null };
}

function hasPoBill(row) {
  const info = getPoBillInfo(row);
  return !!(info.billName || info.files.length);
}

function canSubmitForApproval(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'draft' || s === 'pending') {
    return true;
  }
  return false;
}

function isPendingManagerApproval(status) {
  return String(status || '').toLowerCase() === 'pending_approval';
}

/** Eye / receive screen after manager approval (incl. vendor accepted) */
function showReceiveEye(status) {
  const s = String(status || '').toLowerCase();
  return ['approved', 'vendor_accepted', 'processing', 'completed', 'sent'].includes(s);
}

function matchesPoStatusTab(rowStatus, tab) {
  const s = String(rowStatus || '').toLowerCase();
  if (tab === 'approved') {
    return ['approved', 'vendor_accepted', 'sent'].includes(s);
  }
  return normalizePoStatus(rowStatus) === tab;
}

const PO_STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'processing', label: 'Processing' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' }
];

function normalizePoStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending' || s === '') return 'draft';
  return s;
}

const emptyModalForm = () => ({
  purchase_order_number: '',
  purchase_order_date: new Date().toISOString().slice(0, 10),
  purchase_order_type: '',
  vendor_id: '',
  po_state: '',
  remarks: ''
});

const emptyAssetDraft = () => ({
  brand: '',
  model: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  gpu: '',
  screen_size: '',
  quantity: '',
  rate: '',
  period_months: '',
  monthly_rental_amount: '',
  tenure_months: ''
});

/** PO form-meta `asset_catalog` fallback when API omits catalog */
const defaultAssetCatalog = () => mergeAssetCatalog({});

function AssetSelect({ label, value, onChange, options, required }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      <select
        className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Please Select</option>
        {(options || []).map((opt) => (
          <option key={String(opt)} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function AssetTextInput({ label, value, onChange, placeholder, required, type = 'text', min }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      <input
        type={type}
        min={min}
        className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const vendorFilterId = searchParams.get('vendor_id');
  const manager = isManagerUser(user);
  const procurement = isProcurementUser(user);

  const [allRows, setAllRows] = useState([]);
  const [statusTab, setStatusTab] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState({ open: false, po: null, reason: '' });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [form, setForm] = useState(emptyModalForm());
  const [assetDraft, setAssetDraft] = useState(emptyAssetDraft());
  const [assetRows, setAssetRows] = useState([]);
  /** When set, Add / Update applies to this index instead of appending. */
  const [editingAssetIndex, setEditingAssetIndex] = useState(null);
  const [assetCatalog, setAssetCatalog] = useState(null);

  const [preview, setPreview] = useState({ open: false, loading: false, detail: null });
  const [previewTab, setPreviewTab] = useState('details');
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [billView, setBillView] = useState({ open: false, bill_name: '', files: [], poId: null });
  const [billUpload, setBillUpload] = useState({ open: false, po: null, bill_name: '' });
  /** Read-only summary of the create-PO modal before Save (no API call). */
  const [createPreviewOpen, setCreatePreviewOpen] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const all = [];
      let pg = 1;
      let totalPg = 1;
      const baseParams = {
        search: search.trim() || undefined,
        vendor_id: vendorFilterId || undefined
      };
      do {
        const { data } = await fetchPurchaseOrders({ ...baseParams, page: pg, limit: API_LIST_MAX });
        if (!data.success) throw new Error(data.message || 'Failed to load purchase orders');
        all.push(...(data.data || []));
        totalPg = data.pagination?.totalPages || 1;
        pg += 1;
      } while (pg <= totalPg);
      setAllRows(all);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [search, vendorFilterId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const statusTabCounts = useMemo(() => {
    const c = { all: allRows.length, draft: 0, pending_approval: 0, approved: 0, processing: 0, completed: 0, rejected: 0 };
    allRows.forEach((r) => {
      const s = String(r.status || '').toLowerCase();
      if (['approved', 'vendor_accepted', 'sent'].includes(s)) {
        c.approved += 1;
      } else {
        const k = normalizePoStatus(r.status);
        if (c[k] != null) c[k] += 1;
      }
    });
    return c;
  }, [allRows]);

  useEffect(() => {
    let list = [...allRows];
    if (statusTab !== 'all') {
      list = list.filter((r) => matchesPoStatusTab(r.status, statusTab));
    }
    setTotal(list.length);
    const tp = Math.max(1, Math.ceil(list.length / LIST_PAGE_SIZE));
    setTotalPages(tp);
    const start = (page - 1) * LIST_PAGE_SIZE;
    setRows(list.slice(start, start + LIST_PAGE_SIZE));
  }, [allRows, statusTab, page]);

  useEffect(() => {
    setPage(1);
  }, [statusTab, search, vendorFilterId]);

  function applySearch(e) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const openModal = useCallback(async (preselectVendorId) => {
    setModalOpen(true);
    setMetaLoading(true);
    setForm(emptyModalForm());
    setAssetDraft(emptyAssetDraft());
    setAssetRows([]);
    setEditingAssetIndex(null);
    setAssetCatalog(null);
    setCreatePreviewOpen(false);
    try {
      const { data } = await fetchPurchaseOrderFormMeta();
      if (!data.success) throw new Error(data.message || 'Failed');
      setVendorOptions(data.vendors || []);
      setAssetCatalog(data.asset_catalog || defaultAssetCatalog());
      const vid = preselectVendorId || vendorFilterId || '';
      setForm((f) => ({
        ...f,
        purchase_order_number: data.purchase_order_number || '',
        purchase_order_date: new Date().toISOString().slice(0, 10),
        vendor_id: vid ? String(vid) : ''
      }));
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Could not load form');
      setModalOpen(false);
    } finally {
      setMetaLoading(false);
    }
  }, [vendorFilterId]);

  useEffect(() => {
    if (location.state?.openCreate) {
      openModal(location.state.vendorId);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, openModal]);

  function closeModal() {
    setModalOpen(false);
    setForm(emptyModalForm());
    setVendorOptions([]);
    setAssetDraft(emptyAssetDraft());
    setAssetRows([]);
    setEditingAssetIndex(null);
    setAssetCatalog(null);
    setCreatePreviewOpen(false);
  }

  const selectedVendor = useMemo(
    () => vendorOptions.find((v) => String(v.id) === String(form.vendor_id)),
    [vendorOptions, form.vendor_id]
  );

  const catalog = assetCatalog || defaultAssetCatalog();

  const modelOptions = useMemo(
    () => modelsForBrand(assetDraft.brand, catalog),
    [assetDraft.brand, catalog]
  );

  const processorOptions = useMemo(
    () => processorsForBrand(assetDraft.brand, catalog),
    [assetDraft.brand, catalog]
  );

  const generationOptions = useMemo(
    () => generationsForBrandProcessor(assetDraft.brand, assetDraft.processor, catalog),
    [assetDraft.brand, assetDraft.processor, catalog]
  );

  function addAssetRow() {
    if (!form.vendor_id || !form.purchase_order_type) {
      toast.error('Select vendor and purchase order type before adding asset lines');
      return;
    }
    const isRental = ['rental_purchase', 'rent_to_own'].includes(form.purchase_order_type);
    const isRto = form.purchase_order_type === 'rent_to_own';
    const checks = [
      assetDraft.brand,
      assetDraft.model,
      assetDraft.processor,
      assetDraft.generation,
      assetDraft.ram,
      assetDraft.storage,
      assetDraft.gpu,
      assetDraft.screen_size,
      assetDraft.quantity,
      assetDraft.rate,
      // Rent-to-own has no locking period field; Tenure stands in for it.
      ...(!isRto ? [assetDraft.period_months] : []),
      ...(isRental ? [assetDraft.monthly_rental_amount] : []),
      ...(isRto ? [assetDraft.tenure_months] : [])
    ];
    if (checks.some((x) => x === '' || x == null || String(x).trim() === '')) {
      toast.error('Fill every asset detail field');
      return;
    }
    const qty = Number(assetDraft.quantity);
    const rate = Number(assetDraft.rate);
    // For rent-to-own, the locking/period value carried downstream is the Tenure.
    const pm = isRto ? Number(assetDraft.tenure_months || 0) : Number(assetDraft.period_months);
    if (!(qty > 0) || !(Number.isFinite(rate) && rate >= 0) || !(Number.isFinite(pm) && pm >= 0)) {
      toast.error('Quantity must be > 0; rate and locking/warranty months must be valid');
      return;
    }
    const rowPayload = {
      brand: assetDraft.brand,
      model: assetDraft.model,
      processor: assetDraft.processor,
      generation: assetDraft.generation,
      ram: assetDraft.ram,
      storage: assetDraft.storage,
      gpu: assetDraft.gpu,
      screen_size: assetDraft.screen_size,
      quantity: qty,
      rate,
      period_months: pm,
      monthly_rental_amount: isRental ? Number(assetDraft.monthly_rental_amount) : undefined,
      tenure_months: isRto ? Number(assetDraft.tenure_months) : undefined
    };
    if (editingAssetIndex !== null) {
      setAssetRows((rows) => {
        const next = [...rows];
        if (next[editingAssetIndex] === undefined) return rows;
        next[editingAssetIndex] = rowPayload;
        return next;
      });
      setEditingAssetIndex(null);
      toast.success('Asset line updated');
    } else {
      setAssetRows((rows) => [...rows, rowPayload]);
    }
    setAssetDraft(emptyAssetDraft());
  }

  function loadAssetRowIntoForm(index) {
    const row = assetRows[index];
    if (!row) return;
    setAssetDraft({
      brand: String(row.brand ?? ''),
      model: String(row.model ?? ''),
      processor: String(row.processor ?? ''),
      generation: String(row.generation ?? ''),
      ram: String(row.ram ?? ''),
      storage: String(row.storage ?? ''),
      gpu: String(row.gpu ?? ''),
      screen_size: String(row.screen_size ?? ''),
      quantity: row.quantity !== '' && row.quantity != null ? String(row.quantity) : '',
      rate: row.rate !== '' && row.rate != null ? String(row.rate) : '',
      period_months: row.period_months !== '' && row.period_months != null ? String(row.period_months) : '',
      monthly_rental_amount:
        row.monthly_rental_amount != null ? String(row.monthly_rental_amount) : '',
      tenure_months: row.tenure_months != null ? String(row.tenure_months) : ''
    });
    setEditingAssetIndex(index);
  }

  function cancelAssetEdit() {
    setEditingAssetIndex(null);
    setAssetDraft(emptyAssetDraft());
  }

  function removeAssetRow(index) {
    if (editingAssetIndex === index) {
      setEditingAssetIndex(null);
      setAssetDraft(emptyAssetDraft());
    } else if (editingAssetIndex !== null && editingAssetIndex > index) {
      setEditingAssetIndex((i) => i - 1);
    }
    setAssetRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function submitModal(e) {
    e.preventDefault();
    if (editingAssetIndex !== null) {
      toast.error('Save or cancel the asset line you are editing before submitting the purchase order.');
      return;
    }
    if (!assetRows.length) {
      toast.error('Add at least one asset line using the Assets details section');
      return;
    }
    try {
      const line_items = assetRows.map((row) => {
        const line = {
          brand: row.brand,
          model: row.model,
          processor: row.processor,
          generation: row.generation,
          ram: row.ram,
          storage: row.storage,
          gpu: row.gpu,
          screen_size: row.screen_size,
          quantity: Number(row.quantity),
          rate: Number(row.rate)
        };
        if (form.purchase_order_type === 'direct_purchase') {
          line.warranty = Number(row.period_months);
        } else {
          line.vendor_locking_period = Number(row.period_months);
        }
        if (['rental_purchase', 'rent_to_own'].includes(form.purchase_order_type) && row.monthly_rental_amount != null) {
          line.monthly_rental_amount = Number(row.monthly_rental_amount);
        }
        if (form.purchase_order_type === 'rent_to_own' && row.tenure_months != null) {
          line.tenure_months = Number(row.tenure_months);
        }
        return line;
      });
      const assets_details = {
        brand: assetRows.map((r) => r.brand),
        Model: assetRows.map((r) => r.model),
        Processor: assetRows.map((r) => r.processor),
        Generation: assetRows.map((r) => r.generation),
        RAM: assetRows.map((r) => r.ram),
        Storage: assetRows.map((r) => r.storage),
        GPU: assetRows.map((r) => r.gpu),
        quantity: assetRows.map((r) => Number(r.quantity)),
        rate: assetRows.map((r) => Number(r.rate)),
        'Screen size': assetRows.map((r) => r.screen_size),
        locking_period: assetRows.map((r) => Number(r.period_months) || '')
      };

      const body = {
        purchase_order_number: form.purchase_order_number,
        purchase_order_date: form.purchase_order_date,
        purchase_order_type: form.purchase_order_type,
        vendor_id: Number(form.vendor_id),
        po_state: form.po_state,
        remarks: form.remarks.trim(),
        line_items,
        assets_details
      };
      const { data } = await createPurchaseOrder(body);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Purchase Order saved successfully');
      closeModal();
      loadList();
    } catch (err) {
      const msg = err.response?.data?.errors?.[0]?.msg;
      toast.error(msg || err.response?.data?.message || err.message || 'Save failed');
    }
  }

  function poStateMatchesVendor(poStateSlug, vendorStateRaw) {
    if (!poStateSlug || vendorStateRaw == null || String(vendorStateRaw).trim() === '') return false;
    const slug = String(poStateSlug).trim().toLowerCase();
    const vs = String(vendorStateRaw).trim();
    const vsSlug = vs.toLowerCase().replace(/\s+/g, '_');
    if (slug === vsSlug) return true;
    const opt = STATE_OPTIONS.find((o) => o.label.toLowerCase() === vs.toLowerCase());
    return opt?.value === slug;
  }

  function openDraftPurchaseOrderPreview() {
    if (editingAssetIndex !== null) {
      toast.error('Save or cancel the asset line you are editing before previewing.');
      return;
    }
    if (!form.vendor_id) {
      toast.error('Select a vendor');
      return;
    }
    if (!form.purchase_order_type) {
      toast.error('Select purchase order type');
      return;
    }
    if (!form.po_state) {
      toast.error('Select state of supply');
      return;
    }
    if (!form.purchase_order_date) {
      toast.error('Select purchase order date');
      return;
    }
    if (!form.remarks || !String(form.remarks).trim()) {
      toast.error('Enter remarks');
      return;
    }
    if (!assetRows.length) {
      toast.error('Add at least one asset line in Assets details');
      return;
    }
    setCreatePreviewOpen(true);
  }

  async function openPreview(poId) {
    setPreviewTab('details');
    setPreview({ open: true, loading: true, detail: null });
    try {
      const { data } = await fetchPurchaseOrder(poId);
      if (!data.success || !data.data) throw new Error(data.message || 'Not found');
      setPreview({ open: true, loading: false, detail: data.data });
      setActivityRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Could not load preview');
      setPreview({ open: false, loading: false, detail: null });
    }
  }

  function closePreview() {
    setPreview({ open: false, loading: false, detail: null });
  }

  async function onStatusChange(po, next, extra = {}) {
    if (!next || next === po.status) return;
    try {
      const { data } = await patchPurchaseOrderStatus(po.po_id, next, extra);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Purchase order status updated!');
      if (next === 'rejected') setRejectModal({ open: false, po: null, reason: '' });
      setActivityRefreshKey((k) => k + 1);
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
      await loadList();
    }
  }

  function openBillUpload(po) {
    setBillUpload({
      open: true,
      po,
      bill_name: po.bill_name || po.vendor_invoice_number || '',
    });
  }

  async function submitBillUpload(e) {
    e.preventDefault();
    const { po, bill_name } = billUpload;
    const input = document.getElementById('po-bill-files-input');
    const files = input?.files;
    if (!po) return;
    const name = bill_name.trim();
    if (!name) {
      toast.error('Bill number is required');
      return;
    }
    if (!files?.length) {
      toast.error('Select at least one file');
      return;
    }
    const fd = new FormData();
    fd.append('bill_name', name);
    for (let i = 0; i < files.length; i += 1) {
      fd.append('files', files[i]);
    }
    try {
      const { data } = await uploadPurchaseOrderBills(po.po_id, fd);
      if (!data.success) throw new Error(data.message);
      toast.success(data.message || 'Bill uploaded successfully');
      setBillUpload({ open: false, po: null, bill_name: '' });
      if (input) input.value = '';
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Upload failed');
    }
  }

  const previewLines = useMemo(() => parseLineItems(preview.detail), [preview.detail]);
  const lockingHeader =
    preview.detail?.purchase_order_type === 'direct_purchase' ? 'Warranty period' : 'Locking period';

  const previewGstFooter = useMemo(() => {
    const d = preview.detail;
    if (!d) return null;
    const sub = Number(d.sub_total_amount || 0);
    const same = !!d.is_same_state;
    if (!Number.isFinite(sub) || sub <= 0) return null;
    if (same) {
      const sgst = (sub * 9) / 100;
      const cgst = (sub * 9) / 100;
      const tot = sub + sgst + cgst;
      return { mode: 'intra', sub, sgst, cgst, tot };
    }
    const igst = (sub * 18) / 100;
    const tot = sub + igst;
    return { mode: 'inter', sub, igst, tot };
  }, [preview.detail]);

  const createDraftGstFooter = useMemo(() => {
    const sub = assetRows.reduce((acc, r) => {
      const q = Number(r.quantity) || 0;
      const rate = Number(r.rate) || 0;
      return acc + q * rate;
    }, 0);
    if (!Number.isFinite(sub) || sub <= 0) return null;
    const same = poStateMatchesVendor(form.po_state, selectedVendor?.state);
    if (same) {
      const sgst = (sub * 9) / 100;
      const cgst = (sub * 9) / 100;
      return { mode: 'intra', sub, sgst, cgst, tot: sub + sgst + cgst, sameState: true };
    }
    const igst = (sub * 18) / 100;
    return { mode: 'inter', sub, igst, tot: sub + igst, sameState: false };
  }, [assetRows, form.po_state, selectedVendor?.state]);

  const createDraftLockingHeader =
    form.purchase_order_type === 'direct_purchase' ? 'Warranty period' : 'Locking period';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          {vendorFilterId ? (
            <p className="text-xs text-blue-600 mt-1 font-medium">Filtered by vendor #{vendorFilterId}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Purchase Order
        </button>
      </header>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
        <p className="font-semibold mb-1">PO approval &amp; vendor flow</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-800/90 text-xs sm:text-sm">
          <li>
            <strong>Procurement</strong> creates a PO and clicks <em>Submit for Approval</em>.
          </li>
          <li>
            <strong>Manager / Admin</strong> reviews POs in the <em>Pending Approval</em> tab and approves or rejects.
            Managers with SMTP configured receive an email alert; otherwise use the <em>Pending Approval</em> tab.
          </li>
          <li>
            On approval, the vendor receives an email with the PO PDF and can accept/reject in the{' '}
            <strong>Vendor Portal</strong> (optional — you can still receive goods without portal use).
          </li>
          <li>
            After approval, use the <strong>eye icon</strong> to receive goods. Upload the vendor bill here or during GRN;
            vendor portal invoices also appear in the bill column.
          </li>
        </ol>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-100 bg-white rounded-xl border border-gray-100 p-2 shadow-sm">
        {PO_STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              statusTab === tab.key ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                statusTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {loading ? '…' : statusTabCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search PO #, type, remark, vendor…"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full max-w-md"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <div className="p-8 rounded-lg border text-center text-slate-500 animate-pulse">Loading…</div>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="grid gap-3 md:hidden">
          {rows.length === 0 ? (
            <div className="p-8 rounded-lg border bg-white text-center text-slate-500">
              No purchase orders match your filters.
            </div>
          ) : rows.map((r, i) => {
            const st = String(r.status || '').toLowerCase();
            const vendorName =
              r.vendor_display_name || r.vendor_business_name || r.vendor_first_name || `Vendor #${r.vendor_id}`;
            const showEye = showReceiveEye(r.status);
            const showSubmit = canSubmitForApproval(r.status) && procurement;
            const showManagerActions = isPendingManagerApproval(r.status) && manager;
            const typeBadge = poTypeBadge(r.purchase_order_type);
            const stBadge = poStatusBadge(r.status);
            const billInfo = getPoBillInfo(r);
            return (
              <div key={r.po_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-orange-600 font-bold hover:underline"
                    onClick={() => openPreview(r.po_id)}
                  >
                    {r.purchase_order_number}
                  </button>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${stBadge.className}`}>
                    {stBadge.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${typeBadge.className}`}>{typeBadge.label}</span>
                  <span>{r.purchase_order_date}</span>
                </div>
                <p className="text-sm text-slate-800 font-medium">{vendorName}</p>
                {r.remarks ? <div className="text-xs text-slate-600"><RemarkCell text={r.remarks} /></div> : null}
                {st === 'rejected' && r.rejection_reason ? (
                  <p className="text-xs text-red-600">Rejected: {r.rejection_reason}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {billInfo.billName ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 font-semibold text-slate-800"
                      onClick={() => setBillView({ open: true, bill_name: billInfo.billName, files: billInfo.files, poId: r.po_id })}
                    >
                      View bill
                    </button>
                  ) : showEye ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 font-semibold"
                      onClick={() => openBillUpload(r)}
                    >
                      Upload bill
                    </button>
                  ) : (
                    <span className="text-slate-400">Bill after approval</span>
                  )}
                </div>

                {(showSubmit || showManagerActions || showEye) && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                    {showSubmit ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold"
                        onClick={() => onStatusChange(r, 'pending_approval')}
                      >
                        Submit for Approval
                      </button>
                    ) : null}
                    {showManagerActions ? (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                          onClick={() => onStatusChange(r, 'approved')}
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                          onClick={() => setRejectModal({ open: true, po: r, reason: '' })}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {showEye && !showSubmit ? (
                      <Link
                        to={`/vendor-management/purchase-orders/${r.po_id}/receive`}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-blue-200 text-blue-600 text-xs font-semibold hover:bg-blue-50"
                      >
                        <Eye className="w-4 h-4" /> {st === 'completed' ? 'View received' : 'Receive goods'}
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden md:block overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="p-3">S No.</th>
                <th className="p-3">Purchase order details</th>
                <th className="p-3">Vendor name</th>
                <th className="p-3">Remark</th>
                <th className="p-3">Bill number</th>
                <th className="p-3">Upload / view</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = String(r.status || '').toLowerCase();
                const vendorName =
                  r.vendor_display_name || r.vendor_business_name || r.vendor_first_name || `Vendor #${r.vendor_id}`;
                const showEye = showReceiveEye(r.status);
                const showSubmit = canSubmitForApproval(r.status) && procurement;
                const showManagerActions = isPendingManagerApproval(r.status) && manager;
                const typeBadge = poTypeBadge(r.purchase_order_type);
                const stBadge = poStatusBadge(r.status);
                const billInfo = getPoBillInfo(r);

                return (
                  <tr key={r.po_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-3 text-slate-600">{(page - 1) * LIST_PAGE_SIZE + i + 1}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-left text-orange-600 font-semibold hover:underline"
                        onClick={() => openPreview(r.po_id)}
                      >
                        {r.purchase_order_number}
                      </button>
                      <p className="mt-1 text-xs text-gray-600 flex flex-wrap items-center gap-1">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${typeBadge.className}`}>
                          {typeBadge.label}
                        </span>
                        <span>{r.purchase_order_date}</span>
                      </p>
                    </td>
                    <td className="p-3 text-slate-800">{vendorName}</td>
                    <td className="p-3">
                      <RemarkCell text={r.remarks} />
                    </td>
                    <td className="p-3">
                      {billInfo.billName ? (
                        <button
                          type="button"
                          className="text-orange-600 font-medium hover:underline text-left"
                          onClick={() =>
                            setBillView({
                              open: true,
                              bill_name: billInfo.billName,
                              files: billInfo.files,
                              poId: r.po_id
                            })
                          }
                        >
                          {billInfo.billName}
                          {billInfo.source === 'vendor' ? (
                            <span className="block text-[10px] text-slate-500 font-normal">via vendor portal</span>
                          ) : null}
                        </button>
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-3">
                      {hasPoBill(r) ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                          onClick={() =>
                            setBillView({
                              open: true,
                              bill_name: billInfo.billName,
                              files: billInfo.files,
                              poId: r.po_id
                            })
                          }
                        >
                          View bill
                        </button>
                      ) : showEye ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-orange-500 text-orange-600 text-xs font-semibold hover:bg-orange-50"
                          onClick={() => openBillUpload(r)}
                        >
                          Upload bill
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">After approval</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-2 items-start">
                        {!showSubmit && !showManagerActions ? (
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${stBadge.className}`}>
                            {stBadge.label}
                          </span>
                        ) : null}
                        {showSubmit ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold"
                            onClick={() => onStatusChange(r, 'pending_approval')}
                          >
                            Submit for Approval
                          </button>
                        ) : null}
                        {showManagerActions ? (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                              onClick={() => onStatusChange(r, 'approved')}
                            >
                              <Check className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                              onClick={() => setRejectModal({ open: true, po: r, reason: '' })}
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                        {st === 'rejected' && r.rejection_reason ? (
                          <p className="text-[11px] text-gray-500 max-w-[12rem]" title={r.rejection_reason}>
                            {r.rejection_reason}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      {showSubmit ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : showEye ? (
                        <Link
                          to={`/vendor-management/purchase-orders/${r.po_id}/receive`}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50"
                          title={st === 'completed' ? 'View received items' : 'Receive Goods'}
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No purchase orders match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>
            Page {page} of {totalPages}
            <span className="text-slate-400 mx-2">·</span>
            {total} total
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create PO modal — unchanged fields vs Laravel PO form */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <h2 id="po-modal-title" className="text-lg font-bold text-slate-900">
                Purchase order form
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {metaLoading ? (
              <div className="p-12 text-center text-slate-500 text-sm animate-pulse">Loading form…</div>
            ) : (
              <form onSubmit={submitModal} className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                      Purchase order number <span className="text-red-500">*</span>
                    </label>
                    <input
                      readOnly
                      required
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                      value={form.purchase_order_number}
                      onChange={() => {}}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                      Purchase order date <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="date"
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      value={form.purchase_order_date}
                      onChange={(e) => setForm((f) => ({ ...f, purchase_order_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                      Purchase order type <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      value={form.purchase_order_type}
                      onChange={(e) => setForm((f) => ({ ...f, purchase_order_type: e.target.value }))}
                    >
                      <option value="">Please select</option>
                      <option value="rental_purchase">Rental purchase</option>
                      <option value="rent_to_own">Rent to own</option>
                      <option value="direct_purchase">Direct purchase</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                      Select vendor <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      value={form.vendor_id}
                      onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}
                    >
                      <option value="">Please select</option>
                      {vendorOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                      State of supply <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      value={form.po_state}
                      onChange={(e) => setForm((f) => ({ ...f, po_state: e.target.value }))}
                    >
                      <option value="">Select a state</option>
                      {STATE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {!metaLoading && vendorOptions.length === 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    No approved vendors found. Mark vendors as <strong>approved</strong> before creating a purchase order.
                  </p>
                )}

                {selectedVendor && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                    <p className="font-bold text-sm text-slate-900">{selectedVendor.label}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {selectedVendor.email && <span>{selectedVendor.email}</span>}
                      {selectedVendor.phone && <span>{selectedVendor.phone}</span>}
                    </div>
                    {selectedVendor.address && <p className="text-slate-600">{selectedVendor.address}</p>}
                    {selectedVendor.state != null && selectedVendor.state !== '' && (
                      <p className="text-slate-500">Vendor state: {selectedVendor.state}</p>
                    )}
                  </div>
                )}

                {selectedVendor && form.purchase_order_type && assetCatalog && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                      <Laptop className="w-5 h-5 text-slate-600" />
                      <h3 className="text-sm font-bold text-slate-900">Assets details</h3>
                      <span className="text-[11px] text-slate-500 ml-auto">Laravel PO form parity — add one or more rows</span>
                    </div>

                    {editingAssetIndex !== null ? (
                      <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50/90 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-teal-950">
                        <span>
                          Editing Product <strong className="tabular-nums">{editingAssetIndex + 1}</strong> — fields below are
                          prefilled; click <strong>Update Product</strong> when done.
                        </span>
                        <button
                          type="button"
                          onClick={() => cancelAssetEdit()}
                          className="shrink-0 px-3 py-1.5 rounded-md border border-teal-300 bg-white text-teal-900 text-[11px] font-semibold hover:bg-teal-50"
                        >
                          Cancel edit
                        </button>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <AssetSelect
                        label="All Brands"
                        required
                        value={assetDraft.brand}
                        onChange={(v) =>
                          setAssetDraft((d) => {
                            const nextModels = modelsForBrand(v, catalog);
                            const model =
                              d.model && nextModels.includes(d.model) ? d.model : '';
                            const nextProcs = processorsForBrand(v, catalog);
                            const processor = d.processor && nextProcs.includes(d.processor) ? d.processor : '';
                            const nextGens = generationsForBrandProcessor(v, processor, catalog);
                            const generation = d.generation && nextGens.includes(d.generation) ? d.generation : '';
                            return { ...d, brand: v, model, processor, generation };
                          })
                        }
                        options={catalog.brands}
                      />
                      <AssetSelect
                        label="Model"
                        required
                        value={assetDraft.model}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, model: v }))}
                        options={modelOptions}
                      />
                      <AssetSelect
                        label="Processor"
                        required
                        value={assetDraft.processor}
                        onChange={(v) =>
                          setAssetDraft((d) => {
                            const nextGens = generationsForBrandProcessor(d.brand, v, catalog);
                            const generation =
                              d.generation && nextGens.includes(d.generation) ? d.generation : '';
                            return { ...d, processor: v, generation };
                          })
                        }
                        options={processorOptions}
                      />
                      <AssetSelect
                        label="Generation"
                        required
                        value={assetDraft.generation}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, generation: v }))}
                        options={generationOptions}
                      />
                      <AssetSelect
                        label="Ram"
                        required
                        value={assetDraft.ram}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, ram: v }))}
                        options={catalog.rams}
                      />
                      <AssetSelect
                        label="Storage"
                        required
                        value={assetDraft.storage}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, storage: v }))}
                        options={catalog.storages}
                      />
                      <AssetSelect
                        label="Gpu"
                        required
                        value={assetDraft.gpu}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, gpu: v }))}
                        options={catalog.gpus}
                      />
                      <AssetSelect
                        label="Screen Size"
                        required
                        value={assetDraft.screen_size}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, screen_size: v }))}
                        options={catalog.screen_sizes}
                      />
                      <AssetTextInput
                        label="Quantity"
                        required
                        type="number"
                        min={1}
                        placeholder="Enter quantity"
                        value={assetDraft.quantity}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, quantity: v }))}
                      />
                      <AssetTextInput
                        label="Rate"
                        required
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Enter rate"
                        value={assetDraft.rate}
                        onChange={(v) => setAssetDraft((d) => ({ ...d, rate: v }))}
                      />
                      {/* Rent-to-own uses Tenure only — no separate locking period. */}
                      {form.purchase_order_type !== 'rent_to_own' && (
                        <div className="lg:col-span-2">
                          <AssetTextInput
                            label={
                              form.purchase_order_type === 'direct_purchase'
                                ? 'Warranty (In Month)'
                                : 'Locking Period (In Month)'
                            }
                            required
                            type="number"
                            min={0}
                            placeholder="Enter value in month"
                            value={assetDraft.period_months}
                            onChange={(v) => setAssetDraft((d) => ({ ...d, period_months: v }))}
                          />
                        </div>
                      )}
                      {['rental_purchase', 'rent_to_own'].includes(form.purchase_order_type) ? (
                        <AssetTextInput
                          label="Monthly Rental Amount"
                          required
                          type="number"
                          min={0}
                          step="any"
                          placeholder="Monthly rental (₹)"
                          value={assetDraft.monthly_rental_amount}
                          onChange={(v) => setAssetDraft((d) => ({ ...d, monthly_rental_amount: v }))}
                        />
                      ) : null}
                      {form.purchase_order_type === 'rent_to_own' ? (
                        <AssetTextInput
                          label="Tenure (months)"
                          required
                          type="number"
                          min={1}
                          placeholder="Rent-to-own tenure"
                          value={assetDraft.tenure_months}
                          onChange={(v) => setAssetDraft((d) => ({ ...d, tenure_months: v }))}
                        />
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={addAssetRow}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-slate-400 bg-slate-100 text-slate-900 text-sm font-semibold hover:bg-slate-200"
                      >
                        {editingAssetIndex !== null ? (
                          <>
                            Update Product
                            <Check className="w-5 h-5" />
                          </>
                        ) : (
                          <>
                            Add
                            <PlusCircle className="w-5 h-5" />
                          </>
                        )}
                      </button>
                      {editingAssetIndex !== null ? (
                        <button
                          type="button"
                          onClick={() => cancelAssetEdit()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50"
                        >
                          Cancel edit
                        </button>
                      ) : null}
                    </div>

                    {assetRows.length > 0 ? (
                      <div className="mt-6 border-t border-slate-100 pt-4">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Added Products ({assetRows.length})</p>
                        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                          {assetRows.map((row, idx) => {
                            const periodMonthsLabel =
                              form.purchase_order_type === 'direct_purchase'
                                ? 'Warranty (mo)'
                                : 'Locking period (mo)';
                            return (
                              <div
                                key={`asset-added-${idx}-${row.brand}-${row.model}`}
                                className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-slate-50/80 px-3 py-2.5 text-xs text-slate-800 transition-shadow ${
                                  idx === editingAssetIndex
                                    ? 'border-teal-400 ring-2 ring-teal-400/40 shadow-sm'
                                    : 'border-slate-100'
                                }`}
                              >
                                <div className="flex-1 min-w-0 space-y-2">
                                  <p className="m-0 font-semibold text-slate-900 text-sm">
                                    {row.brand} — {row.model}
                                  </p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px] leading-snug">
                                    <span>
                                      <span className="font-medium text-slate-500">Processor</span>
                                      <span className="block text-slate-800">{row.processor}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Generation</span>
                                      <span className="block text-slate-800">{row.generation}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Ram</span>
                                      <span className="block text-slate-800">{row.ram}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Storage</span>
                                      <span className="block text-slate-800">{row.storage}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Gpu</span>
                                      <span className="block text-slate-800">{row.gpu}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Screen size</span>
                                      <span className="block text-slate-800">{row.screen_size}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Quantity</span>
                                      <span className="block text-slate-800 tabular-nums">{row.quantity}</span>
                                    </span>
                                    <span>
                                      <span className="font-medium text-slate-500">Rate</span>
                                      <span className="block text-slate-800 tabular-nums">₹{row.rate}</span>
                                    </span>
                                    <span className="sm:col-span-1">
                                      <span className="font-medium text-slate-500">{periodMonthsLabel}</span>
                                      <span className="block text-slate-800 tabular-nums">{row.period_months}</span>
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 self-start">
                                  <button
                                    type="button"
                                    title="Edit in form above"
                                    onClick={() => loadAssetRowIntoForm(idx)}
                                    className="p-2 rounded-md border border-slate-200 text-teal-700 hover:bg-teal-50"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Remove Product"
                                    onClick={() => removeAssetRow(idx)}
                                    className="p-2 rounded-md border border-slate-200 text-rose-600 hover:bg-rose-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-4">
                        After filling all fields above, click <strong>Add</strong> once per asset row. Use the pencil on a
                        row to load it back into the form for changes.
                      </p>
                    )}
                  </div>
                )}

                {selectedVendor && !form.purchase_order_type ? (
                  <p className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    Pick <strong>Purchase order type</strong> to reveal <strong>Assets details</strong>.
                  </p>
                ) : null}

                <div>
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    Remarks <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={3}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Enter remarks"
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-100">
                  <p className="text-[11px] text-slate-500 m-0 order-2 sm:order-1">
                    Use <strong>Preview</strong> to review entries. <strong>Save</strong> creates the purchase order.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2 order-1 sm:order-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={metaLoading}
                      onClick={openDraftPurchaseOrderPreview}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Eye className="w-4 h-4 shrink-0" />
                      Preview
                    </button>
                    <button
                      type="submit"
                      disabled={metaLoading}
                      className="px-5 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Draft preview — data from create PO modal only (above z-create modal) */}
      {modalOpen && createPreviewOpen && (
        <div
          className="fixed inset-0 z-[102] flex items-center justify-center p-4 bg-black/55"
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-draft-preview-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreatePreviewOpen(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50 gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Draft</p>
                <h2 id="po-draft-preview-title" className="text-lg font-bold text-slate-900 leading-tight">
                  Purchase order preview
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setCreatePreviewOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-white bg-slate-100/80"
                >
                  Back to form
                </button>
                <button
                  type="button"
                  onClick={() => setCreatePreviewOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-200"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 m-0">
                Not saved yet. Close this window to return to the form, then click <strong>Save</strong> when ready.
              </p>

              {selectedVendor ? (
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                  <div className="grid sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="font-bold text-slate-900">{selectedVendor.label}</p>
                      <p className="text-slate-600 mt-1">{selectedVendor.email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-slate-700">{selectedVendor.phone || '—'}</p>
                      <p className="text-slate-600 mt-1 line-clamp-2">{selectedVendor.address || '—'}</p>
                    </div>
                    <div className="text-xs text-slate-500">
                      Vendor state: {selectedVendor.state != null && String(selectedVendor.state).trim() !== '' ? selectedVendor.state : '—'}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex flex-wrap justify-between gap-2 px-4 py-3 bg-slate-100 text-sm font-semibold text-slate-900">
                  <span>{form.purchase_order_number || '—'}</span>
                  <span>{form.purchase_order_date || '—'}</span>
                </div>
                <div className="p-4 grid sm:grid-cols-2 gap-2 text-sm text-slate-700">
                  <p>
                    <span className="text-slate-500">Purchase type:</span> {formatPoType(form.purchase_order_type)}
                  </p>
                  <p>
                    <span className="text-slate-500">State of supply:</span>{' '}
                    {STATE_OPTIONS.find((o) => o.value === form.po_state)?.label || form.po_state || '—'}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="text-slate-500">Remarks:</span> {form.remarks?.trim() || '—'}
                  </p>
                  <p>
                    <span className="text-slate-500">Total lines:</span> {assetRows.length}
                  </p>
                  <p>
                    <span className="text-slate-500">GST (estimate):</span>{' '}
                    {selectedVendor?.state
                      ? createDraftGstFooter?.sameState
                        ? 'SGST + CGST (same state)'
                        : 'IGST (other state)'
                      : 'Depends on vendor state'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="p-2">SL</th>
                      <th className="p-2">Item description</th>
                      <th className="p-2 whitespace-nowrap">{createDraftLockingHeader}</th>
                      <th className="p-2">Ordered qty</th>
                      <th className="p-2">Received</th>
                      <th className="p-2">Remaining</th>
                      <th className="p-2">Rate (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetRows.map((row, idx) => {
                      const qty = Number(row.quantity) || 0;
                      const rate = Number(row.rate) || 0;
                      const lockMonths = Number(row.period_months) || 0;
                      const title = `${row.brand}${row.model ? ` — ${row.model}` : ''}`.trim() || `Product ${idx + 1}`;
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2 min-w-[12rem]">
                            <div className="rounded-lg border bg-slate-50/80 p-2">
                              <p className="font-semibold text-slate-900">{title}</p>
                              <p className="text-xs text-slate-600 mt-0.5">
                                {[row.processor, row.generation].filter(Boolean).join(' · ')}{' '}
                                {[row.ram, row.storage].filter(Boolean).join(' | ')}{' '}
                                {row.gpu ? ` · ${row.gpu}` : ''}
                              </p>
                              {row.screen_size ? (
                                <p className="text-[11px] text-slate-500 mt-1">Screen: {row.screen_size}</p>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-slate-700">{lockMonths ? `${lockMonths} mo` : '—'}</td>
                          <td className="p-2 tabular-nums">{qty}</td>
                          <td className="p-2 text-slate-400">—</td>
                          <td className="p-2 tabular-nums">{qty}</td>
                          <td className="p-2 font-mono">{rate.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {createDraftGstFooter && assetRows.length > 0 && (
                    <tfoot className="bg-slate-50 font-semibold text-slate-800">
                      {createDraftGstFooter.mode === 'intra' ? (
                        <>
                          <tr>
                            <td colSpan={6} className="p-2 text-right">
                              Sub total
                            </td>
                            <td className="p-2">₹{createDraftGstFooter.sub.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                              SGST (9%)
                            </td>
                            <td className="p-2 font-normal">₹{createDraftGstFooter.sgst.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                              CGST (9%)
                            </td>
                            <td className="p-2 font-normal">₹{createDraftGstFooter.cgst.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={6} className="p-2 text-right">
                              Total
                            </td>
                            <td className="p-2">₹{createDraftGstFooter.tot.toFixed(2)}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td colSpan={6} className="p-2 text-right">
                              Sub total
                            </td>
                            <td className="p-2">₹{createDraftGstFooter.sub.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                              IGST (18%)
                            </td>
                            <td className="p-2 font-normal">₹{createDraftGstFooter.igst.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={6} className="p-2 text-right">
                              Total
                            </td>
                            <td className="p-2">₹{createDraftGstFooter.tot.toFixed(2)}</td>
                          </tr>
                        </>
                      )}
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-slate-50 shrink-0">
              <button
                type="button"
                onClick={() => setCreatePreviewOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-white bg-slate-100/80"
              >
                Back to form
              </button>
              <button
                type="button"
                disabled={metaLoading}
                onClick={submitModal}
                className="px-5 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal — vendor + PO summary + line_items table */}
      {preview.open && (
        <div
          className="fixed inset-0 z-[101] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50 gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Purchase order details</h2>
                {preview.detail?.purchase_order_number ? (
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{preview.detail.purchase_order_number}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {!preview.loading && preview.detail ? (
              <div className="flex gap-2 border-b px-5 pt-2">
                {['details', 'activity'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPreviewTab(t)}
                    className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${
                      previewTab === t
                        ? 'border-indigo-600 text-indigo-700 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {t === 'activity' ? 'Activity' : 'Details'}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {preview.loading ? (
                <div className="py-16 text-center text-slate-500 animate-pulse">Loading…</div>
              ) : preview.detail ? (
                previewTab === 'activity' ? (
                  <PoActivityPanel poId={preview.detail.po_id} refreshKey={activityRefreshKey} />
                ) : (
                <>
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                    <div className="grid sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="font-bold text-slate-900">{preview.detail.vendor_display_name || 'Vendor'}</p>
                        <p className="text-slate-600 mt-1">{preview.detail.vendor_email || '—'}</p>
                      </div>
                      <div>
                        <p className="text-slate-700">{preview.detail.vendor_phone || '—'}</p>
                        <p className="text-slate-600 mt-1 line-clamp-2">{preview.detail.vendor_address || '—'}</p>
                      </div>
                      <div className="text-xs text-slate-500">
                        Vendor state: {preview.detail.vendor_state || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex flex-wrap justify-between gap-2 px-4 py-3 bg-slate-100 text-sm font-semibold text-slate-900">
                      <span>{preview.detail.purchase_order_number}</span>
                      <span>{preview.detail.purchase_order_date}</span>
                    </div>
                    <div className="p-4 grid sm:grid-cols-2 gap-2 text-sm text-slate-700">
                      <p>
                        <span className="text-slate-500">Purchase type:</span>{' '}
                        {formatPoType(preview.detail.purchase_order_type)}
                      </p>
                      <p>
                        <span className="text-slate-500">Remark:</span> {preview.detail.remarks || '—'}
                      </p>
                      <p>
                        <span className="text-slate-500">Total Products:</span> {previewLines.length}
                      </p>
                      <p>
                        <span className="text-slate-500">GST:</span>{' '}
                        {preview.detail.is_same_state ? 'SGST + CGST (same state)' : 'IGST (other state)'}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                        <tr>
                          <th className="p-2">SL</th>
                          <th className="p-2">Item description</th>
                          <th className="p-2 whitespace-nowrap">{lockingHeader}</th>
                          <th className="p-2">Ordered qty</th>
                          <th className="p-2">Received</th>
                          <th className="p-2">Remaining</th>
                          <th className="p-2">Rate (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewLines.map((item, idx) => {
                          const qty = Number(item.quantity) || 0;
                          const rc = Number(item.receivedQty ?? item.received_qty ?? 0) || 0;
                          const rem = Math.max(0, qty - rc);
                          const rate = Number(item.rate) || 0;
                          const lockMonths =
                            preview.detail?.purchase_order_type === 'direct_purchase'
                              ? Number(item.warranty) || 0
                              : Number(item.vendor_locking_period) || 0;
                          const brand = item.brand_name || item.brand || '';
                          const title = `${brand}${item.model ? ` — ${item.model}` : ''}`.trim() || `Product ${idx + 1}`;
                          return (
                            <tr key={idx} className="border-t">
                              <td className="p-2">{idx + 1}</td>
                              <td className="p-2 min-w-[12rem]">
                                <div className="rounded-lg border bg-slate-50/80 p-2">
                                  <p className="font-semibold text-slate-900">{title}</p>
                                  <p className="text-xs text-slate-600 mt-0.5">
                                    {[item.processor, item.generation].filter(Boolean).join(' · ')}{' '}
                                    {[item.ram, item.storage].filter(Boolean).join(' | ')}{' '}
                                    {item.gpu ? ` · ${item.gpu}` : ''}
                                  </p>
                                </div>
                              </td>
                              <td className="p-2 text-slate-700">{lockMonths ? `${lockMonths} mo` : '—'}</td>
                              <td className="p-2">{qty}</td>
                              <td className="p-2">{rc}</td>
                              <td className="p-2">{rem}</td>
                              <td className="p-2 font-mono">{rate.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {previewGstFooter && previewLines.length > 0 && (
                        <tfoot className="bg-slate-50 font-semibold text-slate-800">
                          {previewGstFooter.mode === 'intra' ? (
                            <>
                              <tr>
                                <td colSpan={6} className="p-2 text-right">
                                  Sub total
                                </td>
                                <td className="p-2">₹{previewGstFooter.sub.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                                  SGST (9%)
                                </td>
                                <td className="p-2 font-normal">₹{previewGstFooter.sgst.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                                  CGST (9%)
                                </td>
                                <td className="p-2 font-normal">₹{previewGstFooter.cgst.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={6} className="p-2 text-right">
                                  Total
                                </td>
                                <td className="p-2">₹{previewGstFooter.tot.toFixed(2)}</td>
                              </tr>
                            </>
                          ) : (
                            <>
                              <tr>
                                <td colSpan={6} className="p-2 text-right">
                                  Sub total
                                </td>
                                <td className="p-2">₹{previewGstFooter.sub.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={6} className="p-2 text-right font-normal text-slate-600">
                                  IGST (18%)
                                </td>
                                <td className="p-2 font-normal">₹{previewGstFooter.igst.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={6} className="p-2 text-right">
                                  Total
                                </td>
                                <td className="p-2">₹{previewGstFooter.tot.toFixed(2)}</td>
                              </tr>
                            </>
                          )}
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* View bill files */}
      {billView.open && (
        <div
          className="fixed inset-0 z-[102] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBillView({ ...billView, open: false });
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-2">
              <h3 className="font-bold text-slate-900">Bill #{billView.bill_name}</h3>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-100"
                aria-label="Close"
                onClick={() => setBillView({ ...billView, open: false })}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {billView.files.length === 0 && <li className="text-slate-500">No files on record.</li>}
              {billView.files.map((f, idx) => {
                const href = filePublicUrl(f);
                return (
                  <li key={`${href}-${idx}`}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-orange-600 hover:underline"
                    >
                      {typeof f === 'string' ? f.split('/').pop() : 'File'}{' '}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Upload bill */}
      {billUpload.open && billUpload.po && (
        <div
          className="fixed inset-0 z-[102] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBillUpload({ open: false, po: null, bill_name: '' });
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900">Upload bill / invoice</h3>
            <p className="text-xs text-slate-500 mt-1">PO {billUpload.po.purchase_order_number}</p>
            <form onSubmit={submitBillUpload} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Bill number</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={billUpload.bill_name}
                  onChange={(e) => setBillUpload((b) => ({ ...b, bill_name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Files</label>
                <input
                  id="po-bill-files-input"
                  type="file"
                  multiple
                  className="mt-1 w-full text-sm"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border text-sm"
                  onClick={() => setBillUpload({ open: false, po: null, bill_name: '' })}
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold">
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectModal.open && rejectModal.po ? (
        <div
          className="fixed inset-0 z-[103] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="font-bold text-slate-900">Reject purchase order</h3>
            <p className="text-xs text-slate-500 mt-1">{rejectModal.po.purchase_order_number}</p>
            <textarea
              className="mt-4 w-full border rounded-lg px-3 py-2 text-sm min-h-[100px]"
              placeholder="Reason for rejection (required)"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((m) => ({ ...m, reason: e.target.value }))}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border text-sm"
                onClick={() => setRejectModal({ open: false, po: null, reason: '' })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                disabled={!rejectModal.reason.trim()}
                onClick={() => onStatusChange(rejectModal.po, 'rejected', { rejection_reason: rejectModal.reason.trim() })}
              >
                Reject PO
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
