import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  CheckCircle2, XCircle, Laptop, Loader2, AlertTriangle, Copy, Download, Cpu, KeyRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getApiUrl, getCaptureApiBase } from '../utils/api';
import { buildMacCaptureCommand } from '../utils/macHwCaptureScript';
import {
  buildWindowsCaptureCommand,
  buildWindowsCapturePs1,
  encodePsCommand,
} from '../utils/windowsHwCaptureScript';

function getPublicApiBase() {
  return getApiUrl();
}

function publicApi() {
  return axios.create({
    baseURL: getPublicApiBase(),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Public page: enter access number → reveal hardware verification script.
 * Layout mirrors GrnSerialCapturePage.
 */
const CAPTURE_UI = {
  qc2: {
    apiPrefix: 'qc2-capture',
    brand: 'QC2',
    accessHint: 'QC2 ticket',
    screenHint: 'QC2 screen',
    successHint: 'QC2 ticket — testing checklist is unlocked',
    scriptFile: 'rentfoxxy-qc2-verify.ps1',
    exeFile: 'rentfoxxy-qc2-verify.exe',
    laptopHint: 'laptop under QC2',
    ps1Title: 'QC2',
  },
  'dispatch-qc': {
    apiPrefix: 'dispatch-qc-capture',
    brand: 'Dispatch QC',
    accessHint: 'Dispatch QC ticket',
    screenHint: 'Dispatch QC screen',
    successHint: 'Dispatch QC ticket — testing checklist is unlocked',
    scriptFile: 'rentfoxxy-dispatch-qc-verify.ps1',
    exeFile: 'rentfoxxy-dispatch-qc-verify.exe',
    laptopHint: 'laptop under Dispatch QC',
    ps1Title: 'Dispatch QC',
  },
  'vendor-return': {
    apiPrefix: 'vendor-return-capture',
    brand: 'Vendor Return',
    accessHint: 'vendor return challan',
    screenHint: 'Vendor Return screen',
    successHint: 'vendor return — laptop can be received into stock',
    scriptFile: 'rentfoxxy-vendor-return-verify.ps1',
    exeFile: 'rentfoxxy-vendor-return-verify.exe',
    laptopHint: 'laptop returned by the vendor',
    ps1Title: 'Vendor Return',
  },
};

export default function Qc2ConfigMatchPage({ captureKind = 'qc2' }) {
  const ui = CAPTURE_UI[captureKind] || CAPTURE_UI.qc2;
  const [accessInput, setAccessInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [token, setToken] = useState(null);
  const [captureApiBase, setCaptureApiBase] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionWarning, setSessionWarning] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const scriptApiBase = getCaptureApiBase(captureApiBase);
  const psScript = useMemo(
    () => (token ? buildWindowsCaptureCommand(scriptApiBase, token, ui.apiPrefix) : ''),
    [scriptApiBase, token, ui.apiPrefix]
  );
  const psEncoded = useMemo(() => (psScript ? encodePsCommand(psScript) : ''), [psScript]);
  const macScript = useMemo(
    () => (token ? buildMacCaptureCommand(scriptApiBase, token, ui.apiPrefix) : ''),
    [scriptApiBase, token, ui.apiPrefix]
  );

  const loadSession = useCallback(async () => {
    if (!token) return;
    setSessionWarning(null);
    try {
      const { data } = await publicApi().get(`/${ui.apiPrefix}/${token}`);
      if (data.success) {
        setSession(data.data);
        if (data.data.status === 'matched') {
          setDone(true);
        }
      } else {
        setSessionWarning(data.message || 'Could not load session');
      }
    } catch (e) {
      setSessionWarning(e.response?.data?.message || e.message || 'Could not reach server');
    } finally {
      setLoading(false);
    }
  }, [token, ui.apiPrefix]);

  useEffect(() => {
    if (!token) return undefined;
    setLoading(true);
    loadSession();
    const poll = setInterval(loadSession, 4000);
    return () => clearInterval(poll);
  }, [token, loadSession]);

  const resolveAccess = async (e) => {
    e?.preventDefault?.();
    const code = accessInput.trim();
    if (!code) {
      toast.error(`Enter the access number from the ${ui.brand} screen`);
      return;
    }
    setResolving(true);
    try {
      const { data } = await publicApi().post(`/${ui.apiPrefix}/resolve`, { access_number: code });
      if (!data.success) {
        toast.error(data.message || 'Invalid access number');
        return;
      }
      setToken(data.data.token);
      setCaptureApiBase(data.data.api_base_url || null);
      setSession({
        ...data.data,
        status: 'pending',
        config_verified: false,
      });
      toast.success('Access verified — run the script on this laptop');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Access number not found or expired');
    } finally {
      setResolving(false);
    }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  const downloadWindowsExe = async () => {
    if (!token) return;
    try {
      const res = await publicApi().get(`/${ui.apiPrefix}/${token}/windows-exe`, {
        responseType: 'blob',
      });
      const contentType = String(res.headers['content-type'] || '');
      if (contentType.includes('application/json')) {
        const text = await res.data.text();
        const parsed = JSON.parse(text);
        toast.error(parsed.message || 'Failed to download Windows app');
        return;
      }
      const blob = new Blob([res.data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ui.exeFile || 'rentfoxxy-hw-verify.exe';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Windows app downloaded — double-click to run on this laptop');
    } catch (err) {
      let message = 'Failed to download Windows app';
      try {
        if (err.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed.message) message = parsed.message;
        } else if (err.response?.data?.message) {
          message = err.response.data.message;
        }
      } catch { /* ignore */ }
      toast.error(message);
    }
  };

  const downloadWindowsScript = () => {
    if (!token) return;
    const content = buildWindowsCapturePs1(scriptApiBase, token, ui.apiPrefix, `Rentfoxxy ${ui.ps1Title}`);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ui.scriptFile;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Script downloaded — right-click → Run with PowerShell');
  };

  const isLocalhost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname);
  const expected = session?.expected_config || null;
  const expectedSpecs = expected
    ? [
        ['Brand', expected.brand],
        ['Model', expected.model],
        ['Processor', expected.processor],
        ['Generation', expected.generation],
        ['RAM', expected.ram],
        ['SSD', expected.ssd],
        ['GPU', expected.gpu],
      ].filter(([, v]) => v != null && String(v).trim() !== '')
    : [];
  const configCheck = session?.config_check || session?.match_result || null;
  const configChecks = Array.isArray(configCheck?.checks) ? configCheck.checks : [];
  const configMatched = !!session?.config_verified || session?.status === 'matched';

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="bg-indigo-700 text-white px-6 py-5">
            <div className="flex items-center gap-3">
              <KeyRound className="w-8 h-8 shrink-0 opacity-90" />
              <div>
                <p className="text-xs uppercase tracking-wide text-indigo-100 font-semibold">Rentfoxxy {ui.brand}</p>
                <h1 className="text-lg font-bold">Config match</h1>
                <p className="text-sm text-indigo-100 mt-0.5">Enter the access number from the {ui.accessHint}</p>
              </div>
            </div>
          </div>
          <form onSubmit={resolveAccess} className="p-6 space-y-4">
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Access number</span>
              <input
                autoFocus
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-3 text-lg font-mono tracking-widest text-center"
                value={accessInput}
                onChange={(e) => setAccessInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="6-digit code"
              />
            </label>
            <button
              type="submit"
              disabled={resolving || accessInput.length < 4}
              className="w-full py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {resolving ? 'Checking…' : 'Continue'}
            </button>
            <p className="text-xs text-slate-500 text-center">
              Open this page on the {ui.laptopHint}. The access number is shown on the CRM {ui.screenHint}.
            </p>
          </form>
        </div>
      </div>
    );
  }

  if (loading && !session && !sessionWarning) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-slate-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
        <div className="bg-indigo-700 text-white px-6 py-5">
          <div className="flex items-center gap-3">
            <Laptop className="w-8 h-8 shrink-0 opacity-90" />
            <div>
              <p className="text-xs uppercase tracking-wide text-indigo-100 font-semibold">Rentfoxxy {ui.brand}</p>
              <h1 className="text-lg font-bold">Hardware verification</h1>
              <p className="text-sm text-indigo-100 mt-0.5">
                {session?.ttspl_id ? `TTSPL ${session.ttspl_id}` : 'Production Asset match'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {sessionWarning ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="m-0 text-xs leading-relaxed">{sessionWarning}</p>
            </div>
          ) : null}

          {isLocalhost ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              This link uses <strong>localhost</strong> — only works on the same PC as your CRM backend.
            </div>
          ) : null}

          {done || configMatched ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-slate-900">Specs verified</h2>
              <p className="text-sm text-slate-500 mt-3">
                Return to the {ui.successHint}. You can close this tab.
              </p>
            </div>
          ) : (
            <>
              {expectedSpecs.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                    <Cpu className="w-3.5 h-3.5" /> Expected configuration (Production Asset)
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {expectedSpecs.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-slate-500">{k}</span>
                        <span className="font-medium text-slate-800 text-right">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {configChecks.length > 0 ? (
                <div
                  className={`rounded-xl border p-3 ${
                    configMatched ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
                  }`}
                >
                  <p
                    className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                      configMatched ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {configMatched ? 'Configuration verified' : 'Configuration mismatch'}
                  </p>
                  <ul className="space-y-1">
                    {configChecks.map((c) => (
                      <li key={c.field} className="flex items-start gap-2 text-xs">
                        {c.matched ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className={`w-4 h-4 shrink-0 mt-0.5 ${c.required ? 'text-rose-500' : 'text-amber-500'}`} />
                        )}
                        <span className="text-slate-700">
                          <strong>{c.label}</strong>
                          {c.matched
                            ? ' matched'
                            : ` mismatch — expected "${c.expected ?? ''}", found "${c.actual ?? ''}"`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside leading-relaxed">
                <li>You are on the <strong>{ui.laptopHint}</strong>.</li>
                <li>
                  <strong>Windows:</strong> download the app (.exe) and double-click it.
                  If SmartScreen warns, choose <em>More info → Run anyway</em>.
                </li>
                <li>On match, return to the CRM {ui.screenHint} — testing unlocks automatically.</li>
              </ol>

              <button
                type="button"
                onClick={downloadWindowsExe}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
              >
                <Download className="w-4 h-4" /> Download Windows app (.exe)
              </button>

              <button
                type="button"
                onClick={downloadWindowsScript}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                Download PowerShell script (.ps1) instead
              </button>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">PowerShell one-liner</span>
                  <button type="button" onClick={() => copyText(psEncoded, 'PowerShell')} className="text-xs text-indigo-600 flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
                <pre className="text-[10px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto max-h-24">{psEncoded}</pre>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">macOS one-liner</span>
                  <button type="button" onClick={() => copyText(macScript, 'macOS')} className="text-xs text-indigo-600 flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
                <pre className="text-[10px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto max-h-24">{macScript}</pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
