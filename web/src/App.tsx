import { CoverageHost } from '@/components/Coverage'
import { Loading } from '@/components/Loading'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { ACCOUNT_KEY, Dashboard, RESIDENTS_KEY } from '@/components/Dashboard'
import { LoginView } from '@/components/LoginView'
import { FaqView, Home } from '@/components/Landing'
import { HowPage } from '@/components/HowPage'
import { AboutPage } from '@/components/AboutPage'
import { PayWizard } from '@/components/PayWizard'
import { PricingPage } from '@/components/Pricing'
import { legalPageFromHash, type LegalPage } from '@/lib/legalPages'
import { NotFoundPage } from '@/components/NotFound'
import { CheckoutDone } from '@/components/CheckoutDone'
import { InviteCurtain, InviteGate } from '@/components/InviteGate'
import { resumeLinkTrack, startLinkTrack, trackLinkStep } from '@/lib/linkTrack'
import { ValidatePayment } from '@/components/ValidatePayment'
import { captureInvite, consumeLinkCurtain, deviceKind, forgetInvite, isMember, linkSource, markMember, openedFromLink } from '@/lib/invite'
import { PayByPhone } from '@/components/signs'
import { ServiceBanner } from '@/components/ServiceBanner'
import { api, ApiError, forgetZoneLookup, type Me, type Overview } from '@/lib/api'

// Pages seldom opened, loaded only when they are (the first screen comes up sooner).
const SecurityPage = lazy(() => import('@/components/SecurityPage').then((m) => ({ default: m.SecurityPage })))
const LegalView = lazy(() => import('@/components/Legal').then((m) => ({ default: m.LegalView })))
const AdminPage = lazy(() => import('@/components/Admin').then((m) => ({ default: m.AdminPage })))
const Welcome = lazy(() => import('@/components/Welcome').then((m) => ({ default: m.Welcome })))
const SubscriptionDialog = lazy(() => import('@/components/Subscription').then((m) => ({ default: m.SubscriptionDialog })))

type Route = 'faq' | 'comment-ca-marche' | 'qui-sommes-nous' | 'tarifs' | 'connexion' | 'inscription' | 'demo' | 'admin' | 'bienvenue' | 'valider' | null

function routeFromHash(hash: string): Route {
  const id = hash.replace(/^#\/?/, '').split('?')[0]
  return id === 'faq' || id === 'comment-ca-marche' || id === 'qui-sommes-nous' || id === 'tarifs' || id === 'connexion' || id === 'inscription' || id === 'demo' || id === 'admin' ||
    id === 'bienvenue' || id === 'valider'
    ? id
    : null
}

const OVERVIEW_KEY = 'pbb-overview'

/** The account data kept for this tab only (sessionStorage: gone when the tab closes, cleared at logout). */
function cachedOverview(): Overview | null {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_KEY)
    return raw ? (JSON.parse(raw) as Overview) : null
  } catch {
    return null
  }
}

function keepOverview(d: Overview | null) {
  try {
    if (d) sessionStorage.setItem(OVERVIEW_KEY, JSON.stringify(d))
    else for (const key of [OVERVIEW_KEY, ACCOUNT_KEY, RESIDENTS_KEY]) sessionStorage.removeItem(key)
  } catch {
    // storage blocked: nothing kept
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const shown = useRef(false) // the dashboard is on screen: errors are toasts, not the loading screen
  // The last account data seen in this tab: shown at once on a reload while fresh data is fetched (no blank page).
  const [data, setDataState] = useState<Overview | null>(() => cachedOverview())
  const setData = useCallback((d: Overview | null) => {
    setDataState(d)
    keepOverview(d)
  }, [])
  // The account data asked at start, alongside « who am I » (one round trip instead of two in a row).
  const early = useRef<Promise<Overview | null> | null>(null)
  const [paying, setPaying] = useState(false)
  const [hosted, setHosted] = useState(false)
  // Word of mouth only (server's PAYBYBOT_INVITE_ONLY): the site opens through a user's link (?i=…).
  const [inviteOnly, setInviteOnly] = useState(false)
  const [interrupted, setInterrupted] = useState(false) // PayByPhone not answering: the banner on every page
  const [invited, setInvited] = useState<'yes' | 'no' | 'invalid' | null>(null)
  const [legal, setLegal] = useState<LegalPage | null>(() => legalPageFromHash(window.location.hash))
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash))
  // Right after "S'inscrire": open the renewal setup on the dashboard.
  const [onboarding, setOnboarding] = useState(false)
  const [autoRenew, setAutoRenew] = useState(false) // past the welcome page: the renewal opens by itself
  const [zoneReady, setZoneReady] = useState(true)

  // A small ticket bought by hand, to try a bank's validation for real: no button leads here.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#/test-ticket') setPaying(true)
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  useEffect(() => {
    const onHash = () => {
      setLegal(legalPageFromHash(window.location.hash))
      setRoute(routeFromHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // A link to a legal page remembers where it was clicked (« ?from=inscription »), so its « ← » leads back there,
  // also when it opens in a new tab. Between legal pages, the first origin is kept.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null
      if (!a) return
      const target = a.getAttribute('href') ?? ''
      if (!legalPageFromHash(target)) return
      const here = window.location.hash
      const from = legalPageFromHash(here)
        ? new URLSearchParams(here.split('?')[1] ?? '').get('from')
        : here.replace(/^#\/?/, '').split('?')[0]
      a.setAttribute('href', target.split('?')[0] + (from ? '?from=' + encodeURIComponent(from) : ''))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // "Démo" link on the home page: open the demo account directly.
  useEffect(() => {
    if (route !== 'demo' || me === undefined) return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setRoute(null)
    if (me === null) api.login('demo', 'demo').then((m) => setMe(m as Me), (e) => toast.error((e as Error).message))
  }, [route, me])

  // A visitor who came through the private link reaches the sign-up page: the step shows on « Activité ».
  useEffect(() => {
    if (route === 'inscription') trackLinkStep('inscription')
  }, [route])

  // #/bienvenue: show the welcome page again (what PayByBot found in PayByPhone), once signed in.
  useEffect(() => {
    if (route !== 'bienvenue' || !me) return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setRoute(null)
    setOnboarding(true)
  }, [route, me])

  // Back from the e-mail's « Débloquer mon compte » once Stripe has taken the payment.
  useEffect(() => {
    if (window.location.hash !== '#/debloque') return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    toast.success('Compte débloqué : le renouvellement reprend.')
  }, [])

  // Signed in (not the demo): this device may sign in again later without an invitation link.
  useEffect(() => {
    if (me && !me.demo) markMember()
    if (me) consumeLinkCurtain() // signed in: signing out later shows the site, not the « parrainage » curtain again
  }, [me])

  // Signed in: the address is the user's referral link (/r/<code>), so copying it from the address bar shares a
  // link that opens the site (not the blurred « sur parrainage » page), whatever page they are on.
  useEffect(() => {
    if (!me || me.demo || !inviteOnly) return
    api.myInvite().then(
      ({ code }) => {
        const url = new URL(window.location.href)
        // With the trailing slash, like the shared link (see /api/invite): its WhatsApp preview is the current one.
        if (url.pathname === `/r/${code}/` && !url.searchParams.has('i')) return
        url.searchParams.delete('i')
        history.replaceState(history.state, '', `/r/${code}/` + url.search + url.hash)
      },
      () => {},
    )
  }, [me, inviteOnly])

  // Signed out (expired cookie, other tab): the data kept for this tab goes too.
  useEffect(() => {
    if (me === null) setData(null)
  }, [me, setData])

  useEffect(() => {
    early.current = api.overview().catch(() => null) // not signed in: nothing, the usual flow follows
    api.me().then(setMe, () => setMe(null))
    api.config().then(
      (c) => {
        setHosted(c.hosted)
        setInviteOnly(!!c.inviteOnly)
        setInterrupted(!!c.interrupted)
      },
      () => {},
    )
    const code = captureInvite()
    if (!code) setInvited('no')
    else
      api.inviteCheck(code).then(
        (r) => {
          if (!r.valid) forgetInvite()
          // The link itself just opened (not a reload): counted for the admin, anonymously.
          if (r.valid && openedFromLink()) startLinkTrack(linkSource(), deviceKind())
          else resumeLinkTrack()
          setInvited(r.valid ? 'yes' : 'invalid')
        },
        () => setInvited('no'),
      )
  }, [])

  // A page left open across an update keeps running the old app: reload it once a new version is online.
  useEffect(() => {
    const mine = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.split('/assets/')[1]
    if (!mine) return // dev server
    const check = () =>
      api.config().then(
        (c) => {
          setInterrupted(!!c.interrupted) // checked every minute: the banner comes and goes without a reload
          if (!c.build || c.build === mine) return
          try {
            if (sessionStorage.getItem('pbb-build') === c.build) return // already reloaded for it: no loop
            sessionStorage.setItem('pbb-build', c.build)
          } catch {
            return
          }
          window.location.reload()
        },
        () => {},
      )
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    const id = setInterval(check, 60_000) // a new version is online within a minute, no hard refresh needed
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    shown.current = !!data
  }, [data])

  const refresh = useCallback(async () => {
    const first = early.current
    early.current = null
    if (first) {
      const ready = await first
      if (ready) {
        setData(ready)
        setLoadError(null)
        return
      }
    }
    try {
      setData(
        await api.overview().catch(async (e) => {
          // Requests sent together may renew the PayByPhone login at the same time and one be refused: once more,
          // with the cookie the other one brought back, before asking to log in again.
          if (!(e instanceof ApiError && e.status === 401)) throw e
          await new Promise((r) => setTimeout(r, 1500))
          return api.overview()
        }),
      )
      setLoadError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null)
      else {
        // Nothing shown yet: the loading screen says it and offers to retry; otherwise a toast is enough.
        const message = (e as Error).message || 'Impossible de charger votre compte.'
        setLoadError(message)
        if (shown.current) toast.error(message)
      }
    }
  }, [])

  // A renewal whose payment is under way (on, no error, not paused, no ticket yet): its result is looked for every
  // 5 seconds for 3 minutes, then every minute as usual.
  const renewing = !!data?.autopilots.some((ap) => {
    const now = Date.now()
    const from = ap.pausedFrom ? new Date(ap.pausedFrom).getTime() : null
    const until = ap.pausedUntil ? new Date(ap.pausedUntil).getTime() : null
    const paused = from !== null && from <= now && (until === null || now < until)
    const key = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
    const covered = data.sessions.some((s) => key(s.plate) === key(ap.plate) && new Date(s.expire).getTime() > now)
    return ap.enabled && !ap.lastError && !paused && !covered
  })

  useEffect(() => {
    if (!me) return
    refresh()
  }, [me, refresh])

  useEffect(() => {
    if (!me) return
    // A tab in the background asks nothing: each refresh costs PayByBot 3 calls to PayByPhone, and hundreds of tabs
    // left open would add up (the dashboard refreshes anyway as soon as the tab is back in front).
    const tick = () => (document.visibilityState === 'visible' ? refresh() : undefined)
    if (!renewing) {
      const id = setInterval(tick, 60_000)
      return () => clearInterval(id)
    }
    let left = 36
    const id = setInterval(() => (left-- > 0 ? tick() : undefined), 5_000)
    const slow = setInterval(tick, 60_000)
    return () => {
      clearInterval(id)
      clearInterval(slow)
    }
  }, [me, refresh, renewing])

  async function logout() {
    await api.logout().catch(() => {})
    setData(null)
    setOnboarding(false)
    forgetZoneLookup()
    setMe(null)
  }

  // Development only: « Mon abonnement » with a made-up subscription (#/apercu-abonnement).
  if (import.meta.env.DEV && window.location.hash === '#/apercu-abonnement') {
    const fake = {
      plan: 'monthly', amount: 990, status: 'active', nextBilling: '2026-11-22T12:00:00Z', cancelAtPeriodEnd: false,
      card: { brand: 'mastercard', last4: '4242', expMonth: 7, expYear: 2031 },
      invoices: [{ date: '2026-10-22T12:00:00Z', amount: 990, status: 'paid', url: null }],
    }
    const real = window.fetch
    window.fetch = (input, init) =>
      String(input).includes('/api/billing/subscription') || String(input).includes('/api/billing/cancel')
        ? Promise.resolve(new Response(JSON.stringify({ ...fake, cancelAtPeriodEnd: String(input).includes('cancel') }), { headers: { 'content-type': 'application/json' } }))
        : real(input, init)
    return (
      <Suspense fallback={null}>
        <SubscriptionDialog onClose={() => (window.location.hash = '#/')} />
      </Suspense>
    )
  }
  // Development only: the screen shown after Stripe Checkout, without paying (#/apercu-paiement).
  if (import.meta.env.DEV && window.location.hash === '#/apercu-paiement')
    return (
      <>
        <img src="/how/3-tableau-de-bord.png" alt="" className="fixed inset-0 size-full object-cover object-top" />
        <CheckoutDone vehicle={{ plate: 'AB-123-CD', type: 'Car', zone: '75005' }} onClose={() => (window.location.hash = '#/')} />
      </>
    )

  return (
    <Suspense fallback={<Loading />}>
      <Toaster />
      <CoverageHost />
      {interrupted && me && route !== 'admin' && <ServiceBanner />}
      {/* Opened through a valid private link: « sur parrainage » first, then the screen lifts on the site. */}
      {inviteOnly && !me && invited === 'yes' && openedFromLink() && <InviteCurtain />}
      {!['/', '/index.html'].includes(window.location.pathname) && !/^\/r\/[0-9A-Za-z_-]{1,40}\/?$/.test(window.location.pathname) ? (
        <NotFoundPage hosted={hosted} />
      ) : legal ? (
        legal === 'securite' ? <SecurityPage hosted={hosted} signedIn={!!me} /> : <LegalView page={legal} hosted={hosted} signedIn={!!me} />
      ) : route === 'valider' ? (
        <ValidatePayment />
      ) : me === undefined || (inviteOnly && !me && invited === null) ? (
        <Loading />
      ) : inviteOnly && !me && invited !== 'yes' && route !== 'admin' && route !== 'connexion' && (!isMember() || route === 'inscription') ? (
        // Not invited: the home page, blurred, asks for an e-mail to send the link to. Signing in is always open (an
        // account already exists; the server only refuses a sign-up without a link), signing up needs a link. The
        // admin page has its own login: never gated.
        <InviteGate hosted={hosted} invalid={invited === 'invalid'} />
      ) : route === 'admin' ? (
        <AdminPage signedIn={!!me} />
      ) : route === 'tarifs' ? (
        // Public too (« Tarifs » in the top bar); signed in, the account's own price.
        <PricingPage hosted={hosted} signedIn={!!me} />
      ) : route === 'faq' ? (
        <FaqView hosted={hosted} signedIn={!!me} />
      ) : route === 'comment-ca-marche' ? (
        <HowPage hosted={hosted} signedIn={!!me} />
      ) : route === 'qui-sommes-nous' ? (
        <AboutPage hosted={hosted} signedIn={!!me} />
      ) : me === null ? (
        route === 'connexion' || route === 'inscription' ? (
          <LoginView
            signup={route === 'inscription'}
            hosted={hosted}
            onLogin={(m) => {
              forgetZoneLookup()
              if (route === 'inscription') {
                trackLinkStep('inscrit')
                setOnboarding(true)
                setZoneReady(false)
                // Long enough to read the message, even when PayByPhone answers fast.
                Promise.all([api.residentZone(), new Promise((r) => setTimeout(r, 2500))]).finally(() => setZoneReady(true))
              }
              history.replaceState(null, '', window.location.pathname + window.location.search)
              setRoute(null)
              setMe(m)
            }}
          />
        ) : (
          <Home hosted={hosted} />
        )
      ) : (onboarding && (!data || !zoneReady)) || !data ? (
        <Loading
          label={onboarding ? <>Récupération de vos paramètres <PayByPhone />…</> : <>Chargement de votre compte <PayByPhone />…</>}
          error={loadError}
          onLogout={logout}
          onRetry={() => {
            setLoadError(null)
            refresh()
          }}
        />
      ) : onboarding ? (
        <Welcome
          me={me}
          data={data}
          onRefresh={refresh}
          onContinue={() => {
            setOnboarding(false)
            setAutoRenew(true)
          }}
        />
      ) : (
        <>
          <Dashboard
            onDeleted={() => {
              history.replaceState(null, '', window.location.pathname + window.location.search)
              setRoute(null)
              setData(null)
              setOnboarding(false)
              forgetZoneLookup()
              setMe(null)
            }}
            me={me}
            autoRenew={autoRenew}
            data={data}
            onRefresh={refresh}
            onPay={() => setPaying(true)}
            onLogout={logout}
          />
          {paying && data && (
            <PayWizard
              data={data}
              demo={me.demo}
              onRefresh={refresh}
              onClose={() => setPaying(false)}
              onPaid={() => {
                setPaying(false)
                refresh()
              }}
            />
          )}
        </>
      )}
    </Suspense>
  )
}
