// Explicit business writes start immediately. Navigation waits for all of them.
const pending = new Set<Promise<unknown>>()
const failures = new Map<string, unknown>()

export function persistBusinessAction<T>(companyId: string, work: () => Promise<T>): Promise<T> {
  const promise = Promise.resolve().then(work)
  pending.add(promise)
  void promise.then(
    () => { failures.delete(companyId); pending.delete(promise) },
    error => { failures.set(companyId, error); pending.delete(promise) },
  )
  return promise
}

export async function flushPendingWrites() {
  while (pending.size) await Promise.allSettled([...pending])
  if (failures.size) throw new Error('A save failed. Retry the failed action before leaving or closing the year.', { cause: [...failures.values()][0] })
}

export function hasPendingWrites() { return pending.size > 0 }

export async function runProtectedOperation<T>(work: () => Promise<T>) {
  const promise = Promise.resolve().then(work)
  pending.add(promise)
  try { return await promise } finally { pending.delete(promise) }
}

export function acknowledgeRecoveredWrites() { failures.clear() }
