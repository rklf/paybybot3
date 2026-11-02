import { useEffect, useMemo, useState } from 'react'
import { arrondissement, Plate } from '@/components/signs'
import { ChevronDown, Loader2, X } from 'lucide-react'
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
        renewal?: 'Actif' | 'Suspendu' | null
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

/** A running total over time (a step up at each event), from the first one to now, refreshed live. */
function StepChart({ times, unit }: { times: string[]; unit: string }) {
  const opens = times.map((t) => new Date(t).getTime()).sort((a, b) => a - b)
  const now = Date.now()
  const start = opens.length ? Math.min(opens[0], now - 3600_000) : now - 86_400_000
  const W = 600
  const H = 140
  const x = (t: number) => ((t - start) / Math.max(1, now - start)) * W
  const y = (v: number) => H - (v / Math.max(1, opens.length)) * (H - 12) - 2
  // A staircase: flat until each open, then one step up.
  let d = `M0,${y(0)}`
  opens.forEach((t, i) => (d += ` L${x(t).toFixed(1)},${y(i).toFixed(1)} L${x(t).toFixed(1)},${y(i + 1).toFixed(1)}`))
  d += ` L${W},${y(opens.length).toFixed(1)}`
  const label = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mt-3 rounded-2xl border border-ink/10 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-heading text-3xl font-semibold tabular-nums text-ink">{opens.length}</span>
        <span className="flex items-center gap-2 text-sm text-ink/50">
          <span className="size-2 animate-pulse rounded-full bg-[#16a34a]" aria-hidden /> {unit} · en direct
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-36 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="var(--eu)" opacity=".08" />
        <path d={d} fill="none" stroke="var(--eu)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-ink/45 tabular-nums">
        <span>{label(start)}</span>
        <span>maintenant</span>
      </div>
    </div>
  )
}

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €'
const ends = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', 'h')

/** Time left on a ticket: « 2 j 4 h », « 3 h 20 min », « 12 min »; null once it has ended. */
function left(iso: string, now: number) {
  const m = Math.floor((new Date(iso).getTime() - now) / 60000)
  if (m <= 0) return null
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d} j ${h} h` : h ? `${h} h ${m % 60} min` : `${m % 60} min`
}

/** One row per vehicle (or per client when PayByPhone could not be read). */
type Row = {
  plate: string | null
  resident: string
  covered: 'Oui' | 'Non' | '—'
  renewal: 'Actif' | 'Suspendu' | 'Aucun' | '—'
  name: string
  email: string
  created: string
  /** The plan chosen (kept after it stops), « — » when none was ever chosen. */
  offer: 'Annuel' | 'Mensuel' | '—'
  /** Whether the subscription is running now (Stripe), trial month included. */
  active: 'Actif' | 'Inactif'
  origin: 'Parrainage' | 'Sans parrainage' | '—'
  price: string
  ticket: 'En cours' | 'Aucun' | 'Illisible'
  expire: string | null
  left: string | null
  /** The end dates of the client's cards. */
  card: string
  cardState: CardState
  /** ok: subscribed and covered; alert: subscribed and no time left (a real problem); none: no offer running. */
  status: 'ok' | 'alert' | 'none'
}

const CARD_SOON = 60 * 86_400_000
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

const STATUS_TEXT = { ok: 'OK', alert: 'Problème', none: 'Non suivi' } as const
const COLUMNS: { key: keyof Row; label: string; choices?: string[] }[] = [
  { key: 'plate', label: 'Véhicule' },
  { key: 'resident', label: 'Résident' },
  { key: 'covered', label: 'Couvert', choices: ['Oui', 'Non'] },
  { key: 'renewal', label: 'Renouvellement', choices: ['Actif', 'Suspendu', 'Aucun'] },
  { key: 'name', label: 'Client' },
  { key: 'email', label: 'E-mail' },
  { key: 'created', label: 'Inscrit le' },
  { key: 'origin', label: 'Origine', choices: ['Parrainage', 'Sans parrainage', '—'] },
  { key: 'offer', label: 'Offre', choices: ['Annuel', 'Mensuel', '—'] },
  { key: 'active', label: 'Statut de l’offre', choices: ['Actif', 'Inactif'] },
  { key: 'ticket', label: 'Ticket', choices: ['En cours', 'Aucun', 'Illisible'] },
  { key: 'left', label: 'Expire' },
  { key: 'cardState', label: 'Carte', choices: ['Expirée', 'Bientôt', 'OK', 'Date inconnue', 'Aucune', 'Illisible'] },
  { key: 'status', label: 'État', choices: ['OK', 'Problème', 'Non suivi'] },
]

function rowsOf(clients: AdminClient[], now: number): Row[] {
  return clients.flatMap((c) => {
    const base = {
      name: c.name || '—',
      email: c.email || '—',
      created: new Date(c.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
      offer: (c.plan === 'yearly' ? 'Annuel' : c.plan === 'monthly' || c.subscribed ? 'Mensuel' : '—') as Row['offer'],
      active: (c.subscribed ? 'Actif' : 'Inactif') as Row['active'],
      origin: (c.origin === 'sans_parrainage' ? 'Sans parrainage' : c.origin === 'parrainage' ? 'Parrainage' : '—') as Row['origin'],
      price: c.price != null ? `${euros(c.price)} / ${c.plan === 'yearly' ? 'an' : 'mois'}` : '',
      card: (c.cards ?? []).map((x) => x.exp ?? '?').join(', '),
      cardState: cardState(c.cards, now),
    }
    if (c.vehicles === null) return [{ ...base, plate: null, resident: '—', covered: '—', renewal: '—', ticket: 'Illisible', expire: null, left: null, status: c.subscribed ? 'alert' : 'none' } as Row]
    return c.vehicles.map((v) => {
      const rest = v.expire ? left(v.expire, now) : null
      return {
        ...base,
        plate: v.plate,
        resident: v.resident ? (arrondissement(v.resident) ?? `Zone ${v.resident}`) : v.resident === false ? 'Non' : 'Inconnu',
        covered: v.covered ? 'Oui' : 'Non',
        renewal: v.renewal ?? 'Aucun',
        ticket: rest ? 'En cours' : 'Aucun',
        expire: rest ? v.expire : null,
        left: rest,
        status: !c.subscribed ? 'none' : rest ? 'ok' : 'alert',
      } as Row
    })
  })
}

/** The text a column is filtered on. */
const cell = (r: Row, key: keyof Row) => (key === 'status' ? STATUS_TEXT[r.status] : key === 'left' ? (r.expire ? `${ends(r.expire)} ${r.left}` : '') : String(r[key] ?? ''))

function VehicleTable({ clients }: { clients: AdminClient[] }) {
  const [filters, setFilters] = useState<Partial<Record<keyof Row, string>>>({})
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  // Problems first, then covered vehicles, then those without an offer; cards ending first within each.
  const rows = useMemo(() => {
    const order = { alert: 0, ok: 1, none: 2 }
    const urgent = (r: Row) => (r.cardState === 'Expirée' ? 0 : r.cardState === 'Bientôt' ? 1 : 2)
    return rowsOf(clients, now).sort((a, b) => order[a.status] - order[b.status] || urgent(a) - urgent(b))
  }, [clients, now])
  const shown = rows.filter((r) =>
    COLUMNS.every(({ key, choices }) => {
      const f = filters[key]
      if (!f) return true
      return choices ? cell(r, key) === f : cell(r, key).toLowerCase().includes(f.toLowerCase())
    }),
  )
  const alerts = rows.filter((r) => r.status === 'alert').length
  const vehicles = rows.filter((r) => r.plate).length
  // One client can have several vehicles: counted once.
  const cardsIn = (state: CardState) => clients.filter((c) => cardState(c.cards, now) === state).length
  const expiredCards = cardsIn('Expirée')
  const soonCards = cardsIn('Bientôt')
  const field = 'mt-2 h-8 w-full min-w-0 rounded-lg border border-ink/10 bg-white px-2 text-xs font-normal text-ink outline-none focus:border-eu'

  return (
    <>
      <p className="mt-2 text-sm text-ink/55">
        {vehicles} véhicule{vehicles > 1 ? 's' : ''}
        {alerts > 0 && <span className="font-semibold text-destructive"> · {alerts} sans ticket alors que l’abonnement est actif</span>}
        {expiredCards > 0 && <span className="font-semibold text-destructive"> · {expiredCards} client{expiredCards > 1 ? 's' : ''} avec carte expirée</span>}
        {soonCards > 0 && <span className="font-semibold text-[#9a6700]"> · {soonCards} carte{soonCards > 1 ? 's' : ''} à renouveler sous 60 jours</span>}
        {shown.length !== rows.length && <> · {shown.length} ligne{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''}</>}
      </p>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-ink/10 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink/[0.03] align-top text-ink/55">
            <tr>
              {COLUMNS.map(({ key, label, choices }) => (
                <th key={key} className={`px-3 py-3 font-medium ${choices ? 'min-w-[7.5rem]' : ''}`}>
                  {/* One line per title: every filter box sits at the same height. */}
                  <span className="block whitespace-nowrap">{label}</span>
                  {choices ? (
                    <select value={filters[key] ?? ''} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} className={field} aria-label={`Filtrer : ${label}`}>
                      <option value="">Tous</option>
                      {choices.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={filters[key] ?? ''} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} placeholder="Filtrer" className={field} aria-label={`Filtrer : ${label}`} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={`border-t border-ink/10 ${r.status === 'alert' ? 'bg-destructive/[0.04]' : ''}`}>
                <td className="px-3 py-3 whitespace-nowrap">{r.plate ? <Plate plate={r.plate} size="sm" /> : <span className="text-ink/40">—</span>}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink/70">{r.resident}</td>
                <td className={cn('px-3 py-3', r.covered === 'Non' ? 'text-ink/45' : 'text-ink/70')}>{r.covered}</td>
                <td className={cn('px-3 py-3', r.renewal === 'Suspendu' ? 'font-semibold text-[#741b11]' : r.renewal === 'Actif' ? 'text-[#14703a]' : 'text-ink/45')}>
                  {r.renewal}
                </td>
                <td className="px-3 py-3 font-semibold text-ink">{r.name}</td>
                <td className="px-3 py-3 text-ink/70">{r.email}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink/70 tabular-nums">{r.created}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {r.origin === 'Sans parrainage' ? (
                    <span className="rounded-full bg-eu/[0.08] px-2 py-0.5 text-xs font-semibold text-eu">Sans parrainage</span>
                  ) : (
                    <span className="text-ink/60">{r.origin}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="text-ink">{r.offer}</span>
                  {r.price && <span className="mt-0.5 block text-xs whitespace-nowrap text-ink/60 tabular-nums">{r.price}</span>}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.active === 'Actif' ? 'bg-[#e7f6ec] text-[#14703a]' : 'bg-ink/[0.06] text-ink/60'}`}
                  >
                    {r.active}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {r.ticket === 'En cours' ? (
                    <span className="text-[#14703a]">En cours</span>
                  ) : r.ticket === 'Aucun' ? (
                    <span className="text-ink/50">Aucun</span>
                  ) : (
                    <span className="text-ink/40">PayByPhone illisible</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {r.expire ? (
                    <>
                      <span className="text-ink">{ends(r.expire)}</span>
                      <span className="block text-xs text-ink/55">reste {r.left}</span>
                    </>
                  ) : (
                    <span className="text-ink/40">—</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {r.card ? <span className="text-ink">{r.card}</span> : <span className="text-ink/40">—</span>}
                  {r.cardState === 'Expirée' && <span className="block text-xs font-semibold text-destructive">Expirée</span>}
                  {r.cardState === 'Bientôt' && <span className="block text-xs font-semibold text-[#9a6700]">Bientôt</span>}
                  {(r.cardState === 'Illisible' || r.cardState === 'Date inconnue') && <span className="block text-xs text-ink/50">{r.cardState}</span>}
                </td>
                <td className="px-3 py-3">
                  <span
                    title={STATUS_TEXT[r.status]}
                    className={`grid size-6 place-items-center rounded-full text-xs font-bold text-white ${
                      r.status === 'ok' ? 'bg-[#1f9d55]' : r.status === 'alert' ? 'bg-destructive' : 'bg-ink/15'
                    }`}
                  >
                    {r.status === 'ok' ? '✓' : r.status === 'alert' ? '!' : ''}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-ink/50">
                  Aucun véhicule ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function AdminPage(_: { signedIn?: boolean }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [activity, setActivity] = useState<AdminActivity[] | null>(null)

  // The owner's own visits of the private link (this device) are not shown.
  function setOwnActivity(rows: AdminActivity[]) {
    const mine = ownVisitor()
    setActivity(mine ? rows.filter((r) => r.visitor !== mine) : rows)
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

  // « Activité » and the link-opens curve stay live: looked at again every 30 seconds.
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

  if (needsLogin) {
    return (
      <div className="min-h-dvh bg-background">
        <TopBar />
        <AdminLoginForm onDone={load} />
      </div>
    )
  }


  return (
    <div className="min-h-dvh bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 pt-12 pb-20">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-heading text-[2.4rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink">Admin</h1>
          {stats && (
            <button onClick={logout} className={ui.pillGray}>
              Se déconnecter
            </button>
          )}
        </div>
        {error ? (
          <p className="mt-6 rounded-xl bg-destructive/8 px-4 py-3 text-destructive">{error}</p>
        ) : !stats ? (
          <Loader2 className="mt-8 size-6 animate-spin text-ink/40" />
        ) : (
          <>
            <ServicePanel />

            <h2 className="mt-12 text-sm font-semibold text-ink/55">Clients{clients ? ` (${clients.length})` : ''}</h2>
            {clients && clients.length === 0 && <p className="mt-3 text-ink/50">Aucun client pour l’instant.</p>}
            {clients && clients.length > 0 && <VehicleTable clients={clients} />}

            <h2 className="mt-12 text-sm font-semibold text-ink/55">Liens privés ouverts</h2>
            {activity ? (
              <StepChart
                times={byPerson(activity.filter((r) => r.event === LINK_OPENED)).map((g) => g[g.length - 1].at)}
                unit="visiteurs uniques"
              />
            ) : (
              <div className="mt-3 h-52 animate-pulse rounded-2xl bg-ink/[0.04]" />
            )}

            {/* Sign-ups from the accounts themselves (all of them), paid subscriptions from « Activité ». */}
            <h2 className="mt-12 text-sm font-semibold text-ink/55">Inscriptions</h2>
            {clients ? (
              <StepChart times={clients.map((c) => c.created)} unit="inscriptions" />
            ) : (
              <div className="mt-3 h-52 animate-pulse rounded-2xl bg-ink/[0.04]" />
            )}

            <h2 className="mt-12 text-sm font-semibold text-ink/55">Abonnements payants</h2>
            {activity ? (
              <StepChart times={activity.filter((r) => r.event === 'Abonnement souscrit').map((r) => r.at)} unit="abonnements" />
            ) : (
              <div className="mt-3 h-52 animate-pulse rounded-2xl bg-ink/[0.04]" />
            )}

            <h2 className="mt-12 text-sm font-semibold text-ink/55">Activité{activity ? ` (${byPerson(activity).length})` : ''}</h2>
            {!activity ? (
              <Loader2 className="mt-3 size-5 animate-spin text-ink/40" />
            ) : (
              <ActivityList rows={activity} onDelete={removeActivity} />
            )}
          </>
        )}
      </main>
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

/** One action as a line: what, who, details, when, and a cross to delete it. */
function ActivityLine({ r, now, onDelete, extra }: { r: AdminActivity; now: number; onDelete: (id?: number) => void; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3 text-sm">
      <span className="min-w-0">
        <span className="font-semibold text-ink">{r.event}</span>
        {r.who && <span className="text-ink/70"> · {r.who}</span>}
        {extra}
        {r.detail && <span className="block text-xs text-ink/55">{r.detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-xs whitespace-nowrap text-ink/50 tabular-nums" title={new Date(r.at).toLocaleString('fr-FR')}>
          {ago(r.at, now)} · {ends(r.at)}
        </span>
        {r.id != null && (
          <button
            onClick={() => onDelete(r.id!)}
            aria-label="Supprimer cette activité"
            title="Supprimer"
            className="grid size-6 place-items-center rounded-md text-ink/30 transition hover:bg-ink/[0.05] hover:text-destructive"
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
      className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs font-medium text-ink/70 transition hover:bg-ink/[0.1]"
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
        <ul className="divide-y divide-ink/5 border-t border-ink/5 bg-ink/[0.02] pl-4">
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
  if (!rows.length) return <p className="mt-3 text-ink/50">Aucune activité pour l’instant.</p>
  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Filtrer l’activité"
          className="h-9 rounded-lg border border-ink/10 bg-white px-2 text-sm text-ink outline-none focus:border-eu"
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
          className={confirmAll ? 'text-sm font-semibold text-destructive' : cn('text-sm', ui.link)}
        >
          {confirmAll ? 'Confirmer : tout effacer' : 'Tout effacer'}
        </button>
      </div>
      <ul className="mt-3 max-h-[32rem] divide-y divide-ink/10 overflow-y-auto rounded-2xl border border-ink/10 bg-white">
        {byPerson(shown).map((g) => (
          <PersonRow key={`${g[0].event}${g[0].id ?? g[0].at}`} rows={g} now={now} onDelete={onDelete} />
        ))}
      </ul>
    </>
  )
}
