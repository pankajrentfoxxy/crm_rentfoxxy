# Rentfoxxy hardware capture stub

Console Windows app used for per-session QC2 / Dispatch QC / GRN hardware verification.

## How it works

1. Backend appends a JSON session trailer to this stub:
   `[stub.exe][json utf8][uint32 le length][magic RFXYHW01]`
2. Technician downloads the resulting `.exe` and double-clicks it on the laptop under test.
3. The app reads WMI hardware, `POST`s verify-configuration, then submits the BIOS serial.

## Build (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File tools/hw-capture/build.ps1
```

Output: `backend/assets/hw-capture/rentfoxxy-hw-capture-stub.exe`

Requires .NET Framework 4.x `csc.exe` (included with Windows) and `System.Management`.

## Session JSON

```json
{
  "apiBase": "https://crm.example.com/api",
  "token": "<uuid>",
  "apiPrefix": "qc2-capture",
  "brand": "QC2"
}
```

`apiPrefix` values: `qc2-capture` | `dispatch-qc-capture` | `grn-capture`
