import * as Sentry from '@sentry/react'

/**
 * Errors, slow pages and a replay of the sessions where an error happens, sent to Sentry (project paybybot-web).
 * Nothing personal leaves the browser: no IP or cookies, every text and field masked in the replays, no
 * request bodies (plates, cards, passwords never reach Sentry).
 */
export function startSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return // local development: nothing sent
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return // a local copy of the built site: nothing sent either
  Sentry.init({
    dsn,
    environment: 'production',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.3, // page loads and API calls timed on 30 % of the visits
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    // Not PayByBot's code: a browser extension or the browser itself reading the page's structured data.
    ignoreErrors: [/@context/],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
    beforeSend: scrub,
    beforeSendTransaction: scrub,
    beforeBreadcrumb: (b) => {
      if (b.data?.from) b.data.from = hideToken(b.data.from)
      if (b.data?.to) b.data.to = hideToken(b.data.to)
      if (b.data?.url) b.data.url = hideToken(b.data.url)
      return b
    },
  })
}

/** No IP address (explicitly empty, so Sentry does not take the connection's), no cookies, headers or bodies. */
function scrub<T extends Sentry.Event>(event: T): T {
  event.user = { ip_address: null }
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.data
    if (event.request.url) event.request.url = hideToken(event.request.url)
  }
  return event
}

/** The signed links (« Valider mon paiement », unlock) carry their token as t=: never sent. */
function hideToken(url: string) {
  return String(url).replace(/([?&#]t=)[^&#]*/g, '$1…')
}

export const reactErrorHandler = Sentry.reactErrorHandler
export const captureException = Sentry.captureException
