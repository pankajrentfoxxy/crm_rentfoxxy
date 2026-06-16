import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Laptop, Loader2, AlertTriangle, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { getApiUrl } from '../utils/api';

const AGENT_URL = 'http://127.0.0.1:19527';

function publicApi() {
  return axios.create({
    baseURL: getApiUrl(),
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function GrnSerialCapturePage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);
  const [capturedSerial, setCapturedSerial] = useState('');
  const [agentOk, setAgentOk] = useState(null);

  const loadSession = useCallback(async () => {
    try {
      const { data } = await publicApi().get(`/grn-capture/${token}`);
      if (data.success) {
        setSession(data.data);
        if (data.data.status === 'captured' || data.data.status === 'used') {
          setDone(true);
          setCapturedSerial(data.data.serial_number || '');
        }
      } else {
        setError(data.message || 'Invalid link');
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Link not found or expired');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${AGENT_URL}/health`, { mode: 'cors' })
      .then((r) => r.json())
      .then(() => { if (!cancelled) setAgentOk(true); })
      .catch(() => { if (!cancelled) setAgentOk(false); });
    return () => { cancelled = true; };
  }, []);

  const apiBase = getApiUrl();

  const psScript = useMemo(() => {
    const api = apiBase.replace(/"/g, '`"');
    return `$s=(Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper(); Invoke-RestMethod -Uri "${api}/grn-capture/${token}" -Method Post -Body (@{serial_number=$s}|ConvertTo-Json) -ContentType "application/json"`;
  }, [apiBase, token]);

  const macScript = useMemo(() => {
    return `SERIAL=$(ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformSerialNumber/ { print $3; exit }' | tr -d '"'); curl -s -X POST "${apiBase}/grn-capture/${token}" -H "Content-Type: application/json" -d "{\\"serial_number\\":\\"$SERIAL\\"}"`;
  }, [apiBase, token]);

  const submitSerial = async (serial) => {
    setCapturing(true);
    try {
      const { data } = await publicApi().post(`/grn-capture/${token}`, {
        serial_number: String(serial).trim().toUpperCase(),
      });
      if (data.success) {
        setDone(true);
        setCapturedSerial(data.data?.serial_number || serial);
        toast.success('Serial captured!');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to submit serial');
    } finally {
      setCapturing(false);
    }
  };

  const runAutoCapture = async () => {
    setCapturing(true);
    try {
      const r = await fetch(`${AGENT_URL}/serial`, { mode: 'cors' });
      const data = await r.json();
      if (!data.success || !data.serial_number) {
        toast.error(data.message || 'Could not read serial from this laptop');
        return;
      }
      await submitSerial(data.serial_number);
    } catch {
      toast.error('Capture agent not running. Start it or use the PowerShell / Terminal script below.');
      setAgentOk(false);
    } finally {
      setCapturing(false);
    }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-900">Capture link unavailable</h1>
          <p className="text-sm text-slate-600 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const unitLabel = session
    ? `Laptop ${(session.unit_index || 0) + 1} of ${session.total_units || 1}`
    : '';

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

        <div className="p-6 space-y-5">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-slate-900">Serial captured</h2>
              <p className="font-mono text-teal-800 text-lg mt-2">{capturedSerial}</p>
              <p className="text-sm text-slate-500 mt-3">
                Return to the receiving screen — the serial will appear automatically.
                You can close this tab.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600 leading-relaxed">
                Open this page <strong>on the laptop being received</strong>. We will read its
                hardware serial and send it back to the GRN screen — no manual typing.
              </p>

              <button
                type="button"
                disabled={capturing}
                onClick={runAutoCapture}
                className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {agentOk === true ? 'Read serial from this laptop' : 'Try auto-capture (needs helper)'}
              </button>

              <p className="text-xs text-slate-500 text-center">
                <strong>New laptop?</strong> You do not need Node.js. Copy the PowerShell command below and run it on this machine.
              </p>

              {agentOk === false ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
                  <p className="font-semibold m-0">Capture helper not detected</p>
                  <p className="text-xs m-0 leading-relaxed">
                    On this laptop, open a terminal in the CRM folder and run:
                  </p>
                  <code className="block text-[11px] bg-white border rounded p-2 font-mono break-all">
                    node backend/scripts/grn-serial-capture-agent.js
                  </code>
                  <p className="text-xs m-0">Then click &quot;Try auto-capture&quot; again.</p>
                </div>
              ) : null}

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Or run a one-line script on this laptop
                </p>
                <div>
                  <p className="text-xs text-slate-600 mb-1">Windows (PowerShell as Admin not required)</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 text-[10px] bg-slate-50 border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                      {psScript}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(psScript, 'PowerShell command')}
                      className="shrink-0 p-2 border rounded-lg hover:bg-slate-50"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-600 mb-1">macOS (Terminal)</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 text-[10px] bg-slate-50 border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                      {macScript}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(macScript, 'Terminal command')}
                      className="shrink-0 p-2 border rounded-lg hover:bg-slate-50"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
