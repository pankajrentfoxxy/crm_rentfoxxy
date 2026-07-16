import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, ShieldCheck, KeyRound, Loader2, ExternalLink, RefreshCw, ArrowRight,
} from 'lucide-react';
import {
  createDispatchQcCaptureToken,
  getDispatchQcCaptureStatus,
  getProductionAssetByTicket,
} from '../floorPipelineApi';

const SPEC_FIELDS = [
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'ssd', label: 'SSD' },
];

const POLL_MS = 5000;

/**
 * Dispatch QC hardware verification — script-driven (mirrors Qc2SpecVerifyPanel).
 */
export default function DispatchQcSpecVerifyPanel({ ticket, onVerified, onHeaderSync }) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [failedDetail, setFailedDetail] = useState(null);
  const [matchDetail, setMatchDetail] = useState(null);
  const [expectedConfig, setExpectedConfig] = useState({});
  const [specsMatched, setSpecsMatched] = useState(false);
  const [testingStarted, setTestingStarted] = useState(false);
  const matchUrl = `${window.location.origin}/dispatch-qc-config-match`;

  const onVerifiedRef = useRef(onVerified);
  const onHeaderSyncRef = useRef(onHeaderSync);
  const ticketRef = useRef(ticket);
  const testingStartedRef = useRef(testingStarted);
  const lastSyncedKeyRef = useRef('');
  const lastFailedNotifiedRef = useRef(false);

  useEffect(() => { onVerifiedRef.current = onVerified; }, [onVerified]);
  useEffect(() => { onHeaderSyncRef.current = onHeaderSync; }, [onHeaderSync]);
  useEffect(() => { ticketRef.current = ticket; }, [ticket]);
  useEffect(() => { testingStartedRef.current = testingStarted; }, [testingStarted]);

  const applyStatus = useCallback((data, paConfig) => {
    const t = ticketRef.current || {};
    const cfg = paConfig || {};
    const exp = {
      brand: cfg.brand || t.brand || '',
      model: cfg.model || t.model || '',
      processor: cfg.processor || t.processor || '',
      generation: cfg.generation || '',
      ram: cfg.ram || t.ram || '',
      ssd: cfg.ssd || cfg.storage || t.storage || '',
    };
    setExpectedConfig(exp);

    const matched =
      !!paConfig?.qc2_verification?.configurationMatched
      || data?.status === 'matched';

    if (matched) {
      const mr = data?.match_result || paConfig?.qc2_verification || null;
      setMatchDetail(mr);
      setFailedDetail(null);
      setSpecsMatched(true);
      lastFailedNotifiedRef.current = false;

      const syncKey = JSON.stringify({
        processor: exp.processor,
        generation: exp.generation,
        storage_type: exp.ssd,
        ram_size: exp.ram,
      });
      if (lastSyncedKeyRef.current !== syncKey) {
        lastSyncedKeyRef.current = syncKey;
        onHeaderSyncRef.current?.({
          processor: exp.processor,
          generation: exp.generation,
          storage_type: exp.ssd,
          ram_size: exp.ram,
        });
      }
      return;
    }

    if (data?.status === 'failed' || paConfig?.qc2_verification?.configurationMatched === false) {
      const mr = data?.match_result || paConfig?.qc2_verification || null;
      setFailedDetail(mr);
      setMatchDetail(null);
      setSpecsMatched(false);
      if (!testingStartedRef.current && !lastFailedNotifiedRef.current) {
        lastFailedNotifiedRef.current = true;
        onVerifiedRef.current?.(false, mr);
      }
      return;
    }

    setSpecsMatched(false);
    setFailedDetail(null);
    setMatchDetail(null);
    lastFailedNotifiedRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    const ticketId = ticketRef.current?.ticket_id;
    if (!ticketId) return;
    try {
      const [paRes, stRes] = await Promise.all([
        getProductionAssetByTicket(ticketId).catch(() => ({ data: {} })),
        getDispatchQcCaptureStatus(ticketId).catch(() => ({ data: { data: null } })),
      ]);
      const cfg = paRes.data?.config || {};
      const st = stRes.data?.data || null;
      if (st) setTokenInfo(st);
      applyStatus(st, cfg);
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    setLoading(true);
    lastSyncedKeyRef.current = '';
    lastFailedNotifiedRef.current = false;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [ticket.ticket_id, refresh]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data } = await createDispatchQcCaptureToken(ticket.ticket_id);
      if (!data.success) {
        toast.error(data.message || 'Failed to generate access number');
        return;
      }
      setTokenInfo({
        access_number: data.data.access_number,
        status: 'pending',
        expires_at: data.data.expires_at,
        token: data.data.token,
        sales_order_number: data.data.sales_order_number,
      });
      setFailedDetail(null);
      setMatchDetail(null);
      setSpecsMatched(false);
      setTestingStarted(false);
      lastSyncedKeyRef.current = '';
      lastFailedNotifiedRef.current = false;
      onVerifiedRef.current?.(false);
      toast.success(`Access number: ${data.data.access_number}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to generate access number');
    } finally {
      setGenerating(false);
    }
  };

  const continueToTesting = () => {
    setTestingStarted(true);
    onVerifiedRef.current?.(true);
    toast.success('Dispatch QC testing unlocked');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading verification status…
      </div>
    );
  }

  const failChecks = Array.isArray(failedDetail?.checks) ? failedDetail.checks : [];
  const matchChecks = Array.isArray(matchDetail?.checks) ? matchDetail.checks : [];
  const pending = tokenInfo?.status === 'pending' && !specsMatched;

  if (testingStarted && specsMatched) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center justify-between gap-3 text-green-800 text-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          Specs verified — Dispatch QC checklist is open below.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-white p-5 space-y-4 shadow-sm">
      <div>
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-violet-600" />
          Dispatch QC Spec Verification (script)
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Verify physical specs against the working asset and SO line before challan generation.
          {tokenInfo?.sales_order_number ? ` SO ${tokenInfo.sales_order_number}.` : ''}
        </p>
      </div>

      {specsMatched && !testingStarted ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-4">
          <p className="text-sm font-semibold text-green-800 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> Specs matched
          </p>

          {matchChecks.length > 0 ? (
            <ul className="space-y-2">
              {matchChecks.map((c) => (
                <li
                  key={c.field}
                  className="flex items-start gap-2 text-sm rounded-lg bg-white/80 border border-green-100 px-3 py-2"
                >
                  {c.matched ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{c.label || c.field}</span>
                    <div className="grid grid-cols-2 gap-2 mt-1 text-xs text-slate-600">
                      <span>Expected: <strong className="text-slate-900">{c.expected || '—'}</strong></span>
                      <span>Found: <strong className="text-slate-900">{c.actual || '—'}</strong></span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-white/80 border border-green-100 px-3 py-2 space-y-1.5 text-sm">
              {SPEC_FIELDS.map((f) => (
                <div key={f.key} className="flex justify-between gap-3">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-medium text-slate-900 text-right">
                    {expectedConfig[f.key] || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={continueToTesting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
          >
            Proceed to Dispatch QC Testing
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {failedDetail && !specsMatched ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-rose-800 flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Configuration mismatch — unit routed to Pending Inventory
          </p>
          {failedDetail.remarks ? (
            <p className="text-xs text-rose-700">{failedDetail.remarks}</p>
          ) : null}
          {failChecks.length ? (
            <ul className="space-y-1">
              {failChecks.filter((c) => !c.matched && c.required).map((c) => (
                <li key={c.field} className="text-xs text-rose-800">
                  <strong>{c.label || c.field}</strong>
                  {`: expected "${c.expected ?? ''}", found "${c.actual ?? ''}"`}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-rose-700">
            Serial detached from SO. Receive via <strong>Pending Inventory</strong> after rework.
          </p>
        </div>
      ) : null}

      {!specsMatched ? (
        <>
          {pending && tokenInfo?.access_number ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 text-center space-y-2">
              <p className="text-xs font-medium text-violet-700 uppercase tracking-wide">Access number</p>
              <p className="text-3xl font-mono font-bold tracking-[0.35em] text-violet-900">
                {tokenInfo.access_number}
              </p>
              <p className="text-xs text-violet-700">
                Status: <strong>Pending</strong>
                {tokenInfo.expires_at
                  ? ` · expires ${new Date(tokenInfo.expires_at).toLocaleTimeString('en-IN')}`
                  : ''}
              </p>
              <a
                href={matchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-700 font-medium hover:underline"
              >
                Open config-match page <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <p className="text-[11px] text-violet-600">
                On the laptop: go to <code className="bg-white/70 px-1 rounded">{matchUrl}</code> and enter this number.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
              No active access number. Generate one to start hardware verification.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              {pending ? 'Generate new access number' : 'Generate access number for hardware verification'}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" /> Refresh status
            </button>
          </div>

          <p className="text-xs text-amber-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            After a match, verified specs appear here. Testing opens only when you click Proceed.
          </p>
        </>
      ) : null}
    </div>
  );
}
