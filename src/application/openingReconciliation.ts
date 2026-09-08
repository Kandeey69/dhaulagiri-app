export type OpeningState = { derived: number; override: boolean }
export type OpeningProvenance = {
  sourceId: string;
  accounts: Record<string, OpeningState>;
  purchase: Record<string, OpeningState>;
  stock: Record<string, { targetId: string; quantity: OpeningState; value: OpeningState }>;
}

export function reconcileOpening(current: number | undefined, derived: number, previous?: OpeningState) {
  if (!Number.isFinite(derived) || (current !== undefined && !Number.isFinite(current))) throw new Error('Opening value must be finite.')
  // An existing independent opening or a changed derived opening is an explicit override.
  const override = current !== undefined && (previous?.override || Math.abs(current - (previous?.derived ?? derived)) > 0.000001)
  return { value: override ? current! : derived, state: { derived, override: Boolean(override) } }
}

export function assertReopenDependencies(sourceId: string, profiles: { id: string; nextCompanyId: string; isLocked: boolean }[]) {
  const seen = new Set<string>()
  let row = profiles.find(row => row.id === sourceId)
  while (row?.nextCompanyId) {
    if (seen.has(row.id)) throw new Error('Fiscal-year chain contains a cycle.')
    seen.add(row.id)
    row = profiles.find(candidate => candidate.id === row!.nextCompanyId)
    if (!row) throw new Error('Linked successor is missing. Repair the fiscal-year chain first.')
    if (row.isLocked) throw new Error('Reopen dependent fiscal years from newest to oldest before adjusting this year. Reconcile and close them from oldest to newest afterward.')
  }
}
