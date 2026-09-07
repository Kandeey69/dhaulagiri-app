# DDA Error Log

## DDA-ERR-001

Severity: LOW

Test step: DDA-BASE-002

Exact operation: `npm.cmd run lint`

Expected: ESLint exits successfully.

Actual: ESLint failed on `src/accounts/pages/Dashboard.tsx:43` with `preserve-caught-error`.

Exact error message: `There is no cause attached to the symptom error being thrown`

Console/Rust log: N/A

SQL error: N/A

Relevant database rows: N/A

Reproducibility: Always

Root cause: `loadDashboardSection` wrapped an original exception in a new `Error` but did not attach the original error as `cause`.

Files involved: `src/accounts/pages/Dashboard.tsx`

Fix applied: Changed the thrown error to `new Error(message, { cause: error })`.

Retest result: `npm.cmd run lint` passed.

Status: FIXED

## DDA-ERR-003

Severity: CRITICAL

Test step: DDA-LOCK-001

Exact operation: Code/data-path inspection for closed fiscal-year write enforcement.

Expected: Closed-year write operations are blocked at UI and storage/service level.

Actual: Year lock state is stored in company profiles/localStorage. UI components receive read-only flags, but lower-level persistence paths are not consistently guarded by an authoritative closed-year check.

Exact error message: N/A

Console/Rust log: N/A

SQL error: N/A

Relevant database rows: `company-profiles.seed.json` marks FY1/FY2 locked; transaction tables still depend on caller behavior to avoid writes.

Reproducibility: Always by architecture/code path.

Root cause: Lock status is not enforced as a database-level invariant and is not consistently checked in every write service.

Files involved: `src/App.tsx`, `src/companyContext.ts`, `src/accounts/data/storage.ts`, `src/purchase/repository.ts`, `src/stock/storage.ts`

Fix applied: Added authoritative company lock guards in `src/companyContext.ts`, then called them from accounts, purchase repository, and stock persistence write paths before persistence. Added regression coverage for locked/open company guard resolution and representative storage write APIs.

Retest result: `npm.cmd run test` passed with 44 tests, including `storage write APIs reject locked active company before persistence`; `npm.cmd run lint` passed.

Status: FIXED

## DDA-ERR-002

Severity: INFO

Test step: DDA-BASE-004

Exact operation: `cargo check --manifest-path src-tauri\Cargo.toml`

Expected: Cargo check exits successfully.

Actual: Initial sandboxed run failed opening `src-tauri\target\debug\.cargo-build-lock` with access denied.

Exact error message: `Access is denied. (os error 5)`

Console/Rust log: Cargo did not compile on the first attempt.

SQL error: N/A

Relevant database rows: N/A

Reproducibility: Once in sandboxed execution.

Root cause: Local build-lock access permission or process-level lock in sandboxed command context.

Files involved: `src-tauri\target\debug\.cargo-build-lock`

Fix applied: Reran the same command with approved elevated execution.

Retest result: Passed.

Status: FIXED
