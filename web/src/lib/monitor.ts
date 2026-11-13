/**
 * Sentry, loaded after the page is shown (it weighs about as much as the rest of the app): errors seen before it
 * is ready are kept and sent once it is. Nothing is sent in local development (no DSN).
 */
type Sent = { captureException: (e: unknown, hint?: unknown) => void }

let sentry: Sent | null = null
const waiting: [unknown, unknown][] = []

export function report(error: unknown, hint?: unknown) {
  if (sentry) sentry.captureException(error, hint)
  else if (waiting.length < 20) waiting.push([error, hint])
}

/** React's root error callbacks: every error goes to report(). */
export const reactErrorHandler = () => (error: unknown, info?: { componentStack?: string }) =>
  report(error, info?.componentStack ? { contexts: { react: { componentStack: info.componentStack } } } : undefined)

export function startMonitoringLater() {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  const start = () =>
    import('@/lib/sentry').then((m) => {
      m.startSentry()
      sentry = { captureException: (e, h) => m.captureException(e, h as never) }
      waiting.splice(0).forEach(([e, h]) => m.captureException(e, h as never))
    }, () => {})
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  if (document.readyState === 'complete') (idle ? idle(start, { timeout: 3000 }) : setTimeout(start, 1500))
  else window.addEventListener('load', () => (idle ? idle(start, { timeout: 3000 }) : setTimeout(start, 1500)), { once: true })
}
