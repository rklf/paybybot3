import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/** Cloudflare Turnstile: a human check before sign-up and logins, online only (the server says if it is on). */
type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let siteKey: Promise<string | null> | null = null
let script: Promise<Turnstile> | null = null

function loadScript() {
  return (script ??= new Promise<Turnstile>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    el.async = true
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    el.onerror = () => {
      script = null
      reject(new Error('turnstile'))
    }
    document.head.appendChild(el)
  }))
}

const UNAVAILABLE = "La vérification anti-robot n'a pas abouti. Rechargez la page et réessayez."
const failure = (code: string | null) => (code ? `${UNAVAILABLE} (code ${code})` : UNAVAILABLE)

/**
 * `box` goes on an empty element in the form: Cloudflare's box shows there (a click is asked only when in doubt).
 * `token()` gives a fresh single-use token ("" when the check is off) and readies the next one.
 */
export function useTurnstile() {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<{ t: Turnstile; id: string } | null>(null)
  const current = useRef<string | null>(null)
  const waiting = useRef<((token: string) => void)[]>([])
  const [enabled, setEnabled] = useState(false)
  const [failed, setFailedState] = useState<string | null>(null) // Cloudflare's error code, shown to help support
  const broken = useRef(false)
  const codeRef = useRef<string | null>(null)
  const setFailed = (code: string | null) => {
    broken.current = code !== null
    codeRef.current = code
    setFailedState(code)
  }

  useEffect(() => {
    let cancelled = false
    ;(siteKey ??= api.config().then((c) => c.turnstileSiteKey ?? null, () => null)).then(async (key) => {
      if (!key || cancelled) return
      setEnabled(true)
      try {
        const t = await loadScript()
        if (cancelled || !box.current) return
        const id = t.render(box.current, {
          sitekey: key,
          appearance: 'interaction-only', // invisible unless Cloudflare needs a click (a suspicious visitor)
          theme: 'light',
          language: 'fr',
          size: 'flexible',
          callback: (token: string) => {
            current.current = token
            setFailed(null)
            waiting.current.splice(0).forEach((resolve) => resolve(token))
          },
          'expired-callback': () => (current.current = null),
          'error-callback': (code: string) => {
            console.warn('Turnstile error', code)
            setFailed(String(code || 'inconnu'))
            return false // Cloudflare retries by itself
          },
        })
        widget.current = { t, id }
      } catch {
        if (!cancelled) setFailed('script')
      }
    })
    return () => {
      cancelled = true
      if (widget.current) widget.current.t.remove(widget.current.id)
      widget.current = null
    }
  }, [])

  const token = useCallback(async () => {
    if (!enabled) return ''
    if (broken.current && !current.current && widget.current) widget.current.t.reset(widget.current.id) // one more try
    const value =
      current.current ??
      (await new Promise<string>((resolve, reject) => {
        waiting.current.push(resolve)
        setTimeout(() => reject(new Error(failure(codeRef.current))), broken.current ? 15000 : 30000)
      }))
    current.current = null // single use: the next submit waits for a new one
    if (widget.current) widget.current.t.reset(widget.current.id)
    return value
  }, [enabled])

  return { box, token, enabled, failed: failed ? failure(failed) : null }
}
