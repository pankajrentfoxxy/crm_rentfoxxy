# Build Rentfoxxy hardware-capture stub (Windows .NET Framework 4.x).
# Requires: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root '..\..\backend\assets\hw-capture'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outExe = Join-Path $outDir 'rentfoxxy-hw-capture-stub.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  throw "csc.exe not found at $csc"
}
& $csc /nologo /optimize+ /target:exe /platform:anycpu `
  /reference:System.Management.dll `
  /out:$outExe `
  (Join-Path $root 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit $LASTEXITCODE" }
Write-Host "Built: $outExe"
Get-Item $outExe | Format-List FullName, Length, LastWriteTime
