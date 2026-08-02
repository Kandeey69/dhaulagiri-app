import { useEffect, useMemo, useState } from 'react'
import { createDraftSnapshot, shouldRestoreDraft, type DraftSnapshot } from '../application/draftAutosave'

export function useDraftAutosave<T>({
  enabled,
  keyName,
  value,
  version,
  debounceMs = 700,
}: {
  enabled: boolean
  keyName: string
  value: T
  version: string
  debounceMs?: number
}) {
  const [status, setStatus] = useState<'idle' | 'unsaved' | 'saved' | 'error'>('idle')

  const recovered = useMemo(() => {
    if (!keyName) return null
    try {
      const raw = window.localStorage.getItem(keyName)
      if (!raw) return null
      const snapshot = JSON.parse(raw) as DraftSnapshot<T>
      return shouldRestoreDraft(snapshot.version, version) ? snapshot.value : null
    } catch {
      return null
    }
  }, [keyName, version])

  useEffect(() => {
    if (!enabled || !keyName) {
      return
    }

    setStatus('unsaved')
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          keyName,
          JSON.stringify(createDraftSnapshot(keyName, version, value)),
        )
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }, debounceMs)

    return () => window.clearTimeout(timeout)
  }, [debounceMs, enabled, keyName, value, version])

  const clearDraft = () => {
    if (!keyName) return
    window.localStorage.removeItem(keyName)
    setStatus('idle')
  }

  return { clearDraft, recovered, status }
}

