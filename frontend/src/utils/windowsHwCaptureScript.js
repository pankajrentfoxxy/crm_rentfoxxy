/** PowerShell error extraction reused in one-liner and .ps1 scripts. */
export const PS_ERR =
  "$e=$_.ErrorDetails.Message;if(-not $e){try{$rs=$_.Exception.Response.GetResponseStream();$e=(New-Object System.IO.StreamReader($rs)).ReadToEnd()}catch{$e=$_.Exception.Message}}";

/** Readable multi-line Windows capture script (download / reference). */
export function buildWindowsCapturePs1(apiBase, token, apiPrefix = 'grn-capture', title = 'Rentfoxxy') {
  const base = `${apiBase}/${apiPrefix}/${token}`;
  return `# ${title} — run on the laptop under test (Windows PowerShell)
# Verifies hardware against expected config, then submits serial.
$cs  = Get-CimInstance Win32_ComputerSystem
$csp = Get-CimInstance Win32_ComputerSystemProduct
$cpu = (Get-CimInstance Win32_Processor).Name
$gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
$ram = [math]::Round((Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB)
if (-not $ram -or $ram -eq 0) { $ram = [math]::Round($cs.TotalPhysicalMemory / 1GB) }
$ssd = [math]::Round((Get-PhysicalDisk | Select-Object -First 1).Size / 1000000000)
$gen = ''
if ($cpu -match '(\\d{1,2})(?:st|nd|rd|th)\\s*Gen') {
  $gen = $matches[1]
} elseif ($cpu -match 'i[3579][- ]?(\\d{3,5})') {
  $n = $matches[1]
  if ($n.Length -ge 5) { $gen = $n.Substring(0, 2) }
  elseif ($n.Length -eq 4) {
    if ($n.Substring(0, 1) -eq '1') { $gen = $n.Substring(0, 2) }
    else { $gen = $n.Substring(0, 1) }
  } else { $gen = $n.Substring(0, 1) }
}
$cfg = @{
  manufacturer   = $cs.Manufacturer
  model          = $cs.Model
  model_version  = $csp.Version
  system_family  = $cs.SystemFamily
  processor      = $cpu
  generation     = $gen
  ram            = $ram
  ssd            = $ssd
  gpu            = $gpu
} | ConvertTo-Json
Write-Host 'Verifying configuration...'
try {
  $verify = Invoke-RestMethod -Uri '${base}/verify-configuration' -Method Post -Body $cfg -ContentType 'application/json'
} catch {
  ${PS_ERR}
  if ($e -notmatch 'Already verified') {
    Write-Host "Verify request failed: $e" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    return
  }
  $verify = @{ configurationMatched = $true }
}
if (-not $verify.configurationMatched) {
  Write-Host 'Configuration does NOT match:' -ForegroundColor Red
  $verify.errors | ForEach-Object {
    Write-Host ("  - {0}: expected '{1}', found '{2}'" -f $_.field, $_.expected, $_.actual) -ForegroundColor Red
  }
  Read-Host 'Press Enter to close'
  return
}
Write-Host 'Configuration matched.' -ForegroundColor Green
$serial = (Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper()
$body = @{ serial_number = $serial } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri '${base}' -Method Post -Body $body -ContentType 'application/json' | Out-Null
  Write-Host "Verified + serial sent: $serial" -ForegroundColor Green
} catch {
  ${PS_ERR}
  Write-Host "Serial submit failed: $e" -ForegroundColor Red
}
Read-Host 'Press Enter to close'
`;
}

/** One-line Windows PowerShell script for -EncodedCommand. */
export function buildWindowsCaptureCommand(apiBase, token, apiPrefix = 'grn-capture') {
  const base = `${apiBase}/${apiPrefix}/${token}`;
  return `$cs=Get-CimInstance Win32_ComputerSystem;$csp=Get-CimInstance Win32_ComputerSystemProduct;$cpu=(Get-CimInstance Win32_Processor).Name;$gpu=(Get-CimInstance Win32_VideoController|Select-Object -First 1).Name;$ram=[math]::Round((Get-CimInstance Win32_PhysicalMemory|Measure-Object -Property Capacity -Sum).Sum/1GB);if(-not $ram){$ram=[math]::Round($cs.TotalPhysicalMemory/1GB)};$ssd=[math]::Round((Get-PhysicalDisk|Select-Object -First 1).Size/1000000000);$gen='';if($cpu -match '(\\d{1,2})(?:st|nd|rd|th)\\s*Gen'){$gen=$matches[1]}elseif($cpu -match 'i[3579][- ]?(\\d{3,5})'){$n=$matches[1];if($n.Length -ge 5){$gen=$n.Substring(0,2)}elseif($n.Length -eq 4){if($n.Substring(0,1) -eq '1'){$gen=$n.Substring(0,2)}else{$gen=$n.Substring(0,1)}}else{$gen=$n.Substring(0,1)}};$cfg=@{manufacturer=$cs.Manufacturer;model=$cs.Model;model_version=$csp.Version;system_family=$cs.SystemFamily;processor=$cpu;generation=$gen;ram=$ram;ssd=$ssd;gpu=$gpu}|ConvertTo-Json;try{$v=Invoke-RestMethod -Uri "${base}/verify-configuration" -Method Post -Body $cfg -ContentType "application/json"}catch{${PS_ERR};if($e -notmatch 'Already verified'){Write-Host "Verify failed: $e" -ForegroundColor Red;Read-Host "Press Enter to close";return};$v=@{configurationMatched=$true}};if(-not $v.configurationMatched){Write-Host "Config mismatch:" -ForegroundColor Red;$v.errors|%{Write-Host (" - "+$_.field+": expected '"+$_.expected+"', found '"+$_.actual+"'") -ForegroundColor Red};Read-Host "Press Enter to close";return};$s=(Get-CimInstance Win32_BIOS).SerialNumber.Trim().ToUpper();try{Invoke-RestMethod -Uri "${base}" -Method Post -Body (@{serial_number=$s}|ConvertTo-Json) -ContentType "application/json"|Out-Null;Write-Host "Verified + serial sent: $s" -ForegroundColor Green}catch{${PS_ERR};Write-Host "Serial submit failed: $e" -ForegroundColor Red};Read-Host "Press Enter to close"`;
}

/** UTF-16LE base64 wrapper for powershell -EncodedCommand. */
export function encodePsCommand(script) {
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
