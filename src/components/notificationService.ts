export type ToastKind = 'success' | 'warning' | 'info'

export type ToastNotice = {
  id: number
  kind: ToastKind
  message: string
  duration: number
}

export type DialogRequest = {
  id: number
  kind: 'confirm' | 'error'
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  resolve?: (accepted: boolean) => void
}

export type NotificationEvent =
  | { type: 'toast'; notice: ToastNotice }
  | { type: 'dialog'; request: DialogRequest }

const listeners = new Set<(event: NotificationEvent) => void>()
let nextNotificationId = 1

function publish(event: NotificationEvent) {
  listeners.forEach((listener) => listener(event))
}

export function subscribeNotifications(listener: (event: NotificationEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyToast(message: string, kind: ToastKind = 'success', duration = 5000) {
  publish({
    type: 'toast',
    notice: { id: nextNotificationId++, kind, message, duration },
  })
}

export function notifyError(message: string, title = 'Unable to continue') {
  publish({
    type: 'dialog',
    request: {
      id: nextNotificationId++,
      kind: 'error',
      title,
      message,
      confirmLabel: 'Close',
    },
  })
}

export function confirmAction({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}) {
  return new Promise<boolean>((resolve) => {
    publish({
      type: 'dialog',
      request: {
        id: nextNotificationId++,
        kind: 'confirm',
        title,
        message,
        confirmLabel,
        cancelLabel,
        destructive,
        resolve,
      },
    })
  })
}
