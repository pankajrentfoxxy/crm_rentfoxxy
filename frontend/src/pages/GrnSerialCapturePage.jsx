import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, XCircle, Laptop, Loader2, AlertTriangle, Copy, Download, Cpu } from 'lucide-react';
import toast from 'react-hot-toast';
import { getApiUrl } from '../utils/api';

/**
 * Public capture page API base.
 * Reuses the app's resolver so it targets the backend in dev (localhost:5001)
 * and the same public origin in staging/prod (nginx proxies /api).
 */
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
 * Wrap a PowerShell script as an obfuscated, self-running command.
 * Uses PowerShell's native -EncodedCommand (Base64 of UTF-16LE), so the URL,
 * token and logic are not human-readable, yet `powershell -EncodedCommand …`
 * runs the exact same script.
 */
function encodePsCommand(script) {
  let bin = '';
  for (let i = 0; i < script.length; i += 1) {
    const code = script.charCodeAt(i);
    bin += String.fromCharCode(code & 0xff, (code >> 8) & 0xff);
  }
  const b64 = typeof window !== 'undefined' && window.btoa
    ? window.btoa(bin)
    : Buffer.from(bin, 'binary').toString('base64');
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}`;
}

// Reads the server error body from a failed Invoke-RestMethod (works on both
// Windows PowerShell 5.1 and PowerShell 7+).
const PS_ERR =
  "$e=$_.ErrorDetails.Message;if(-not $e){try{$rs=$_.Exception.Response.GetResponseStream();$e=(New-Object System.IO.StreamReader($rs)).ReadToEnd()}catch{$e=$_.Exception.Message}}";

// Verify hardware config first, then submit the serial only if it matches.
function buildPsCommand(apiBase, token) {
  const base = `${apiBase}/grn-capture/${token}`;
  return `$cs=Get-CimInstance Win32_ComputerSystem;$csp=Get-CimInstance Win32_ComputerSystemProduct;$cpu=(Get-CimInstance Win32_Processor).Name;$gpu=(Get-CimInstance Win32_VideoController|Select-Object -First 1).Name;$ram=[math]::Round((Get-CimInstance Win32_PhysicalMemory|Measure-Object -Property Capacity -Sum).Sum/1GB);if(-not $ram){$ram=[math]::Round($cs.TotalPhysicalMemory/1GB)};$ssd=[math]::Round((Get-PhysicalDisk|Select-Object -First 1).Size/1000000000);$gen='';if($cpu -match '(\\d{1,2})(?:st|nd|rd|th)\\s*Gen'){$gen=$matches[1]}elseif($cpu -match 'i[3579][- ]?(\\d{3,5})'){$n=$matches[1];if($n.Length -ge 5){$gen=$n.Substring(0,2)}elseif($n.Length -eq 4){if($n.Substring(0,1) -eq '1'){$gen=$n.Substring(0,2)}else{$gen=$n.Substring(0,1)}}else{$gen=$n.Substring(0,1)}};$cfg=@{manufacturer=$cs.Manufacturer;model=$cs.Model;model_version=$csp.Version;system_family=$cs.SystemFamily;processor=$cpu;generation=$gen;ram=$ram;ssd=$ssd;gpu=$gpu}|ConvertTo-Json;try{$v=Invoke-RestMethod -Uri "${base}/verify-configuration" -Method Post -Body $cfg -ContentType "application/json"}catch{${PS_ERR};Write-Host "Verify failed: $e" -ForegroundColor Red;Read-Host "Press Enter to close";return};if(-not $v.configurationMatched){Write-Host "Config mismatch:" -ForegroundColor Red;$v.errors|%{Write-Host (" - "+$_.field+": expected '"+$_.expected+"', found '"+$_.actual+"'") -ForegroundColor Red};Read-Host "Press Enter to close";return};$s=(Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper();try{Invoke-RestMethod -Uri "${base}" -Method Post -Body (@{serial_number=$s}|ConvertTo-Json) -ContentType "application/json"|Out-Null;Write-Host "Verified + serial sent: $s" -ForegroundColor Green}catch{${PS_ERR};Write-Host "Serial submit failed: $e" -ForegroundColor Red};Read-Host "Press Enter to close"`;
}

function buildMacCommand(apiBase, token) {
  const base = `${apiBase}/grn-capture/${token}`;
  return `M=$(sysctl -n hw.model);C=$(sysctl -n machdep.cpu.brand_string 2>/dev/null||echo "Apple Silicon");R=$(( $(sysctl -n hw.memsize)/1073741824 ));S=$(system_profiler SPNVMeDataType SPSerialATADataType 2>/dev/null|awk '/Capacity/{print;exit}'|grep -oE '[0-9]+(\\.[0-9]+)?'|head -1);V=$(curl -s -X POST "${base}/verify-configuration" -H "Content-Type: application/json" -d "{\\"manufacturer\\":\\"Apple\\",\\"model\\":\\"$M\\",\\"processor\\":\\"$C\\",\\"ram\\":\\"$R\\",\\"ssd\\":\\"$S\\",\\"gpu\\":\\"\\"}");if echo "$V"|grep -q '"configurationMatched":true';then SERIAL=$(ioreg -rd1 -c IOPlatformExpertDevice|awk '/IOPlatformSerialNumber/{print $3;exit}'|tr -d '"');curl -s -X POST "${base}" -H "Content-Type: application/json" -d "{\\"serial_number\\":\\"$SERIAL\\"}";echo "Verified + serial sent: $SERIAL";else echo "Verification failed / config mismatch:";echo "$V";fi`;
}

function buildPs1FileContent(apiBase, token) {
  const base = `${apiBase}/grn-capture/${token}`;
  return `# Rentfoxxy GRN — run on the received laptop (Windows PowerShell)
# Step 1: verify hardware config. Step 2: capture serial only if it matches.
$cs  = Get-CimInstance Win32_ComputerSystem
$csp = Get-CimInstance Win32_ComputerSystemProduct
$cpu = (Get-CimInstance Win32_Processor).Name
$gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
$ram = [math]::Round((Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum/1GB)
if (-not $ram -or $ram -eq 0) { $ram = [math]::Round($cs.TotalPhysicalMemory/1GB) }
$ssd = [math]::Round((Get-PhysicalDisk | Select-Object -First 1).Size/1000000000)
$gen = ''
if ($cpu -match '(\\d{1,2})(?:st|nd|rd|th)\\s*Gen') {
  $gen = $matches[1]
} elseif ($cpu -match 'i[3579][- ]?(\\d{3,5})') {
  $n = $matches[1]
  if ($n.Length -ge 5) { $gen = $n.Substring(0,2) }
  elseif ($n.Length -eq 4) { if ($n.Substring(0,1) -eq '1') { $gen = $n.Substring(0,2) } else { $gen = $n.Substring(0,1) } }
  else { $gen = $n.Substring(0,1) }
}
$cfg = @{ manufacturer = $cs.Manufacturer; model = $cs.Model; model_version = $csp.Version; system_family = $cs.SystemFamily; processor = $cpu; generation = $gen; ram = $ram; ssd = $ssd; gpu = $gpu } | ConvertTo-Json
Write-Host "Verifying configuration..."
try {
  $verify = Invoke-RestMethod -Uri '${base}/verify-configuration' -Method Post -Body $cfg -ContentType 'application/json'
} catch {
  ${PS_ERR}
  Write-Host "Verify request failed: $e" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  return
}
if (-not $verify.configurationMatched) {
  Write-Host 'Configuration does NOT match the expected GRN item:' -ForegroundColor Red
  $verify.errors | ForEach-Object { Write-Host ("  - {0}: expected '{1}', found '{2}'" -f $_.field, $_.expected, $_.actual) -ForegroundColor Red }
  Read-Host 'Press Enter to close'
  return
}
Write-Host 'Configuration matched.' -ForegroundColor Green
$serial = (Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper()
$body = @{ serial_number = $serial } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri '${base}' -Method Post -Body $body -ContentType 'application/json' | Out-Null
  Write-Host "Verified + serial sent: $serial" -ForegroundColor Green
  Write-Host 'Done! Return to the GRN screen — serial will appear automatically.'
} catch {
  ${PS_ERR}
  Write-Host "Serial submit failed: $e" -ForegroundColor Red
}
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
  const psEncoded = useMemo(() => encodePsCommand(psScript), [psScript]);
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
  const configCheck = session?.config_check || null;
  const configChecks = Array.isArray(configCheck?.checks) ? configCheck.checks : [];
  const configMatched = !!session?.config_verified;

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
              {expectedSpecs.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                    <Cpu className="w-3.5 h-3.5" /> Expected configuration (GRN item)
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
                          {!c.required ? <span className="text-slate-400"> (info)</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!configMatched ? (
                    <p className="text-[11px] text-rose-700 mt-2 m-0">
                      This laptop does not match the expected GRN configuration. The serial will not be captured until it matches — verify the device and re-run the command.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside leading-relaxed">
                <li>You are on the <strong>received laptop</strong> (this machine).</li>
                <li>
                  <strong>Windows:</strong> download the script below, or copy the PowerShell one-liner → paste in
                  PowerShell → Enter.
                </li>
                <li>
                  <strong>Mac:</strong> copy the Terminal command → paste in Terminal → Enter.
                </li>
                <li>
                  The script first <strong>verifies the hardware</strong> against the expected GRN config, then
                  sends the serial only if it matches — no CRM install needed on this laptop.
                </li>
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
                  <p className="text-xs text-slate-600 mb-1 font-medium">
                    Windows — PowerShell <span className="text-slate-400">(secured / encoded)</span>
                  </p>
                  <div className="flex gap-2">
                    <pre className="flex-1 text-[10px] bg-slate-50 border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-28">
                      {psEncoded}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyText(psEncoded, 'Secured PowerShell command')}
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
