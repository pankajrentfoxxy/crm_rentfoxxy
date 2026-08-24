import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import DispatchModal from '../components/DispatchModal';
import ChangeAssigneeModal from '../components/ChangeAssigneeModal';
import EInvoicePanel from '../components/EInvoicePanel';
import SaleDcCompliancePanel from '../components/SaleDcCompliancePanel';
import DemoEwayPanel from '../components/DemoEwayPanel';
import QcStatusBadge from '../components/QcStatusBadge';
import {
  createDcQcTickets, getDC, getDcQcStatus, getDCMeta, getSalesOrderFull,
  markDelivered, markRejected, regenerateDcPdf, downloadDcRentalInvoicePdf, downloadDcBluedartAwbPdf,
  downloadBluedartWaybillPdfByAwb, cancelDC,
  sendDeliveryOtp, sendWarehouseReturnOtp, verifyDeliveryOtp, verifyWarehouseReturnOtp,
  sendAccountsDcMail, requestDemoEway,
  updateDC, dispatchDC, updateDcHsn, updateDcDeliveryDate, cancelDcBluedartAwb,
} from '../salesPipelineApi';
import {
  DC_STATUS_STYLES, formatConfig, formatCurrency, formatDate, formatDateTime,
  isDcAssignmentEditable, isDcCancellable, parseSerials, salesOrderDetailPath, statusLabel,
  resolveDcBackNavigation, downloadBlob, collectBluedartAwbRows,
} from '../salesPipelineUtils';
import DcBluedartAwbTable from '../components/DcBluedartAwbTable';
import { getBackendOrigin } from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import { Copy, KeyRound } from 'lucide-react';
import DcEditModal from '../components/DcEditModal';
import MarkDeliveredModal from '../components/MarkDeliveredModal';
import CourierTrackingModal from '../components/CourierTrackingModal';

function resolveDcNumber(params) {
  const raw = params['*'] ?? params.dcNumber ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const TABS = ['details', 'qc', 'dispatch', 'einvoice', 'eway'];

function dcPdfUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function uploadUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${p.replace(/^\/?uploads\//, '')}`;
}

function OtpBox({ label, code, onCopy }) {
  if (!code) return null;
  return (
    <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <KeyRound className="w-4 h-4 text-amber-800 shrink-0" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 m-0">{label}</p>
        <p className="font-mono text-2xl font-bold tracking-widest text-amber-950 m-0 leading-none">{code}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(code)}
        className="p-2 rounded-lg hover:bg-amber-100 text-amber-800"
        title="Copy OTP"
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function DeliveryChallanDetailPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dcNumber = resolveDcNumber(params);
  const listPath = '/sales-pipeline/delivery-challans';
  const cameFromElsewhere = Boolean(location.state?.from);

  const handleBack = useCallback(() => {
    const explicit = resolveDcBackNavigation(location.state);
    if (explicit) {
      navigate(explicit.path, explicit.state ? { state: explicit.state } : undefined);
      return;
    }
    if (cameFromElsewhere) {
      navigate(-1);
      return;
    }
    navigate(listPath);
  }, [cameFromElsewhere, listPath, location.state, navigate]);
  const { user } = useAuth();
  const { canView } = usePermission();
  const canViewOtp = canView('delivery_register_otp');
  const isSuperAdmin = user?.role === 'super_admin';
  const canOverrideHsn = user?.role === 'admin' || user?.role === 'super_admin';
  const canEditDeliveryDate = isSuperAdmin || canOverrideHsn;
  const [tab, setTab] = useState('details');
  const [lines, setLines] = useState([]);
  const [billingLines, setBillingLines] = useState([]);
  const [totals, setTotals] = useState(null);
  const [qc, setQc] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [ttsplDrawer, setTtsplDrawer] = useState(null);
  const [otpModal, setOtpModal] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [warehouseOtp, setWarehouseOtp] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [awbGenerating, setAwbGenerating] = useState(false);
  const [changeAssigneeOpen, setChangeAssigneeOpen] = useState(false);
  const [assignmentEditable, setAssignmentEditable] = useState(false);
  const [assignmentHistory, setAssignmentHistory] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [hsnDraft, setHsnDraft] = useState('');
  const [hsnSaving, setHsnSaving] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSaving, setCancelSaving] = useState(false);
  const [saleCompliance, setSaleCompliance] = useState(null);
  const [demoEwayCompliance, setDemoEwayCompliance] = useState(null);
  const [canDownloadPdf, setCanDownloadPdf] = useState(true);
  const [rentalInvoice, setRentalInvoice] = useState(null);
  const [invoicePdfLoading, setInvoicePdfLoading] = useState(false);
  const [bluedartPdfLoading, setBluedartPdfLoading] = useState(false);
  const [shipmentUnits, setShipmentUnits] = useState([]);
  const [updateDeliveryDateOpen, setUpdateDeliveryDateOpen] = useState(false);
  const [sendingAccountsMail, setSendingAccountsMail] = useState(false);
  const [apiCanViewOtp, setApiCanViewOtp] = useState(false);
  const [apiDeliveryOtp, setApiDeliveryOtp] = useState(null);
  const [apiWarehouseOtp, setApiWarehouseOtp] = useState(null);

  const head = lines[0] || {};
  const showOtp = canViewOtp || apiCanViewOtp || isSuperAdmin;
  const deliveryOtpCode = apiDeliveryOtp || head.otp_code || head.d_otp || head.delivery_otp || null;
  const warehouseReturnOtpCode = apiWarehouseOtp || head.warehouse_return_otp || null;
  const summaryLines = billingLines.length ? billingLines : lines;
  const isSale = head.entity_code === 'gorefurbo' || head.quotation_type === 'sale' || head.quotation_type === 'sales';
  const needsInvoice = Boolean(saleCompliance?.requires_invoice_compliance) || isSale;
  const needsDemoEway = Boolean(demoEwayCompliance?.applies || demoEwayCompliance?.requires_eway_bill);

  const loadQc = useCallback(async () => {
    try {
      const res = await getDcQcStatus(dcNumber);
      setQc(res.data);
    } catch {
      setQc(null);
    }
  }, [dcNumber]);

  const load = useCallback(async () => {
    try {
      const res = await getDC(dcNumber);
      setLines(res.data?.lines || []);
      setBillingLines(res.data?.billing_lines || []);
      setTotals(res.data?.totals || null);
      setAssignmentEditable(res.data?.assignment_editable ?? isDcAssignmentEditable(res.data?.lines?.[0]?.status));
      setAssignmentHistory(res.data?.assignment_history || []);
      setHsnDraft(res.data?.lines?.[0]?.hsn_code || '');
      setSaleCompliance(res.data?.sale_compliance || null);
      setDemoEwayCompliance(res.data?.demo_eway_compliance || null);
      setCanDownloadPdf(res.data?.can_download_pdf !== false);
      setRentalInvoice(res.data?.rental_invoice || null);
      setShipmentUnits(res.data?.shipment_units || []);
      setApiCanViewOtp(Boolean(res.data?.can_view_otp));
      setApiDeliveryOtp(res.data?.otp_code || res.data?.lines?.[0]?.otp_code || res.data?.lines?.[0]?.d_otp || null);
      setApiWarehouseOtp(res.data?.warehouse_return_otp || res.data?.lines?.[0]?.warehouse_return_otp || null);
      if (res.data?.lines?.[0]?.sales_order_number) {
        const soRes = await getSalesOrderFull(res.data.lines[0].sales_order_number);
        setPaymentSummary(soRes.data?.summary);
      }
    } catch {
      toast.error('DC not found');
    }
    await loadQc();
  }, [dcNumber, loadQc]);

  useEffect(() => { load(); }, [load]);

  const openChangeAssignee = async () => {
    const so = lines[0]?.sales_order_number;
    if (so) {
      try {
        const meta = await getDCMeta(so);
        setTechnicians(meta.data?.delivery_technicians || []);
      } catch {
        setTechnicians([]);
      }
    }
    setChangeAssigneeOpen(true);
  };

  const bluedartAwbs = useMemo(
    () => collectBluedartAwbRows(head, shipmentUnits),
    [head, shipmentUnits]
  );

  const parseDownloadError = async (err, fallback) => {
    let msg = fallback;
    const data = err.response?.data;
    if (data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text());
        msg = parsed.message || msg;
      } catch { /* ignore */ }
    } else if (data?.message) {
      msg = data.message;
    }
    return msg;
  };

  const handleCancelBluedartAwb = async () => {
    const awb = bluedartAwbs.map((r) => r.awb_number).join(', ') || head.awb_number;
    if (!awb) return;
    if (!window.confirm(`Cancel BlueDart AWB${bluedartAwbs.length > 1 ? 's' : ''} ${awb} and clear them from this DC?`)) return;
    setAwbGenerating(true);
    try {
      const { data } = await cancelDcBluedartAwb(dcNumber, { awb_number: awb });
      toast.success(data?.message || `AWB ${awb} cancelled`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'BlueDart cancel failed');
    } finally {
      setAwbGenerating(false);
    }
  };

  const handleDownloadOneAwbPdf = async (awb) => {
    if (!awb) {
      toast.error('Generate BlueDart AWB first');
      return;
    }
    setBluedartPdfLoading(awb);
    try {
      try {
        const res = await downloadDcBluedartAwbPdf(dcNumber, { awb });
        downloadBlob(new Blob([res.data], { type: 'application/pdf' }), `BlueDart_${awb}.pdf`);
        toast.success(`AWB ${awb} downloaded`);
        return;
      } catch {
        // fall through to filename lookup
      }
      const pdfRes = await downloadBluedartWaybillPdfByAwb(awb);
      downloadBlob(new Blob([pdfRes.data], { type: 'application/pdf' }), `BlueDart_${awb}.pdf`);
      toast.success(`AWB ${awb} downloaded`);
    } catch (err) {
      toast.error(await parseDownloadError(err, `Could not download PDF for AWB ${awb}`));
    } finally {
      setBluedartPdfLoading(false);
    }
  };

  const handleDownloadAllAwbPdfs = async () => {
    if (!bluedartAwbs.length) {
      toast.error('Generate BlueDart AWB first');
      return;
    }
    if (bluedartAwbs.length === 1) {
      return handleDownloadOneAwbPdf(bluedartAwbs[0].awb_number);
    }
    setBluedartPdfLoading('all');
    try {
      try {
        const res = await downloadDcBluedartAwbPdf(dcNumber, { all: 1 });
        const safeDc = String(dcNumber).replace(/[^\w.-]+/g, '-');
        downloadBlob(new Blob([res.data], { type: 'application/pdf' }), `BlueDart_${safeDc}_all.pdf`);
        toast.success(`Downloaded ${bluedartAwbs.length} AWB PDFs`);
        return;
      } catch {
        // fall through: download each AWB separately
      }
      let ok = 0;
      for (const row of bluedartAwbs) {
        try {
          const pdfRes = await downloadBluedartWaybillPdfByAwb(row.awb_number);
          downloadBlob(new Blob([pdfRes.data], { type: 'application/pdf' }), `BlueDart_${row.awb_number}.pdf`);
          ok += 1;
        } catch {
          // continue remaining AWBs
        }
      }
      if (!ok) toast.error('Could not download BlueDart AWB PDFs');
      else toast.success(`Downloaded ${ok} of ${bluedartAwbs.length} AWB PDFs`);
    } catch (err) {
      toast.error(await parseDownloadError(err, 'Could not download BlueDart AWB PDFs'));
    } finally {
      setBluedartPdfLoading(false);
    }
  };

  const initiateQc = async () => {
    try {
      const res = await createDcQcTickets(dcNumber);
      toast.success(`${res.data?.tickets_created || 0} QC tickets created`);
      loadQc();
    } catch (err) {
      toast.error(err.response?.data?.message || 'QC initiation failed');
    }
  };

  const handleSendOtp = async () => {
    try {
      const r = await sendDeliveryOtp(dcNumber, {});
      if (r.data?.otp_visible) {
        setApiDeliveryOtp(r.data.otp_visible);
        toast.success(`OTP: ${r.data.otp_visible}`);
      } else {
        toast.success('OTP sent to customer');
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'OTP send failed');
    }
  };

  const copyOtp = async (code) => {
    try {
      await navigator.clipboard.writeText(String(code));
      toast.success('OTP copied');
    } catch {
      toast.error('Could not copy OTP');
    }
  };

  const handleVerifyDeliver = async () => {
    try {
      await verifyDeliveryOtp(dcNumber, { otp: otpValue });
      await markDelivered(dcNumber, {});
      toast.success('Delivered ?');
      setOtpModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Verification failed');
    }
  };

  const confirmUpdateDeliveryDate = async ({ delivered_at }) => {
    try {
      await updateDcDeliveryDate(dcNumber, { delivered_at });
      toast.success('Delivery date updated');
      setUpdateDeliveryDateOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update delivery date');
      throw err;
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      await markRejected(dcNumber, {
        rejection_reason: rejectReason.trim(),
        rejection_remarks: rejectRemarks.trim() || undefined,
      });
      toast.success('Marked rejected · confirm warehouse return with OTP when laptops are back');
      setRejectModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleCourierReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    try {
      await markRejected(dcNumber, {
        rejection_reason: rejectReason.trim(),
        rejection_remarks: rejectRemarks.trim() || undefined,
      });
      toast.success('Marked rejected · send warehouse return OTP when laptops arrive');
      setRejectModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleSendWarehouseReturnOtp = async () => {
    try {
      const r = await sendWarehouseReturnOtp(dcNumber);
      if (r.data?.otp_visible) {
        setWarehouseOtp(r.data.otp_visible);
        setApiWarehouseOtp(r.data.otp_visible);
        toast.success(`Warehouse OTP: ${r.data.otp_visible}`);
      } else {
        toast.success(r.data?.message || 'Warehouse OTP sent');
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send OTP');
    }
  };

  const handleVerifyWarehouseReturn = async () => {
    try {
      await verifyWarehouseReturnOtp(dcNumber, { otp: warehouseOtp });
      toast.success('Return confirmed · laptops in QC');
      setWarehouseOtp('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid OTP');
    }
  };

  const handleCancelDc = async () => {
    setCancelSaving(true);
    try {
      const res = await cancelDC(dcNumber, { reason: cancelReason.trim() || undefined });
      toast.success(res.data?.message || 'Delivery challan cancelled');
      setCancelModal(false);
      setCancelReason('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not cancel delivery challan');
    } finally {
      setCancelSaving(false);
    }
  };

  const isRejected = head.status === 'rejected';
  const isCancelled = head.status === 'cancelled';
  const canCancelDc = isSuperAdmin && isDcCancellable(head);
  const isCourier = head.dispatch_mode === 'courier' || head.ship_by === 'by_courier';
  const pendingWarehouseReturn = isRejected && !head.return_to_warehouse_at;

  const specStr = (d) => [d.processor, d.generation, d.ram, d.storage, d.gpu, d.screen_size]
    .filter(Boolean).join(' · ');
  const laptops = lines.flatMap((l) => (
    (l.serials_detail && l.serials_detail.length)
      ? l.serials_detail.map((d) => ({ ttspl: d.ttspl, config: `${d.brand} ${d.model} · ${specStr(d)}`.trim() }))
      : parseSerials(l.serial_number).map((s) => {
        const parts = String(s).split('|');
        return { ttspl: parts[2] || parts[1] || parts[0], config: formatConfig(l) };
      })
  ));
  const allUnits = lines.flatMap((l) => {
    const lineRemark = (l.remarks || '').trim();
    if (l.serials_detail && l.serials_detail.length) {
      return l.serials_detail.map((d) => ({
        ...d,
        remark: (d.remark || '').trim() || lineRemark,
      }));
    }
    return parseSerials(l.serial_number).map((s) => {
      const parts = String(s).split('|');
      return {
        ttspl: parts[2] || parts[1] || parts[0],
        config: formatConfig(l),
        remark: lineRemark,
        brand: l.brand,
        model: l.model_name,
        processor: l.processor,
        generation: l.generation,
        ram: l.ram,
        storage: l.storage,
        gpu: l.gpu,
        screen_size: l.screen_size,
      };
    });
  });

  const qcBanner = () => {
    if (!qc?.total_count) return null;
    if (qc.any_failed) return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{qc.tickets?.filter((t) => t.status === 'qc_failed').length} laptop(s) failed QC. Cannot dispatch until resolved.</div>;
    if (qc.all_passed) return <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">All laptops have passed QC. Ready to dispatch.</div>;
    return <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">{qc.pending_count} of {qc.total_count} laptops pending QC.</div>;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back
          </button>
          <h1 className={`text-2xl font-semibold font-mono mt-1 ${isRejected || isCancelled ? 'text-red-700 line-through decoration-red-400' : 'text-black'}`}>{dcNumber}</h1>
          <p className="text-gray-600">
            {head.customer_name || '—'} · SO:{' '}
            <Link className="text-blue-600" to={salesOrderDetailPath(head.sales_order_number, location.state?.soScope)}>
              {head.sales_order_number}
            </Link>
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Created: {formatDate(head.created_at)}
            {head.dispatched_at ? (
              <span className="ml-3 font-medium text-indigo-800">Dispatch Date: {formatDateTime(head.dispatched_at)}</span>
            ) : (
              <span className="ml-3 text-amber-700">Not dispatched yet</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[head.status || 'pending']}`}>{statusLabel(head.status || 'pending')}</span>
            {head.entity_code && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${head.entity_code === 'gorefurbo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {head.entity_code === 'gorefurbo' ? 'Gorefurbo' : 'Rentfoxxy'}
              </span>
            )}
            <QcStatusBadge allPassed={qc?.all_passed} pendingCount={qc?.pending_count} failedCount={qc?.tickets?.filter((t) => t.status === 'qc_failed').length} totalCount={qc?.total_count} />
          </div>
          {showOtp && deliveryOtpCode ? (
            <OtpBox label="Delivery OTP" code={deliveryOtpCode} onCopy={copyOtp} />
          ) : null}
          {showOtp && warehouseReturnOtpCode ? (
            <OtpBox label="Warehouse return OTP" code={warehouseReturnOtpCode} onCopy={copyOtp} />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(canDownloadPdf || isSuperAdmin) && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await regenerateDcPdf(dcNumber);
                  const url = dcPdfUrl(r.data?.pdf_path) || dcPdfUrl(head.pdf_path);
                  if (url) window.open(url, '_blank');
                  else toast.error('PDF not available');
                } catch (err) {
                  toast.error(err.response?.data?.message || 'Could not open PDF');
                }
              }}
              className="inline-flex items-center px-4 min-h-[40px] text-sm font-semibold border border-slate-300 rounded-xl text-gray-700 hover:bg-gray-50"
            >
              Download PDF
            </button>
          )}
          {!isSale && rentalInvoice?.invoice_id && (
            <button
              type="button"
              disabled={invoicePdfLoading}
              onClick={async () => {
                setInvoicePdfLoading(true);
                try {
                  const res = await downloadDcRentalInvoicePdf(dcNumber);
                  const blob = new Blob([res.data], { type: 'application/pdf' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${rentalInvoice.invoice_number || 'invoice'}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  let msg = 'Could not download invoice PDF';
                  const data = err.response?.data;
                  if (data instanceof Blob) {
                    try {
                      const parsed = JSON.parse(await data.text());
                      msg = parsed.message || msg;
                    } catch { /* ignore */ }
                  } else if (data?.message) {
                    msg = data.message;
                  }
                  toast.error(msg);
                } finally {
                  setInvoicePdfLoading(false);
                }
              }}
              className="inline-flex items-center px-4 min-h-[40px] text-sm font-semibold border border-emerald-300 rounded-xl text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60"
              title={`${rentalInvoice.invoice_number} · ${rentalInvoice.invoice_month}/${rentalInvoice.invoice_year}`}
            >
              {invoicePdfLoading ? 'Preparing…' : 'Download Invoice PDF'}
            </button>
          )}
          {needsInvoice && !canDownloadPdf && !isSuperAdmin && (
            <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-2 rounded-xl">
              DC PDF is locked until Accounts uploads the e-invoice
            </span>
          )}
          {needsDemoEway && !canDownloadPdf && !isSuperAdmin && (
            <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
              DC Download → Locked
            </span>
          )}
          {isSuperAdmin && (
            <button type="button" onClick={() => setEditOpen(true)}
              className="inline-flex items-center px-4 min-h-[40px] text-sm font-semibold bg-amber-600 text-white rounded-xl hover:bg-amber-700">Edit DC</button>
          )}
          {canCancelDc && (
            <button
              type="button"
              onClick={() => setCancelModal(true)}
              className="inline-flex items-center px-4 min-h-[40px] text-sm font-semibold border border-red-300 text-red-700 rounded-xl hover:bg-red-50"
            >
              Cancel DC
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2 border-b overflow-x-auto">
            {TABS.filter((t) => (t !== 'einvoice' || needsInvoice) && (t !== 'eway' || needsDemoEway)).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500'}`}>
                {t === 'qc' ? 'Pre-Dispatch QC' : t === 'einvoice' ? 'E-Invoice' : t === 'eway' ? 'E-Way Bill' : t}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <>
            {needsDemoEway && !demoEwayCompliance?.eway_complete && (
              <div className="p-4 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-950 space-y-2">
                <p className="font-semibold">E-Way Bill Required</p>
                <p>
                  New-customer demo value is above ₹{Number(demoEwayCompliance?.eway_threshold || 50000).toLocaleString('en-IN')}.
                  DC download stays locked until Accounts uploads the E-Way Bill.
                </p>
                {demoEwayCompliance?.request_sent ? (
                  <p className="text-xs font-semibold text-emerald-800">E-Way Bill Request Sent</p>
                ) : (
                  <button
                    type="button"
                    disabled={sendingAccountsMail || demoEwayCompliance?.dispatch_mail_configured === false}
                    onClick={async () => {
                      if (!window.confirm(`Request E-Way Bill from ${demoEwayCompliance?.accounts_email || 'Accounts'}?`)) return;
                      setSendingAccountsMail(true);
                      try {
                        const res = await requestDemoEway(dcNumber);
                        toast.success(res.data?.message || 'E-Way Bill Request Sent');
                        load();
                      } catch (err) {
                        if (err.response?.status === 409) {
                          toast.success(err.response?.data?.message || 'E-Way Bill Request Sent');
                          load();
                        } else {
                          toast.error(err.response?.data?.message || 'Could not send request');
                        }
                      } finally {
                        setSendingAccountsMail(false);
                      }
                    }}
                    className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
                  >
                    {sendingAccountsMail ? 'Sending…' : 'Request E-Way Bill from Accounts'}
                  </button>
                )}
              </div>
            )}
            {needsInvoice && !saleCompliance?.einvoice_complete && (
              <div className="p-4 mb-4 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-950 space-y-2">
                <p className="font-semibold">Accounts invoice required</p>
                <p>
                  Warehouse cannot download this DC until Accounts creates the e-invoice in Zoho and uploads it
                  {saleCompliance?.requires_eway_bill ? ' (e-way bill is also mandatory — value above ₹50,000)' : ''}.
                  {saleCompliance?.is_first_customer_order && !isSale ? ' This is the customer’s first order.' : ''}
                </p>
                {saleCompliance?.can_send_accounts_mail && (
                  <button
                    type="button"
                    disabled={sendingAccountsMail || saleCompliance?.dispatch_mail_configured === false}
                    onClick={async () => {
                      if (!window.confirm(`Send invoice request to ${saleCompliance?.accounts_email || 'Accounts'}?`)) return;
                      setSendingAccountsMail(true);
                      try {
                        const res = await sendAccountsDcMail(dcNumber);
                        toast.success(res.data?.message || 'Mail sent to Accounts');
                        load();
                      } catch (err) {
                        toast.error(err.response?.data?.message || 'Could not send mail');
                      } finally {
                        setSendingAccountsMail(false);
                      }
                    }}
                    className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
                  >
                    {sendingAccountsMail
                      ? 'Sending…'
                      : saleCompliance?.accounts_notified_at
                        ? 'Resend mail to Accounts'
                        : 'Send mail to Accounts'}
                  </button>
                )}
                {saleCompliance?.accounts_notified_at && (
                  <p className="text-xs text-emerald-800">Last mailed: {formatDateTime(saleCompliance.accounts_notified_at)}</p>
                )}
              </div>
            )}
            {isCancelled && (
              <div className="p-3 mb-4 bg-slate-100 border border-slate-300 rounded-lg text-sm text-slate-800">
                This delivery challan was cancelled. Laptops are attached on the sales order again · open the SO and create new DC(s), one per package if needed.
              </div>
            )}
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">TTSPL</th>
                      <th className="px-3 py-2 text-left">Brand</th>
                      <th className="px-3 py-2 text-left">Model</th>
                      <th className="px-3 py-2 text-left">Processor</th>
                      <th className="px-3 py-2 text-left">Gen</th>
                      <th className="px-3 py-2 text-left">RAM</th>
                      <th className="px-3 py-2 text-left">Storage</th>
                      <th className="px-3 py-2 text-left">GPU</th>
                      <th className="px-3 py-2 text-left">Screen</th>
                      <th className="px-3 py-2 text-left">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {allUnits.length === 0 ? (
                      <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">No laptops attached</td></tr>
                    ) : allUnits.map((d, i) => (
                      <tr key={d.ttspl || i}>
                        <td className="px-3 py-2 font-mono text-xs text-blue-700">{d.ttspl}</td>
                        <td className="px-3 py-2">{d.brand || '—'}</td>
                        <td className="px-3 py-2">{d.model || '—'}</td>
                        <td className="px-3 py-2">{d.processor || '—'}</td>
                        <td className="px-3 py-2">{d.generation || '—'}</td>
                        <td className="px-3 py-2">{d.ram || '—'}</td>
                        <td className="px-3 py-2">{d.storage || '—'}</td>
                        <td className="px-3 py-2">{d.gpu || '—'}</td>
                        <td className="px-3 py-2">{d.screen_size || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 max-w-[200px] whitespace-pre-wrap">{d.remark || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {allUnits.length === 0 && lines.length > 0 ? (
                <div className="p-4 text-sm border-t space-y-1">
                  {lines.map((l, i) => (
                    <p key={l.id || i}>
                      <span className="text-gray-500">{[l.brand, l.model_name].filter(Boolean).join(' ') || `Item ${i + 1}`} · Remarks:</span>{' '}
                      {(l.remarks || '').trim() || '—'}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="p-4 text-sm border-t space-y-1">
                <p>Created: {formatDate(head.created_at)}</p>
                <p className="font-medium text-slate-800">Dispatch date: {formatDateTime(head.dispatched_at)}</p>
                {(head.ship_by === 'by_courier' || head.dispatch_mode === 'courier') && (
                  <div>
                    <p>
                      Courier: <strong>{head.courier_name || '—'}</strong>
                      {bluedartAwbs.length === 1 && (
                        <> · AWB: <strong>{bluedartAwbs[0].awb_number}</strong></>
                      )}
                      {bluedartAwbs.length > 1 && (
                        <> · <strong>{bluedartAwbs.length} AWBs</strong></>
                      )}
                      {!bluedartAwbs.length && !head.awb_number && (
                        <>
                          {' · '}
                          <PermissionGate section={['sales_orders_doc', 'delivery_challans']} action="edit">
                            <button
                              type="button"
                              onClick={openChangeAssignee}
                              className="text-blue-600 underline text-xs ml-1"
                            >
                              Generate BlueDart AWB
                            </button>
                          </PermissionGate>
                        </>
                      )}
                      {!bluedartAwbs.length && !head.awb_number && head.courier_tracking_url && (
                        <> · <a href={head.courier_tracking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs ml-1">Track</a></>
                      )}
                    </p>
                    <DcBluedartAwbTable
                      rows={bluedartAwbs}
                      loadingKey={bluedartPdfLoading}
                      onDownload={handleDownloadOneAwbPdf}
                      onDownloadAll={handleDownloadAllAwbPdfs}
                      onTrack={() => setTrackingOpen(true)}
                      onCancel={handleCancelBluedartAwb}
                      cancelBusy={awbGenerating}
                    />
                  </div>
                )}
                {(head.ship_by === 'by_porter' || head.dispatch_mode === 'porter') && (
                  <p>
                    Porter ID: <strong>{head.porter_tracking_id || '—'}</strong>
                    {head.porter_order_id && <> · Order: <strong>{head.porter_order_id}</strong></>}
                    {head.porter_booking_url && (
                      <> · <a href={head.porter_booking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs ml-1">Track</a></>
                    )}
                  </p>
                )}
                {(head.ship_by === 'by_hand' || head.dispatch_mode === 'inhouse') && (
                  <p>
                    Delivery Technician:{' '}
                    <strong>{head.delivery_person_name || head.technician_name || 'Not assigned'}</strong>
                    {head.delivery_person_phone && <> · {head.delivery_person_phone}</>}
                  </p>
                )}
                <p>Security: {formatCurrency(head.security_amount)} · Shipping: {formatCurrency(head.shiping_charges)}</p>
                <p className="text-xs text-gray-400">
                  Security per laptop: {formatCurrency((Number(head.security_amount) || 0) / (Number(head.quantity) || 1))}
                </p>
              </div>
            </div>

            <div className="bg-white border rounded-xl overflow-hidden">
              <h3 className="px-4 pt-4 font-semibold text-sm">Billing Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm mt-2">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-center">HSN/SAC</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Rate</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summaryLines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{[l.brand, l.model_name].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-2 text-center font-mono text-xs">{l.hsn_code || head.hsn_code || '—'}</td>
                        <td className="px-4 py-2 text-right">{l.quantity || l.main_qty || 1}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(l.rate)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(l.amount ?? (Number(l.rate || 0) * Number(l.quantity || l.main_qty || 1)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canOverrideHsn ? (
                <div className="border-t px-4 py-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Override HSN/SAC</label>
                    <input
                      className="border rounded-lg px-2 py-1.5 text-xs font-mono w-36"
                      value={hsnDraft}
                      onChange={(e) => setHsnDraft(e.target.value)}
                      placeholder="997315"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={hsnSaving}
                    onClick={async () => {
                      const trimmed = String(hsnDraft || '').trim();
                      if (!/^\d{4,8}$/.test(trimmed)) {
                        toast.error('HSN/SAC must be 4–8 digits');
                        return;
                      }
                      setHsnSaving(true);
                      try {
                        await updateDcHsn(dcNumber, { hsn_code: trimmed });
                        toast.success('HSN updated');
                        load();
                      } catch (err) {
                        toast.error(err.response?.data?.message || 'Failed to update HSN');
                      } finally {
                        setHsnSaving(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs bg-teal-700 text-white rounded-lg disabled:opacity-60"
                  >
                    {hsnSaving ? 'Saving…' : 'Save HSN'}
                  </button>
                </div>
              ) : null}
              {totals && (
                <div className="border-t p-4 text-sm space-y-1.5 max-w-xs ml-auto">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><strong>{formatCurrency(totals.subtotal)}</strong></div>
                  {totals.gst_type === 'inter' ? (
                    <div className="flex justify-between"><span className="text-gray-500">IGST ({totals.gst_rate || 18}%)</span><strong>{formatCurrency(totals.igst)}</strong></div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span className="text-gray-500">CGST ({(Number(totals.gst_rate) || 18) / 2}%)</span><strong>{formatCurrency(totals.cgst)}</strong></div>
                      <div className="flex justify-between"><span className="text-gray-500">SGST ({(Number(totals.gst_rate) || 18) / 2}%)</span><strong>{formatCurrency(totals.sgst)}</strong></div>
                    </>
                  )}
                  {Number(totals.shipping) > 0 && (
                    <div className="flex justify-between"><span className="text-gray-500">Shipping Charges</span><strong>{formatCurrency(totals.shipping)}</strong></div>
                  )}
                  {Number(totals.security) > 0 && (
                    <div className="flex justify-between"><span className="text-gray-500">Security Amount</span><strong>{formatCurrency(totals.security)}</strong></div>
                  )}
                  <div className="flex justify-between border-t pt-1.5 mt-1"><span className="font-semibold text-gray-900">Total</span><strong>{formatCurrency(totals.grand_total)}</strong></div>
                </div>
              )}
            </div>
            </>
          )}

          {tab === 'qc' && (
            <div className="bg-white border rounded-xl p-4 space-y-4">
              <div>
                <h2 className="font-semibold">Pre-Dispatch Quality Check</h2>
                <p className="text-sm text-gray-500">All laptops must pass QC before dispatch</p>
              </div>
              {qcBanner()}
              {!qc?.total_count ? (
                <PermissionGate section="dispatch_ops" action="edit">
                  <button type="button" onClick={initiateQc} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Initiate Pre-Dispatch QC</button>
                </PermissionGate>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="text-left py-2">TTSPL</th>
                        <th className="text-left py-2">Ticket</th>
                        <th className="text-left py-2">Stage</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(qc.tickets || []).map((t) => (
                        <tr key={t.ticket_id}>
                          <td className="py-2 font-mono text-blue-700">{t.ttspl_id}</td>
                          <td className="py-2"><Link to={`/floor-pipeline/tickets/${t.ticket_id}`} className="text-blue-600">#{t.ticket_id}</Link></td>
                          <td className="py-2">{t.stage_name || '—'}</td>
                          <td className="py-2 capitalize">{t.status?.replace('_', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" onClick={loadQc} className="text-sm text-blue-600">Refresh QC Status</button>
                </>
              )}
            </div>
          )}

          {tab === 'dispatch' && (
            <div className="bg-white border rounded-xl p-4 space-y-4">
              <h2 className="font-semibold">Dispatch &amp; Delivery</h2>
              <div className="text-sm text-gray-600 space-y-1 bg-gray-50 border rounded-lg p-3">
                <p>Mode: <strong className="capitalize">{head.dispatch_mode || head.ship_by || '—'}</strong></p>
                {head.courier_name && (
                  <div>
                    <p>
                      Courier: {head.courier_name}
                      {bluedartAwbs.length === 1 && <> · AWB: {bluedartAwbs[0].awb_number}</>}
                      {bluedartAwbs.length > 1 && <> · {bluedartAwbs.length} AWBs</>}
                      {!bluedartAwbs.length && !head.awb_number && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            onClick={openChangeAssignee}
                            className="text-blue-600 underline text-xs"
                          >
                            Generate BlueDart AWB
                          </button>
                        </>
                      )}
                    </p>
                    <DcBluedartAwbTable
                      rows={bluedartAwbs}
                      loadingKey={bluedartPdfLoading}
                      onDownload={handleDownloadOneAwbPdf}
                      onDownloadAll={handleDownloadAllAwbPdfs}
                      onTrack={() => setTrackingOpen(true)}
                      onCancel={handleCancelBluedartAwb}
                      cancelBusy={awbGenerating}
                      showCancel
                    />
                  </div>
                )}
                {(head.dispatch_mode === 'inhouse' || head.ship_by === 'by_hand') && (
                  <p>Technician: <strong>{head.delivery_person_name || head.technician_name || 'Not assigned'}</strong></p>
                )}
                {(head.dispatch_mode === 'porter' || head.ship_by === 'by_porter') && (
                  <p>Porter: <strong>{head.porter_tracking_id || head.porter_order_id || '—'}</strong></p>
                )}
                {(head.dispatch_mode === 'inhouse' || head.ship_by === 'by_hand') && (
                  <p className="text-xs text-gray-500">Assigned delivery technician · visible in their delivery bucket.</p>
                )}
              </div>
              {assignmentEditable ? (
                <PermissionGate section="dispatch_ops" action="edit">
                  <button
                    type="button"
                    onClick={openChangeAssignee}
                    className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg text-sm hover:bg-blue-50"
                  >
                    Change delivery details
                  </button>
                  <p className="text-xs text-gray-500">
                    You can reassign technician, courier, or porter until pickup/delivery starts (status: reached or later).
                  </p>
                </PermissionGate>
              ) : (
                <p className="text-xs text-gray-500">Delivery details are locked · pickup/delivery has already started or completed.</p>
              )}
              {assignmentHistory.length > 0 && (
                <div className="border rounded-lg p-3 space-y-2">
                  <h3 className="text-sm font-semibold text-gray-800">Assignment History</h3>
                  <ul className="space-y-2 text-xs text-gray-600">
                    {assignmentHistory.map((row) => (
                      <li key={row.id} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                        <p><strong>{row.previous_assignee_label || '—'}</strong> → <strong>{row.new_assignee_label || '—'}</strong></p>
                        <p className="text-gray-400">
                          {formatDateTime(row.changed_at)}
                          {row.changed_by_name ? ` · ${row.changed_by_name}` : ''}
                          {row.reason ? ` · ${row.reason}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {head.status === 'pending' && (
                <PermissionGate section="dispatch_ops" action="edit">
                  <p className="text-amber-700 text-xs">This DC is not dispatched yet.</p>
                  <button type="button"
                    onClick={() => dispatchDC(dcNumber, { dispatch_mode: head.dispatch_mode || (head.ship_by === 'by_hand' ? 'inhouse' : head.ship_by === 'by_porter' ? 'porter' : 'courier'), courier_name: head.courier_name, awb_number: head.awb_number, delivery_person_id: head.delivery_person_id }).then(load).then(() => toast.success('Dispatched'))}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Mark Dispatched</button>
                </PermissionGate>
              )}
              {['in_transit', 'reached', 'shipped'].includes(head.status) && (
                <div className="text-sm space-y-2">
                  <p>Mode: {head.dispatch_mode || head.ship_by}</p>
                  {head.dispatch_mode === 'inhouse' || head.ship_by === 'by_hand' ? (
                    <>
                      <p>OTP: {(head.otp_sent_at || head.delivery_otp_sent_at || head.d_otp || head.otp_code) ? 'Sent' : 'Not Sent'}</p>
                      {showOtp && deliveryOtpCode ? (
                        <OtpBox label="Delivery OTP" code={deliveryOtpCode} onCopy={copyOtp} />
                      ) : null}
                      <button type="button" onClick={handleSendOtp} className="px-3 py-1 border rounded-lg text-xs">Send OTP</button>
                      <button type="button" onClick={() => setOtpModal(true)} className="ml-2 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs">Verify & Deliver</button>
                    </>
                  ) : isCourier ? (
                    <PermissionGate section="dispatch_ops" action="edit">
                      <button type="button" onClick={() => markDelivered(dcNumber, {}).then(load).then(() => toast.success('Delivered'))} className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs">Mark Delivered</button>
                      <button type="button" onClick={() => setRejectModal(true)} className="ml-2 px-3 py-1 text-red-700 border border-red-200 rounded-lg text-xs">Warehouse: Mark Rejected</button>
                    </PermissionGate>
                  ) : (
                    <PermissionGate section="dispatch_ops" action="edit">
                      <button type="button" onClick={() => markDelivered(dcNumber, {}).then(load).then(() => toast.success('Delivered'))} className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs">Mark Delivered</button>
                    </PermissionGate>
                  )}
                  {!isCourier && (
                    <button type="button" onClick={() => setRejectModal(true)} className="ml-2 px-3 py-1 text-red-700 border border-red-200 rounded-lg text-xs">Mark Rejected</button>
                  )}
                </div>
              )}
              {head.status === 'delivered' && (
                <div className="text-sm space-y-1">
                  <p>Delivered at: {formatDateTime(head.delivered_at)}</p>
                  {canEditDeliveryDate && (
                    <button
                      type="button"
                      onClick={() => setUpdateDeliveryDateOpen(true)}
                      className="mt-2 px-3 py-1.5 border border-amber-300 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-50"
                    >
                      Update delivery date
                    </button>
                  )}
                  {head.delivery_notes && <p className="text-gray-600">Notes: {head.delivery_notes}</p>}
                  <div className="flex flex-wrap gap-4 mt-2">
                    {uploadUrl(head.pod_photo_url) && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">POD Photo</p>
                        <a href={uploadUrl(head.pod_photo_url)} target="_blank" rel="noreferrer">
                          <img src={uploadUrl(head.pod_photo_url)} alt="POD" className="h-32 rounded border" />
                        </a>
                      </div>
                    )}
                    {uploadUrl(head.esign_url) && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Customer Signature</p>
                        <a href={uploadUrl(head.esign_url)} target="_blank" rel="noreferrer">
                          <img src={uploadUrl(head.esign_url)} alt="E-Sign" className="h-32 rounded border bg-white" />
                        </a>
                      </div>
                    )}
                  </div>
                  {!head.pod_photo_url && !head.esign_url && (
                    <p className="text-xs text-gray-400">POD type: {head.pod_type || '—'}</p>
                  )}
                </div>
              )}
              {isRejected && (
                <div className="text-sm space-y-3 border border-red-200 bg-red-50 rounded-lg p-4">
                  <p className="text-red-800 font-semibold line-through decoration-red-400">Delivery Rejected</p>
                  <p className="text-red-700">Reason: {head.rejection_reason || '—'}</p>
                  {head.rejection_remarks && <p className="text-gray-700">Remarks: {head.rejection_remarks}</p>}
                  {head.rejected_at && <p className="text-gray-600">Rejected at: {formatDateTime(head.rejected_at)}</p>}
                  {head.return_to_warehouse_at ? (
                    <p className="text-emerald-700">Returned to warehouse: {formatDateTime(head.return_to_warehouse_at)} · QC tickets created</p>
                  ) : pendingWarehouseReturn ? (
                    <div className="space-y-2 pt-2 border-t border-red-200">
                      <p className="text-xs text-gray-600">
                        Laptops stay in transit until warehouse confirms return. Send OTP when the technician
                        brings units back, then enter it below to move them to QC.
                      </p>
                      {head.warehouse_return_otp_sent_at && (
                        <p className="text-xs text-gray-500">OTP sent: {formatDateTime(head.warehouse_return_otp_sent_at)}</p>
                      )}
                      {showOtp && warehouseReturnOtpCode ? (
                        <OtpBox label="Warehouse return OTP" code={warehouseReturnOtpCode} onCopy={copyOtp} />
                      ) : null}
                      <button type="button" onClick={handleSendWarehouseReturnOtp} className="px-3 py-1 border border-red-300 rounded-lg text-xs text-red-700">Send Warehouse Return OTP</button>
                      <div className="flex gap-2 items-center">
                        <input className="flex-1 border rounded-lg px-2 py-1 text-sm" value={warehouseOtp} onChange={(e) => setWarehouseOtp(e.target.value)} placeholder="Warehouse OTP" />
                        <button type="button" onClick={handleVerifyWarehouseReturn} className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs">Confirm Return</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {tab === 'eway' && needsDemoEway && (
            <DemoEwayPanel
              dcNumber={dcNumber}
              compliance={demoEwayCompliance}
              onReload={load}
              isSuperAdmin={isSuperAdmin}
            />
          )}

          {tab === 'einvoice' && needsInvoice && (
            <div className="space-y-6">
              <SaleDcCompliancePanel
                dcNumber={dcNumber}
                saleCompliance={saleCompliance}
                totals={totals}
                onReload={load}
                isSuperAdmin={isSuperAdmin}
              />
              {isSuperAdmin && (
                <details className="bg-white border rounded-xl p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-700">Zoho API generate (optional)</summary>
                  <div className="mt-4">
                    <EInvoicePanel dcNumber={dcNumber} dcLine={head} customerEmail={head.email} onReload={load} />
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-white border rounded-xl p-4 text-sm">
            <h3 className="font-semibold mb-2">Dispatch</h3>
            <p><span className="text-gray-500">Created:</span> {formatDate(head.created_at)}</p>
            <p><span className="text-gray-500">Dispatch date:</span> <strong>{formatDateTime(head.dispatched_at)}</strong></p>
            <p><span className="text-gray-500">Mode:</span> {head.dispatch_mode || head.ship_by || '—'}</p>
            {head.vehicle_number ? (
              <p><span className="text-gray-500">Vehicle:</span> {head.vehicle_number}</p>
            ) : null}
            {head.delivered_at ? (
              <p>
                <span className="text-gray-500">Delivered:</span> {formatDateTime(head.delivered_at)}
                {canEditDeliveryDate && head.status === 'delivered' ? (
                  <button
                    type="button"
                    onClick={() => setUpdateDeliveryDateOpen(true)}
                    className="ml-2 text-xs text-amber-700 underline hover:text-amber-900"
                  >
                    Edit date
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="bg-white border rounded-xl p-4 text-sm">
            <h3 className="font-semibold mb-2">Customer</h3>
            <p>{head.customer_name}</p>
            <p className="text-gray-500">{head.email}</p>
            <p className="text-gray-500">{head.GST_number || head.gst_number}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-sm">
            <h3 className="font-semibold mb-2">Laptops in this DC</h3>
            {laptops.map((l, i) => (
              <button key={i} type="button" onClick={() => setTtsplDrawer(l.ttspl)} className="block w-full text-left py-1 text-blue-700 font-mono text-xs hover:underline">
                {l.ttspl} · {l.config}
              </button>
            ))}
          </div>
          {paymentSummary && (
            <div className="bg-white border rounded-xl p-4 text-sm">
              <h3 className="font-semibold mb-2">Payment Status</h3>
              <p>Total: {formatCurrency(paymentSummary.total_value)}</p>
              <p>Paid: {formatCurrency(paymentSummary.total_paid)}</p>
              <p className={paymentSummary.balance_due > 0 ? 'text-red-600 font-medium' : 'text-emerald-700'}>Balance: {formatCurrency(paymentSummary.balance_due)}</p>
            </div>
          )}
        </aside>
      </div>

      <DispatchModal open={dispatchOpen} dcNumber={dcNumber} qcBlocked={qc?.total_count > 0 && !qc?.all_passed} onClose={() => setDispatchOpen(false)} onDispatched={load} />

      {trackingOpen && (
        <CourierTrackingModal
          dcNumber={dcNumber}
          awbNumber={head?.awb_number}
          courierName={head?.courier_name}
          trackingUrl={head?.courier_tracking_url}
          onClose={() => setTrackingOpen(false)}
        />
      )}

      <ChangeAssigneeModal
        open={changeAssigneeOpen}
        dcNumber={dcNumber}
        head={head}
        units={allUnits}
        technicians={technicians}
        onClose={() => setChangeAssigneeOpen(false)}
        onSaved={load}
      />

      {otpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOtpModal(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Verify OTP</h3>
            <input className="w-full border rounded-lg px-3 py-2 mb-3" value={otpValue} onChange={(e) => setOtpValue(e.target.value)} placeholder="Enter OTP" />
            <button type="button" onClick={handleVerifyDeliver} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm">Verify & Deliver</button>
          </div>
        </div>
      )}

      {updateDeliveryDateOpen && (
        <MarkDeliveredModal
          dcNumber={dcNumber}
          title="Update Delivery Date"
          initialDate={head.delivered_at}
          confirmLabel="Save delivery date"
          onClose={() => setUpdateDeliveryDateOpen(false)}
          onConfirm={confirmUpdateDeliveryDate}
        />
      )}

      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => !cancelSaving && setCancelModal(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-md space-y-3">
            <h3 className="font-semibold">Cancel delivery challan</h3>
            <p className="text-sm text-gray-600">
              All laptops on this DC will return to <strong>Attached</strong> on sales order{' '}
              <strong>{head.sales_order_number || '—'}</strong>. You can then create separate DCs (e.g. one per package).
            </p>
            <p className="text-xs text-amber-700">
              If an e-invoice was generated for this DC, cancel or void it separately before re-dispatching.
            </p>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={2}
              placeholder="Reason (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={cancelSaving}
                onClick={() => setCancelModal(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm"
              >
                Keep DC
              </button>
              <button
                type="button"
                disabled={cancelSaving}
                onClick={handleCancelDc}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-60"
              >
                {cancelSaving ? 'Cancelling…' : 'Cancel DC'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setRejectModal(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm space-y-3">
            <h3 className="font-semibold mb-1">{isCourier ? 'Reject Courier Delivery' : 'Rejection Reason'}</h3>
            {isCourier && (
              <p className="text-xs text-gray-500">
                Laptops are not moved to inventory until warehouse return OTP is confirmed.
              </p>
            )}
            <textarea className="w-full border rounded-lg px-3 py-2 mb-1" rows={2} placeholder="Rejection reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <textarea className="w-full border rounded-lg px-3 py-2" rows={2} placeholder="Remarks (optional)" value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} />
            <button type="button" onClick={isCourier ? handleCourierReject : handleReject} className="w-full py-2 bg-red-600 text-white rounded-lg text-sm">Confirm Reject</button>
          </div>
        </div>
      )}

      <TtsplHistoryDrawer ttsplId={ttsplDrawer} open={Boolean(ttsplDrawer)} onClose={() => setTtsplDrawer(null)} />

      {editOpen && (
        <DcEditModal
          dcNumber={dcNumber}
          head={head}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}
    </div>
  );
}
