import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Pencil, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NoPayment } from '@/components/NoPayment'
import { PlansDialog } from '@/components/Pricing'
import { periodDays, periodText, RangeCalendar } from '@/components/RangeCalendar'
import { clearPending, CoveredLine, pauseState, RenewalActions, RenewalNote, savePending, when as longWhen, WEEKLY_LABEL, ZoneTag, type PendingRenewal } from '@/components/Riverain'
import { arrondissement, Plate, withPayByPhone } from '@/components/signs'
import { api, ApiError, unitLabel, type Autopilot, type Money, type Overview, type Rate, type Unit } from '@/lib/api'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { Notice } from '@/components/ui/notice'
import { hourText as hourInParis, paris as inParis, parisMs, TZ } from '@/lib/paris'
import { TimeInput } from '@/components/ui/date-time-fields'

/**
 * Tickets on precise days (visitor, Handi, pro…), for people without a resident rate or for other needs: a ticket
 * taken automatically on the chosen days at the chosen time. The server already runs these (days + start).
 */

export const DAILY_LABEL = 'Jours précis'
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
/** A Paris zone (75001 to 75020, 75116): Sundays and holidays free, visitors 6 h at most. Anywhere else PayByPhone
 *  works, every day can be chosen and PayByPhone itself says what it accepts. */
const isParis = (zone: string | null | undefined) => /^75(0\d\d|116)$/.test(zone ?? '')

/** « Du lundi au samedi », « Lundi, mercredi et vendredi ». */
function daysText(days: number[]) {
  const d = [...days].sort()
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1)
  if (d.length > 2 && d[d.length - 1] - d[0] === d.length - 1) return `Du ${DAY_NAMES[d[0]]} au ${DAY_NAMES[d[d.length - 1]]}`
  const names = d.map((i) => DAY_NAMES[i])
  return cap(names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`)
}

/** When the ticket ends: « 15 h », or « le lendemain 9 h » for a day ticket (or one running past midnight). */
function endText(start: string, duration: number, unit: Unit) {
  const minutes = unit === 'Days' ? duration * 24 * 60 : unit === 'Hours' ? duration * 60 : duration
  const [h, m] = start.split(':').map(Number)
  const days = Math.floor((h * 60 + m + minutes) / (24 * 60))
  return `${days === 1 ? 'le lendemain ' : days > 1 ? `${days} jours après, ` : ''}${hourText(start, minutes)}`
}

/** « 9 h », « 14 h 30 »: the start time, plus some minutes when given (the ticket's end). */
function hourText(start: string, plusMinutes = 0) {
  const [h, m] = start.split(':').map(Number)
  const t = (h * 60 + m + plusMinutes) % (24 * 60)
  const mm = t % 60
  return `${Math.floor(t / 60)} h${mm ? ` ${String(mm).padStart(2, '0')}` : ''}`
} // 0 = Monday … 6 = Sunday (never picked in Paris: Sundays and holidays are free)
const TEAL = 'bg-[#4e9aa0]'

// In PayByPhone's own currency (euros, pounds, dollars…), French style.
const euros = (m?: Money | null) =>
  m ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: m.currency || 'EUR' }).format(m.amount) : '—'
const keyOf = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
export const isDaily = (ap: Autopilot) => !!(ap as Autopilot & { days?: number[] }).days?.length
const daysOf = (ap: Autopilot) => (ap as Autopilot & { days?: number[] }).days ?? []
const startOf = (ap: Autopilot) => (ap as Autopilot & { start?: string | null }).start ?? '09:00'
const heavy = (r: Rate) => /lourd/i.test(r.name)
const light = (r: Rate) => /l[ée]ger/i.test(r.name)
const handi = (r: Rate) => /handi/i.test(`${r.name} ${r.type}`)

/** Tickets being taken now for a programmed ticket (asked when programming it): its card shows them coming. */
type Taking = { covered: number; total: number; busy: boolean; error?: string | null }
const taking = new Map<string, Taking>()
const autoTaken = new Set<string>() // taken by the page once already (not again on each refresh)
const takingListeners = new Set<() => void>()
function setTaking(id: string, t: Taking) {
  taking.set(id, t)
  takingListeners.forEach((f) => f())
}
function useTaking(id: string) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const f = () => redraw((n) => n + 1)
    takingListeners.add(f)
    return () => void takingListeners.delete(f)
  }, [])
  return taking.get(id)
}

/** Takes a programmed ticket's tickets now, wave after wave (PayByPhone takes up to a minute each), the dashboard
 *  refreshed after each one; then says how many were taken. The window is already closed. */
async function takeTickets(ap: Autopilot, onChanged: () => void) {
  const total = ap.locations?.length || 1
  setTaking(ap.id, { covered: 0, total, busy: true })
  let last: Taking = { covered: 0, total, busy: true }
  // While loading the user sees only the progress: a wave that takes nothing (PayByPhone slowing down) is tried
  // again after a pause, silently, a few times; what is left after that is taken by the scheduler.
  for (let i = 0, idle = 0; i < 12 && idle < 3; i++) {
    try {
      const r = await api.takeNow(ap.id)
      idle = r.covered > last.covered ? 0 : idle + 1
      last = { covered: r.covered, total: r.total, busy: true, error: r.error }
      setTaking(ap.id, last)
      onChanged()
      if (!r.more) break
    } catch {
      idle++ // a failed call: tried again, never shown
    }
    if (idle) await new Promise((done) => setTimeout(done, 4000))
  }
  setTaking(ap.id, { ...last, busy: false })
  // Only good news pops up; anything left to say stays on the card, in plain words.
  if (last.covered >= last.total) toast.success(last.total > 1 ? `Tickets pris : ${last.total} arrondissements couverts.` : 'Ticket pris.')
}

/** The first question: the vehicle's type, which says the rate. */
const KINDS: ['light' | 'heavy' | 'cmis', string, string][] = [
  ['light', 'Véhicule léger', 'Moins de 1,6 t (2 t électrique)'],
  ['heavy', 'Véhicule lourd', 'Plus de 1,6 t (2 t électrique)'],
  ['cmis', 'Carte mobilité CMI-S', 'Gratuit'], // one line, like the two others
]

/** PayByPhone does not check the card: the holder states it, kept with the ticket. */
function CmisAttest({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink/[0.03] px-4 py-3 text-sm leading-relaxed text-ink/60">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[#4e9aa0]" />
      <span>
        Je suis titulaire d’une carte mobilité inclusion mention stationnement (CMI-S) et je la place derrière le
        pare-brise. Sans elle, ce ticket gratuit ne me couvre pas.
      </span>
    </label>
  )
}

/** The 20 Paris arrondissements: a Handi ticket in Paris covers all of them by default, one free ticket in each. */
const PARIS_ZONES = Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, '0')}`)
/** Its zone in the pill, in codes as on the running-ticket card: « 75001 », « 75001-75020 » or « 75002 + 3 autres ». */
const zoneOf = (ap: Autopilot) => {
  const zones = [...(ap.locations ?? [])].sort()
  return zones.length > 1 ? (zones.length >= 20 ? '75001-75020' : `${zones[0]} + ${zones.length - 1} autre${zones.length > 2 ? "s" : ""}`) : ap.location
}
const resident = (r: Rate) => /r[ée]sident/i.test(`${r.name} ${r.type}`)


/** The next ticket of a precise-days rule (Paris ≈ the browser's time): the next chosen day at the start time. */
/** Now in Paris, whatever the device's time zone: the server takes tickets at Paris time. */
function parisNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), time: `${get('hour')}:${get('minute')}` }
}

/** The hour after this one: « 15:00 » at 14:35, the time a new ticket starts by default. */
function nextHour() {
  return `${String((parisNow().hour + 1) % 24).padStart(2, '0')}:00`
}

function nextTicket(days: number[], start: string, after?: Date | null, period?: { from?: string | null; to?: string | null }) {
  const [h, m] = start.split(':').map(Number)
  // Renewing a running ticket: not before it ends (the next one follows on from it).
  const from = Math.max(Date.now(), after ? after.getTime() - 60_000 : 0)
  const d = inParis(from) // the days and the start time are Paris ones, as the server takes them
  // Chosen on the calendar: only between the first and the last day (ISO days compare as text).
  const first = period?.from ?? null
  const last = period?.to ?? first
  for (let i = 0; i < (first ? 400 : 15); i++) {
    const t = parisMs(d.y, d.mo, d.d + i, h, m)
    const { wd, iso } = inParis(t)
    if (first && iso < first) continue
    if (last && iso > last) return null
    if (days.includes(wd) && t > from) return new Date(t)
  }
  return null
}

/** « lun. 16 nov. à 20h », at Paris time. */
export function when(t: Date) {
  const day = t.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  })
  return `${day} à ${hourInParis(t.getTime())}`
}

/** The rate's name without PayByPhone's zone suffix: « Visiteur - Véhicule léger - 75012-75020 » → « Visiteur ». */
function rateLabel(name: string) {
  const base = name.split(' - ')[0]
  return /visiteur/i.test(base) ? 'Visiteur' : base
}

/** One automatic ticket on precise days, in the style of the ticket card. */
/** Every day there is paid parking: Monday to Saturday in Paris (Sundays free), all week elsewhere. */
const everyDay = (ap: Autopilot) => {
  const d = daysOf(ap)
  return isParis(ap.location) ? [0, 1, 2, 3, 4, 5].every((x) => d.includes(x)) : d.length === 7
}

/** Chosen on the calendar: the rule's first and last day (ISO), else null. */
const periodOf = (ap: Autopilot) => {
  const p = ap as Autopilot & { dateFrom?: string | null; dateTo?: string | null }
  return p.dateFrom ? { from: p.dateFrom, to: p.dateTo ?? p.dateFrom } : null
}

/** How long a ticket of the rule lasts, in ms (a day ticket counted as a day). */
const ruleLength = (ap: Autopilot) =>
  Number(ap.duration) * (ap.unit === 'Minutes' ? 60_000 : ap.unit === 'Hours' ? 3_600_000 : 86_400_000)

/** Where a programmed ticket stands, said in a word (no on/off switch: it is not a control). */
export function ruleState(ap: Autopilot, now = Date.now()) {
  const period = periodOf(ap)
  const next = ap.enabled ? nextTicket(daysOf(ap), startOf(ap), null, period ?? undefined) : null
  const last = ap.lastPayment ? new Date(ap.lastPayment) : null
  const running = !!last && last.getTime() + ruleLength(ap) > now
  // Today's ticket being taken right now (its window started, not paid yet: the scheduler is on it).
  const [h, m] = startOf(ap).split(':').map(Number)
  const today = inParis(now) // today and its start time in Paris, as the server takes tickets
  const startToday = new Date(parisMs(today.y, today.mo, today.d, h, m))
  const todayIso = today.iso
  const dueToday =
    ap.enabled &&
    daysOf(ap).includes(today.wd) &&
    !(isParis(ap.location) && today.wd === 6) &&
    (!period || (period.from <= todayIso && todayIso <= period.to)) &&
    startToday.getTime() <= now &&
    now < startToday.getTime() + ruleLength(ap) &&
    !(last && last >= startToday)
  // Chosen on the calendar with nothing more to take: done (once its last ticket has ended). Same rule as the
  // server's rule_over().
  const finished = !!period && !next && !running && !dueToday
  const { paused } = pauseState(ap)
  const state = !ap.enabled ? 'stopped' : finished ? 'finished' : running ? 'running' : paused ? 'paused' : 'planned'
  return { period, next: next ?? (dueToday ? startToday : null), last, running, finished, state } as const
}

function DailyCard({ ap, data, onChanged, needsOffer }: { ap: Autopilot; data: Overview; onChanged: () => void; needsOffer: boolean }) {
  const now = useTaking(ap.id) // its tickets being taken now (asked when programming it)
  const { period, next, last, finished } = ruleState(ap)
  const single = !!period && period.from === period.to
  const [removing, setRemoving] = useState(false)
  const [editing, setEditing] = useState(false)
  // One card per car: the tickets running now in its zones are shown here, not in a card of their own.
  const zones = ap.locations?.length ? ap.locations : [ap.location]
  const live = data.sessions.filter(
    (x) => !x.stopped && keyOf(x.plate) === keyOf(ap.plate) && zones.includes(x.location) && new Date(x.expire).getTime() > Date.now(),
  )
  const failedTake = !!now && !now.busy && Math.max(now.covered, live.length) < now.total
  const liveEnd = live.length ? new Date(Math.max(...live.map((x) => new Date(x.expire).getTime()))) : null
  // The next ticket is taken when its day's window opens, or when the ticket running then ends (a day ticket
  // taken at 14 h covers until 14 h the next day: the next one is taken then, not at 5 h).
  const nextTake = next && liveEnd && liveEnd > next ? liveEnd : next
  const modify = !finished && (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink/60 transition hover:text-ink"
    >
      <Pencil className="size-3.5" /> Modifier
    </button>
  )


  async function remove() {
    setRemoving(true)
    try {
      await api.deleteAutopilot(ap.id)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
      setRemoving(false)
    }
  }

  const row = (term: string, value: string) => (
    <div className="flex justify-between gap-4">
      <dt className="text-ink/60">{term}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  )

  return (
    <article className={cn('rise overflow-hidden rounded-2xl border border-ink/10 bg-white', finished && 'opacity-80')}>
      {/* The same header as the running-ticket card: the plate, then the kind of ticket and its zone in one pill. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
        <span className="flex shrink-0">
          <Plate plate={ap.plate} size="sm" />
        </span>
        <ZoneTag zone={zoneOf(ap)} resident={false} kind={ap.cmis ? 'Carte mobilité CMI-S' : 'Non-résident'} />
      </div>
      {/* The tickets running now: how many arrondissements, and until when. */}
      {liveEnd && (
        <div className="border-t border-ink/[0.06] px-5 py-4">
          {/* As on any ticket card: until when; how many arrondissements only when some are missing (the pill says
              which zones). */}
          <CoveredLine end={liveEnd.getTime()} />
          {live.length < zones.length && (
            <p className="mt-1 text-sm text-ink/60">
              {live.length} / {zones.length} arrondissements
            </p>
          )}
        </div>
      )}
      {/* Same order as the resident card: the switch right under the header, then the details. */}
      <div className="border-t border-ink/[0.06] px-5 py-4">
        {finished ? (
          // Done: nothing to pause or stop, only to clear it away (the car is free for a new ticket).
          <button
            onClick={remove}
            disabled={removing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-ink/15 px-5 text-[0.95rem] font-medium text-ink transition hover:border-ink/40 disabled:opacity-60"
          >
            {removing ? <Loader2 className="size-4 animate-spin" /> : null} Retirer
          </button>
        ) : (
          <RenewalActions
            ap={ap}
            onChanged={onChanged}
            withPause={!single && !ap.cmis} // a CMI-S ticket is free: stopped or kept, never paused
            detail={
              ap.cmis && ap.enabled && nextTake ? (
                // As on a resident card: when the next tickets are taken.
                <span className="mt-0.5 block text-sm text-ink/60">
                  Prochain : <span className="whitespace-nowrap text-ink tabular-nums">{longWhen(nextTake.getTime())}</span>
                </span>
              ) : undefined
            }
            stopLabel={single ? 'Annuler ce ticket' : 'Arrêter ces tickets'}
            switchLabel={single ? 'Ticket programmé' : 'Renouvellement auto'}
            stoppedText={single ? 'Ticket annulé.' : 'Tickets arrêtés.'}
          />
        )}
      </div>
      {/* CMI-S: no details (one free ticket a day, all set); only the progress or a message, when there is one. */}
      {(!ap.cmis || now?.busy || failedTake || (ap.lastError && !finished)) && (
      <div className={cn('border-t border-ink/[0.06] px-5', ap.cmis ? 'py-3' : 'pt-3.5 pb-4')}>
        {!ap.cmis && (
        <>
        <div className="flex items-start justify-between gap-4">
          {/* One ticket on one day: when it is planned, or when it was taken. Several: the next one and the last. */}
          <dl className="min-w-0 flex-1 space-y-1 text-sm">
            {single ? (
              last ? row('Ticket pris', when(last)) : next ? row('Prévu', when(next)) : null
            ) : (
              <>
                {nextTake && row('Prochain ticket', when(nextTake))}
                {last && row('Dernier ticket', when(last))}
              </>
            )}
          </dl>
          {/* Zone, ticket, length, days, time, card: changed in the same steps as when it was programmed. */}
          {modify}
        </div>
        {/* The days, unless it is every day (then said in words above). */}
        {!period && !everyDay(ap) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (i === 6 && isParis(ap.location) && !daysOf(ap).includes(6) ? null :
            <span
              key={d}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-sm',
                daysOf(ap).includes(i) ? 'bg-[#4e9aa0]/15 font-medium text-[#3d7f84]' : 'bg-ink/[0.04] text-ink/45',
              )}
            >
              {d}
            </span>
          ))}
        </div>
        )}
        </>
        )}
        {finished && !single && <p className="mt-3 text-sm text-ink/60">Période terminée : plus aucun ticket ne sera pris.</p>}
        {finished && single && !last && !ap.lastError && <p className="mt-3 text-sm text-ink/60">Ce ticket n’a pas été pris.</p>}
        {failedTake && !now?.busy && !ap.lastError && (
          // Taken now, but not (all) of it: said on the card with a way to try again, never a silent spinner's end.
          <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', !ap.cmis && 'mt-3')}>
            <span className="text-destructive">{now?.error || 'Le ticket n’a pas pu être pris pour l’instant.'}</span>
            <button onClick={() => void takeTickets(ap, onChanged)} className={cn('inline-flex items-center gap-1.5', ui.link)}>
              <RotateCw className="size-3.5" /> Réessayer
            </button>
          </p>
        )}
        {now?.busy ? (
          <p className={cn('flex items-center gap-2 text-sm text-ink/60', !ap.cmis && 'mt-3')}>
            <Loader2 className="size-4 animate-spin text-[#4e9aa0]" />
            {/* The tickets already visible count as they come, before their wave's answer. */}
            {now.total > 1 ? `Prise des tickets : ${Math.max(now.covered, live.length)} / ${now.total} arrondissements` : 'Prise du ticket en cours…'}
          </p>
        ) : (
          // The error with its way out: « Valider mon paiement » when the bank waits, else « Réessayer » (which also
          // turns a suspended ticket back on).
          ap.lastError && !finished && (
            <p className={cn('text-sm', !ap.cmis && 'mt-3')}>
              <RenewalNote ap={ap} onChanged={onChanged} />
            </p>
          )
        )}
      </div>
      )}
      {editing && <DailyWizard data={data} editing={ap} onClose={() => setEditing(false)} onDone={onChanged} needsOffer={needsOffer} />}
    </article>
  )
}

/** The section of the dashboard: the precise-days tickets and the way to add one. */
export function DailyTickets({
  data,
  onChanged,
  needsOffer = false,
  locked = false,
  autoOpen = false,
  onLogout,
  residentPlates,
  openAsked = 0,
  openPlate,
  onResident,
}: {
  data: Overview
  onChanged: () => void
  /** Counts the clicks on « Programmer un ticket » (top bar): each one opens the wizard. */
  openAsked?: number
  /** The car the wizard opens on (back from a resident car's renewal). */
  openPlate?: string
  /** A car with the resident rate chosen in the wizard: its weekly renewal opens instead. */
  onResident?: (plate: string) => void
  /** The cars with the resident rate (checked with PayByPhone): renewed above, not offered a ticket here. */
  residentPlates?: Set<string> | null
  /** Online, no offer chosen yet: activating leads to the offer screen first. */
  needsOffer?: boolean
  /** Online, no offer and no resident vehicle: the wizard opens by itself and stays open (then the offer). */
  locked?: boolean
  /** Just past the welcome page (no resident car): open the wizard once, closable. */
  autoOpen?: boolean
  onLogout?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [forPlate, setForPlate] = useState<string | undefined>()
  useEffect(() => {
    if (locked || autoOpen) setOpen(true)
  }, [locked, autoOpen])
  // A programmed ticket due now with an arrondissement not covered yet (e.g. just after logging in again): taken
  // by the page at once, its card showing them coming, instead of waiting for the scheduler. Once per page.
  useEffect(() => {
    for (const ap of data.autopilots) {
      if (!ap.due || !ap.enabled || autoTaken.has(ap.id) || taking.get(ap.id)?.busy) continue
      const zones = ap.locations?.length ? ap.locations : [ap.location]
      const covered = (z: string) =>
        data.sessions.some((x) => keyOf(x.plate) === keyOf(ap.plate) && x.location === z && new Date(x.expire).getTime() > Date.now())
      if (zones.every(covered)) continue
      autoTaken.add(ap.id)
      void takeTickets(ap, onChanged)
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A car with nothing on it first (not the resident one, renewed above).
    if (openAsked) (setForPlate(openPlate ?? idle[0]?.plate), setOpen(true))
  }, [openAsked]) // eslint-disable-line react-hooks/exhaustive-deps
  // A one-off ticket (a single day) that has ended is no longer shown.
  const daily = data.autopilots.filter((ap) => {
    if (!isDaily(ap)) return false
    const { period, finished } = ruleState(ap)
    return !(finished && period && period.from === period.to)
  })
  const key = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
  // The cars with nothing on them: no ticket running, no ticket programmed, not a resident car (renewed above).
  const busy = new Set([
    ...data.autopilots.filter((ap) => ap.enabled && !ruleState(ap).finished).map((ap) => key(ap.plate)),
    ...data.sessions.filter((s) => new Date(s.expire).getTime() > Date.now()).map((s) => key(s.plate)),
  ])
  const isResident = (v: { plate: string; zone?: string | null }) => (residentPlates ? residentPlates.has(key(v.plate)) : !!v.zone)
  const idle = data.vehicles.filter((v) => !isResident(v) && !busy.has(key(v.plate)))
  // No card per car with nothing on it: a new ticket starts from the top bar button only.
  return (
    <section id="tickets-programmes" className="rise mt-4 scroll-mt-20">
      {/* The programmed tickets; a new one starts from the top bar button. */}
      {daily.length > 0 && (
        <div className="space-y-3">
          {daily.map((ap) => (
            <DailyCard key={ap.id} ap={ap} data={data} onChanged={onChanged} needsOffer={needsOffer} />
          ))}
        </div>
      )}
      {open && (
        <DailyWizard data={data} onClose={() => setOpen(false)} onDone={onChanged} needsOffer={needsOffer} locked={locked} onLogout={onLogout} initialPlate={forPlate}
          isResidentPlate={(p) => data.vehicles.some((v) => key(v.plate) === key(p) && isResident(v))}
          onResident={onResident}
        />
      )}
    </section>
  )
}

const PARIS_ARRONDISSEMENTS = Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, '0')}`)

/** Every PayByPhone zone number in France, from PayByPhone's own list of towns: loaded once, on demand. */
let frZones: Promise<string[]> | null = null
const loadFrZones = () => (frZones ??= import('@/lib/zones-fr.json').then((m) => m.default as string[]))

/** The zone field with a list of suggestions under it, scrolling, appearing as soon as something is typed and
 *  narrowing with each character: the zones already used on PayByPhone first (its history), then the Paris
 *  arrondissements, then every PayByPhone zone number in France. */
function ZoneInput({ value, onChange, hint }: { value: string; onChange: (zone: string) => void; hint: React.ReactNode }) {
  const [recent, setRecent] = useState<string[]>([])
  const [france, setFrance] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  useEffect(() => {
    api.recentZones().then(setRecent, () => {})
    loadFrZones().then(setFrance, () => {})
  }, [])
  const q = value.trim().toLowerCase()
  const label = (z: string) => arrondissement(z) ?? z
  // By the start of the number; a Paris arrondissement also by its name (« Paris 17 », « 17e »).
  const matches = (z: string) =>
    !q || z.toLowerCase().startsWith(q) || (!!arrondissement(z) && label(z).toLowerCase().replace('er', '').includes(q.replace('er', '')))
  const items = useMemo(() => {
    const seen = new Set<string>()
    const take = (z: string, used: boolean) => (seen.has(z) || z === value || !matches(z) ? [] : (seen.add(z), [{ zone: z, used }]))
    return [
      ...recent.flatMap((z) => take(z, true)),
      ...PARIS_ARRONDISSEMENTS.flatMap((z) => take(z, false)),
      ...france.flatMap((z) => take(z, false)),
    ].slice(0, 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, recent, france, value])
  // Only once something is typed, narrowing as the postcode grows: nothing shows on an empty field.
  const shown = open && q.length > 0 && items.length > 0
  // A zone PayByPhone has in France (a Paris arrondissement, or one of its listed numbers): the field says it is right.
  const known = !shown && (!!arrondissement(value) || france.includes(value))

  function pick(zone: string) {
    onChange(zone)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/[^0-9A-Za-z ]/g, '').slice(0, 12))
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // a click on a suggestion lands first
        onKeyDown={(e) => {
          if (!shown) return
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
          else if (e.key === 'Enter') (e.preventDefault(), pick(items[active].zone))
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Numéro de zone ou code postal"
        role="combobox"
        aria-expanded={shown}
        aria-controls="zone-suggestions"
        aria-autocomplete="list"
        className={cn(ui.field, known && 'pr-14')}
        style={known ? { borderColor: '#4e9aa0' } : undefined}
      />
      {/* The zone is right: a teal ring goes out once, a check pops in the field and draws itself (played again for
          each zone picked: the key is the zone). */}
      {known && (
        <span key={value} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-14">
          <span className="zone-ring absolute inset-0 rounded-xl" />
          <span className="zone-pop absolute top-1/2 right-4 -mt-3.5 grid size-7 place-items-center rounded-full bg-[#4e9aa0] text-white">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" className="zone-draw" />
            </svg>
          </span>
        </span>
      )}
      {shown && (
        <ul
          id="zone-suggestions"
          role="listbox"
          className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-ink/10 bg-white p-1 shadow-[0_18px_40px_-18px_rgb(11_16_36/0.25)]"
        >
          {items.map((x, i) => (
            <li
              key={x.zone}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(x.zone))}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-[0.95rem]', i === active && 'bg-ink/[0.05]')}
            >
              <span className="text-ink tabular-nums">{label(x.zone)}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-ink/45 tabular-nums">
                {x.used && <span className="rounded-full bg-[#4e9aa0]/12 px-2 py-0.5 text-sm font-medium text-[#3d7f84]">Déjà utilisée</span>}
                {arrondissement(x.zone) && x.zone}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!shown && (
        <p key={known ? `ok-${value}` : 'hint'} className={cn('mt-2 text-sm', known ? 'rise font-medium text-[#3d7f84]' : 'text-ink/60')}>
          {known ? (arrondissement(value) ?? `Zone ${value}`) + ' · zone PayByPhone reconnue' : hint}
        </p>
      )}
    </div>
  )
}

/** Four steps, like the rest of the app: vehicle and zone, the ticket, its time and days, then check and activate. */
export function DailyWizard({
  data,
  onClose,
  onDone,
  needsOffer,
  locked = false,
  onLogout,
  initialPlate,
  initialZone,
  initialTicket,
  initialZones,
  editing,
  isResidentPlate,
  onResident,
}: {
  data: Overview
  onClose: () => void
  onDone: () => void
  needsOffer: boolean
  locked?: boolean
  onLogout?: () => void
  /** Opened from a running ticket: its vehicle and zone, already filled in. */
  initialPlate?: string
  initialZone?: string
  /** Opened from a running ticket's « Renouvellement auto »: its rate, start and end, to take the same ticket again. */
  initialTicket?: { rate: string; start: string; expire: string }
  /** Renewing a car's CMI-S tickets: their arrondissements, ticked at the start. */
  initialZones?: string[]
  /** A programmed ticket being changed: every step filled with its settings, its vehicle fixed, saved in place. */
  editing?: Autopilot
  /** The car has the resident rate: its weekly renewal (onResident) instead of a programmed ticket. */
  isResidentPlate?: (plate: string) => boolean
  onResident?: (plate: string) => void
}) {
  const [step, setStep] = useState(1)
  // Step 1 in two screens: the vehicle (one), then its type; a car being changed or renewed already has its vehicle.
  const [typing, setTyping] = useState(!!editing || !!initialTicket)
  // A resident car whose weekly renewal is already on: shown, but not to pick (it would only lead to a renewal
  // with nothing left to tick). Non-resident cars and resident ones without renewal are offered.
  const renewedAlready = (p: string) =>
    !!isResidentPlate?.(p) && data.autopilots.some((ap) => ap.label === WEEKLY_LABEL && keyOf(ap.plate) === keyOf(p))
  const offered = data.vehicles.filter((v) => !renewedAlready(v.plate))
  // One vehicle or several, the same ticket for each; the first one chosen is the one the rates are looked up for.
  const [picked, setPicked] = useState<string[]>(() => {
    const first =
      editing?.plate ??
      offered.find((v) => initialPlate && keyOf(v.plate) === keyOf(initialPlate))?.plate ?? offered[0]?.plate
    return first ? [first] : []
  })
  const plate = picked[0] ?? ''
  const pick = (p: string) => setPicked([p]) // one vehicle: what follows depends on it (resident or not)
  // Its settings, applied once its rate is found again (then the user's own choices win).
  const edit = useRef(editing ?? null)
  const editPeriod = editing ? periodOf(editing) : null
  // The vehicle's usual zone by default: its resident zone, else the zone of its ticket running now.
  const zoneFor = (p: string) =>
    data.vehicles.find((v) => keyOf(v.plate) === keyOf(p))?.zone ??
    data.sessions.find((x) => keyOf(x.plate) === keyOf(p) && new Date(x.expire).getTime() > Date.now())?.location ??
    ''
  // The zone typed (visitor), and the zone in use: the one typed, or for CMI-S the first arrondissement ticked.
  const [zoneTyped, setZoneTyped] = useState(editing && !editing.cmis ? editing.location : (initialZone ?? zoneFor(plate)))
  const [zone, setZone] = useState(editing?.location ?? initialZone ?? zoneFor(plate))
  // The first question, the vehicle's type: it picks the rate (light or heavy visitor, or the free CMI-S ticket).
  const [kind, setKind] = useState<'light' | 'heavy' | 'cmis'>(editing?.cmis ? 'cmis' : 'light')
  // CMI-S, in Paris only for now: the arrondissements covered, none until the user ticks some (or « Tous »).
  const [zones, setZones] = useState<string[]>(editing?.cmis ? (editing.locations ?? [editing.location]) : [])
  const handiZones = kind === 'cmis' ? [...zones].sort() : []
  // The rates found for this zone and vehicle, when the type did not say which one: asked at step 2, under the zone.
  const [ratesKey, setRatesKey] = useState<string | null>(null)
  const lookKey = `${kind === 'cmis' ? handiZones[0] : zoneTyped}|${plate}`
  const defaultZone = useRef(zoneTyped)
  useEffect(() => {
    // Another vehicle picked: its own zone, unless the user typed one.
    if (zoneTyped && zoneTyped !== defaultZone.current) return
    const z = zoneFor(plate)
    defaultZone.current = z
    setZoneTyped(z)
  }, [plate]) // eslint-disable-line react-hooks/exhaustive-deps
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateId, setRateId] = useState<string | null>(null)
  const [cmis, setCmis] = useState(!!editing) // « je suis titulaire de la carte CMI-S »: required for the Handi ticket
  const [duration, setDuration] = useState(6)
  const [unit, setUnit] = useState<Unit>('Hours')
  const [over, setOver] = useState(false)
  // Renewing a running ticket: the next one is taken by default at the time this one ends (not when it began).
  const chainStart = initialTicket
    ? (() => {
        const end = inParis(new Date(initialTicket.expire).getTime())
        return `${String(end.h).padStart(2, '0')}:${String(end.mi).padStart(2, '0')}`
      })()
    : null
  const [start, setStart] = useState(chainStart ?? nextHour())
  const [days, setDays] = useState<number[]>(editing && !editPeriod ? daysOf(editing) : [0, 1, 2, 3, 4, 5])
  // « Chaque semaine »: the days ticked above; « Calendrier »: one day, or a period from a first to a last day.
  const [planMode, setPlanMode] = useState<'week' | 'calendar'>(editPeriod ? 'calendar' : 'week')
  const [range, setRange] = useState<{ from: string | null; to: string | null }>(
    editPeriod ? { from: editPeriod.from, to: editPeriod.to } : { from: null, to: null },
  )
  const calendar = planMode === 'calendar'
  const period = calendar && range.from ? { from: range.from, to: range.to ?? range.from } : undefined
  // On the calendar every day of the period counts (Sundays stay free in Paris, the server skips them).
  const ruleDays = calendar ? [0, 1, 2, 3, 4, 5, 6] : days
  // Tickets counted in the price: the days of the period (Sundays free in Paris), or the days ticked each week.
  const count = calendar ? (period ? periodDays(period.from, period.to, isParis(zone)) : 0) : days.length
  // Today at an hour already gone: no ticket would ever be taken.
  const parisTime = parisNow()
  const hourPast = !!period && count > 0 && period.to === parisTime.day && start <= parisTime.time
  // Today is one of the chosen days (a Paris Sunday is free): the ticket can be taken at once, to see it work.
  const weekday = (new Date(`${parisTime.day}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday
  // Something is left to take now: for CMI-S an arrondissement ticked not covered yet, else no ticket on the car.
  const running = data.sessions.filter((x) => keyOf(x.plate) === keyOf(plate) && new Date(x.expire).getTime() > Date.now())
  const covered = kind === 'cmis'
    ? handiZones.every((z) => running.some((x) => x.location === z))
    : running.length > 0
  const today = !covered && (period
    ? period.from <= parisTime.day && parisTime.day <= period.to
    : days.includes(weekday)) && !((kind === 'cmis' || isParis(zone)) && weekday === 6)
  // Taken at once by default when it is free (CMI-S); a paid ticket only if the user ticks it.
  const [firstNow, setFirstNow] = useState<boolean | null>(null)
  const takeNow = today && (firstNow ?? kind === 'cmis')
  // Today at an hour already gone: moved to the next hour, after a moment so that typing « 18 » can pass through « 1 ».
  useEffect(() => {
    if (!hourPast) return
    const id = setTimeout(() => setStart(nextHour()), 2000)
    return () => clearTimeout(id)
  }, [hourPast, start])
  const [cost, setCost] = useState<Money | null | undefined>(undefined)
  // No answer from PayByPhone (not a free ticket): « prix indisponible » with « Réessayer », never 0,00 €.
  const [costFailed, setCostFailed] = useState(false)
  const [costTry, setCostTry] = useState(0)
  // The ticket now, not at the next window (5 h for CMI-S): the user sees at once that it works.
  const nowBox = today && (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink/[0.03] px-4 py-3 text-sm leading-relaxed text-ink/60">
      <input type="checkbox" checked={takeNow} onChange={(e) => setFirstNow(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[#4e9aa0]" />
      <span>
        {kind === 'cmis'
          ? 'Prendre le ticket tout de suite'
          : `${editing ? 'Prendre le ticket maintenant' : 'Prendre le premier ticket maintenant'}${cost ? ` (${euros(cost)})` : ''}, pour vérifier tout de suite que ça marche.`}
      </span>
    </label>
  )
  const cards = data.payments.filter((p) => p.kind === 'card' && !p.expired)
  const [payment, setPayment] = useState(
    cards.find((c) => c.id === editing?.paymentAccountId)?.id ?? cards[0]?.id ?? '',
  )
  const [saving, setSaving] = useState(false)
  // Online, no offer chosen yet: the offer screen first, as for the weekly renewal; the ticket is programmed on the
  // way back from Stripe (nothing is charged before the end of the free month).
  const [paywall, setPaywall] = useState(false)

  const paris = isParis(zone)
  // A free day picked before coming back to a Paris zone: not a ticket any more.
  useEffect(() => {
    if (paris && range.from && !range.to && count === 0) setRange({ from: null, to: null })
  }, [paris, range.from, range.to, count])
  const place = paris ? arrondissement(zone) : null
  // The visitor rate comes as « léger » and « lourd »: PayByPhone does not know the weight, so one question instead.
  const usable = useMemo(() => (rates ?? []).filter((r) => !r.parkingNotAllowedReason && !resident(r)), [rates])
  const hasWeight = usable.some(light) && usable.some(heavy)
  // The CMI-S ticket is chosen with the vehicle's type (Paris only, for now): not among the visitor rates.
  const handiRate = null as Rate | null
  const effective = usable.find((r) => r.ratePolicyId === rateId) ?? null
  const showRates = kind !== 'cmis' && !!rates && ratesKey === lookKey
  // One question, every answer with its price: the CMI-S card first, then the visitor rates by weight.
  const options = [...(handiRate ? [handiRate] : []), ...usable.filter((r) => !handi(r)).sort((a, b) => Number(heavy(a)) - Number(heavy(b)))]
  // PayByPhone gives no maximum stay with its rates: a day when the rate sells days; for visitors, Paris' 6 hours,
  // elsewhere up to 24 hours (PayByPhone's quote refuses a longer stay than the zone allows).
  // The units offered per rate: Handi in days only, visitors in minutes or hours; each capped at the rate's maximum.
  const unitsOf = (r: Rate): Unit[] => (handi(r) ? ['Days'] : r.acceptedTimeUnits.filter((u) => u !== 'Days'))
  const MAX: Record<Unit, number> = paris ? { Days: 1, Hours: 6, Minutes: 360 } : { Days: 1, Hours: 24, Minutes: 1440 }
  const maxStay = (r: Rate) => (r.acceptedTimeUnits.includes('Days') ? '1\u00a0jour' : paris ? '6\u00a0h' : null)
  const optionText = (r: Rate): [string, string] => {
    const stay = maxStay(r)
    const max = stay ? `${stay} maximum` : r.acceptedTimeUnits.includes('Days') ? 'À la journée' : 'À l’heure'
    return handi(r)
      ? ['Carte mobilité CMI-S', max]
      : hasWeight && light(r)
        ? ['Visiteur · véhicule léger', `Moins de 1,6 t · ${max}`]
        : hasWeight && heavy(r)
          ? ['Visiteur · véhicule lourd', `Plus de 1,6 t · ${max}`]
          : [rateLabel(r.name), max]
  }

  // The zone check and the rates, asked together while the user types (a pause of 350 ms on a full number): on
  // « Suivant » they are usually already there, no wait.
  const ahead = useRef<{ key: string; p: Promise<[boolean, Rate[] | Error]> } | null>(null)
  const lookUp = (z: string, pl: string) =>
    Promise.all([
      api.zone(z).then((r) => r.found, () => true), // PayByPhone silent on the zone: the rates will tell
      api.rates(z, pl).then((r) => r, (e) => e as Error),
    ])
  useEffect(() => {
    const z = kind === 'cmis' ? handiZones[0] : zoneTyped
    if (!plate || !z || !/^[0-9A-Za-z]{5,12}$/.test(z)) return // a whole number (5 characters at least): no call per keystroke
    const key = `${z}|${plate}`
    const t = setTimeout(() => {
      if (ahead.current?.key !== key) ahead.current = { key, p: lookUp(z, plate) }
    }, 350)
    return () => clearTimeout(t)
  }, [zoneTyped, plate, kind, handiZones[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  async function findRates() {
    // CMI-S: the rates of the first arrondissement ticked (each zone's own Handi rate is found by the server).
    const zone = kind === 'cmis' ? handiZones[0] : zoneTyped
    setZone(zone)
    setLooking(true)
    setError(null)
    try {
      const key = `${zone}|${plate}`
      if (ahead.current?.key !== key) ahead.current = { key, p: lookUp(zone, plate) }
      const [found, answer] = await ahead.current.p
      // PayByBot works in France: a number PayByPhone does not know there stops here, with a clear word.
      if (!found) {
        ahead.current = null
        setError('Cette zone n’existe pas chez PayByPhone en France. Vérifiez le numéro sur le panneau ou l’horodateur.')
        return
      }
      if (answer instanceof Error) {
        ahead.current = null // asked again on the next try
        throw answer
      }
      const list = answer
      setRates(list)
      const first = list.filter((r) => !r.parkingNotAllowedReason && !resident(r))
      const kept = edit.current && first.find((r) => r.ratePolicyId === String(edit.current!.rate))
      const visitors = first.filter((r) => !handi(r))
      const weighed = visitors.some(light) && visitors.some(heavy)
      // The type says the rate: CMI-S, or light / heavy when PayByPhone sells both; else asked at step 2.
      const byKind =
        kind === 'cmis'
          ? first.find(handi)
          : weighed ? visitors.find(kind === 'heavy' ? heavy : light) : visitors.length === 1 ? visitors[0] : undefined
      if (kind === 'cmis' && !byKind) {
        setError('PayByPhone ne propose pas le ticket carte mobilité CMI-S pour ce véhicule.')
        return
      }
      // Nothing a visitor can buy there (only the resident rate, or none): said plainly, not a question without answers.
      if (kind !== 'cmis' && !visitors.length) {
        setError('PayByPhone ne vend aucun ticket visiteur pour ce véhicule dans cette zone. Vérifiez le numéro sur le panneau ou l’horodateur.')
        return
      }
      setRateId((kept || byKind || visitors[0] || first[0])?.ratePolicyId ?? null)
      setRatesKey(byKind ? null : key)
      setStep(byKind && !preset.current ? 3 : 2)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLooking(false)
    }
  }

  // Duration preset to what the rate allows: a day when it sells days, else 6 hours (Paris visitors' maximum).
  useEffect(() => {
    if (!effective) return
    const units = unitsOf(effective)
    const e = edit.current
    if (e && effective.ratePolicyId === String(e.rate) && units.includes(e.unit as Unit)) {
      // Its own length and time, as programmed.
      setUnit(e.unit as Unit)
      setDuration(Math.min(MAX[e.unit as Unit], Number(e.duration)))
      setOver(false)
      setStart(startOf(e))
      edit.current = null
      return
    }
    edit.current = null
    const u: Unit = units.includes('Hours') ? 'Hours' : (units[0] ?? 'Days')
    setUnit(u)
    setDuration(MAX[u])
    setOver(false)
    // Paris Handi: taken at 5 h, before 9 h, the day's ticket covers the whole paid day (elsewhere the user says when).
    // Renewing a running ticket: the time it ends, whatever rate is picked (Paris Handi: 5 h, before paid hours).
    setStart(handi(effective) && paris ? '05:00' : (chainStart ?? nextHour()))
  }, [effective?.ratePolicyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // From a running ticket: its rates looked up at once, its rate chosen, its start time and length taken again, and
  // straight to the days (the Handi ticket stops at step 2 for the CMI-S attestation).
  const preset = useRef(initialTicket ?? null)
  // The running ticket being renewed: the next one is not taken before it ends.
  const chainFrom = initialTicket ? new Date(initialTicket.expire) : null
  useEffect(() => {
    if (preset.current && plate && zone) findRates()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = preset.current
    if (!t || !rates) return
    const same = usable.find((r) => r.ratePolicyId === String(t.rate))
    setDays(paris ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]) // renewed every day (Paris: Sundays are free)
    if (!same) return void (preset.current = null) // its rate not offered here: chosen at step 2 (start still its end)
    setKind(handi(same) ? 'cmis' : heavy(same) ? 'heavy' : 'light')
    if (handi(same)) setZones((z) => (z.length ? z : initialZones?.length ? initialZones : [zone])) // its arrondissements ticked
    if (rateId !== same.ratePolicyId) return setRateId(same.ratePolicyId)
    if (!effective) return
    const begin = new Date(t.start)
    const minutes = Math.round((new Date(t.expire).getTime() - begin.getTime()) / 60000)
    const units = unitsOf(effective)
    if (!units.includes('Days') && minutes > 0) {
      const u: Unit = minutes % 60 === 0 && units.includes('Hours') ? 'Hours' : units.includes('Minutes') ? 'Minutes' : 'Hours'
      const n = u === 'Hours' ? Math.max(1, Math.round(minutes / 60)) : minutes
      setUnit(u)
      setDuration(Math.min(MAX[u], n))
    }
    preset.current = null
    setStep(handi(effective) ? 2 : 3)
  }, [rates, rateId, effective?.ratePolicyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every option's price for its own preset length (a day, or 6 hours), so each answer shows what it costs.
  const [prices, setPrices] = useState<Record<string, Money | null>>({})
  useEffect(() => {
    if (step !== 2 || !payment || !usable.length) return
    let cancelled = false
    setPrices({})
    for (const r of usable) {
      const days = r.acceptedTimeUnits.includes('Days')
      api
        .quote({
          location: zone,
          rate: r.ratePolicyId,
          duration: days ? 1 : 6,
          unit: days ? 'Days' : 'Hours',
          plate,
          paymentAccountId: payment,
        })
        .then(
          (q) => q.cost,
          () => null,
        )
        .then((c) => !cancelled && setPrices((p) => ({ ...p, [r.ratePolicyId]: c })))
    }
    return () => {
      cancelled = true
    }
  }, [step, usable, zone, plate, payment])

  // The price of one ticket, from PayByPhone.
  useEffect(() => {
    if (step < 2 || !effective || !payment) return
    let cancelled = false
    setCost(undefined)
    setCostFailed(false)
    api
      .quote({
        location: zone,
        rate: effective.ratePolicyId,
        duration,
        unit,
        plate,
        paymentAccountId: payment,
      })
      .then(
        (q) => !cancelled && setCost(q.cost),
        () => !cancelled && (setCost(null), setCostFailed(true)),
      )
    return () => {
      cancelled = true
    }
  }, [step, effective?.ratePolicyId, duration, unit, zone, plate, payment, costTry]) // eslint-disable-line react-hooks/exhaustive-deps

  const rule = (forPlate = plate): PendingRenewal => ({
    location: zone,
    rate: effective!.ratePolicyId,
    duration,
    unit,
    plate: forPlate,
    paymentAccountId: payment,
    label: DAILY_LABEL,
    days: ruleDays,
    start,
    ...(period ? { dateFrom: period.from, dateTo: period.to } : {}),
    ...(handi(effective!) ? { cmis: true } : {}),
    ...(handiZones.length > 1 ? { locations: handiZones } : {}),
    ...(takeNow ? { now: true } : {}),
  })

  async function activate() {
    if (!effective) return
    if (needsOffer) {
      setPaywall(true)
      return
    }
    if (editing) return save()
    setSaving(true)
    try {
      const made: Autopilot[] = []
      for (const p of picked) made.push(await api.addAutopilot(rule(p) as Parameters<typeof api.addAutopilot>[0]))
      const first = nextTicket(ruleDays, start, chainFrom, period)
      toast.success(chainFrom ? 'Renouvellement activé.' : picked.length > 1 ? `${picked.length} tickets programmés.` : 'Ticket programmé.', {
        description: takeNow ? 'Prise du ticket en cours : suivez-la sur la carte.' : first ? `Prochain ticket ${when(first)}.` : undefined,
      })
      onDone()
      onClose()
      if (takeNow) for (const ap of made) void takeTickets(ap, onDone) // the window closes at once
    } catch (e) {
      // No subscription yet (the account had not loaded): the offer screen.
      if (e instanceof ApiError && e.status === 402 && /offre|abonn/i.test(e.message)) setPaywall(true)
      else toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const ap = await api.editAutopilot(editing!.id, rule() as Parameters<typeof api.editAutopilot>[1])
      toast.success('Ticket modifié.', { description: takeNow ? 'Prise du ticket en cours : suivez-la sur la carte.' : undefined })
      onDone()
      onClose()
      if (takeNow) void takeTickets(ap, onDone)
    } catch (e) {
      if (e instanceof ApiError && e.status === 402 && /offre|abonn/i.test(e.message)) setPaywall(true)
      else toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const steps = [editing ? 'Type de véhicule' : 'Véhicule et type', kind === 'cmis' ? 'Arrondissements' : 'Zone', initialTicket ? 'Horaires' : 'Horaires et jours', editing ? 'Vérifier et enregistrer' : 'Vérifier et activer']

  // The vehicle on a screen of its own (not when it is fixed): five steps instead of four.
  const split = !editing && !initialTicket
  const labels = split ? ['Véhicule', 'Type de véhicule', ...steps.slice(1)] : steps
  const shown = split ? (step === 1 ? (typing ? 2 : 1) : step + 1) : step

  function nextFromVehicle() {
    if (onResident && isResidentPlate?.(plate)) {
      onClose()
      onResident(plate)
    } else setTyping(true)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && !locked && onClose()}>
      <DialogContent className={ui.dialog} showCloseButton={!locked}>
        <div className="px-6 pt-6">
          <p className="text-sm font-medium tracking-wide text-ink/45 uppercase">
            Étape {shown} sur {labels.length} · {labels[shown - 1]}
          </p>
          <DialogTitle className={cn(ui.dialogTitle, 'mt-1')}>{editing ? 'Modifier le ticket' : initialTicket ? 'Renouveler ce ticket' : 'Programmer un ticket'}</DialogTitle>
          {/* The sentence under the title only on the first step: the others need the height. */}
          <DialogDescription className={cn('mt-1 text-ink/60', step > 1 && 'sr-only')}>
            {editing
              ? 'Les nouveaux réglages valent pour les prochains tickets.'
              : initialTicket ? 'Repris automatiquement chaque jour, à l’heure voulue.' : 'Pris automatiquement les jours choisis, à l’heure voulue.'}
          </DialogDescription>
          <div className={cn('mt-5 grid gap-1.5', labels.length === 5 ? 'grid-cols-5' : 'grid-cols-4')} aria-hidden>
            {labels.map((_, i) => (
              <span key={i} className={cn('h-1 rounded-full', i < shown ? TEAL : 'bg-ink/[0.08]')} />
            ))}
          </div>
        </div>

        <div className="space-y-4 p-6 pt-4">
          {step === 1 && !typing && (
            <>
              <div>
                <p className={ui.label}>Véhicule</p>
                <div className="flex flex-wrap gap-2">
                  {data.vehicles.filter((v) => !editing || keyOf(v.plate) === keyOf(editing.plate)).map((v) =>
                    !editing && renewedAlready(v.plate) ? (
                      // Renewed already: shown greyed out, not to pick (no word: the grey says it).
                      <button key={v.plate} disabled className="inline-flex flex-col items-center gap-1 rounded-xl border border-ink/10 p-2 opacity-60">
                        <Plate plate={v.plate} size="sm" />
                      </button>
                    ) : (
                      <button
                        key={v.plate}
                        onClick={() => !editing && pick(v.plate)}
                        aria-pressed={picked.some((p) => keyOf(p) === keyOf(v.plate))}
                        className={cn(
                          'rounded-xl border p-2 transition',
                          picked.some((p) => keyOf(p) === keyOf(v.plate))
                            ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.08] ring-1 ring-[#4e9aa0]'
                            : 'border-ink/15 opacity-70 hover:opacity-100',
                        )}
                      >
                        <Plate plate={v.plate} size="sm" />
                      </button>
                    ),
                  )}
                </div>
              </div>
              {/* No card PayByPhone can charge: nothing could be priced nor paid, said at once with the way to fix it. */}
              {!cards.length && (
                <Notice>
                  {data.payments.some((p) => p.kind === 'card')
                    ? 'Votre carte bancaire PayByPhone a expiré.'
                    : 'Aucune carte bancaire sur votre compte PayByPhone.'}{' '}
                  Ajoutez-en une dans l’application{' '}
                  <a href="https://paybyphone.onelink.me/ZQkh/" target="_blank" rel="noreferrer" className={ui.link}>
                    PayByPhone
                  </a>
                  , puis rouvrez cette fenêtre.
                </Notice>
              )}
            </>
          )}
          {step === 1 && typing && (
            <>
              <div>
                <p className={ui.label}>Type de véhicule</p>
                <div className="space-y-2">
                  {KINDS.map(([k, title, hint]) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      aria-pressed={kind === k}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                        kind === k ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.06]' : 'border-ink/15 hover:border-ink/30',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">{title}</span>
                        <span className="block text-sm text-ink/60">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {kind === 'cmis' ? (
                <>
                  {/* One free Handi ticket in each arrondissement ticked: all of Paris by default. */}
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={ui.label}>
                        Arrondissements couverts
                        {handiZones.length > 0 && ` · ${handiZones.length >= 20 ? 'tout Paris' : handiZones.length}`}
                      </p>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/60">
                        <input
                          type="checkbox"
                          checked={handiZones.length >= 20}
                          onChange={(e) => setZones(e.target.checked ? PARIS_ZONES : [])}
                          className="size-4 accent-[#4e9aa0]"
                        />
                        Tous
                      </label>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {PARIS_ZONES.map((z, i) => {
                        const on = handiZones.includes(z)
                        return (
                          <button
                            key={z}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setZones(on ? handiZones.filter((x) => x !== z) : [...handiZones, z])}
                            // Grey cells; a ticked one keeps its grey with a green border.
                            className={cn(
                              'h-10 rounded-[10px] border-2 bg-ink/[0.05] text-sm tabular-nums transition',
                              on ? 'border-[#4e9aa0] font-semibold text-ink' : 'border-transparent text-ink/60 hover:bg-ink/[0.08]',
                            )}
                          >
                            {i === 0 ? '1er' : `${i + 1}e`}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-2 text-sm text-ink/45">Un ticket gratuit est pris dans chaque arrondissement coché.</p>
                  </div>
                  {nowBox}
                  <CmisAttest checked={cmis} onChange={setCmis} />
                </>
              ) : (
                <div>
                  <p className={ui.label}>Où vous garez-vous ?</p>
                  <ZoneInput value={zoneTyped} onChange={setZoneTyped} hint={withPayByPhone('Le numéro de zone PayByPhone, indiqué sur le panneau ou l’horodateur.')} />
                </div>
              )}
              {/* The type did not say the rate (a zone selling several visitor rates): asked here. */}
              {showRates && options.length > 0 && (
              <div>
                <p className={ui.label}>Quel ticket prendre ?</p>
                <div className="space-y-2">
                  {options.map((r) => {
                    const [title, hint] = optionText(r)
                    const price = prices[r.ratePolicyId]
                    return (
                      <button
                        key={r.ratePolicyId}
                        onClick={() => setRateId(r.ratePolicyId)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                          rateId === r.ratePolicyId ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.06]' : 'border-ink/15 hover:border-ink/30',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink">{title}</span>
                          <span className="block text-sm text-ink/60">{hint}</span>
                        </span>
                        <span className="shrink-0 text-right tabular-nums">
                          <span className="block text-sm font-medium text-ink">
                            {handi(r) ? 'Gratuit' : price === undefined ? <Loader2 className="inline size-3.5 animate-spin text-ink/45" /> : euros(price)}
                          </span>
                          {!handi(r) && <span className="block text-sm text-ink/45">par jour</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {hasWeight && (
                  <p className="mt-2 text-sm text-ink/45">
                    {withPayByPhone('PayByPhone ne connaît pas le poids du véhicule : choisissez le tarif qui lui correspond.')}
                  </p>
                )}
              </div>
              )}
              {error && <p className={ui.error}>{error}</p>}
            </>
          )}

          {step === 3 && effective && (
            <>
              {/* Handi: nothing to set but the days; a day's ticket taken at 5 h, before the paid hours */}
              {!(handi(effective) && paris) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className={ui.label}>Durée du ticket</p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX[unit]}
                        value={duration}
                        onChange={(e) => {
                          const n = Math.max(1, Math.round(Number(e.target.value) || 1))
                          setOver(n > MAX[unit]) // brought back to the maximum, with a discreet word below
                          setDuration(Math.min(MAX[unit], n))
                        }}
                        className={cn(ui.field, 'w-16 shrink-0 px-0 text-center tabular-nums')}
                      />
                      {/* Units side by side, like the option cards: one tap, no drop-down */}
                      <div className="flex min-w-0 flex-1 rounded-xl bg-ink/[0.05] p-1">
                        {(effective ? unitsOf(effective) : [unit]).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => {
                              setUnit(u)
                              setDuration(MAX[u])
                            }}
                            className={cn(
                              'min-w-0 flex-1 rounded-[10px] px-2 text-sm transition',
                              unit === u ? 'bg-white font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-ink/60 hover:text-ink/60',
                            )}
                          >
                            {u === 'Minutes' ? 'min' : unitLabel(u, duration)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {over && (
                      <p className="mt-2 text-sm text-[#741b11]/80">
                        {MAX[unit]} {unitLabel(unit, MAX[unit])} maximum pour ce tarif.
                      </p>
                    )}
                  </div>
                  <div>
                    <p className={ui.label}>Heure de prise</p>
                    <TimeInput label="Heure de prise" value={start} onChange={(v) => setStart(v || nextHour())} />
                    <p className="mt-2 text-sm text-ink/45">
                      {!chainFrom && (
                        <>
                          Fin du ticket : <span className="font-medium text-ink tabular-nums">{endText(start, duration, unit)}</span>
                        </>
                      )}
                      {chainFrom && (
                        <span className="block">Le ticket en cours se termine {when(chainFrom)}.</span>
                      )}
                      {chainFrom && nextTicket(ruleDays, start, chainFrom, period) && (
                        <span className="mt-1 block font-medium text-[#3d7f84]">
                          Nouveau ticket : {when(nextTicket(ruleDays, start, chainFrom, period)!)} → {endText(start, duration, unit)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {/* Renewing a running ticket: no days to pick (taken again every day); a new ticket: the days chosen. */}
              {chainFrom ? null : (
              <div className="space-y-2.5">
                {/* Every week on the days ticked, or on the calendar: one day, or a period from a first to a last day. */}
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
                  {(
                    [
                      ['week', 'Récurrent'],
                      ['calendar', 'Date spécifique'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={planMode === id}
                      onClick={() => setPlanMode(id)}
                      className={cn(
                        'rounded-[10px] py-2 text-sm font-semibold transition',
                        planMode === id ? 'bg-white text-ink shadow-sm' : 'text-ink/60 hover:text-ink/60',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {calendar ? (
                  <div>
                    <RangeCalendar from={range.from} to={range.to} paris={paris} onChange={(from, to) => setRange({ from, to })} />
                    <p className="mt-2 text-sm text-ink/60">
                      {period
                        ? `Un ticket ${periodText(period.from, period.to)}${period.to !== period.from ? ', chaque jour' : ''}`.replace(/\.?$/, '.')
                        : 'Touchez un jour, puis le dernier jour pour une période.'}
                      {paris && <span className="text-ink/45"> Dimanches et jours fériés gratuits à Paris.</span>}
                    </p>
                  </div>
                ) : (
                <div>
                    <p className={ui.label}>Jours</p>
                    {/* A week strip, same cards as the tickets above; in Paris Sunday is shown but free, so never picked */}
                    <div className="grid grid-cols-7 gap-1.5">
                      {(paris ? DAYS.slice(0, 6) : DAYS).map((d, i) => {
                        const on = days.includes(i)
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setDays((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort()))}
                            className={cn(
                              'flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-sm transition',
                              on ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.06] font-medium text-ink' : 'border-ink/15 text-ink/45 hover:border-ink/30',
                            )}
                          >
                            {d}
                            <span className={cn('grid size-4 place-items-center rounded-full', on ? 'bg-[#4e9aa0] text-white' : 'border border-ink/20')}>
                              {on && <Check className="size-3" strokeWidth={3} />}
                            </span>
                          </button>
                        )
                      })}
                      {paris && (
                        <div className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink/10 text-sm text-ink/30">
                          Dim
                          <span className="text-[0.65rem] leading-none">gratuit</span>
                        </div>
                      )}
                    </div>
                    {handi(effective) && paris && (
                      <p className="mt-3 text-sm text-ink/60">Le ticket carte mobilité CMI-S d’une journée est pris automatiquement à 5 h, chaque jour choisi.</p>
                    )}
                    {paris && <p className="mt-2 text-sm text-ink/45">À Paris, le dimanche et les jours fériés sont gratuits : aucun ticket n’est pris.</p>}
                  </div>
                )}
              </div>
              )}
              <div className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm">
                {/* Renewing a running ticket (every day, no days counted): the price of a day. A new ticket: the total of
                    the days ticked, each week, and one ticket's price under it. */}
                {chainFrom ? (
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-ink/60">Prix par jour</span>
                    <span className="text-[0.95rem] font-semibold text-ink tabular-nums">
                      {cost === undefined ? <Loader2 className="inline size-4 animate-spin text-ink/45" /> : costFailed ? (
                      <button onClick={() => setCostTry((n) => n + 1)} className={ui.link}>Prix indisponible · Réessayer</button>
                    ) : euros(cost ?? { amount: 0, currency: 'EUR' })}
                    </span>
                  </div>
                ) : (
                <>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-ink/60">
                    {calendar
                      ? `Au total : ${count} ticket${count > 1 ? 's' : ''}${cost ? ` à ${euros(cost)}` : ''}`
                      : `Par semaine (${days.length} jour${days.length > 1 ? 's' : ''})`}
                  </span>
                  <span className="text-[0.95rem] font-semibold text-ink tabular-nums">
                    {cost === undefined ? (
                      <Loader2 className="inline size-4 animate-spin text-ink/45" />
                    ) : (
                      euros({ amount: (cost?.amount ?? 0) * count, currency: cost?.currency ?? 'EUR' })
                    )}
                  </span>
                </div>
                {/* On a specific date the ticket's price is already in the line above. */}
                <div className={cn('mt-1 flex justify-between gap-4', calendar && 'hidden')}>
                  <span className="text-ink/45">Prix d’un ticket</span>
                  <span className="text-ink/60 tabular-nums">
                    {/* No price from PayByPhone (a free ticket, e.g. Handi): 0 €, not a dash. */}
                    {cost === undefined ? '…' : costFailed ? (
                      <button onClick={() => setCostTry((n) => n + 1)} className={ui.link}>Prix indisponible · Réessayer</button>
                    ) : euros(cost ?? { amount: 0, currency: 'EUR' })}
                  </span>
                </div>
                </>
                )}
                <p className={cn('mt-2 text-sm text-ink/45', calendar && 'hidden')}>{withPayByPhone('Payé à PayByPhone au tarif habituel, à chaque ticket.')}</p>
              </div>
            </>
          )}

          {step === 4 && effective && (
            <>
              <dl className="divide-y divide-ink/[0.06] rounded-xl border border-ink/10 text-sm">
                {[
                  [
                    picked.length > 1 ? 'Véhicules' : 'Véhicule',
                    <span key="p" className="flex flex-wrap justify-end gap-1.5">
                      {picked.map((p) => (
                        <Plate key={p} plate={p} size="sm" />
                      ))}
                    </span>,
                  ],
                  ['Zone', handiZones.length >= 20 ? 'Tout Paris' : handiZones.length > 1 ? `${handiZones.length} arrondissements de Paris` : (place ?? `Zone ${zone}`)],
                  ['Ticket', optionText(effective)[0]],
                  [
                    calendar && period && period.to === period.from ? 'Jour' : 'Jours',
                    chainFrom
                      ? paris ? 'Chaque jour, sauf dimanche et jours fériés' : 'Chaque jour'
                      : period
                        ? periodText(period.from, period.to).replace(/^le /, '').replace(/^du /, 'Du ')
                        : daysText(days),
                  ],
                  ['Horaire', handi(effective) && paris ? 'Toute la journée' : `${hourText(start)} → ${endText(start, duration, unit)}`],
                  [
                    'Prix',
                    handi(effective)
                      ? 'Gratuit'
                      : !cost
                        ? '—'
                        : chainFrom
                          ? `${euros(cost)} par jour`
                          : calendar
                            ? count > 1 ? `${euros({ amount: cost.amount * count, currency: cost.currency })} (${euros(cost)} × ${count})` : euros(cost)
                          : `${euros({ amount: cost.amount * days.length, currency: cost.currency })} par semaine (${euros(cost)} × ${days.length})`,
                  ],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <dt className="text-ink/60">{k}</dt>
                    <dd className="text-right text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              {/* CMI-S: asked with the arrondissements, at step 2. */}
              {kind !== 'cmis' && nowBox}
              {!cards.length ? (
                <NoPayment compact onRefresh={async () => onDone()} />
              ) : (
                cards.length > 1 && (
                  <div>
                    <p className={ui.label}>Payer avec</p>
                    <div className="flex flex-wrap gap-2">
                      {cards.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPayment(p.id)}
                          className={cn(
                            'rounded-xl border px-3 py-2 text-sm font-semibold',
                            payment === p.id ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.06]' : 'border-ink/15',
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}
            </>
          )}

          {step === 3 && hourPast && (
            <p className="rounded-xl bg-destructive/8 px-4 py-3 text-sm text-destructive">Cette heure est déjà passée : choisissez une heure ou un jour à venir.</p>
          )}

          <div className="flex gap-3 pt-1">
            {(step > 1 || (typing && split)) && (
              <button onClick={() => (step > 1 ? setStep(step - 1) : setTyping(false))} className={cn(ui.primaryGray, 'w-auto flex-1')}>
                Précédent
              </button>
            )}
            {step === 1 && (
              <button onClick={typing ? () => setStep(2) : nextFromVehicle} disabled={!plate || !cards.length} className={cn(ui.primary, 'flex-[2]')}>
                Suivant
              </button>
            )}
            {step === 2 && (
              <button
                onClick={showRates ? () => setStep(3) : findRates}
                disabled={looking || (kind === 'cmis' ? !cmis || !handiZones.length : !zoneTyped) || (showRates && !effective)}
                className={cn(ui.primary, 'flex-[2]')}
              >
                {looking ? <Loader2 className="size-5 animate-spin" /> : 'Suivant'}
              </button>
            )}
            {step === 3 && (
              <button onClick={() => setStep(4)} disabled={!effective || hourPast || (calendar ? !count : !days.length)} className={cn(ui.primary, 'flex-[2]')}>
                Suivant
              </button>
            )}
            {step === 4 && (
              <button onClick={activate} disabled={saving || !payment || !effective} className={cn(ui.primary, 'flex-[2]')}>
                {saving ? <Loader2 className="size-5 animate-spin" /> : editing ? 'Enregistrer' : 'Activer'}
              </button>
            )}
          </div>
          {locked && onLogout && (
            <button onClick={onLogout} className={cn('mx-auto mt-4 block text-sm', ui.link)}>
              Se déconnecter
            </button>
          )}
        </div>
      </DialogContent>
      {paywall && (
        <PlansDialog
          // A change is not replayed after Stripe (the ticket already exists): it is saved again from its card.
          onPay={() => !editing && savePending(picked.map((p) => rule(p)))}
          onClose={() => {
            clearPending()
            setPaywall(false)
          }}
        />
      )}
    </Dialog>
  )
}
