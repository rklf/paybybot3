/** Word of mouth: the site opens through a user's link (?i=<code>), kept on this device for the sign-up. */
const KEY = 'pbb_invite'

let fromLinkNow = false

/** This visit came through a link (?i=…) not opened yet in this tab: the welcome curtain is shown (once per tab,
 *  not again on each reload). */
export function openedFromLink(): boolean {
  return fromLinkNow
}

/** Someone signed in on this page: the welcome curtain is over for it (signing out must not show it again). */
export function consumeLinkCurtain() {
  fromLinkNow = false
}

/** Reads ?i= from the address, else the code kept from an earlier visit. The code stays in the address: copied
 *  from the address bar, reopened from the history or from an app's in-app browser, the link keeps working. */
let captured: string | null | undefined

export function captureInvite(): string | null {
  if (captured !== undefined) return captured // read once per page: a second call must not hide the curtain
  captured = readInvite()
  return captured
}

/** The code of a referral link: /r/<code> (the shared form), or ?i=<code> (older links, still valid). */
export function linkCode(): string | null {
  const path = window.location.pathname.match(/^\/r\/([0-9A-Za-z_-]{1,40})\/?$/)
  return path ? path[1] : new URL(window.location.href).searchParams.get('i')
}

function readInvite(): string | null {
  const fromLink = linkCode()
  if (fromLink) {
    try {
      localStorage.setItem(KEY, fromLink)
      // The link's tag (?s=), sent with the sign-up: « acces » means no referral (the link was asked by e-mail).
      localStorage.setItem(SOURCE_KEY, new URL(window.location.href).searchParams.get('s') ?? '')
    } catch {
      // private window: the code still works, it is in the address
    }
    try {
      fromLinkNow = sessionStorage.getItem('pbb_curtain') !== fromLink
      sessionStorage.setItem('pbb_curtain', fromLink)
    } catch {
      fromLinkNow = true
    }
    return fromLink
  }
  return storedInvite()
}

const SOURCE_KEY = 'pbb_source'

/** The tag of the last link opened on this device (« acces », « wa »…), or "". */
export function storedSource(): string {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storedInvite(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetInvite() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing kept
  }
}

/** This device has been signed in before: the site stays open to sign in again (signing up still needs a link). */
const MEMBER = 'pbb_member'

export function markMember() {
  try {
    localStorage.setItem(MEMBER, '1')
  } catch {
    // private window: nothing kept
  }
}

export function isMember(): boolean {
  try {
    return localStorage.getItem(MEMBER) === '1'
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  wa: 'WhatsApp',
  sms: 'SMS',
  mail: 'E-mail',
  tg: 'Telegram',
  copy: 'Lien copié',
  share: 'Partage',
  carte: 'Carte de visite',
  acces: 'Sans parrainage (lien demandé par e-mail)',
}

/** Where the opened link comes from: the share button's tag (?s=), else the app it opens in, else the referring site. */
export function linkSource(): string {
  const tag = new URL(window.location.href).searchParams.get('s')
  if (tag && SOURCES[tag]) return SOURCES[tag]
  const ua = navigator.userAgent
  const apps: [RegExp, string][] = [
    [/Instagram/i, 'Instagram'],
    [/FBAN|FBAV|FB_IAB|Messenger/i, 'Facebook / Messenger'],
    [/Snapchat/i, 'Snapchat'],
    [/LinkedInApp/i, 'LinkedIn'],
    [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
    [/WhatsApp/i, 'WhatsApp'],
  ]
  for (const [re, name] of apps) if (re.test(ua)) return name
  try {
    // From paybybot.fr itself: says nothing of where the link came from.
    const from = document.referrer ? new URL(document.referrer).hostname : ''
    if (from && from !== window.location.hostname) return from.replace(/^www\./, '')
  } catch {
    // no readable referrer
  }
  // The first printed cards' QR code opens ?i=<code> untagged; since 25/10 the site only shares /r/<code>.
  if (new URL(window.location.href).searchParams.get('i')) return SOURCES.carte
  return 'Direct'
}

/** The kind of device, without anything identifying. */
export function deviceKind(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Tablette Android'
  return 'Ordinateur'
}
