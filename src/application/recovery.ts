import { acknowledgeRecoveredWrites } from './persistence'

let recoveryBlocked = false
export function setRecoveryBlocked(value: boolean) { recoveryBlocked = value }
export function assertRecoveryAvailable() {
  if (recoveryBlocked) throw new Error('Data recovery is required. Restart and recover the retained snapshot before making further changes.')
}

export async function readRecoveryJournal(): Promise<string | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    const payload = await invoke<string | null>('read_recovery_journal')
    if (payload) recoveryBlocked = true
    return payload
  }
  const payload = localStorage.getItem('suite-recovery-journal')
  if (payload) recoveryBlocked = true
  return payload
}

export async function writeRecoveryJournal(payload: string | null) {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('write_recovery_journal', { payload })
  } else if (payload === null) localStorage.removeItem('suite-recovery-journal')
  else localStorage.setItem('suite-recovery-journal', payload)
}

export async function runRecoverable<T, S>(snapshot: S, work: () => Promise<T>, restore: (snapshot: S) => Promise<void>, journal = { read: readRecoveryJournal, write: writeRecoveryJournal }) {
  if (await journal.read()) throw new Error('An unfinished recovery journal exists. Recover it before starting another operation.')
  await journal.write(JSON.stringify(snapshot)) // Must be durable BEFORE changing any store.
  try {
    const result = await work()
    await journal.write(null)
    return result
  } catch (error) {
    try {
      await restore(snapshot)
      await journal.write(null)
      acknowledgeRecoveredWrites()
    } catch (recoveryError) {
      recoveryBlocked = true
      throw new Error('Operation failed and automatic recovery could not finish. The original snapshot is retained. Restart and use Recover before entering more data.', { cause: recoveryError })
    }
    throw new Error('Operation failed. All affected company data was restored.', { cause: error })
  }
}
type RecoveryCoordinator = (companyId: string, work: () => Promise<void>) => Promise<void>
let coordinator: RecoveryCoordinator | undefined
export function configureRecoveryCoordinator(value: RecoveryCoordinator) { coordinator = value }
export function recoverCompanyChange(companyId: string, work: () => Promise<void>) {
  if (!coordinator) throw new Error('Company recovery is unavailable. No destructive changes were started.')
  return coordinator(companyId, work)
}
