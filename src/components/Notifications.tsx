import { useEffect, useRef, useState } from 'react'
import { subscribeNotifications, type DialogRequest, type NotificationEvent, type ToastNotice } from './notificationService'

export function NotificationHost() {
  const [toasts, setToasts] = useState<ToastNotice[]>([])
  const [dialogs, setDialogs] = useState<DialogRequest[]>([])
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeDialog = dialogs[0]

  useEffect(() => {
    const listener = (event: NotificationEvent) => {
      if (event.type === 'toast') {
        setToasts((current) => [...current, event.notice])
        window.setTimeout(() => {
          setToasts((current) => current.filter((notice) => notice.id !== event.notice.id))
        }, event.notice.duration)
        return
      }

      setDialogs((current) => [...current, event.request])
    }

    return subscribeNotifications(listener)
  }, [])

  useEffect(() => {
    if (activeDialog) closeButtonRef.current?.focus()
  }, [activeDialog])

  function closeDialog(accepted: boolean) {
    if (!activeDialog) return
    activeDialog.resolve?.(accepted)
    setDialogs((current) => current.slice(1))
  }

  return (
    <>
      <div className="app-toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((notice) => (
          <div className={`app-toast ${notice.kind}`} key={notice.id} role="status">
            <span>{notice.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== notice.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {activeDialog && (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && activeDialog.kind === 'confirm') closeDialog(false)
          }}
        >
          <section
            aria-describedby="app-dialog-message"
            aria-labelledby="app-dialog-title"
            aria-modal="true"
            className={`app-dialog ${activeDialog.kind}`}
            role="alertdialog"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeDialog(false)
            }}
          >
            <h2 id="app-dialog-title">{activeDialog.title}</h2>
            <p id="app-dialog-message">{activeDialog.message}</p>
            <div className="app-dialog-actions">
              {activeDialog.kind === 'confirm' && (
                <button type="button" className="ghost" onClick={() => closeDialog(false)}>
                  {activeDialog.cancelLabel}
                </button>
              )}
              <button
                type="button"
                className={activeDialog.destructive ? 'danger' : ''}
                onClick={() => closeDialog(true)}
                ref={closeButtonRef}
              >
                {activeDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
