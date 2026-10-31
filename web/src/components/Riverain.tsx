import { useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2, Mail, Pause, Play, Repeat, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NoPayment } from '@/components/NoPayment'
import { arrondissement, PayByBot, Plate, withPayByPhone, ZonePlate } from '@/components/signs'
import { loadLast, saveLast } from '@/components/PayWizard'
import { PlansDialog } from '@/components/Pricing'
import { ShinyButton } from '@/components/ui/shiny-button'
import { cn } from '@/lib/utils'
import { choice, ui } from '@/lib/styles'
import { emailProblem } from '@/lib/validate'
import { api, ApiError, type Account, type Activation, type Autopilot, type Money, type Overview, type Parking, type Rate } from '@/lib/api'
import { LoadingLine } from '@/components/Loading'

export const WEEKLY_LABEL = 'Riverain hebdo'

/** The renewals chosen just before leaving for Stripe, activated on the way back (kept one hour). */
const PENDING_KEY = 'pbb-pending-renewals'

/** A renewal kept for the way back from Stripe: weekly (no label) or a non-resident ticket on precise days. */
export type PendingRenewal = Parking & {
  label?: string
  days?: number[]
  start?: string
  cmis?: boolean
  tz?: string
  /** Chosen on the calendar: the first and last day (ISO), equal for a single day. */
  dateFrom?: string
  dateTo?: string
}

export function savePending(items: PendingRenewal[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), items }))
  } catch {
    // no storage: the renewal is simply activated again by hand after the payment page
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // nothing to clear
  }
}


/** What the activation did for a car, as the e-mail says it, with who pays when a payment fails. */
export function activationToast(activation: Activation, plate?: string) {
  if (activation.failed) {
    // The reason is long: it stays under the vehicle, with « Réessayer ».
    toast.error(plate ? `${plate} : ${activation.title}` : activation.title, {
      description: 'La raison est affichée sous votre véhicule.',
    })
    return
  }
  toast.success(plate ? `${plate} : ${activation.title}` : activation.title, {
    // Short on screen: what happens if a payment fails is in the e-mail.
    description: activation.text,
  })
}

/** Back from Stripe with a subscription: activate the renewals chosen before leaving. */
export async function runPendingRenewals(): Promise<{ done: number; failed: string[]; shown: number }> {
  let items: PendingRenewal[] = []
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    if (saved && Date.now() - saved.at < 3_600_000 && Array.isArray(saved.items)) items = saved.items
  } catch {
    // unreadable: nothing pending
  }
  clearPending()
  const failed: string[] = []
  let shown = 0
  for (const p of items) {
    try {
      const { activation } = await api.addAutopilot({ label: WEEKLY_LABEL, ...p } as Parameters<typeof api.addAutopilot>[0])
      if (p.days?.length) {
        // A non-resident ticket on precise days: nothing paid now, the first ticket comes on its day.
        toast.success(items.length > 1 ? `${p.plate} : ticket programmé.` : 'Ticket programmé.')
        shown += 1
        continue
      }
      saveLast(p)
      if (activation) {
        activationToast(activation, items.length > 1 ? p.plate : undefined)
        shown += 1
      }
    } catch (e) {
      failed.push(`${p.plate} : ${(e as Error).message}`)
    }
  }
  return { done: items.length - failed.length, failed, shown }
}
const WEEK_DAYS = 7

export const isWeekly = (ap: Autopilot) => ap.label === WEEKLY_LABEL

/** The weekly renewal of the car and zone of a ticket, if there is one. */
export const renewalOf = (data: Overview, s: { plate: string; location: string }) =>
  data.autopilots.find((ap) => isWeekly(ap) && ap.plate === s.plate && ap.location === s.location)

export function pauseState(ap: Autopilot, now = Date.now()) {
  const start = ap.pausedFrom ? new Date(ap.pausedFrom).getTime() : null
  const end = ap.pausedUntil ? new Date(ap.pausedUntil).getTime() : null
  return {
    start,
    end,
    paused: start !== null && start <= now && (end === null || now < end),
    later: start !== null && start > now,
  }
}

/** One line on what the renewal of a running ticket will do. */
/** Relaunch a suspended or failed renewal: the server tries the payment right away and answers with the outcome. */
export async function relaunch(ap: Autopilot, onChanged: () => void) {
  const waiting = toast.loading('Relance en cours…', { description: 'PayByBot vérifie votre compte PayByPhone et paie si besoin.' })
  try {
    const after = await api.resumeAutopilot(ap.id)
    if (after.lastError) toast.error('Renouvellement non effectué', { id: waiting, description: 'La raison est affichée sous votre véhicule.' })
    else if (after.lastPayment) toast.success('Forfait renouvelé.', { id: waiting })
    else toast.success('Renouvellement relancé.', { id: waiting, description: 'Un ticket est déjà en cours : il prendra le relais à sa fin.' })
  } catch (e) {
    toast.error((e as Error).message, { id: waiting })
  }
  onChanged()
}

function RetryButton({ ap, onChanged }: { ap: Autopilot; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => {
        setBusy(true)
        await relaunch(ap, onChanged)
        setBusy(false)
      }}
      disabled={busy}
      className="mt-2 inline-flex items-center gap-1.5 rounded-[10px] bg-ink/[0.06] px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-ink/[0.1] disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Réessayer
    </button>
  )
}

/** A vacation pause set for later, in its own box under the ticket or the vehicle. */
export function PlannedPause({ ap, className }: { ap: Autopilot; className?: string }) {
  const { start, end, later } = pauseState(ap)
  if (!later || !ap.enabled) return null
  return (
    <p className={cn('flex items-center gap-2.5 rounded-xl border border-eu/15 bg-eu/[0.04] px-4 py-3 text-sm text-ink/75', className)}>
      <Pause className="size-4 shrink-0 text-eu" />
      <span>
        Pause prévue du {dayText(start!)} {end ? `au ${dayText(end - 1)}` : 'sans date de fin'}
      </span>
    </p>
  )
}

export function RenewalNote({ ap, onChanged }: { ap: Autopilot; onChanged?: () => void; next?: string }) {
  const { end, paused } = pauseState(ap)
  if (ap.validate)
    return (
      <>
        <span className="text-destructive">{ap.lastError}</span>
        <a href={`#/valider?t=${ap.validate}`} className="mt-2 flex w-fit items-center rounded-[10px] border-[1.5px] border-eu px-3 py-1.5 text-sm font-semibold text-eu transition hover:bg-eu/[0.06]">
          Valider mon paiement
        </a>
      </>
    )
  if (ap.lastError)
    return (
      <>
        <span className="text-destructive">{ap.lastError}</span>
        {onChanged && <span className="block"><RetryButton ap={ap} onChanged={onChanged} /></span>}
      </>
    )
  if (!ap.enabled)
    return (
      <>
        <span className="text-destructive">Renouvellement suspendu : vérifiez dans l'application PayByPhone, puis relancez-le.</span>
        {onChanged && <span className="block"><RetryButton ap={ap} onChanged={onChanged} /></span>}
      </>
    )
  if (paused) return <>Renouvellement en pause {end ? `jusqu'au ${dayText(end - 1)} inclus` : 'sans date de fin'}</>
  return <>Renouvellement du ticket programmé</>
}

/** Under a ticket: the vacation pause (planned, or a link to plan one), then the way to stop, in red. */
const actionBtn = 'flex h-11 w-full items-center justify-center gap-2 rounded-xl border font-semibold transition active:scale-[0.99] sm:w-auto sm:px-5'

export function RenewalActions({
  ap,
  onChanged,
  className,
  withStop = true,
  withPause = true,
  stopLabel = 'Arrêter le renouvellement',
  stoppedText = 'Renouvellement arrêté.',
  switchLabel,
}: {
  ap: Autopilot
  onChanged: () => void
  className?: string
  /** Shown as an on/off switch with this label (programmed tickets) instead of the stop button; the pause a link. */
  switchLabel?: string
  withStop?: boolean
  /** « Renouvellement » is the resident's word: programmed tickets say what stops instead. */
  stopLabel?: string
  /** A single programmed ticket: nothing to pause. */
  withPause?: boolean
  stoppedText?: string
}) {
  const [pausing, setPausing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { later, paused } = pauseState(ap)

  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(id)
  }, [confirming])

  const [busy, setBusy] = useState(false)

  async function resume() {
    if (busy) return
    setBusy(true)
    // After a failed payment, resuming tries the payment again (up to a minute): shown as such.
    if (ap.lastError) {
      await relaunch(ap, onChanged)
      return setBusy(false)
    }
    try {
      await api.resumeAutopilot(ap.id)
      toast.success(paused ? 'Renouvellement repris.' : 'Pause annulée.')
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
    onChanged()
  }

  async function stop() {
    if (busy) return
    setBusy(true)
    try {
      await api.deleteAutopilot(ap.id)
      toast.success(stoppedText, { description: 'Le ticket en cours reste valable.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
    onChanged()
  }

  if (!ap.enabled) return null
  if (switchLabel)
    return (
      // The card's own text size, like the resident card's « Renouvellement auto ».
      <div className={cn('space-y-3', className)}>
        {confirming ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-ink">{stopLabel} ?</span>
            <span className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-ink/[0.05]">
                Annuler
              </button>
              <button onClick={stop} disabled={busy} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                Confirmer
              </button>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[1.05rem] text-ink">{switchLabel}</span>
            {/* The pause on the switch's line (one line less on the card). */}
            <span className="ml-auto" />
            {withPause && !later && !paused && (
              <button onClick={() => setPausing(true)} className="inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap text-ink/55 transition hover:text-ink">
                <Pause className="size-3.5" />
                <span className="sm:hidden">Pause</span>
                <span className="hidden sm:inline">Programmer une pause</span>
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked
              aria-label={switchLabel}
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="relative h-7 w-12 shrink-0 rounded-full bg-[#4e9aa0] transition-colors disabled:opacity-60"
            >
              <span className="absolute top-1 left-1 grid size-5 translate-x-5 place-items-center rounded-full bg-white shadow transition-transform">
                {busy && <Loader2 className="size-3 animate-spin text-ink/50" />}
              </span>
            </button>
          </div>
        )}
        {later ? (
          <div className="flex items-center justify-between gap-3">
            <PlannedPause ap={ap} className="flex-1" />
            <button onClick={resume} disabled={busy} className={cn('shrink-0', ui.link)}>
              Annuler
            </button>
          </div>
        ) : paused ? (
          <button onClick={resume} disabled={busy} className={cn('text-sm', ui.link)}>
            Reprendre maintenant
          </button>
        ) : null}
        {pausing && <PauseDialog ap={ap} onClose={() => setPausing(false)} onDone={onChanged} />}
      </div>
    )
  return (
    <div className={cn('space-y-3 text-[0.95rem]', className)}>
      {later ? (
        <div className="flex items-center justify-between gap-3">
          <PlannedPause ap={ap} className="flex-1" />
          <button onClick={resume} disabled={busy} className={cn('shrink-0', ui.link)}>
            Annuler
          </button>
        </div>
      ) : paused ? (
        <button onClick={resume} disabled={busy} className={cn(actionBtn, 'border-ink/15 text-ink hover:border-ink/40')}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Reprendre maintenant
        </button>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {withPause && !later && !paused && (
          <button onClick={() => setPausing(true)} className={cn(actionBtn, 'border-ink/15 text-ink hover:border-ink/40')}>
            <Pause className="size-4" /> Programmer une pause
          </button>
        )}
        {withStop && <button
          onClick={() => (confirming ? stop() : setConfirming(true))}
          disabled={busy}
          className={cn(
            actionBtn,
            confirming
              ? 'border-destructive bg-destructive text-white'
              : 'border-destructive/30 text-destructive hover:border-destructive',
          )}
        >
          {confirming ? 'Confirmer l’arrêt' : stopLabel}
        </button>}
      </div>
      {pausing && <PauseDialog ap={ap} onClose={() => setPausing(false)} onDone={onChanged} />}
    </div>
  )
}

/** The "Gérer" link of a renewal and everything behind it: vacation pause, e-mail, stop. */
export function ManageRenewal({ ap, onChanged, demo = false }: { ap: Autopilot; onChanged: () => void; demo?: boolean }) {
  const [managing, setManaging] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [emailing, setEmailing] = useState(false)

  async function resume() {
    if (ap.enabled) {
      try {
        await api.resumeAutopilot(ap.id)
        toast.success('Renouvellement repris.')
      } catch (e) {
        toast.error((e as Error).message)
      }
      return onChanged()
    }
    // Relaunch: the server tries the payment right away and answers with the outcome (up to about a minute).
    await relaunch(ap, onChanged)
  }

  async function stop() {
    try {
      await api.deleteAutopilot(ap.id)
      toast.success('Renouvellement hebdomadaire arrêté.', { description: 'Le ticket en cours reste valable.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
    onChanged()
  }

  return (
    <>
      <button onClick={() => setManaging(true)} className={cn('shrink-0 text-sm', ui.link)}>
        Gérer
      </button>
      {pausing && <PauseDialog ap={ap} onClose={() => setPausing(false)} onDone={onChanged} />}
      {emailing && <EmailDialog ap={ap} demo={demo} onClose={() => setEmailing(false)} onDone={onChanged} />}
      {managing && (
        <ManageDialog
          ap={ap}
          onClose={() => setManaging(false)}
          onPause={() => {
            setManaging(false)
            setPausing(true)
          }}
          onResume={() => {
            setManaging(false)
            resume()
          }}
          onEmail={() => {
            setManaging(false)
            setEmailing(true)
          }}
          onStop={() => {
            setManaging(false)
            stop()
          }}
        />
      )}
    </>
  )
}

const isResident = (r: Rate) => /r[ée]sid|riverain/i.test(`${r.name} ${r.type}`) && !r.parkingNotAllowedReason
const isTwoWheels = (text: string) => /2\s*roues|deux[\s-]*roues|moto|scooter|two[\s-]*wheel/i.test(text)

/** The resident rate for this vehicle: Paris has one for cars and one for motorbikes ("2 roues - Résident"). */
function residentRateFor(rates: Rate[], vehicleType?: string) {
  const residents = rates.filter(isResident)
  const moto = isTwoWheels(vehicleType ?? '')
  return residents.find((r) => isTwoWheels(`${r.name} ${r.type}`) === moto) ?? (moto ? residents[0] : undefined)
}

/** Prominent dashboard card: weekly resident renewal, set up in two clicks. */
export function RiverainCard({
  data,
  onChanged,
  hosted = false,
  demo = false,
}: {
  data: Overview | null
  onChanged: () => void
  hosted?: boolean
  demo?: boolean
}) {
  const [open, setOpen] = useState(false)

  const weekly = data?.autopilots.filter(isWeekly) ?? []

  // « Renouveler un autre véhicule » only while a riverain vehicle is not renewed yet.
  const key = (plate: string) => plate.replace(/[^0-9a-z]/gi, '').toUpperCase()
  const renewed = weekly.map((ap) => key(ap.plate)).sort().join(',')
  const [another, setAnother] = useState(false)
  useEffect(() => {
    if (!weekly.length || !data) return
    const covered = new Set(renewed.split(','))
    if (data.vehicles.every((v) => covered.has(key(v.plate)))) return setAnother(false) // nothing else at all
    let cancelled = false
    api.pricing().then(
      (p) => !cancelled && setAnother((p.vehicles ?? []).some((v) => !covered.has(key(v.plate)))),
      () => !cancelled && setAnother(false),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renewed, data?.vehicles.length])

  if (weekly.length && data) {
    // Renewals of a running ticket are shown on the ticket itself; only the others are listed here.
    const others = weekly.filter((ap) => !data.sessions.some((s) => s.plate === ap.plate && s.location === ap.location))
    return (
      <section className="rise">
        {others.length > 0 && (
          <ul className="mb-4 divide-y divide-border border-y border-border">
            {others.map((ap) => {
              const { paused } = pauseState(ap)
              return (
                <li key={ap.id} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="flex items-center gap-3">
                      <Plate plate={ap.plate} size="sm" />
                      <ZonePlate zone={ap.location} />
                    </span>
                    <p className="mt-2 text-sm text-ink/60">
                      {ap.lastError || paused || !ap.enabled ? <RenewalNote ap={ap} onChanged={onChanged} /> : <>Paiement en cours…</>}
                    </p>
                  </div>
                  <ManageRenewal ap={ap} onChanged={onChanged} demo={demo} />
                  </div>
                  <PlannedPause ap={ap} className="mt-3" />
                </li>
              )
            })}
          </ul>
        )}
        {another && (
          <button onClick={() => setOpen(true)} className={cn('mx-auto block text-sm', ui.link)}>
            Renouveler un autre véhicule
          </button>
        )}
        <RiverainDialog open={open} onOpenChange={setOpen} data={data} onDone={onChanged} hosted={hosted} demo={demo} />
      </section>
    )
  }

  return (
    <section className="rise">
      <ActivateRenewal data={data} onChanged={onChanged} hosted={hosted} demo={demo} />
    </section>
  )
}

/** The kind of ticket and the zone, as one quiet two-part tag: « Résident | 75001 ». */
export function ZoneTag({ zone, resident = true }: { zone: string; resident?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center overflow-hidden rounded-full border border-ink/10 text-[0.875rem] leading-none">
      {resident && <span className="bg-[#4e9aa0]/10 px-2.5 py-1.5 font-medium text-[#3d7f84]">Résident</span>}
      <span className="px-2.5 py-1.5 text-ink/70 tabular-nums">{zone}</span>
    </span>
  )
}

/** « mardi 3 novembre, 23h54 » (minutes only when not on the hour). */
export function when(t: number) {
  const d = new Date(t)
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return `${day}, ${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`
}

/** When this week will be renewed: the server's next look if it is ahead, else the rule it follows (20h the day
 *  before the end, never more than 24 hours before it). */
export function nextRenewal(nextCheck: string | null | undefined, expire: string) {
  const end = new Date(expire).getTime()
  const planned = nextCheck ? new Date(nextCheck).getTime() : NaN
  if (planned > Date.now() && planned <= end + 60_000) return planned
  const dayBefore = new Date(end - 86_400_000)
  dayBefore.setHours(20, 0, 0, 0)
  return Math.max(dayBefore.getTime(), end - 86_400_000 + 60_000)
}

/** The switch's name, with whether it is on: « Renouvellement résident automatique », « Activé » or « Désactivé ». */
function SwitchLabel({ on, children, status }: { on: boolean; children?: ReactNode; status?: ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="block text-base font-medium text-ink sm:text-[1.05rem]">Renouvellement hebdomadaire automatique</span>
      <span className="flex items-center gap-3">
        {/* A line of its own (the next renewal) in place of « Activé », when the card gives one. */}
        {status ?? <span className={cn('text-sm', on ? 'font-medium text-[#3d7f84]' : 'text-ink/50')}>{on ? 'Activé' : 'Désactivé'}</span>}
        {children}
      </span>
    </span>
  )
}

/** « Renouvellement auto », off: a tap turns it green first (the switch answers at once), then opens its window;
 *  it stays green while the window is open and goes back to off if the window is closed without activating. */
export function OpeningSwitch({ open, isOpen, on = false }: { open: () => void; isOpen: boolean; on?: boolean }) {
  const [pressed, setPressed] = useState(false)
  useEffect(() => {
    if (isOpen) setPressed(false) // the window took over: green as long as it is open
  }, [isOpen])
  const checked = on || pressed || isOpen
  return (
    <div className="flex items-center justify-between gap-4">
      <SwitchLabel on={checked} />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Renouvellement résident automatique"
        onClick={() => {
          if (pressed || isOpen) return
          setPressed(true)
          setTimeout(open, 280) // the knob slides to green, then the window opens
        }}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-[#4e9aa0]' : 'bg-ink/15 hover:bg-ink/20')}
      >
        <span className={cn('absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-200', checked && 'translate-x-5')} />
      </button>
    </div>
  )
}

/** The « Activer le renouvellement résident » button and its dialog; with a plate, only that car is ticked. */
/** The ticket card's « Renouvellement auto » switch, Qonto-like (muted teal). Off with no renewal: opens the
 *  setup; on: turning it off asks to confirm, then stops; off after a failure: tries the payment again. */
export function RenewalSwitch({
  ap,
  data,
  plate,
  onChanged,
  hosted,
  demo,
  autoOpen,
  locked,
  onLogout,
  details,
  status,
}: {
  ap: Autopilot | null
  data: Overview
  plate: string
  onChanged: () => void
  hosted: boolean
  demo: boolean
  autoOpen?: boolean
  locked?: boolean
  onLogout?: () => void
  /** Shown under the switch's line (a note when something needs saying), above « Programmer une pause ». */
  details?: ReactNode
  /** Said under the switch's name instead of « Activé » (the next renewal). */
  status?: ReactNode
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pausing, setPausing] = useState(false)
  const on = !!ap && ap.enabled && !ap.lastError
  // On and not paused (nor a pause planned): the pause offered on the switch's line, like programmed tickets.
  const pausable = on && !!ap && !pauseState(ap).paused && !pauseState(ap).later

  async function stop() {
    if (!ap || busy) return
    setBusy(true)
    try {
      await api.deleteAutopilot(ap.id)
      toast.success('Renouvellement arrêté.', { description: 'Le ticket en cours reste valable.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
    setConfirming(false)
    onChanged()
  }

  const row = (onClick: () => void) => (
    <div className="flex items-center justify-between gap-4">
      {/* The title and its state on the left, the switch alone on the right: nothing in between. */}
      <SwitchLabel on={on} status={on ? status : undefined} />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Renouvellement résident automatique"
        disabled={busy}
        onClick={onClick}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-[#4e9aa0]' : 'bg-ink/15')}
      >
        <span className={cn('absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-white shadow transition-transform', on && 'translate-x-5')}>
          {busy && <Loader2 className="size-3 animate-spin text-ink/50" />}
        </span>
      </button>
    </div>
  )

  if (!ap)
    return (
      <ActivateRenewal
        data={data}
        onChanged={onChanged}
        hosted={hosted}
        demo={demo}
        plate={plate}
        autoOpen={autoOpen}
        locked={autoOpen && locked}
        onLogout={onLogout}
        trigger={(open, isOpen) => <OpeningSwitch open={open} isOpen={isOpen} />}
      />
    )
  if (confirming)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-ink">Arrêter le renouvellement ?</span>
        <span className="flex gap-2">
          <button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink/70 hover:bg-ink/[0.05]">
            Annuler
          </button>
          <button onClick={stop} disabled={busy} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white">
            Arrêter
          </button>
        </span>
      </div>
    )
  return (
    <>
      {row(() =>
        on
          ? setConfirming(true)
          : (async () => {
              setBusy(true)
              await relaunch(ap, onChanged)
              setBusy(false)
            })(),
      )}
      {details}
      {pausable && (
        <button onClick={() => setPausing(true)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink/55 transition hover:text-ink">
          <Pause className="size-3.5" /> Programmer une pause
        </button>
      )}
      {pausing && <PauseDialog ap={ap} onClose={() => setPausing(false)} onDone={onChanged} />}
    </>
  )
}

export function ActivateRenewal({
  data,
  onChanged,
  hosted = false,
  demo = false,
  plate,
  label = 'Activer le renouvellement résident',
  autoOpen = false,
  locked = false,
  onLogout,
  trigger,
}: {
  data: Overview | null
  onChanged: () => void
  hosted?: boolean
  demo?: boolean
  plate?: string
  /** Something else than the big button opens the dialog (the ticket card's switch); told whether it is open. */
  trigger?: (open: () => void, isOpen: boolean) => ReactNode
  /** A ticket is running: the renewal only takes over when it ends. */
  label?: string
  /** Just signed up: the dialog opens by itself, like Frequens (then the offer, then the renewal). */
  autoOpen?: boolean
  /** No offer chosen yet: the dialog cannot be closed (only left by signing out). */
  locked?: boolean
  onLogout?: () => void
}) {
  const [open, setOpen] = useState(!!autoOpen && !!data)
  // The account (and so the lock) arrives after the first render.
  useEffect(() => {
    if ((autoOpen || locked) && data) setOpen(true)
  }, [autoOpen, locked, !!data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {trigger ? (
        trigger(() => data && setOpen(true), open)
      ) : (
        <ShinyButton onClick={() => setOpen(true)} disabled={!data} className="flex h-14 w-full items-center justify-center rounded-xl border border-eu/30 bg-eu/[0.07] px-6 text-lg font-bold text-eu hover:bg-eu/[0.1] disabled:opacity-50">
          {label}
        </ShinyButton>
      )}
      {data && <RiverainDialog open={open} onOpenChange={setOpen} data={data} onDone={onChanged} hosted={hosted} demo={demo} plate={plate} locked={locked} onLogout={onLogout} />}
    </>
  )
}

type Found = { rate: Rate | null; quote: Quote | null; error: string | null }
type Quote = { cost: Money | null; afterCurrent?: boolean; currentExpire?: string | null; priceSource?: 'history' | 'paris' | null }

function RiverainDialog({
  open,
  onOpenChange,
  data,
  onDone,
  hosted,
  demo = false,
  plate,
  locked = false,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: Overview
  onDone: () => void
  hosted: boolean
  demo?: boolean
  /** Opened from a car's card: only that car is ticked. */
  plate?: string
  locked?: boolean
  onLogout?: () => void
}) {
  const [plates, setPlates] = useState<string[] | null>(null) // the « riverain » vehicles (null: looking)
  const [selected, setSelected] = useState<string[]>([])
  const [zones, setZones] = useState<Record<string, string>>({}) // each riverain vehicle's arrondissement, from PayByPhone
  const [knownRates, setKnownRates] = useState<Record<string, Rate | null>>({}) // each one's resident rate, from the prices
  const [weeks, setWeeks] = useState<Record<string, number | null>>({}) // the resident week's price, in cents
  const [payment, setPayment] = useState('')
  const [found, setFound] = useState<Record<string, Found>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The bank asks to confirm every payment: trying again would only send it another request.
  const cardRefused = !!error && /3-D Secure|banque a refusé/.test(error)
  // Online, a renewal needs a subscription, chosen on Stripe even during the free month (nothing charged before
  // it ends): without one, « Activer » opens the offer choice first.
  const [account, setAccount] = useState<Account | null>(null)
  const [paywall, setPaywall] = useState(false)
  useEffect(() => {
    if (open && hosted && !demo) api.account().then(setAccount, () => {})
  }, [open, hosted, demo])

  const covered = new Set(data.autopilots.filter(isWeekly).map((a) => a.plate))
  // Renewals pay with a saved card only (PayPal or the phone bill are not offered for them).
  // Expired cards would be refused: never offered.
  const allCards = data.payments.filter((p) => p.kind === 'card')
  const cards = allCards.filter((p) => !p.expired)

  // Each time the dialog opens: the riverain vehicles not renewed yet (all ticked), each with the arrondissement
  // PayByPhone gives it the resident rate in (never typed), and the card.
  useEffect(() => {
    if (!open) return
    const last = loadLast()
    setError(null)
    setFound({})
    setPlates(null)
    api.pricing(60_000).then(
      (p) => {
        const riverain = (p.vehicles ?? []).filter((v) => v.zone)
        setZones(Object.fromEntries(riverain.map((v) => [v.plate, v.zone as string])))
        setKnownRates(Object.fromEntries(riverain.map((v) => [v.plate, v.rate ?? null])))
        setWeeks(Object.fromEntries(riverain.map((v) => [v.plate, v.weekly ?? null])))
        setPlates(riverain.map((v) => v.plate))
        const same = (x: string) => !plate || x.replace(/[^0-9a-z]/gi, '').toUpperCase() === plate.replace(/[^0-9a-z]/gi, '').toUpperCase()
        setSelected(riverain.map((v) => v.plate).filter((x) => !covered.has(x) && same(x)))
      },
      (e) => {
        setPlates([])
        setError((e as Error).message)
      },
    )
    setPayment(cards.find((p) => p.id === last.paymentAccountId)?.id ?? cards[0]?.id ?? '')
    // Then the card PayByPhone was last paid with, when there is a choice.
    if (cards.length > 1)
      api.lastCard().then(
        (r) => r.paymentAccountId && cards.some((p) => p.id === r.paymentAccountId) && setPayment(r.paymentAccountId),
        () => {},
      )
    // Only when it opens: a refresh of the account behind it must not wipe the price or a message on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && !payment && cards[0]) setPayment(cards[0].id)
  }, [open, cards, payment])

  const ready = open && selected.length > 0 && payment

  // For each ticked vehicle: its resident rate and the price of a week, in its own arrondissement.
  useEffect(() => {
    if (!ready) {
      setFound({})
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const results = await Promise.all(
        selected.map(async (plate): Promise<[string, Found]> => {
          try {
            // The rate the account's prices already found, else asked to PayByPhone.
            const resident =
              knownRates[plate] ?? residentRateFor(await api.rates(zones[plate], plate), data.vehicles.find((v) => v.plate === plate)?.type)
            if (!resident) throw new Error('Pas de tarif résident pour ce véhicule dans cette zone.')
            if (!resident.acceptedTimeUnits.includes('Days')) throw new Error('Le tarif résident de cette zone ne se paie pas à la journée.')
            const quote = await api.quote({ ...parking(resident, plate), renewal: true })
            return [plate, { rate: resident, quote, error: null }]
          } catch (e) {
            return [plate, { rate: null, quote: null, error: (e as Error).message }]
          }
        }),
      )
      if (!cancelled) {
        setFound(Object.fromEntries(results))
        setLoading(false)
      }
    }, Object.keys(found).length ? 350 : 0) // at once when the window opens, then after the ticks settle
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected.join(','), payment])

  function parking(r: Rate, plate: string): Parking {
    return { location: zones[plate], rate: r.ratePolicyId, duration: WEEK_DAYS, unit: 'Days', plate, paymentAccountId: payment }
  }

  const samePlate = (a: string, b: string) => a.replace(/[^0-9a-z]/gi, '').toUpperCase() === b.replace(/[^0-9a-z]/gi, '').toUpperCase()
  const runningFor = (plate: string) =>
    !!found[plate]?.quote?.afterCurrent || data.sessions.some((s) => samePlate(s.plate, plate) && new Date(s.expire).getTime() > Date.now())
  const ok = selected.filter((plate) => found[plate]?.rate && found[plate]?.quote)

  function toggle(plate: string) {
    setSelected((list) => (list.includes(plate) ? list.filter((x) => x !== plate) : [...list, plate]))
  }

  async function activate() {
    if (!ok.length) return
    if (account && !account.subscribed && !account.blocked) {
      // No subscription yet: the offer screen first. The renewal is activated on the way back from Stripe, and
      // that is when the first payment (or the extension) happens.
      setPaywall(true)
      return
    }
    setSaving(true)
    setError(null)
    const failed: string[] = []
    let shown = 0
    for (const plate of ok) {
      try {
        const p = parking(found[plate].rate!, plate)
        // Confirmations go to the account e-mail; online, the answer says what was paid and when the next is.
        const { activation } = await api.addAutopilot({ ...p, label: WEEKLY_LABEL })
        saveLast(p)
        if (activation) {
          activationToast(activation, ok.length > 1 ? plate : undefined)
          shown += 1
        }
      } catch (e) {
        // No subscription yet (the account had not loaded when « Activer » was clicked): the offer screen.
        if (e instanceof ApiError && e.status === 402 && /offre/.test(e.message)) {
          setSaving(false)
          setPaywall(true)
          return
        }
        failed.push(`${plate} : ${(e as Error).message}`)
      }
    }
    setSaving(false)
    const done = ok.length - failed.length
    if (done) {
      if (!shown)
        toast.success(done > 1 ? `Renouvellement activé pour ${done} véhicules.` : 'Renouvellement hebdomadaire activé.', {
          description: ok.some(runningFor)
            ? 'Chaque renouvellement prend le relais à la fin du ticket en cours.'
            : 'La première semaine est en cours de paiement.',
        })
      setTimeout(onDone, 2500)
      onDone()
    }
    if (failed.length) setError(failed.join('\n'))
    else onOpenChange(false)
  }

  return (
    // Always closable with the cross, even when it opened by itself (locked): the dashboard stays behind it.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(ui.dialog, 'sm:max-w-lg')}>
        <div className="px-6 pt-7">
          <DialogTitle className={cn(ui.dialogTitle, 'font-semibold')}>Renouvellement hebdomadaire</DialogTitle>
          {/* Opened from a car's card: the button says what to do, no sentence needed. */}
          <DialogDescription className={plate ? 'sr-only' : 'mt-1 text-ink/60'}>
            {plate ? 'Vérifiez, puis activez. On s’occupe du reste.' : "Choisissez les véhicules à renouveler, vérifiez, puis activez. On s'occupe du reste."}
          </DialogDescription>
        </div>

        <div className="space-y-6 p-6">
          {/* Opened from a car's card: that car only, nothing to choose. */}
          {!plate && (
          <div>
            <p className={ui.label}>{plates && plates.length > 1 ? 'Véhicules résidents' : 'Véhicule résident'}</p>
            {plates === null ? (
              <div className="grid h-12 place-items-center rounded-xl border border-ink/10">
                <LoadingLine className="items-center" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {plates.map((plate) =>
                  covered.has(plate) ? (
                    <span key={plate} className="inline-flex flex-col items-center gap-1 rounded-xl border border-ink/10 p-2 opacity-60">
                      <Plate plate={plate} size="sm" />
                      <span className="text-xs text-ink/55">Déjà renouvelé</span>
                    </span>
                  ) : (
                    <button
                      key={plate}
                      onClick={() => toggle(plate)}
                      aria-pressed={selected.includes(plate)}
                      className={choice(selected.includes(plate), 'flex items-center gap-2 p-2')}
                    >
                      <span
                        className={cn(
                          'grid size-5 place-items-center rounded-md border',
                          selected.includes(plate) ? 'border-eu bg-eu text-white' : 'border-ink/25',
                        )}
                      >
                        {selected.includes(plate) && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <Plate plate={plate} size="sm" />
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          )}

          {!allCards.length && <NoPayment compact onRefresh={async () => onDone()} />}
          {allCards.length > 0 && !cards.length && (
            <p role="alert" className="rounded-xl border-l-4 border-destructive bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {allCards.length > 1 ? "Les cartes" : "La carte"} de votre compte PayByPhone {allCards.length > 1 ? 'ont' : 'a'} expiré (
              {allCards.map((p) => p.label.split('—').pop()!.trim()).join(', ')}). Ajoutez votre nouvelle carte dans l'application PayByPhone, puis rouvrez cette fenêtre.
            </p>
          )}

          {cards.length > 1 && (
            <div>
              <p className={ui.label}>Payer avec</p>
              <div className="flex flex-wrap gap-2">
                {cards.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPayment(p.id)}
                    className={choice(payment === p.id, 'px-3 py-2 text-sm font-bold')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Summary: one line per ticked vehicle */}
          <div className="rounded-xl border border-ink/10 p-4" aria-live="polite">
            {!selected.length ? (
              <p className="text-muted-foreground">Cochez au moins un véhicule.</p>
            ) : loading ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Recherche du tarif résident…
              </p>
            ) : (
              <ul className="space-y-3">
                {selected.map((plate) => {
                  const f = found[plate]
                  const cents = weeks[plate] ?? (f?.quote?.cost ? Math.round(f.quote.cost.amount * 100) : null)
                  return (
                    <li key={plate} className="min-w-0">
                      {/* Like the ticket card: the plate left, « Résident | zone » right, then the price and when it is paid. */}
                      <span className="flex items-center justify-between gap-3">
                        <Plate plate={plate} size="sm" />
                        {zones[plate] && <ZoneTag zone={zones[plate]} />}
                      </span>
                      {cents != null && !f?.error && (
                        <span className="mt-4 block font-heading text-[1.3rem] leading-none text-ink tabular-nums">
                          {(cents / 100).toFixed(2).replace('.', ',')} € <span className="text-base text-ink/50">par semaine</span>
                        </span>
                      )}
                      {(() => {
                        // The first payment: the day before the running ticket ends, else right away.
                        const t = data.sessions.find((x) => samePlate(x.plate, plate) && new Date(x.expire).getTime() > Date.now())
                        return (
                          <span className="mt-2 block text-sm text-ink/50">
                            Premier paiement : <span className="whitespace-nowrap text-ink">{t ? when(nextRenewal(null, t.expire)) : 'maintenant'}</span>
                          </span>
                        )
                      })()}
                      {f?.error && <span className="mt-1 block text-sm text-destructive">{f.error}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-xl border-l-4 border-destructive bg-destructive/8 px-4 py-3 text-sm whitespace-pre-line text-destructive">
              {error}
              {cardRefused && cards.length > 1 && (
                <span className="mt-2 block font-semibold">Vous pouvez aussi choisir votre autre carte ci-dessus, puis réessayer.</span>
              )}
            </p>
          )}

          {/* After a refusal: retry on purpose (once the card is checked or changed in PayByPhone, or with the other
              card chosen above), never by accident. */}
          <button
            onClick={() => {
              setError(null)
              activate()
            }}
            disabled={!ok.length || loading || saving}
            className={ui.primary}
          >
            {cardRefused ? (
              <>
                <RotateCw className="size-5" /> Réessayer
              </>
            ) : saving ? (
              <Loader2 className="size-5 animate-spin" />
            ) : ok.length > 1 ? (
              `Activer le renouvellement pour ${ok.length} véhicules`
            ) : (
              'Activer le renouvellement'
            )}
          </button>
          {locked && onLogout && (
            <button onClick={onLogout} className={cn('mx-auto block text-sm', ui.link)}>
              Se déconnecter
            </button>
          )}
        </div>
      </DialogContent>
      {paywall && (
        <PlansDialog
          plates={ok}
          onPay={() => savePending(ok.map((plate) => parking(found[plate].rate!, plate)))}
          onClose={() => {
            clearPending()
            setPaywall(false)
          }}
        />
      )}
    </Dialog>
  )
}

/** PayByPhone offers no resident rate to the account in its home zone: say it, and what to do. */
export function NoResidentStatus({ zone, className }: { zone: string | null; className?: string }) {
  const where = zone ? arrondissement(zone) ?? `la zone ${zone}` : null
  return (
    <div role="status" className={cn('rounded-2xl border border-amber/60 bg-amber/10 p-4 text-left', className)}>
      <p className="font-semibold text-ink">Tarif résident requis sur {withPayByPhone('PayByPhone')}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink/70">
        Aucun tarif résident n’a été trouvé pour vos véhicules{where ? ` (${where})` : ''}. Effectuez votre demande de
        stationnement résident, puis revenez une fois le tarif actif dans votre application {withPayByPhone('PayByPhone')}.
      </p>
    </div>
  )
}

/** Paris arrondissements and their resident zone number on PayByPhone (the postcode). */
const ARRONDISSEMENTS = Array.from({ length: 20 }, (_, i) => ({
  label: i === 0 ? '1er' : `${i + 1}e`,
  zone: `750${String(i + 1).padStart(2, '0')}`,
}))

/** « 17 », « 17e », « Paris 17 » or « 75017 » -> the matching arrondissements, as they are typed. */
function matchArrondissements(query: string) {
  const digits = query.replace(/\D/g, '')
  if (!digits) return []
  if (digits.startsWith('75')) return ARRONDISSEMENTS.filter((a) => a.zone.startsWith(digits)).slice(0, 6)
  const n = digits.replace(/^0+/, '')
  return n ? ARRONDISSEMENTS.filter((a) => String(Number(a.zone.slice(3))).startsWith(n)).slice(0, 6) : []
}

/** The home zone: shown when known (history, account), else typed: suggestions appear as you type. */
export function ZoneField({
  zone,
  fromHistory,
  onZone,
}: {
  zone: string
  fromHistory: boolean
  onZone: (zone: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const open = editing || !zone
  const matches = matchArrondissements(query)

  function choose(z: string) {
    onZone(z)
    setQuery('')
    setEditing(false)
  }

  if (!open) {
    return (
      <div>
        <p className={ui.label}>Arrondissement de résidence</p>
        <div className="flex items-center justify-between gap-4">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {arrondissement(zone) && <span className="font-semibold text-ink">{arrondissement(zone)}</span>}
            <ZonePlate zone={zone} />
            {fromHistory && <span className="text-sm text-ink/50">d'après votre historique</span>}
          </span>
          <button onClick={() => setEditing(true)} className={cn('text-sm', ui.link)}>
            Changer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor="riverain-arrondissement" className={ui.label}>
        Votre arrondissement de résidence
      </label>
      <input
        id="riverain-arrondissement"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls="riverain-arrondissements"
        autoComplete="off"
        inputMode="numeric"
        placeholder="Ex. : 17 ou 75017"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault()
            choose(matches[0].zone)
          }
        }}
        autoFocus
        className={cn(ui.field, 'h-12 text-base')}
      />
      {matches.length > 0 && (
        <ul
          id="riverain-arrondissements"
          role="listbox"
          aria-label="Arrondissements"
          className="mt-2 overflow-hidden rounded-xl border border-ink/15"
        >
          {matches.map((a) => (
            <li key={a.zone}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => choose(a.zone)}
                className="flex w-full items-center justify-between gap-3 border-b border-ink/10 px-4 py-3 text-left last:border-b-0 hover:bg-muted"
              >
                <span className="font-semibold text-ink">Paris {a.label}</span>
                <span className="text-sm font-bold text-ink/50 tabular-nums">{a.zone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && !matches.length && (
        <p className="mt-2 text-sm text-ink/55">Tapez un arrondissement de Paris, de 1 à 20.</p>
      )}
      {zone && (
        <button onClick={() => setEditing(false)} className={cn('mt-2 text-sm', ui.link)}>
          Garder {arrondissement(zone) ?? `la zone ${zone}`}
        </button>
      )}
    </div>
  )
}

function dayText(ms: number) {
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Vacation pause: no payment between two days (Paris time), or from a day with no end yet. */
/** Where the renewal's confirmations go: one address, or none. */
function EmailDialog({ ap, demo, onClose, onDone }: { ap: Autopilot; demo: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(ap.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = email.trim() === '' ? null : emailProblem(email)

  async function save(value: string) {
    setSaving(true)
    setError(null)
    try {
      await api.setAutopilotEmail(ap.id, value)
      toast.success(value ? 'Les confirmations seront envoyées à cette adresse.' : 'Vous ne recevrez plus d’e-mails.')
      onClose()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Confirmations par e-mail</DialogTitle>
          <DialogDescription className="mt-1 text-ink/60">
            Un e-mail à chaque paiement, et une alerte en cas de problème.
            {demo && ' Mode démo : aucun e-mail n’est envoyé.'}
          </DialogDescription>
        </div>
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (problem) setError(problem)
            else save(email.trim())
          }}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="vous@exemple.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Adresse e-mail"
            className={ui.field}
          />
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving || email.trim() === (ap.email ?? '')} className={ui.primary}>
            {saving ? <Loader2 className="size-5 animate-spin" /> : 'Enregistrer'}
          </button>
          {ap.email && (
            <button type="button" onClick={() => save('')} disabled={saving} className={cn('mx-auto block text-sm', ui.link)}>
              Ne plus recevoir d’e-mails
            </button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PauseDialog({ ap, onClose, onDone }: { ap: Autopilot; onClose: () => void; onDone: () => void }) {
  const today = isoDay(new Date())
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState('')
  const [noEnd, setNoEnd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = start >= today && (noEnd || (end !== '' && end >= start))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.pauseAutopilot(ap.id, start, noEnd ? null : end)
      toast.success('Pause enregistrée.', {
        description: noEnd ? 'Reprenez quand vous voulez depuis le tableau de bord.' : 'Le renouvellement reprendra tout seul.',
      })
      onClose()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Programmer une pause</DialogTitle>
          <DialogDescription className="mt-1 text-ink/60">
            Aucun forfait ne sera payé pendant la pause. Un ticket déjà en cours reste valable jusqu’à sa fin.
          </DialogDescription>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <Plate plate={ap.plate} size="sm" />
            <ZonePlate zone={ap.location} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={ui.label}>Premier jour</span>
              <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className={cn(ui.field, 'h-12 text-base')} />
            </label>
            <label className="space-y-1.5">
              <span className={ui.label}>Dernier jour</span>
              <input
                type="date"
                min={start}
                value={end}
                disabled={noEnd}
                onChange={(e) => setEnd(e.target.value)}
                className={cn(ui.field, 'h-12 text-base disabled:opacity-40')}
              />
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} className="size-5 accent-[var(--eu)]" />
            <span>Pas de date de fin pour le moment</span>
          </label>
          <p className={ui.note}>
            {noEnd
              ? `En pause à partir du ${start ? dayText(new Date(start + 'T12:00').getTime()) : '…'}, jusqu’à ce que vous repreniez.`
              : end
                ? `En pause du ${dayText(new Date(start + 'T12:00').getTime())} au ${dayText(new Date(end + 'T12:00').getTime())} inclus. Reprise automatique le lendemain.`
                : 'Choisissez le dernier jour de pause.'}
          </p>
          {error && <p role="alert" className="rounded-lg border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-destructive">{error}</p>}
          <button onClick={save} disabled={!valid || saving} className={ui.primary}>
            {saving ? <Loader2 className="size-5 animate-spin" /> : 'Mettre en pause'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The options of one renewal, behind a single "Gérer" link to keep the card quiet. */
function ManageDialog({
  ap,
  onClose,
  onPause,
  onResume,
  onEmail,
  onStop,
}: {
  ap: Autopilot
  onClose: () => void
  onPause: () => void
  onResume: () => void
  onEmail: () => void
  onStop: () => void
}) {
  const now = Date.now()
  const start = ap.pausedFrom ? new Date(ap.pausedFrom).getTime() : null
  const end = ap.pausedUntil ? new Date(ap.pausedUntil).getTime() : null
  const pauseSet = start !== null && (end === null || now < end)
  const row = 'flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-base font-normal transition hover:bg-muted'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 rounded-2xl bg-white p-2 sm:max-w-sm">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Plate plate={ap.plate} size="sm" />
          <DialogTitle className="text-base font-normal">Renouvellement zone {ap.location}</DialogTitle>
          <DialogDescription className="sr-only">Options du renouvellement</DialogDescription>
        </div>
        {!ap.enabled ? (
          <button onClick={onResume} className={row}>
            <Play className="size-5" /> Relancer le renouvellement
          </button>
        ) : pauseSet ? (
          <button onClick={onResume} className={row}>
            <Play className="size-5" /> {start! <= now ? 'Reprendre maintenant' : 'Annuler la pause prévue'}
          </button>
        ) : (
          <button onClick={onPause} className={row}>
            <Pause className="size-5" /> Pause vacances
          </button>
        )}
        <button onClick={onEmail} className={row}>
          <Mail className="size-5" />
          <span className="min-w-0">
            Confirmations par e-mail
            <span className="block truncate text-sm font-normal text-muted-foreground">{ap.email || 'Désactivées'}</span>
          </span>
        </button>
        <button onClick={onStop} className={`${row} font-bold text-destructive hover:bg-destructive/10`}>
          <Repeat className="size-5" /> Arrêter le renouvellement
        </button>
      </DialogContent>
    </Dialog>
  )
}

export type ResidentStatus = { zone: string | null; resident: boolean | null }

/**
 * No resident rate on PayByPhone: PayByBot cannot be used. Full screen over the blurred page, with a way to check
 * again once the rate is granted, to correct the arrondissement, or to leave.
 */
export function ResidentGate({
  zone,
  vehicles,
  onChecked,
}: {
  zone: string | null
  vehicles?: number
  onChecked: (status: ResidentStatus) => void
}) {
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      const status = await api.residentStatus()
      if (status.resident === false) toast('Toujours aucun tarif résident sur votre compte PayByPhone.')
      onChecked(status)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  async function logout() {
    await api.logout().catch(() => {})
    window.location.assign('/')
  }

  return (
    <ResidentRequired zone={zone} vehicles={vehicles}>
      <button onClick={check} disabled={checking} className={cn('mt-7', ui.primary)}>
        {checking ? <Loader2 className="size-5 animate-spin" /> : 'J’ai le tarif résident, vérifier à nouveau'}
      </button>
      <p className="mt-5 text-center text-sm">
        <button onClick={logout} className={ui.link}>
          Se déconnecter
        </button>
      </p>
    </ResidentRequired>
  )
}

/** Full screen over the blurred page: PayByBot needs a vehicle with the resident rate; what to do, then the actions. */
/** Full screen over the blurred page: what PayByBot needs and what to do, then the actions (children). */
function FullScreenNotice({ title, intro, steps, children }: { title: string; intro: ReactNode; steps: string[]; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-screen-notice-title"
      className="fixed inset-0 z-50 grid center-safe overflow-y-auto bg-white/60 p-4 backdrop-blur-md sm:p-6"
    >
      <div className="rise w-full max-w-lg rounded-3xl border border-ink/10 bg-white p-7 shadow-[0_40px_80px_-30px_rgb(11_16_36/0.35)] sm:p-9">
        <span className="grid size-12 place-items-center rounded-2xl bg-eu font-heading text-2xl font-bold text-white">P</span>
        <h2 id="full-screen-notice-title" className="mt-5 font-heading text-[1.9rem] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h2>
        <p className="mt-3 leading-relaxed text-ink/70">{intro}</p>
        <ol className="mt-5 space-y-2.5 text-[0.95rem] leading-relaxed text-ink/80">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-eu/[0.08] text-sm font-bold text-eu">
                {i + 1}
              </span>
              <span>{withPayByPhone(step)}</span>
            </li>
          ))}
        </ol>
        {children}
      </div>
    </div>
  )
}

/** PayByBot needs a vehicle with the resident rate. */
export function ResidentRequired({
  zone = null,
  vehicles = 2,
  children,
}: {
  zone?: string | null
  vehicles?: number // one: « votre véhicule », else the plural
  children: ReactNode
}) {
  const where = zone ? arrondissement(zone) ?? `la zone ${zone}` : null
  return (
    <FullScreenNotice
      title="Stationnement résident requis"
      intro={
        <>
          Pour accéder aux services <PayByBot />,{' '}
          {vehicles === 1 ? 'votre véhicule doit' : 'au moins un de vos véhicules doit'} bénéficier du tarif résident sur
          votre compte {withPayByPhone('PayByPhone')}
          {where ? ` (${where})` : ''}.{' '}
          {vehicles === 1 ? 'Ce n’est pas le cas pour le moment.' : 'Ce n’est le cas d’aucun d’entre eux pour le moment.'}
        </>
      }
      steps={[
        'Faites votre demande de stationnement résident pour obtenir le forfait résident.',
        'Vérifiez que le tarif résident apparaît dans votre application PayByPhone.',
        'Revenez ici : l’accès à PayByBot s’ouvre dès que le tarif résident est actif.',
      ]}
    >
      {children}
    </FullScreenNotice>
  )
}

/** Sign-up: PayByBot pays with a card saved on PayByPhone. */
export const CARD_NOTE = 'Une carte bancaire enregistrée dans PayByPhone est nécessaire.'

/** PayByBot pays with a card saved on PayByPhone. */
export function CardRequired({ children }: { children: ReactNode }) {
  return (
    <FullScreenNotice
      title="Carte bancaire requise"
      intro={
        <>
          Pour renouveler votre forfait automatiquement, <PayByBot /> paie avec une carte bancaire enregistrée sur votre compte{' '}
          {withPayByPhone('PayByPhone')}. Aucune carte n’y est enregistrée pour le moment. Apple Pay et Google Pay ne
          permettent pas le paiement automatique : ils demandent une validation sur votre téléphone à chaque paiement.
        </>
      }
      steps={[
        'Ouvrez l’application PayByPhone, rubrique Moyens de paiement.',
        'Ajoutez une carte bancaire.',
        'Revenez ici : l’accès à PayByBot s’ouvre dès que la carte est enregistrée.',
      ]}
    >
      {children}
    </FullScreenNotice>
  )
}

/** Signed in without a saved card: PayByBot is not usable until one is added (the page reloads to check). */
export function CardGate() {
  async function logout() {
    await api.logout().catch(() => {})
    window.location.assign('/')
  }
  return (
    <CardRequired>
      <button onClick={() => window.location.reload()} className={cn('mt-7', ui.primary)}>
        J’ai ajouté une carte, vérifier à nouveau
      </button>
      <p className="mt-5 text-center text-sm">
        <button onClick={logout} className={ui.link}>
          Se déconnecter
        </button>
      </p>
    </CardRequired>
  )
}
