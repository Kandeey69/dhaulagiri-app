# Live Tauri Smoke Test

Date: 2026-08-03

## Startup Command

Command:

```powershell
npm.cmd run tauri:dev
```

The command was run in a bounded desktop-startup check from `E:\Coding by Kandeey\Dhaulagiri App\MERGED APP`.

## Result

Status: startup pass.

Evidence:

- Vite started successfully at `http://localhost:5173/`.
- Tauri compiled `easysolution v0.1.1` in dev profile.
- Tauri launched `target\debug\easysolution.exe`.
- The spawned app process was cleaned up after the bounded run.

Log files:

- `C:\Users\Kandeey\AppData\Local\Temp\tauri-dev-20260803-101003.out.log`
- `C:\Users\Kandeey\AppData\Local\Temp\tauri-dev-20260803-101003.err.log`

Key stderr lines:

```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 13.57s
Running `target\debug\easysolution.exe`
```

## Live Workflow Coverage

Detailed in-window workflows were not live-executed because this environment does not expose a reliable connector for interacting with the launched Tauri WebView. The startup itself was verified; purchase/sales/backup/year-end workflows remain manual release checks.

## Manual Follow-Up Required

- Create two companies and verify their active stock databases are isolated.
- Enable inventory for one company and confirm the setting does not bleed into the other.
- Create import purchase, local purchase, sale, collection/payment, and reversal flows from the real Tauri window.
- Export workbook, export portable backup, restore portable backup, and reopen the app.
