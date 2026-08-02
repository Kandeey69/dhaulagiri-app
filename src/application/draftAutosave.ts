export type DraftSnapshot<T> = {
  key: string
  version: string
  savedAt: string
  value: T
}

export function createDraftKey(parts: string[]) {
  return parts
    .map((part) => part.trim().replace(/[^a-zA-Z0-9_-]+/g, '-'))
    .filter(Boolean)
    .join(':')
}

export function createDraftSnapshot<T>(key: string, version: string, value: T): DraftSnapshot<T> {
  return {
    key,
    version,
    savedAt: new Date().toISOString(),
    value,
  }
}

export function shouldRestoreDraft(savedVersion: string, currentVersion: string) {
  return Boolean(savedVersion) && savedVersion === currentVersion
}

