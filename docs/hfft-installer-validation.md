# HFFT Installer Validation

Updated: 2026-08-11

## Status

MSI MANUAL VALIDATION REQUIRED

NSIS MANUAL VALIDATION REQUIRED

Uninstall/data-retention validation also remains manual because no disposable Windows install environment was available in this session. I did not install over the user's current application/data.

## Build Artifacts

| Artifact | Path | Size | Result |
|---|---|---:|---:|
| Release EXE | `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\src-tauri\target\release\easysolution.exe` | 12,567,552 bytes | BUILT |
| MSI | `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\src-tauri\target\release\bundle\msi\Easysolution_0.1.1_x64_en-US.msi` | 4,530,176 bytes | BUILT |
| NSIS | `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP\src-tauri\target\release\bundle\nsis\Easysolution_0.1.1_x64-setup.exe` | 3,152,485 bytes | BUILT |

## Manual Scope Remaining

| Area | Required Result | Status |
|---|---|---:|
| MSI install | Installer completes in disposable environment | MANUAL VALIDATION REQUIRED |
| MSI runtime | Launch, DB discovery, FY switching, inventory, backup/workbook export | MANUAL VALIDATION REQUIRED |
| NSIS install | Installer completes in disposable environment | MANUAL VALIDATION REQUIRED |
| NSIS runtime | Launch, restart persistence, DB writability, backup/workbook export | MANUAL VALIDATION REQUIRED |
| Uninstall/data retention | Program files removed; financial AppData preserved unless explicitly warned by product | MANUAL VALIDATION REQUIRED |
