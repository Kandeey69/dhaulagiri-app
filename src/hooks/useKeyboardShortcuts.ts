import { useEffect } from 'react'

export function useKeyboardShortcuts({
  onSaveDraft,
  onReviewOrPost,
  onEscape,
  searchSelector = '[data-global-search="true"]',
}: {
  onSaveDraft?: () => void
  onReviewOrPost?: () => void
  onEscape?: () => void
  searchSelector?: string
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTextInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable

      if (event.key === '/' && !isTextInput) {
        const searchInput = document.querySelector<HTMLInputElement>(searchSelector)
        if (searchInput) {
          event.preventDefault()
          searchInput.focus()
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSaveDraft?.()
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        onReviewOrPost?.()
      }

      if (event.key === 'Escape') {
        onEscape?.()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, onReviewOrPost, onSaveDraft, searchSelector])
}

