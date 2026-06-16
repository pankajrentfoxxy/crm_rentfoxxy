# Rentfoxxy GRN — read this laptop's serial and send it to the capture link.
# No Node.js required. Run on the RECEIVED laptop in PowerShell.
#
# Usage:
#   .\grn-serial-capture.ps1 -Token "YOUR-UUID-TOKEN" -ApiBase "http://localhost:5001/api"
#
# Or open the capture page in the browser — it shows a one-liner with your token filled in.

param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [Parameter(Mandatory = $true)]
  [string]$ApiBase
)

$ErrorActionPreference = 'Stop'

$serial = (Get-CimInstance Win32_BIOS).SerialNumber
if (-not $serial) {
  Write-Error 'Could not read BIOS serial number on this machine.'
}
$serial = $serial.Trim().ToUpper()

$uri = ($ApiBase.TrimEnd('/')) + '/grn-capture/' + $Token
$body = @{ serial_number = $serial } | ConvertTo-Json

Write-Host "Sending serial: $serial"
$response = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType 'application/json'
Write-Host 'Success:' ($response.message)
Write-Host 'You can close this window and return to the GRN screen.'
