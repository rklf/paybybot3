import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { arrondissement, Plate, Wordmark } from '@/components/signs'
import { Activity, ArrowUpRight, CalendarClock, Check, ChevronDown, ChevronRight, LayoutGrid, ListChecks, Loader2, LogOut, Search, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { ApiError } from '@/lib/api'
import { TopBar } from '@/components/TopBar'
import { api } from '@/lib/api'
import { useTurnstile } from '@/lib/turnstile'
import { markOwnerDevice, ownVisitor } from '@/lib/linkTrack'

/** PayByBot's interruption state (PayByPhone not answering), as the admin sees it. */
export type ServiceState = {
  failures?: number
  interrupted_at?: string | null
  notified_at?: string | null
  recipients?: number
  sent?: number
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })

/** The interruption, in one card: its state and the owner's three actions. The customers' e-mail is never sent
 *  on its own: the owner confirms it here. */
function ServicePanel() {
  const [state, setState] = useState<ServiceState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.adminService().then(setState, (e) => setError((e as Error).message))
  }, [])
  async function act(action: 'interrupt' | 'notify' | 'resume', question: string) {
    if (!window.confirm(question)) return
    setBusy(action)
    setError(null)
    try {
      const next = await api.adminServiceAction(action)
      setState((s) => ({ ...s, ...next }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const on = !!state?.interrupted_at
  // Only while PayByBot is interrupted: nothing to see or do otherwise (the detection is automatic).
  if (!on && !error) return null
  const n = state?.recipients ?? 0
  return (
    <section className={`mt-8 rounded-2xl border p-5 ${on ? 'border-[#741b11]/30 bg-[#741b11]/[0.04]' : 'border-ink/10 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-heading text-lg font-medium text-ink">
            {on ? 'Service interrompu' : 'Service normal'}
          </p>
          <p className="mt-1 text-sm text-ink/55">
            {on
              ? `Depuis le ${when(state!.interrupted_at!)} · bannière affichée · ${
                  state?.notified_at ? `clients prévenus le ${when(state.notified_at)}` : 'clients pas encore prévenus'
                }`
              : `PayByPhone répond. ${state?.failures ? `${state.failures} échec(s) d’affilée en cours.` : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!on && (
            <button
              disabled={!!busy}
              onClick={() => act('interrupt', 'Afficher la bannière d’interruption à tous les utilisateurs ?')}
              className={ui.pillGray}
            >
              Interrompre le service
            </button>
          )}
          {on && !state?.notified_at && (
            <button
              disabled={!!busy || !n}
              onClick={() => act('notify', `Envoyer l’e-mail « ne comptez plus sur PayByBot » à ${n} client(s) ?`)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#741b11] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'notify' && <Loader2 className="size-4 animate-spin" />} Prévenir les {n} client(s) par e-mail
            </button>
          )}
          {on && (
            <button
              disabled={!!busy}
              onClick={() =>
                act(
                  'resume',
                  state?.notified_at
                    ? `Rétablir le service et écrire à ${n} client(s) que PayByBot fonctionne de nouveau ?`
                    : 'Rétablir le service (bannière retirée, aucun e-mail) ?',
                )
              }
              className={ui.pillGray}
            >
              {busy === 'resume' && <Loader2 className="size-4 animate-spin" />} Rétablir le service
            </button>
          )}
        </div>
      </div>
      {state?.sent ? <p className="mt-3 text-sm text-ink/60">{state.sent} e-mail(s) envoyé(s).</p> : null}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}

export type AdminStats = {
  accounts: number
  accounts_7d: number
  accounts_30d: number
  renewals: number
  renewals_active: number
  renewals_paused: number
  renewals_error: number
  paid_7d: number
  signups_by_day: { day: string; count: number }[]
}

/** The owner's page: a few counts, nothing else. */
export type AdminClient = {
  name: string | null
  email: string | null
  created: string
  plan: string | null
  subscribed: boolean
  /** The end of the free month (null: never started); a subscriber pays from then on. */
  trialEnd?: string | null
  /** The subscription in cents, per month (monthly) or per year (yearly). */
  price: number | null
  /** Each vehicle on PayByPhone with its running ticket's end (null: none); null if PayByPhone could not be read. */
  vehicles:
    | {
        plate: string
        expire: string | null
        /** Its resident arrondissement; false: PayByPhone gives it none; null: never looked up. */
        resident?: string | false | null
        /** In the subscription (ticked, or with a renewal). */
        covered?: boolean
        /** Its automations: on, stopped by a failure, or turned off. */
        renewal?: 'Actif' | 'Suspendu' | 'Désactivé' | null
        /** The last failure of one of its PayByBot automations (renewal or programmed ticket), still standing. */
        failure?: string | null
      }[]
    | null
  /** When each of the client's cards ends (MM/AA); null if PayByPhone could not be read. */
  cards: { exp: string | null; validUntil: string | null; expired?: boolean }[] | null
  renewals: number
  /** How the account came: through a user's link, or the link asked by e-mail (none for accounts before). */
  origin?: 'parrainage' | 'sans_parrainage' | null
}

/** One user action (sign-up, sign-in, renewal…), for « Activité ». */
export type AdminActivity = {
  id: number | null
  at: string
  event: string
  who: string | null
  detail: string | null
  /** Random id of the device that opened the private link (none before it was sent). */
  visitor?: string | null
}

const LINK_OPENED = 'Lien privé ouvert'

/** Who a row belongs to: one visitor for the link (its device id; before ids, its device and city), one account
 *  for the other actions; a row with neither stands alone. */
function personOf(r: AdminActivity, i: number) {
  if (r.event === LINK_OPENED) {
    if (r.visitor) return `v:${r.visitor}`
    const parts = (r.detail ?? '').split(' · ')
    const at = parts.findIndex((p) => /, [A-Z]{2}$/.test(p))
    return at > 0 ? `old:${parts[at - 1]}|${parts[at]}` : `row:${i}`
  }
  return r.who ? `${r.event}|${r.who}` : `row:${i}`
}

/** The rows of each person together, newest first (rows come newest first). */
function byPerson(rows: AdminActivity[]) {
  const groups = new Map<string, AdminActivity[]>()
  rows.forEach((r, i) => {
    const key = personOf(r, i)
    groups.set(key, [...(groups.get(key) ?? []), r])
  })
  return [...groups.values()]
}

const DAY = 86_400_000
const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €'
const ends = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', 'h')
const day = (iso: string | number) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`

/** Time left on a ticket: « 2 j 4 h », « 3 h 20 min », « 12 min »; null once it has ended. */
function left(iso: string, now: number) {
  const m = Math.floor((new Date(iso).getTime() - now) / 60000)
  if (m <= 0) return null
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d} j ${h} h` : h ? `${h} h ${m % 60} min` : `${m % 60} min`
}

const inFreeMonth = (c: AdminClient, now: number) => c.subscribed && !!c.trialEnd && new Date(c.trialEnd).getTime() > now
/** What a client brings each month (an old yearly one for a twelfth), 0 while in the free month or without one. */
const monthlyOf = (c: AdminClient, now: number) =>
  !c.subscribed || inFreeMonth(c, now) || c.price == null ? 0 : c.plan === 'yearly' ? c.price / 12 : c.price
/** When a client started paying: the end of the free month (or the sign-up for accounts before it). */
const payingSince = (c: AdminClient) => new Date(c.trialEnd ?? c.created).getTime()

/** A running total at the end of each of the last `days` days. */
function cumulative(times: number[], now: number, days = 30, weight: (i: number) => number = () => 1) {
  const points: { t: number; v: number }[] = []
  for (let d = days - 1; d >= 0; d--) {
    const t = d === 0 ? now : now - d * DAY
    points.push({ t, v: times.reduce((n, x, i) => (x <= t ? n + weight(i) : n), 0) })
  }
  return points
}

// ————————————————————————————————————————————— charts

type Point = { t: number; v: number }

/** A smooth line through the points (monotone enough for running totals: never dips below them). */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const cx = (x0 + x1) / 2
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`
  }
  return d
}

/** The small curve of a figure card. */
function Spark({ points }: { points: Point[] }) {
  const W = 120
  const H = 36
  const max = Math.max(1, ...points.map((p) => p.v))
  const min = Math.min(...points.map((p) => p.v))
  const xy = points.map((p, i) => [(i / Math.max(1, points.length - 1)) * W, H - 3 - ((p.v - min) / Math.max(1, max - min)) * (H - 6)] as [number, number])
  const line = smooth(xy)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-20 shrink-0 overflow-visible 2xl:w-28" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--eu)" stopOpacity=".16" />
          <stop offset="1" stopColor="var(--eu)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#spark)" />
      <path d={line} fill="none" stroke="var(--eu)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  )
}

/** The main curve: the last 30 days, a crosshair and the day's figure under the pointer. */
function GrowthChart({ points, format }: { points: Point[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720
  const H = 220
  const max = Math.max(1, ...points.map((p) => p.v)) * 1.12
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W
  const y = (v: number) => H - (v / max) * H
  const xy = points.map((p, i) => [x(i), y(p.v)] as [number, number])
  const line = smooth(xy)
  const at = hover ?? points.length - 1
  const ticks = [0, 0.5, 1].map((f) => Math.round((max / 1.12) * f))
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between pb-7 text-[11px] text-ink/35 tabular-nums">
        {[...ticks].reverse().map((v, i) => (
          <span key={i}>{format(v)}</span>
        ))}
      </div>
      <div
        className="relative ml-14"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))))
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="growth" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--eu)" stopOpacity=".18" />
              <stop offset="1" stopColor="var(--eu)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={H - f * (H / 1.12)} y2={H - f * (H / 1.12)} stroke="currentColor" className="text-ink/[0.07]" vectorEffect="non-scaling-stroke" strokeDasharray={f ? '3 4' : undefined} />
          ))}
          <motion.path initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} d={`${line} L${W},${H} L0,${H} Z`} fill="url(#growth)" />
          <motion.path
            key={line}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            d={line}
            fill="none"
            stroke="var(--eu)"
            strokeWidth="2.25"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hover != null && <line x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="var(--eu)" strokeOpacity=".25" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-eu shadow-[0_0_0_4px_rgb(29_78_163/0.15)]"
          style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(points[at].v) / H) * 224}px` }}
        />
        {hover != null && (
          <span
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
            style={{ left: `${Math.min(92, Math.max(8, (x(at) / W) * 100))}%` }}
          >
            <span className="text-white/60">{day(points[at].t)} · </span>
            <span className="font-semibold tabular-nums">{format(points[at].v)}</span>
          </span>
        )}
        <div className="mt-2 flex justify-between text-[11px] text-ink/40 tabular-nums">
          <span>{day(points[0].t)}</span>
          <span>{day(points[Math.floor(points.length / 2)].t)}</span>
          <span>aujourd’hui</span>
        </div>
      </div>
    </div>
  )
}

// ————————————————————————————————————————————— building blocks

const card = 'rounded-2xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgb(17_17_17/0.04),0_8px_24px_-12px_rgb(17_17_17/0.08)]'

/** One card of the page, in the page's entrance (each one a little after the one before). */
function Card({ i = 0, className, children, id }: { i?: number; className?: string; children: React.ReactNode; id?: string }) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
      className={cn(card, className)}
    >
      {children}
    </motion.section>
  )
}

function CardHead({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div>
        <h2 className="text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {note && <p className="mt-0.5 text-sm text-ink/50">{note}</p>}
      </div>
      {children}
    </div>
  )
}

/** A gain over 7 days, as a small green (or grey) chip. */
function Delta({ n, format = String }: { n: number; format?: (v: number) => string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', n > 0 ? 'bg-go/[0.09] text-go' : 'bg-ink/[0.05] text-ink/45')}>
      {n > 0 ? <ArrowUpRight className="size-3" /> : null}
      {n > 0 ? '+' : ''}
      {format(n)}
    </span>
  )
}

function Kpi({ i, label, value, delta, deltaFormat, note, points }: { i: number; label: string; value: string; delta: number; deltaFormat?: (v: number) => string; note: string; points: Point[] }) {
  return (
    <Card i={i} className="p-5">
      <p className="text-sm text-ink/55">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-heading text-[1.85rem] leading-none font-semibold tracking-[-0.03em] whitespace-nowrap text-ink tabular-nums">{value}</p>
        <Spark points={points} />
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-ink/45">
        <Delta n={delta} format={deltaFormat} /> {note}
      </p>
    </Card>
  )
}

/** Two to four choices side by side, the chosen one raised. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-[10px] bg-ink/[0.05] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn('relative h-8 rounded-[8px] px-3 text-sm font-medium whitespace-nowrap transition', value === v ? 'text-ink' : 'text-ink/50 hover:text-ink/80')}
        >
          {value === v && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(17_17_17/0.08),0_0_0_1px_rgb(17_17_17/0.04)]" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />}
          <span className="relative">{text}</span>
        </button>
      ))}
    </div>
  )
}

// ————————————————————————————————————————————— overview

const DEVICES = ['iPhone', 'iPad', 'Android', 'Tablette Android', 'Ordinateur']
/** A user's link sent from the « Partager » panel (or opened in a messaging app): one line in the summary. */
const SHARED = ['WhatsApp', 'SMS', 'E-mail', 'Telegram', 'Lien copié', 'Partage', 'Facebook / Messenger']

/** Visitors of the private link by where their first visit came from (the detail's first part). */
function sourcesOf(visitors: AdminActivity[][]) {
  const counts = new Map<string, number>()
  for (const g of visitors) {
    const first = (g[g.length - 1].detail ?? '').split(' · ')[0].trim()
    const source =
      !first || DEVICES.includes(first) ? 'Non renseigné' // rows from before sources were kept
      : first === 'paybybot.fr' ? 'Direct' // older rows: from the site itself, now counted as « Direct »
      : SHARED.includes(first) ? 'Partage de lien' // the way it was shared stays in « Activité »
      : first
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  if (!counts.has('Carte de visite')) counts.set('Carte de visite', 0) // always shown: the business cards' QR code
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || (a[0] === 'Carte de visite' ? -1 : 1))
  // The four biggest, the rest in one « Autres » line.
  const rest = sorted.slice(4).reduce((n, [, c]) => n + c, 0)
  return sorted.length > 5 ? [...sorted.slice(0, 4), ['Autres', rest] as [string, number]] : sorted
}

type Metric = 'mrr' | 'subscribers' | 'signups' | 'visitors'

function Overview({ visitors, clients, activity }: { visitors: AdminActivity[][]; clients: AdminClient[]; activity: AdminActivity[] }) {
  const [metric, setMetric] = useState<Metric>('mrr')
  const now = Date.now()
  const week = now - 7 * DAY
  const visitTimes = visitors.map((g) => new Date(g[g.length - 1].at).getTime())
  const signupTimes = clients.map((c) => new Date(c.created).getTime())
  const subscribers = clients.filter((c) => c.subscribed)
  const subTimes = activity.filter((r) => r.event === 'Abonnement souscrit').map((r) => new Date(r.at).getTime())
  const paying = subscribers.filter((c) => monthlyOf(c, now) > 0)
  const mrr = paying.reduce((n, c) => n + monthlyOf(c, now), 0)
  const series: Record<Metric, Point[]> = {
    mrr: cumulative(paying.map(payingSince), now, 30, (i) => monthlyOf(paying[i], now)),
    subscribers: cumulative(subTimes, now),
    signups: cumulative(signupTimes, now),
    visitors: cumulative(visitTimes, now),
  }
  const gained = (pts: Point[]) => pts[pts.length - 1].v - (pts[pts.length - 8]?.v ?? 0)
  const inTrial = subscribers.filter((c) => inFreeMonth(c, now)).length
  const money = (v: number) => euros(Math.round(v))
  const short = (v: number) => (v >= 100000 ? `${Math.round(v / 100)} €` : euros(Math.round(v)).replace(',00', ''))

  // Visitors → sign-ups → subscribers → paying: each step with its share of the step before.
  const funnel: [string, number][] = [
    ['Visiteurs', visitors.length],
    ['Inscrits', clients.length],
    ['Abonnés', subscribers.length],
    ['Payants', paying.length],
  ]
  const sources = sourcesOf(visitors)
  const recentSignups = clients.filter((c) => new Date(c.created).getTime() > week).length

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi i={0} label="Revenu mensuel récurrent" value={money(mrr)} delta={gained(series.mrr)} deltaFormat={short} note={`${plural(paying.length, 'abonné payant', 'abonnés payants')}`} points={series.mrr} />
        <Kpi i={1} label="Abonnés" value={String(subscribers.length)} delta={gained(series.subscribers)} note={inTrial ? `dont ${inTrial} au mois offert` : 'en 7 jours'} points={series.subscribers} />
        <Kpi i={2} label="Inscrits" value={String(clients.length)} delta={recentSignups} note="en 7 jours" points={series.signups} />
        <Kpi i={3} label="Visiteurs uniques" value={String(visitors.length)} delta={gained(series.visitors)} note="en 7 jours" points={series.visitors} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card i={4} className="pb-5">
          <CardHead title="Croissance" note="30 derniers jours">
            <Segmented
              label="Courbe"
              value={metric}
              onChange={setMetric}
              options={[
                ['mrr', 'Revenu'],
                ['subscribers', 'Abonnés'],
                ['signups', 'Inscrits'],
                ['visitors', 'Visiteurs'],
              ]}
            />
          </CardHead>
          <div className="mt-6 px-5 sm:px-6">
            <GrowthChart points={series[metric]} format={metric === 'mrr' ? short : (v) => String(Math.round(v))} />
          </div>
        </Card>

        <Card i={5} className="flex flex-col pb-5">
          <CardHead title="Conversion" note="Du premier lien au premier paiement" />
          <ol className="mt-5 space-y-3.5 px-5 sm:px-6">
            {funnel.map(([label, n], i) => {
              const before = i ? funnel[i - 1][1] : n
              return (
                <li key={label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink/70">{label}</span>
                    <span className="flex items-baseline gap-2">
                      {i > 0 && <span className="text-xs text-ink/40 tabular-nums">{before ? Math.round((n / before) * 100) : 0} %</span>}
                      <span className="font-semibold text-ink tabular-nums">{n}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(n / Math.max(1, funnel[0][1])) * 100}%` }}
                      transition={{ duration: 0.8, delay: 0.25 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full rounded-full bg-eu"
                      style={{ opacity: 1 - i * 0.18 }}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
          <h3 className="mx-5 mt-6 border-t border-ink/[0.07] pt-5 text-sm font-semibold text-ink sm:mx-6">D’où viennent les visiteurs</h3>
          <ul className="mt-3 space-y-2 px-5 text-sm sm:px-6">
            {sources.map(([source, n]) => (
              <li key={source} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink/70">{source}</span>
                <span className="flex items-center gap-2.5">
                  <span className="text-xs text-ink/40 tabular-nums">{visitors.length ? Math.round((n / visitors.length) * 100) : 0} %</span>
                  <span className="w-6 text-right font-semibold text-ink tabular-nums">{n}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

// ————————————————————————————————————————————— to do and upcoming payments

const CARD_SOON = 60 * DAY
type CardState = 'Expirée' | 'Bientôt' | 'OK' | 'Date inconnue' | 'Aucune' | 'Illisible'

/** A client is safe while one card still works: judged on the card ending last. */
function cardState(cards: AdminClient['cards'], now: number): CardState {
  if (!cards) return 'Illisible'
  if (!cards.length) return 'Aucune'
  const valid = cards.filter((c) => !c.expired)
  if (!valid.length) return 'Expirée'
  if (valid.some((c) => !c.validUntil)) return 'Date inconnue'
  return Math.max(...valid.map((c) => new Date(c.validUntil!).getTime())) - now <= CARD_SOON ? 'Bientôt' : 'OK'
}

/** What needs the owner, worst first; each line opens the clients it is about. */
function Todo({ rows, onShow }: { rows: Row[]; onShow: (names: string[]) => void }) {
  const failed = rows.filter((r) => r.status === 'alert')
  const firstFailure = failed.flatMap((r) => r.vehicles ?? []).find((v) => v.failure)?.failure
  const expired = rows.filter((r) => r.cardState === 'Expirée')
  const soon = rows.filter((r) => r.cardState === 'Bientôt')
  const items: { tone: 'red' | 'amber'; text: string; hint: string; rows: Row[] }[] = [
    { tone: 'red' as const, text: `${plural(failed.length, 'client')} avec un échec PayByBot`, hint: firstFailure ?? 'Renouvellement ou ticket programmé', rows: failed },
    { tone: 'red' as const, text: `${plural(expired.length, 'client')} avec carte expirée`, hint: 'Plus de paiement possible', rows: expired },
    { tone: 'amber' as const, text: `${plural(soon.length, 'carte')} à renouveler sous 60 jours`, hint: 'Rappel envoyé à 30 et 7 jours', rows: soon },
  ].filter((x) => x.rows.length)
  return (
    <Card className="pb-2">
      <CardHead title="À traiter" note={items.length ? undefined : 'Rien à faire pour l’instant.'}>
        {items.length > 0 && <span className="rounded-full bg-destructive/[0.08] px-2 py-0.5 text-xs font-semibold text-destructive tabular-nums">{items.length}</span>}
      </CardHead>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 pt-4 pb-4 text-sm text-ink/60 sm:px-6">
          <span className="grid size-8 place-items-center rounded-full bg-go/[0.09] text-go">
            <Check className="size-4" />
          </span>
          Aucun échec PayByBot, aucune carte à surveiller.
        </div>
      ) : (
        <ul className="mt-3">
          {items.map((x) => (
            <li key={x.text}>
              <button
                onClick={() => onShow(x.rows.map((r) => r.email))}
                className="group flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-ink/[0.025] sm:px-6"
              >
                <span className={cn('size-2 shrink-0 rounded-full', x.tone === 'red' ? 'bg-destructive' : 'bg-amber')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{x.text}</span>
                  <span className="block truncate text-xs text-ink/45">
                    {x.hint} · {x.rows.slice(0, 3).map((r) => r.name).join(', ')}
                    {x.rows.length > 3 ? '…' : ''}
                  </span>
                </span>
                <ChevronRight className="size-4 text-ink/25 transition group-hover:translate-x-0.5 group-hover:text-ink/50" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** The free months ending in the next 30 days: the first payments to come. */
function Upcoming({ clients, onShow }: { clients: AdminClient[]; onShow: (names: string[]) => void }) {
  const now = Date.now()
  const next = clients
    .filter((c) => inFreeMonth(c, now) && new Date(c.trialEnd!).getTime() - now < 30 * DAY)
    .sort((a, b) => a.trialEnd!.localeCompare(b.trialEnd!))
  const total = next.reduce((n, c) => n + (c.price ?? 0), 0)
  return (
    <Card className="pb-2">
      <CardHead title="Premiers prélèvements" note={next.length ? `${euros(total)} attendus sous 30 jours` : 'Aucun mois offert en cours.'} />
      <ul className="mt-3">
        {next.slice(0, 5).map((c) => {
          const days = Math.ceil((new Date(c.trialEnd!).getTime() - now) / DAY)
          return (
            <li key={c.email ?? c.created}>
              <button onClick={() => onShow([c.email || '—'])} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-ink/[0.025] sm:px-6">
                <Avatar name={c.name || c.email || '?'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{c.name || c.email}</span>
                  <span className="block text-xs text-ink/45">le {day(c.trialEnd!)}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold text-ink tabular-nums">{c.price != null ? euros(c.price) : '—'}</span>
                  <span className="block text-xs text-ink/45 tabular-nums">dans {plural(days, 'jour')}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ————————————————————————————————————————————— clients

/** One vehicle of a client, as its line in the « Véhicules » cell. */
type VehicleLine = {
  plate: string
  resident: string
  renewal: 'Actif' | 'Suspendu' | 'Désactivé' | 'Aucun'
  expire: string | null
  left: string | null
  /** What went wrong with a renewal or a programmed ticket taken by PayByBot (a car without a ticket is not a problem). */
  failure: string | null
  alert: boolean
}

/** One row per client: one subscription covers all of the account's vehicles. */
type Row = {
  name: string
  email: string
  created: string
  createdAt: number
  origin: 'Parrainage' | 'Sans parrainage' | '—'
  /** Paying, in the free month, stopped after having one, or never taken. */
  sub: 'Payant' | 'Mois offert' | 'Arrêté' | 'Sans abonnement'
  /** Under the subscription: its price, or the end of the free month. */
  subNote: string
  /** Null when PayByPhone could not be read. */
  vehicles: VehicleLine[] | null
  card: string
  cardState: CardState
  /** alert: a PayByBot automation failed; ok: subscribed, nothing failed; none: no subscription. */
  status: 'ok' | 'alert' | 'none'
}

function rowsOf(clients: AdminClient[], now: number): Row[] {
  return clients.map((c) => {
    const free = inFreeMonth(c, now)
    const sub: Row['sub'] = !c.subscribed ? (c.plan ? 'Arrêté' : 'Sans abonnement') : free ? 'Mois offert' : 'Payant'
    const vehicles =
      c.vehicles?.map((v) => {
        const rest = v.expire ? left(v.expire, now) : null
        return {
          plate: v.plate,
          resident: v.resident ? (arrondissement(v.resident) ?? `Zone ${v.resident}`) : v.resident === false ? 'Non résident' : 'Zone inconnue',
          renewal: v.renewal ?? 'Aucun',
          expire: rest ? v.expire : null,
          left: rest,
          failure: v.failure ?? null,
          alert: !!v.failure,
        } as VehicleLine
      }) ?? null
    return {
      name: c.name || '—',
      email: c.email || '—',
      created: new Date(c.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
      createdAt: new Date(c.created).getTime(),
      origin: c.origin === 'sans_parrainage' ? 'Sans parrainage' : c.origin === 'parrainage' ? 'Parrainage' : '—',
      sub,
      subNote:
        sub === 'Mois offert' ? `jusqu’au ${day(c.trialEnd!)}`
        : sub === 'Payant' && c.price != null ? `${euros(c.price)} / ${c.plan === 'yearly' ? 'an (ancien annuel)' : 'mois'}`
        : '',
      vehicles,
      card: (c.cards ?? []).map((x) => x.exp ?? '?').join(', '),
      cardState: cardState(c.cards, now),
      status: vehicles?.some((v) => v.alert) ? 'alert' : c.subscribed ? 'ok' : 'none',
    }
  })
}

const SUB_STYLE: Record<Row['sub'], string> = {
  Payant: 'bg-go/[0.09] text-go',
  'Mois offert': 'bg-eu/[0.08] text-eu',
  Arrêté: 'bg-destructive/[0.08] text-[#741b11]',
  'Sans abonnement': 'bg-ink/[0.05] text-ink/55',
}

/** Initials in a quiet circle, the same tint for the same person. */
function Avatar({ name }: { name: string }) {
  const letters = name.replace(/@.*/, '').split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  const hues = ['bg-eu/[0.09] text-eu', 'bg-go/[0.1] text-go', 'bg-amber/[0.18] text-[#7a5b00]', 'bg-ink/[0.06] text-ink/70']
  const tint = hues[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % hues.length]
  return <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold', tint)}>{letters}</span>
}

type Segment = 'all' | 'paying' | 'trial' | 'problems' | 'none'

function ClientTable({ rows, focus, onClearFocus }: { rows: Row[]; focus: string[] | null; onClearFocus: () => void }) {
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState<Segment>('all')
  const [cardFilter, setCardFilter] = useState('')
  // Problems first, then paying clients, the free month, then the others; cards ending first within each.
  const sorted = useMemo(() => {
    const order = { alert: 0, ok: 1, none: 2 }
    const subOrder = { Payant: 0, 'Mois offert': 1, Arrêté: 2, 'Sans abonnement': 3 }
    const urgent = (r: Row) => (r.cardState === 'Expirée' ? 0 : r.cardState === 'Bientôt' ? 1 : 2)
    return [...rows].sort((a, b) => order[a.status] - order[b.status] || subOrder[a.sub] - subOrder[b.sub] || urgent(a) - urgent(b) || b.createdAt - a.createdAt)
  }, [rows])
  const inSegment = (r: Row, s: Segment) =>
    s === 'all' ||
    (s === 'paying' && r.sub === 'Payant') ||
    (s === 'trial' && r.sub === 'Mois offert') ||
    (s === 'problems' && (r.status === 'alert' || r.cardState === 'Expirée' || r.cardState === 'Bientôt')) ||
    (s === 'none' && (r.sub === 'Arrêté' || r.sub === 'Sans abonnement'))
  const text = (r: Row) =>
    `${r.name} ${r.email} ${(r.vehicles ?? []).map((v) => `${v.plate} ${v.plate.replace(/[^0-9A-Z]/gi, '')} ${v.resident}`).join(' ')}`.toLowerCase()
  const shown = sorted.filter(
    (r) =>
      (!focus || focus.includes(r.email)) &&
      inSegment(r, segment) &&
      (!cardFilter || r.cardState === cardFilter) &&
      (!query || text(r).includes(query.trim().toLowerCase())),
  )
  const count = (s: Segment) => rows.filter((r) => inSegment(r, s)).length
  const vehicles = rows.reduce((n, r) => n + (r.vehicles?.length ?? 0), 0)

  return (
    <Card className="overflow-hidden">
      <CardHead title="Clients" note={`${plural(rows.length, 'compte')} · ${plural(vehicles, 'véhicule')}`}>
        <Segmented
          label="Segment"
          value={segment}
          onChange={(s) => {
            setSegment(s)
            onClearFocus()
          }}
          options={[
            ['all', `Tous ${rows.length}`],
            ['paying', `Payants ${count('paying')}`],
            ['trial', `Mois offert ${count('trial')}`],
            ['problems', `À traiter ${count('problems')}`],
            ['none', `Sans abonnement ${count('none')}`],
          ]}
        />
      </CardHead>
      <div className="mt-4 flex flex-wrap items-center gap-2 px-5 sm:px-6">
        <label className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, e-mail, plaque ou arrondissement"
            aria-label="Rechercher un client"
            className="h-10 w-full rounded-[10px] border border-ink/10 bg-white pr-3 pl-9 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-eu focus:ring-3 focus:ring-eu/10"
          />
        </label>
        <select
          value={cardFilter}
          onChange={(e) => setCardFilter(e.target.value)}
          aria-label="Filtrer : Carte"
          className="h-10 rounded-[10px] border border-ink/10 bg-white px-3 text-sm text-ink outline-none focus:border-eu"
        >
          <option value="">Toutes les cartes</option>
          {['Expirée', 'Bientôt', 'OK', 'Date inconnue', 'Aucune', 'Illisible'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {focus && (
          <button onClick={onClearFocus} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-eu/[0.08] px-3 text-sm font-medium text-eu transition hover:bg-eu/[0.12]">
            {plural(focus.length, 'client choisi', 'clients choisis')} <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto border-t border-ink/[0.07]">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink/45">
            <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium [&>th:first-child]:pl-5 sm:[&>th:first-child]:pl-6 [&>th:last-child]:pr-5 sm:[&>th:last-child]:pr-6">
              <th>Client</th>
              <th>Abonnement</th>
              <th className="min-w-[19rem]">Véhicules</th>
              <th>Carte</th>
              <th>Arrivée</th>
              <th className="text-right">État</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.email + r.createdAt}
                className={cn(
                  'border-t border-ink/[0.06] align-top transition-colors hover:bg-ink/[0.015] [&>td]:px-3 [&>td]:py-3.5 [&>td:first-child]:pl-5 sm:[&>td:first-child]:pl-6 [&>td:last-child]:pr-5 sm:[&>td:last-child]:pr-6',
                  r.status === 'alert' && 'bg-destructive/[0.025] hover:bg-destructive/[0.04]',
                )}
              >
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name !== '—' ? r.name : r.email} />
                    <span className="min-w-0">
                      <span className="block font-semibold whitespace-nowrap text-ink">{r.name}</span>
                      <span className="block text-xs text-ink/50">{r.email}</span>
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', SUB_STYLE[r.sub])}>{r.sub}</span>
                  {r.subNote && <span className="mt-1.5 block text-xs text-ink/50 tabular-nums">{r.subNote}</span>}
                </td>
                <td className="!py-2">
                  {r.vehicles === null ? (
                    <span className="mt-1.5 block text-ink/40">PayByPhone illisible</span>
                  ) : r.vehicles.length === 0 ? (
                    <span className="mt-1.5 block text-ink/40">Aucun véhicule</span>
                  ) : (
                    <ul className="divide-y divide-ink/[0.05]">
                      {r.vehicles.map((v) => (
                        <li key={v.plate} className="flex items-start gap-3 py-1.5">
                          <Plate plate={v.plate} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs text-ink/55">
                              {v.resident} ·{' '}
                              <span className={cn(v.renewal === 'Suspendu' ? 'font-semibold text-[#741b11]' : v.renewal === 'Actif' ? 'text-go' : 'text-ink/40')}>
                                {v.renewal === 'Aucun' ? 'pas de renouvellement' : `renouvellement ${v.renewal.toLowerCase()}`}
                              </span>
                            </span>
                            {v.expire ? (
                              <span className="block text-xs whitespace-nowrap text-ink tabular-nums">
                                Ticket jusqu’au {ends(v.expire)} <span className="text-ink/45">· reste {v.left}</span>
                              </span>
                            ) : (
                              <span className="block text-xs text-ink/40">Aucun ticket</span>
                            )}
                            {v.failure && (
                              <span className="mt-0.5 block max-w-[26rem] text-xs font-semibold text-destructive" title={v.failure}>
                                Échec : <span className="font-normal">{v.failure}</span>
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {r.card ? <span className="text-ink">{r.card}</span> : <span className="text-ink/35">—</span>}
                  {r.cardState === 'Expirée' && <span className="mt-0.5 block text-xs font-semibold text-destructive">Expirée</span>}
                  {r.cardState === 'Bientôt' && <span className="mt-0.5 block text-xs font-semibold text-[#9a6700]">Bientôt</span>}
                  {(r.cardState === 'Illisible' || r.cardState === 'Date inconnue') && <span className="mt-0.5 block text-xs text-ink/45">{r.cardState}</span>}
                </td>
                <td className="whitespace-nowrap">
                  <span className="block text-ink/70 tabular-nums">{r.created}</span>
                  {r.origin === 'Sans parrainage' ? (
                    <span className="mt-1 inline-block rounded-md bg-eu/[0.08] px-1.5 py-0.5 text-xs font-semibold text-eu">Sans parrainage</span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-ink/45">{r.origin === '—' ? 'Origine inconnue' : r.origin}</span>
                  )}
                </td>
                <td className="text-right">
                  <span
                    title={r.status === 'ok' ? 'OK' : r.status === 'alert' ? 'Problème' : 'Non suivi'}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
                      r.status === 'ok' ? 'bg-go/[0.09] text-go' : r.status === 'alert' ? 'bg-destructive/[0.09] text-destructive' : 'bg-ink/[0.05] text-ink/45',
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', r.status === 'ok' ? 'bg-go' : r.status === 'alert' ? 'bg-destructive' : 'bg-ink/30')} />
                    {r.status === 'ok' ? 'OK' : r.status === 'alert' ? 'Problème' : 'Non suivi'}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-ink/45">
                  Aucun client ne correspond.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ————————————————————————————————————————————— page

const NAV = [
  ['overview', 'Vue d’ensemble', LayoutGrid],
  ['todo', 'À traiter', ListChecks],
  ['upcoming', 'Premiers prélèvements', CalendarClock],
  ['clients', 'Clients', Users],
  ['activity', 'Activité', Activity],
] as const
type View = (typeof NAV)[number][0]

/** The lines of « À traiter » that have someone in them (the same three checks as the card). */
const todoLines = (rows: Row[]) =>
  [
    rows.some((r) => r.status === 'alert'),
    rows.some((r) => r.cardState === 'Expirée'),
    rows.some((r) => r.cardState === 'Bientôt'),
  ].filter(Boolean).length

export function AdminPage(_: { signedIn?: boolean }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [activity, setActivity] = useState<AdminActivity[] | null>(null)
  const [focus, setFocus] = useState<string[] | null>(null)
  // One section at a time, picked in « Pilotage ».
  const [view, setView] = useState<View>('overview')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // The owner's own visits of the private link (this device) are not shown.
  function setOwnActivity(rows: AdminActivity[]) {
    const mine = ownVisitor()
    // Nor the link opens tagged « Test » (a manual try, not a visitor).
    const test = (r: AdminActivity) => r.event === LINK_OPENED && (r.detail ?? '').split(' · ')[0].trim() === 'Test'
    setActivity(rows.filter((r) => !test(r) && (!mine || r.visitor !== mine)))
  }

  function load() {
    setError(null)
    api.adminStats().then(
      (s) => {
        markOwnerDevice()
        setStats(s)
        setNeedsLogin(false)
        api.adminClients().then(setClients, () => setClients([]))
        api.adminActivity().then(setOwnActivity, () => setActivity([]))
      },
      (e) => {
        if (e instanceof ApiError && e.status === 401) setNeedsLogin(true)
        else setError((e as Error).message)
      },
    )
  }

  useEffect(load, [])

  // « Activité » and the curves stay live: looked at again every 30 seconds.
  useEffect(() => {
    if (!stats) return
    const id = setInterval(() => api.adminActivity().then(setOwnActivity, () => {}), 30_000)
    return () => clearInterval(id)
  }, [stats])

  async function removeActivity(id?: number) {
    setActivity((rows) => (rows ? (id == null ? [] : rows.filter((r) => r.id !== id)) : rows))
    await api.adminActivityDelete(id).catch(() => {})
    api.adminActivity().then(setOwnActivity, () => {})
  }

  async function logout() {
    await api.adminLogout().catch(() => {})
    setStats(null)
    setNeedsLogin(true)
  }

  const rows = useMemo(() => (clients ? rowsOf(clients, now) : []), [clients, now])
  const open = (v: View) => {
    setView(v)
    setFocus(null)
    window.scrollTo({ top: 0 })
  }
  // A line of « À traiter » or « Premiers prélèvements »: the clients it is about, in « Clients ».
  const show = (emails: string[]) => {
    setView('clients')
    setFocus(emails)
    window.scrollTo({ top: 0 })
  }
  const badge: Partial<Record<View, number>> = clients
    ? { todo: todoLines(rows), upcoming: clients.filter((c) => inFreeMonth(c, now) && new Date(c.trialEnd!).getTime() - now < 30 * DAY).length, clients: clients.length }
    : {}

  if (needsLogin) {
    return (
      <div className="min-h-dvh bg-background">
        <TopBar />
        <AdminLoginForm onDone={load} />
      </div>
    )
  }

  const today = new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })
  const ready = stats && clients && activity

  return (
    <div className="min-h-dvh bg-[#f6f6f4] lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-ink/[0.07] bg-white px-4 py-5 lg:flex">
        <a href="#/" aria-label="PayByBot, accueil" className="px-2">
          <Wordmark />
        </a>
        <p className="mt-8 px-2 text-[11px] font-semibold tracking-[0.08em] text-ink/35 uppercase">Pilotage</p>
        <nav className="mt-2 space-y-0.5" aria-label="Sections">
          {NAV.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => open(id)}
              aria-current={view === id ? 'page' : undefined}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition',
                view === id ? 'bg-ink/[0.06] text-ink' : 'text-ink/60 hover:bg-ink/[0.04] hover:text-ink',
              )}
            >
              <Icon className={cn('size-4', view === id ? 'text-eu' : 'text-ink/40')} />
              <span className="flex-1 text-left whitespace-nowrap">{label}</span>
              {!!badge[id] && (
                <span className={cn('rounded-md px-1.5 text-xs font-semibold tabular-nums', id === 'todo' ? 'bg-destructive/[0.09] text-destructive' : 'text-ink/40')}>{badge[id]}</span>
              )}
            </button>
          ))}
        </nav>
        {stats && (
          <button onClick={logout} className="mt-auto flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-ink/55 transition hover:bg-ink/[0.04] hover:text-ink">
            <LogOut className="size-4 text-ink/40" /> Se déconnecter
          </button>
        )}
      </aside>

      <div className="min-w-0">
        {/* Small screens: the site's bar, the sidebar's actions in it. */}
        <TopBar className="lg:hidden">
          {stats && (
            <button onClick={logout} className={ui.pillGray}>
              Se déconnecter
            </button>
          )}
        </TopBar>
        {/* Small screens: « Pilotage » as a row of tabs under the bar. */}
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-ink/[0.07] bg-white/70 px-4 py-2 lg:hidden">
          {NAV.map(([id, label]) => (
            <button
              key={id}
              onClick={() => open(id)}
              aria-current={view === id ? 'page' : undefined}
              className={cn('h-9 shrink-0 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition', view === id ? 'bg-ink/[0.06] text-ink' : 'text-ink/55')}
            >
              {label}
              {!!badge[id] && <span className={cn('ml-1.5 text-xs font-semibold tabular-nums', id === 'todo' ? 'text-destructive' : 'text-ink/40')}>{badge[id]}</span>}
            </button>
          ))}
        </nav>
        <main className="mx-auto max-w-[84rem] scroll-mt-6 px-4 pt-8 pb-20 sm:px-8 lg:pt-10">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-ink/45 first-letter:uppercase">{today}</p>
            </div>
            {clients && (
              <p className="text-sm text-ink/50">
                PayByBot · <span className="font-semibold text-ink tabular-nums">9,50 €</span> par mois et par compte, tous véhicules compris
              </p>
            )}
          </header>

          {error ? (
            <p className="mt-6 rounded-xl bg-destructive/8 px-4 py-3 text-destructive">{error}</p>
          ) : !ready ? (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-2xl bg-ink/[0.04]" />
              ))}
              <div className="h-80 animate-pulse rounded-2xl bg-ink/[0.04] sm:col-span-2 xl:col-span-4" />
            </div>
          ) : (
            <div key={view} className="mt-8 space-y-4">
              <ServicePanel />
              {view === 'overview' && <Overview visitors={byPerson(activity.filter((r) => r.event === LINK_OPENED))} clients={clients} activity={activity} />}
              {view === 'todo' && <Todo rows={rows} onShow={show} />}
              {view === 'upcoming' && <Upcoming clients={clients} onShow={show} />}
              {view === 'clients' &&
                (clients.length === 0 ? (
                  <Card className="p-6 text-ink/50">Aucun client pour l’instant.</Card>
                ) : (
                  <ClientTable rows={rows} focus={focus} onClearFocus={() => setFocus(null)} />
                ))}
              {view === 'activity' && (
                <Card className="pb-2">
                  <ActivityList rows={activity} onDelete={removeActivity} />
                </Card>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function AdminLoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const human = useTurnstile()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.adminLogin(email.trim(), password, await human.token())
      setPassword('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex justify-center px-6 pt-[12vh] pb-12">
      <form
        className="w-full max-w-[24rem]"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h1 className="font-heading text-[2.2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink">Admin</h1>
        <div className="mt-8 space-y-3">
          <input
            type="email"
            autoComplete="username"
            placeholder="E-mail"
            aria-label="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={ui.field}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Mot de passe"
            aria-label="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={ui.field}
          />
        </div>
        {/* The place of Cloudflare's box kept from the start: nothing moves when it shows up. */}
        {human.enabled && <div ref={human.box} className="mt-4 h-[65px]" />}
        {(error || human.failed) && <p className={`mt-4 ${ui.error}`}>{error || human.failed}</p>}
        <button type="submit" disabled={busy} className={`mt-6 ${ui.primary}`}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : 'Se connecter'}
        </button>
      </form>
    </main>
  )
}

/** « 5 min », « 3 h », « 2 j »: how long ago. */
function ago(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`
}

/** The dot of an action in the timeline: green for money in, red for a problem, blue otherwise. */
const dotOf = (event: string) =>
  /souscrit|Paiement|Avance/i.test(event) ? 'bg-go' : /suspendu|échec|refus|Erreur|impayé/i.test(event) ? 'bg-destructive' : event === LINK_OPENED ? 'bg-ink/25' : 'bg-eu'

/** One action as a line: what, who, details, when, and a cross to delete it. */
function ActivityLine({ r, now, onDelete, extra }: { r: AdminActivity; now: number; onDelete: (id?: number) => void; extra?: React.ReactNode }) {
  return (
    <div className="group flex items-start gap-3 px-5 py-3 text-sm sm:px-6">
      <span className={cn('mt-[0.45rem] size-2 shrink-0 rounded-full ring-4 ring-white', dotOf(r.event))} />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">{r.event}</span>
        {r.who && <span className="text-ink/60"> · {r.who}</span>}
        {extra}
        {r.detail && <span className="mt-0.5 block text-xs text-ink/45">{r.detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-xs whitespace-nowrap text-ink/40 tabular-nums" title={new Date(r.at).toLocaleString('fr-FR')}>
          {ago(r.at, now)}
        </span>
        {r.id != null && (
          <button
            onClick={() => onDelete(r.id!)}
            aria-label="Supprimer cette activité"
            title="Supprimer"
            className="grid size-6 place-items-center rounded-md text-ink/25 opacity-0 transition group-hover:opacity-100 hover:bg-ink/[0.05] hover:text-destructive focus:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  )
}

/** One person: their latest action, and « 12 visites ▾ » opening the others. */
function PersonRow({ rows, now, onDelete }: { rows: AdminActivity[]; now: number; onDelete: (id?: number) => void }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 1) return <li><ActivityLine r={rows[0]} now={now} onDelete={onDelete} /></li>
  const count = (
    <button
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="ml-2 inline-flex items-center gap-0.5 rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-xs font-medium text-ink/60 transition hover:bg-ink/[0.09]"
    >
      {rows.length} {rows[0].event === LINK_OPENED ? 'visites' : 'fois'}
      <ChevronDown className={cn('size-3 transition', open && 'rotate-180')} />
    </button>
  )
  // The cross on the first line deletes all of this person's lines.
  const deleteAll = () => rows.forEach((r) => r.id != null && onDelete(r.id))
  return (
    <li>
      <ActivityLine r={rows[0]} now={now} onDelete={deleteAll} extra={count} />
      {open && (
        <ul className="bg-ink/[0.015] pl-5">
          {rows.slice(1).map((r, i) => (
            <li key={r.id ?? i}>
              <ActivityLine r={r} now={now} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** What users did lately, one line per person (newest first), with a filter by kind of action. */
function ActivityList({ rows, onDelete }: { rows: AdminActivity[]; onDelete: (id?: number) => void }) {
  const [kind, setKind] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const now = Date.now()
  const kinds = [...new Set(rows.map((r) => r.event))].sort()
  const shown = kind ? rows.filter((r) => r.event === kind) : rows
  return (
    <>
      <CardHead title="Activité" note={`${plural(byPerson(rows).length, 'personne')} · les plus récentes d’abord`}>
        {rows.length > 0 && (
          <div className="flex items-center gap-3">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              aria-label="Filtrer l’activité"
              className="h-9 rounded-[10px] border border-ink/10 bg-white px-2 text-sm text-ink outline-none focus:border-eu"
            >
              <option value="">Toutes les actions</option>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            {/* Two clicks to clear everything: the first only asks. */}
            <button
              onClick={() => {
                if (!confirmAll) return setConfirmAll(true)
                setConfirmAll(false)
                onDelete()
              }}
              onBlur={() => setConfirmAll(false)}
              className={confirmAll ? 'text-sm font-semibold text-destructive' : 'text-sm font-medium text-ink/45 transition hover:text-ink'}
            >
              {confirmAll ? 'Confirmer : tout effacer' : 'Tout effacer'}
            </button>
          </div>
        )}
      </CardHead>
      {!rows.length ? (
        <p className="px-5 py-6 text-sm text-ink/45 sm:px-6">Aucune activité pour l’instant.</p>
      ) : (
        <ul className="relative mt-2 max-h-[34rem] overflow-y-auto before:absolute before:top-4 before:bottom-4 before:left-[1.5rem] before:w-px before:bg-ink/[0.07] sm:before:left-[1.75rem]">
          {byPerson(shown).map((g) => (
            <PersonRow key={`${g[0].event}${g[0].id ?? g[0].at}`} rows={g} now={now} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </>
  )
}
