import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Laptop, Loader2, AlertTriangle, Copy, Download } from 'lucide-react';
import toast from 'react-hot-toast';

/** Public capture page — always uses the same host the user opened (staging, prod, etc.) */
function getPublicApiBase() {
  if (typeof window === 'undefined') return '/api';
  const origin = window.location.origin.replace(/\/$/, '');
  return `${origin}/api`;
}

function publicApi() {
  return axios.create({
    baseURL: getPublicApiBase(),
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildPsCommand(apiBase, token) {
  const api = apiBase.replace(/"/g, '`"');
  return `$s=(Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper(); if(-not $s){Write-Error 'No serial'}; Invoke-RestMethod -Uri "${api}/grn-capture/${token}" -Method Post -Body (@{serial_number=$s}|ConvertTo-Json) -ContentType 'application/json'; Write-Host "Sent serial: $s"`;
}

function buildMacCommand(apiBase, token) {
  return `SERIAL=$(ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformSerialNumber/ { print $3; exit }' | tr -d '"'); curl -s -X POST "${apiBase}/grn-capture/${token}" -H "Content-Type: application/json" -d "{\\"serial_number\\":\\"$SERIAL\\"}" && echo "Sent serial: $SERIAL"`;
}

function buildPs1FileContent(apiBase, token) {
  return `# Rentfoxxy GRN — run on the received laptop (Windows PowerShell)
$ErrorActionPreference = 'Stop'
$serial = (Get-CimInstance Win32_BIOS).SerialNumber
if (-not $serial) { throw 'Could not read BIOS serial number' }
$serial = $serial.Trim().ToUpper()
$uri = '${apiBase}/grn-capture/${token}'
$body = @{ serial_number = $serial } | ConvertTo-Json
Write-Host "Sending serial: $serial"
Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType 'application/json'
Write-Host 'Done! Return to the GRN screen — serial will appear automatically.'
Read-Host 'Press Enter to close'
`;
}

export default function GrnSerialCapturePage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [sessionWarning, setSessionWarning] = useState(null);
  const [done, setDone] = useState(false);
  const [capturedSerial, setCapturedSerial] = useState('');

  const apiBase = getPublicApiBase();
  const psScript = useMemo(() => buildPsCommand(apiBase, token), [apiBase, token]);
  const macScript = useMemo(() => buildMacCommand(apiBase, token), [apiBase, token]);

  const loadSession = useCallback(async () => {
    setSessionWarning(null);
    try {
      const { data } = await publicApi().get(`/grn-capture/${token}`);
      if (data.success) {
        setSession(data.data);
        if (data.data.status === 'captured' || data.data.status === 'used') {
          setDone(true);
          setCapturedSerial(data.data.serial_number || '');
        }
      } else {
        setSessionWarning(data.message || 'Could not verify link — you can still try the command below.');
      }
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Could not reach server';
      setSessionWarning(
        `${msg}. If this is a fresh link from GRN, run the PowerShell command below anyway.`
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSession();
    const poll = setInterval(loadSession, 4000);
    return () => clearInterval(poll);
  }, [loadSession]);

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  const downloadWindowsScript = () => {
    const content = buildPs1FileContent(apiBase, token);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rentfoxxy-grn-capture.ps1';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Script downloaded — right-click → Run with PowerShell');
  };

  if (loading && !sessionWarning) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    );
  }

  const unitLabel = session
    ? `Laptop ${(session.unit_index || 0) + 1} of ${session.total_units || 1}`
    : 'GRN serial capture';

  const isLocalhost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname);

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 to-slate-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
        <div className="bg-teal-700 text-white px-6 py-5">
          <div className="flex items-center gap-3">
            <Laptop className="w-8 h-8 shrink-0 opacity-90" />
            <div>
              <p className="text-xs uppercase tracking-wide text-teal-100 font-semibold">Rentfoxxy GRN</p>
              <h1 className="text-lg font-bold">Serial number capture</h1>
              <p className="text-sm text-teal-100 mt-0.5">{unitLabel}</p>
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
              This link uses <strong>localhost</strong> — it only works on the same PC as your dev server.
              On <strong>staging.rentfoxxy.com</strong>, links work on any laptop on the internet.
            </div>
          ) : null}

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-slate-900">Serial captured</h2>
              <p className="font-mono text-teal-800 text-lg mt-2">{capturedSerial}</p>
              <p className="text-sm text-slate-500 mt-3">
                Return to the GRN receive screen on the CRM — the serial field will fill automatically.
                You can close this tab.
              </p>
            </div>
          ) : (
            <>
              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside leading-relaxed">
                <li>You are on the <strong>received laptop</strong> (this machine).</li>
                <li>
                  <strong>Windows:</strong> download the script below, or copy the PowerShell one-liner → paste in
                  PowerShell → Enter.
                </li>
                <li>
                  <strong>Mac:</strong> copy the Terminal command → paste in Terminal → Enter.
                </li>
                <li>Serial is sent to the open GRN form — no CRM install needed on this laptop.</li>
              </ol>

              <button
                type="button"
                onClick={downloadWindowsScript}
                className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Windows script (easiest — double-click or Run with PowerShell)
              </button>

              <div className="space-y-3 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Or copy one line
                </p>
                <div>
                  <p className="text-xs text-slate-600 mb-1 font-medium">Windows — PowerShell</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 text-[10px] bg-slate-50 border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-28">
                      {psScript}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(psScript, 'PowerShell command')}
                      className="shrink-0 p-2 border rounded-lg hover:bg-slate-50 h-fit"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-600 mb-1 font-medium">macOS — Terminal</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 text-[10px] bg-slate-50 border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-28">
                      {macScript}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(macScript, 'Terminal command')}
                      className="shrink-0 p-2 border rounded-lg hover:bg-slate-50 h-fit"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 m-0">
                  API: <span className="font-mono break-all">{apiBase}/grn-capture/…</span>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
