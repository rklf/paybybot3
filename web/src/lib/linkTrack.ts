import { api } from '@/lib/api'

/** Follows one opening of the private link on « Activité »: how far the visitor goes and how long they stay.
 *  The visit count stays on this device; nothing identifying is sent, only a random id that groups its visits. */
const KEY = 'pbb_link_track'
const VISITS = 'pbb_link_visits'
const VISITOR = 'pbb_visitor'
const OWNER = 'pbb_owner'

/** This device opened the admin page: the owner's own visits are not counted. */
export function markOwnerDevice() {
  try {
    localStorage.setItem(OWNER, '1')
  } catch {
    // private window: counted
  }
}

/** The random id of this device's visits (empty if none yet). */
export function ownVisitor() {
  try {
    return localStorage.getItem(VISITOR) || ''
  } catch {
    return ''
  }
}
const STEPS = ['inscription', 'identifiants', 'code', 'inscrit'] as const
export type LinkStep = (typeof STEPS)[number]

type State = { id: number; sig: string; source: string; device: string; visit: number; visitor: string; step: string; start: number }

function load(): State | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function save(s: State) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // private window: followed for this page only
  }
}

/** Sends the visit as it is now (with the time spent); on leaving, as a beacon that survives the page closing. */
function send(leaving = false) {
  const s = load()
  if (!s) return
  const body = JSON.stringify({
    id: s.id,
    sig: s.sig,
    source: s.source,
    device: s.device,
    visit: s.visit,
    visitor: s.visitor || '',
    step: s.step,
    seconds: Math.round((Date.now() - s.start) / 1000),
  })
  if (leaving && navigator.sendBeacon) navigator.sendBeacon('/api/link-progress', new Blob([body], { type: 'application/json' }))
  else fetch('/api/link-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send(true))
  window.addEventListener('pagehide', () => send(true))
}

/** The link itself just opened: one « Lien privé ouvert » row, then followed. */
export function startLinkTrack(source: string, device: string) {
  try {
    if (localStorage.getItem(OWNER)) return
  } catch {
    // followed
  }
  let visit = 1
  let visitor = ''
  try {
    visit = (Number(localStorage.getItem(VISITS)) || 0) + 1
    localStorage.setItem(VISITS, String(visit))
    visitor = localStorage.getItem(VISITOR) || [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(VISITOR, visitor)
  } catch {
    // counted as a first visit, of a visitor of its own
  }
  api.linkOpen(source, device, visit, visitor).then(
    (r) => {
      if (!r.id || !r.sig) return
      save({ id: r.id, sig: r.sig, source, device, visit, visitor, step: '', start: Date.now() })
      listen()
    },
    () => {},
  )
}

/** A reload in the same tab: the visit already followed goes on. */
export function resumeLinkTrack() {
  if (load()) listen()
}

/** A sign-up step reached (only forward: going back to a page does not lower it). */
export function trackLinkStep(step: LinkStep) {
  const s = load()
  if (!s || STEPS.indexOf(step) <= STEPS.indexOf(s.step as LinkStep)) return
  s.step = step
  save(s)
  send()
}
