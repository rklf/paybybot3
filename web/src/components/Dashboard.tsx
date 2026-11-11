import { Loading } from '@/components/Loading'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Accessibility, LogOut, Plus } from 'lucide-react'
import { PayByPhone, Plate, vehicleType, withPayByPhone } from '@/components/signs'
import { TopBar } from '@/components/TopBar'
import { InviteButton } from '@/components/Invite'
import { DailyTickets, DailyWizard, isDaily, ruleState, when as whenAt } from '@/components/DailyTickets'
import { AccountButton } from '@/components/Account'
import { HistoryButton } from '@/components/History'
import { FreeMonthCard, ReactivateCard, TrialBanner } from '@/components/Pricing'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { LineBone } from '@/components/Skeletons'
import { HostedFooter } from '@/components/Footer'
import { CheckoutDone } from '@/components/CheckoutDone'
import { ActivateRenewal, CardGate, OpeningSwitch, RenewalActions, RenewalNote, RenewalSwitch, RiverainDialog, pauseState, nextRenewal, when, ZoneTag, RiverainCard, WEEKLY_LABEL, renewalOf, runPendingRenewals } from '@/components/Riverain'
import { RippleButton } from '@/components/ui/ripple-button'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { api, type Account, type Me, type Overview, type Session } from '@/lib/api'

function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}

/** The time left as a countdown: [['6', 'jours'], ['10', 'heures'], ['57', 'minutes']] (days only when there are some). */


function Ticket({
  session,
  now,
  data,
  onRefresh,
  hosted,
  demo,
  autoOpen = false,
  locked = false,
  onLogout,
  daily = false,
  pending = false,
  place,
  group = [session],
  needsOffer = false,
}: {
  session: Session
  now: number
  data: Overview
  onRefresh: () => Promise<void>
  hosted: boolean
  demo: boolean
  autoOpen?: boolean
  locked?: boolean
  onLogout?: () => void
  /** A non-resident ticket: no weekly renewal switch. */
  daily?: boolean
  /** Not known yet whether the car is resident (PayByPhone still answering): the switch's line is kept, greyed. */
  pending?: boolean
  /** Several tickets shown as one (Handi in several arrondissements): where they cover, instead of the zone. */
  place?: string
  /** The tickets this card stands for (all the arrondissements of a CMI-S ticket), stopped together. */
  group?: Session[]
  /** No offer chosen yet: the ticket wizard shows the offer screen first. */
  needsOffer?: boolean
}) {
  // A non-resident ticket with nothing after it: « Renouveler automatiquement » opens the ticket wizard from it.
  const [renewing, setRenewing] = useState(false)
  const renewal = renewalOf(data, session)
  // The weekly renewal is for resident tickets only: a non-resident ticket (visitor, Handi…) shows no switch, unless
  // it is already renewed; tickets on chosen days are set up in « Tickets non-résident ».
  // `daily` already weighs PayByPhone's rate type, the ticket's length and the car: a resident ticket is renewable.
  const renewable = !daily || !!renewal
  const end = new Date(session.expire).getTime()
  const left = end - now
  const soon = left < 15 * 60000

  // A line under the switch only when something needs saying (failure, suspended, pause).
  const note = renewal && (renewal.lastError || !renewal.enabled || pauseState(renewal).paused)

  // Renewal on and nothing wrong: nothing to watch, only when the ticket ends and when the next one is paid.
  const calm = !!renewal && renewal.enabled && !note

  // Renewal off and under 48 h left: the one thing to do on the card, said in red under the switch.
  const urgent = !renewal?.enabled && !note && left < 48 * 3600000
  const hoursLeft = Math.max(1, Math.round(left / 3600000))

  // Qonto-like: one white card, one 20px grid, labels left and values right, hairline dividers, a muted teal accent.
  return (
    <article data-renewal-card className="rise overflow-hidden rounded-2xl border border-ink/10 bg-white">
      {/* The car and where: the plate on the left, the zone on the right, on one line. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
        <span className="shrink-0">
          <Plate plate={session.plate} size="sm" />
        </span>
        <ZoneTag zone={place ?? session.location} resident={!daily} kind={session.kind} />
      </div>

      {/* The ticket: when it ends (renewal on) or the time left, large, with the end beside it. */}
      <div className="border-t border-ink/[0.06] px-5 py-5">
        {/* One line: until when (the time left would say it twice); in red in its last 15 minutes. */}
        <p className={cn(soon ? 'font-semibold text-destructive' : 'text-ink')}>Couvert jusqu’au {when(end)}</p>
        {renewing && (
          <DailyWizard
            data={data}
            onClose={() => setRenewing(false)}
            onDone={onRefresh}
            needsOffer={needsOffer}
            initialPlate={session.plate}
            initialZone={session.location}
            initialTicket={{ rate: session.rate, start: session.start, expire: session.expire }}
            initialZones={group.map((x) => x.location)}
          />
        )}
      </div>

      {/* « Renouvellement auto » is for resident tickets only: a non-resident ticket card has no switch (tickets on
          chosen days or dates are programmed below, with « Programmer un ticket »). */}
      {/* Still looking whether the car is resident: the switch's line holds its place (the card does not grow later). */}
      {!renewable && pending && (
        <div className="flex items-center justify-between gap-4 border-t border-ink/[0.06] px-5 py-4" aria-hidden>
          <span className="text-[1.05rem] text-ink/40">Renouvellement hebdomadaire automatique</span>
          <span className="h-7 w-12 shrink-0 rounded-full bg-ink/10" />
        </div>
      )}
      {renewable && (
        <div className="border-t border-ink/[0.06] px-5 py-5">
          {/* The switch alone, on or off: turning it on opens the renewal setup (no second button saying the same). */}
          <div>
            <RenewalSwitch
              ap={renewal ?? null}
              data={data}
              plate={session.plate}
              onChanged={onRefresh}
              hosted={hosted}
              demo={demo}
              autoOpen={autoOpen}
              locked={locked}
              onLogout={onLogout}
              status={
                calm && renewal ? (
                  <span className="mt-0.5 text-sm text-ink/50">
                    Prochain :{' '}
                    <span className="whitespace-nowrap text-ink tabular-nums">{when(nextRenewal(renewal.nextCheck, session.expire))}</span>
                  </span>
                ) : undefined
              }
              details={
                <>
                  {note && (
                    <p className="mt-2 text-sm text-ink/70">
                      <RenewalNote ap={renewal} onChanged={onRefresh} next={session.expire} />
                    </p>
                  )}
                </>
              }
            />
            {urgent && (
              <p className="mt-0.5 text-sm font-medium text-destructive">
                Non renouvelé : {left < 3600000 ? `il reste ${Math.max(1, Math.round(left / 60000))} min` : `il reste ${hoursLeft} h`}
              </p>
            )}
          </div>
          {/* The pause is offered under the switch; here only « Reprendre » or the planned pause, when there is one. */}
          {renewal && (pauseState(renewal).paused || pauseState(renewal).later) && (
            <RenewalActions ap={renewal} onChanged={onRefresh} withStop={false} withPause={false} className="mt-4" />
          )}
        </div>
      )}
      {/* A non-resident ticket with nothing after it: the same switch, off; turning it on takes it again from its end. */}
      {daily && !renewal && !data.autopilots.some((ap) => ap.enabled && sameCar(ap.plate, session.plate)) && (
        <div className="flex items-center justify-between gap-4 border-t border-ink/[0.06] px-5 py-4">
          <span className="text-[1.05rem] text-ink">Renouvellement auto</span>
          <ToggleSwitch checked={renewing} label="Renouvellement auto" onPress={() => setRenewing(true)} />
        </div>
      )}
    </article>
  )
}

/** In red at the top while no card of the PayByPhone account is valid after this month (it expires this month, or
 *  has expired): renewed in PayByPhone, the next refresh sees the new card and the banner goes. */
function CardBanner({ payments }: { payments: Overview['payments'] }) {
  const cards = payments.filter((p) => p.kind === 'card' && p.validUntil)
  if (!cards.length) return null
  const last = Math.max(...cards.map((p) => new Date(p.validUntil!).getTime()))
  const now = new Date()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  if (last >= monthEnd) return null // a card still valid next month
  const gone = last < now.getTime()
  return (
    <div role="alert" className="bg-destructive px-6 py-3 text-center text-sm font-semibold text-white">
      {gone ? 'Votre carte bancaire a expiré' : 'Votre carte bancaire expire ce mois-ci'} : renouvelez-la sur{' '}
      <a href="https://paybyphone.onelink.me/ZQkh/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        PayByPhone
      </a>
      , sinon vos tickets ne seront plus payés.
    </div>
  )
}

/** The PayByPhone account has no car yet: add one there, then come back. */
function NoVehicle({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-5">
      <p className="font-semibold text-ink">Aucun véhicule sur votre compte <PayByPhone /></p>
      <p className="mt-1 text-ink/65">
        Ajoutez votre véhicule dans l’application <PayByPhone />, puis rafraîchissez cette page.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href="https://paybyphone.onelink.me/ZQkh/" target="_blank" rel="noreferrer" className={cn(ui.pillBlue, 'h-10')}>
          Ouvrir <PayByPhone />
        </a>
        <button onClick={onRefresh} className={cn(ui.pillGray, 'h-10')}>
          Rafraîchir
        </button>
      </div>
    </div>
  )
}

/** The cars with no ticket: plate, type and zone, one card each. */
const plateKey = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
const sameCar = (a: string, b: string) => a.replace(/[^0-9a-z]/gi, '').toUpperCase() === b.replace(/[^0-9a-z]/gi, '').toUpperCase()

function IdleVehicles({ data, onChanged, hosted, demo, autoPlate, locked, onLogout }: { data: Overview; onChanged: () => void; hosted: boolean; demo?: boolean; autoPlate?: string | null; locked?: boolean; onLogout?: () => void }) {
  const key = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
  // The vehicles with the resident rate on PayByPhone (a zone in the pricing); null while looking.
  const [residents, setResidents] = useState<Set<string> | null>(null)
  useEffect(() => {
    let cancelled = false
    api.pricing().then(
      (p) => {
        if (cancelled) return
        setResidents(new Set((p.vehicles ?? []).filter((v) => v.zone).map((v) => key(v.plate))))
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [data.vehicles.length])
  const renewed = new Set(data.autopilots.filter((ap) => ap.label === WEEKLY_LABEL).map((ap) => key(ap.plate)))
  const parked = new Set(data.sessions.filter((s) => !s.stopped && new Date(s.expire).getTime() > Date.now()).map((s) => key(s.plate)))
  // Only vehicles with the resident rate get « Activer le renouvellement résident »: the others take tickets on
  // chosen days (Tickets non-résident, below).
  const isResident = (v: { plate: string; zone?: string | null }) => (residents ? residents.has(key(v.plate)) : !!v.zone)
  const cars = data.vehicles.filter((v) => isResident(v) && !renewed.has(key(v.plate)) && !parked.has(key(v.plate)))
  if (!cars.length) return null
  return (
    <div className="mt-5 space-y-3">
      {cars.map((v) => {
        return (
          <div key={v.plate} data-renewal-card className="flex flex-col items-center rounded-2xl border border-border p-5 text-center">
            <Plate plate={v.plate} />
            <span className="mt-3 rounded-full bg-[#4e9aa0]/12 px-2.5 py-1 text-xs font-medium text-[#3d7f84]">Résident</span>
            <dl className="mt-4 space-y-1 text-[0.95rem] text-ink/60">
              {vehicleTypeLabel(v.type) && (
                <div>
                  <dt className="inline">Véhicule : </dt>
                  <dd className="inline text-ink">{vehicleTypeLabel(v.type)}</dd>
                </div>
              )}
              {/* The zone comes a moment after the card: its line holds its place meanwhile. */}
              {v.zone ? (
                <div>
                  <dt className="inline">Zone : </dt>
                  <dd className="inline text-ink">{v.zone}</dd>
                </div>
              ) : (
                <LineBone className="mx-auto mt-1.5 h-[1.15rem] w-44" />
              )}
            </dl>
            {/* « Renouvellement auto » switch, off: turning it on opens the renewal setup (same as the ticket card). */}
            <div className="mt-4 w-full border-t border-ink/[0.06] pt-4 text-left">
              <ActivateRenewal
                data={data}
                onChanged={onChanged}
                hosted={hosted}
                demo={demo}
                plate={v.plate}
                autoOpen={!!autoPlate && key(autoPlate) === key(v.plate)}
                locked={!!locked && !!autoPlate && key(autoPlate) === key(v.plate)}
                onLogout={onLogout}
                trigger={(open, isOpen) => <OpeningSwitch open={open} isOpen={isOpen} />}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Account details kept for this tab only (sessionStorage, cleared at logout), for the signed-in user only. */
export const ACCOUNT_KEY = 'pbb-account'
export const RESIDENTS_KEY = 'pbb-residents'

function kept<T>(key: string, user: string): T | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { u: string; v: T } | null
    return v && v.u === user ? v.v : null
  } catch {
    return null
  }
}

function keep(key: string, user: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify({ u: user, v: value }))
  } catch {
    // storage blocked: nothing kept
  }
}

export function Dashboard({
  me,
  data,
  onRefresh,
  onLogout,
  onDeleted,
  autoRenew = false,
}: {
  /** Just past the welcome page: open the renewal of the first car at once. */
  autoRenew?: boolean
  me: Me
  data: Overview | null
  onRefresh: () => Promise<void>
  onPay?: () => void
  onLogout: () => void
  onDeleted?: () => void
}) {
  const now = useNow()
  // Kept for this tab like the account data: on a reload the trial bar and the switches are there at once, instead
  // of pushing the page down a moment later.
  const [account, setAccountState] = useState<Account | null>(() => kept<Account>(ACCOUNT_KEY, me.username))
  // The account asked once (answer or not): the page shows only then, so the trial bar never pushes it down.
  const [accountAsked, setAccountAsked] = useState(() => !!account)
  const setAccount = (a: Account) => {
    setAccountState(a)
    keep(ACCOUNT_KEY, me.username, a)
  }
  const [checkoutDone, setCheckoutDone] = useState(false)
  useEffect(() => {
    // Back from Stripe Checkout: record the subscription, then show the account as it is now.
    const done = window.location.hash.match(/session_id=(cs_[A-Za-z0-9_]+)/)
    const confirm = done
      ? api.confirmCheckout(done[1]).then(
          async () => {
            history.replaceState(null, '', window.location.pathname)
            // The renewal or ticket chosen just before Stripe is activated now. The « Votre stationnement est
            // désormais automatisé » screen only when one really was: paid from the banner or « Mon compte » with
            // nothing set up yet, a short word says the account is active and what to do next.
            const { done: renewed, weekly, failed, shown } = await runPendingRenewals()
            if (renewed) {
              // « Renouvellement auto » is only true of a weekly renewal: a programmed ticket has its own word.
              if (weekly) setCheckoutDone(true)
              if (!shown)
                toast.success(renewed > 1 ? `Renouvellement activé pour ${renewed} véhicules.` : 'Renouvellement activé.')
              onRefresh()
            } else if (!failed.length) {
              toast.success('Votre compte est activé.', {
                description: 'Activez maintenant le renouvellement de votre véhicule ou programmez un ticket.',
              })
            }
            if (failed.length) toast.error(failed.join('\n'))
          },
          (e) => toast.error((e as Error).message),
        )
      : Promise.resolve()
    confirm.then(() => api.account().then(setAccount, () => {}).finally(() => setAccountAsked(true)))
  }, [])
  // The vehicles with the resident rate on PayByPhone (a zone in the pricing); null while looking.
  const [pricedResidents, setPricedResidents] = useState<Set<string> | null>(() => {
    const plates = kept<string[]>(RESIDENTS_KEY, me.username)
    return plates ? new Set(plates) : null
  })
  const setResidentPlates = (plates: Set<string> | null) => {
    setPricedResidents(plates)
    keep(RESIDENTS_KEY, me.username, plates && [...plates])
  }
  useEffect(() => {
    api.pricing().then(
      // Zones not looked up (PayByPhone busy) or no answer: unknown, never taken for « no resident car ».
      (p) =>
        setResidentPlates(
          (p as { zonesKnown?: boolean }).zonesKnown === false
            ? null
            : new Set((p.vehicles ?? []).filter((v) => v.zone).map((v) => plateKey(v.plate))),
        ),
      // No answer: what was known in this tab stays (unknown is never taken for « no resident car »).
      () => {},
    )
  }, [me.hosted, me.demo, data?.vehicles.length])
  // A stopped ticket is not running (PayByPhone still lists it until its end).
  const running = data?.sessions.filter((s) => !s.stopped && new Date(s.expire).getTime() > now) ?? []
  // A Handi ticket in several arrondissements: its tickets (one per zone) shown as one card, the first one.
  // One card per car: a ticket running in the zones of a programmed ticket of the car shows on that card.
  const programmed = (s: Session) =>
    data?.autopilots.some(
      (ap) => isDaily(ap) && ap.enabled && sameCar(ap.plate, s.plate) && (ap.locations?.length ? ap.locations : [ap.location]).includes(s.location),
    )
  // The others: a car's CMI-S tickets (one per arrondissement) make one card, whether programmed here or not.
  const cmis = (s: Session) => s.kind === 'Carte mobilité CMI-S'
  const groupOf = (s: Session) => (cmis(s) ? running.filter((x) => cmis(x) && sameCar(x.plate, s.plate)) : [s])
  const sessions = running.filter((s) => !programmed(s) && groupOf(s)[0] === s)
  // Zone codes, like a resident ticket's « 75016 »: « 75001-75020 » for all of Paris, else « 75002 + 13 autres ».
  const placeOf = (s: Session) => {
    const zones = groupOf(s).map((x) => x.location).sort()
    return zones.length < 2 ? undefined : zones.length >= 20 ? '75001-75020' : `${zones[0]} + ${zones.length - 1} autre${zones.length > 2 ? "s" : ""}`
  }
  // The programmed-ticket cards shown below (as DailyTickets lists them: a finished one-off ticket is not).
  const shownDaily = (data?.autopilots ?? []).filter((ap) => {
    if (!isDaily(ap)) return false
    const { period, finished } = ruleState(ap)
    return !(finished && period && period.from === period.to)
  }).length
  // The soonest ticket a programmed day will take, to say when the car is next covered when none runs now.
  const nextPlanned =
    data?.autopilots
      .filter((ap) => isDaily(ap) && ap.enabled)
      .map((ap) => ruleState(ap).next)
      .filter((t): t is Date => !!t)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  // The cars PayByPhone gives the resident rate (checked by the server, zone by zone). A ticket's length says
  // nothing: a non-resident ticket can last several days.
  // A car with a resident ticket running is resident too, whatever the pricing says (or when it is unknown).
  const residentTickets = (data?.sessions ?? [])
    .filter((s) => s.resident === true && new Date(s.expire).getTime() > Date.now())
    .map((s) => plateKey(s.plate))
  const residentPlates =
    pricedResidents || residentTickets.length ? new Set([...(pricedResidents ?? []), ...residentTickets]) : null
  const renewing = !!data?.autopilots.some((ap) => ap.label === WEEKLY_LABEL)
  // The opening after the welcome page is used once: once a renewal ran, stopping it must not open the window again.
  const [autoUsed, setAutoUsed] = useState(false)
  useEffect(() => {
    if (renewing) setAutoUsed(true)
  }, [renewing])
  // Something left to programme: a car without a weekly renewal (a resident one to renew, or tickets on chosen days
  // for the others). Every car renewed each week (only resident cars can be): « Programmer… » would lead nowhere, so
  // it is hidden. Known from the account alone, without waiting for the tariffs: it never shows, then goes.
  const programmable =
    !!data &&
    data.vehicles.some((v) => !data.autopilots.some((ap) => ap.label === WEEKLY_LABEL && plateKey(ap.plate) === plateKey(v.plate)))
  // Right after the welcome page, nothing renewed yet: the renewal of the car with a ticket (else the first car)
  // opens by itself, then the offer comes when it is activated.
  // Online, no offer chosen yet: PayByBot is not usable before choosing one. With a resident vehicle, its renewal
  // dialog stays open (then the offer); without one, the « Programmer un ticket » wizard does (then the offer).
  // No subscription running (never taken, or the free month over without one): every automation ends on the
  // subscription screen. An unpaid one is not: its invoice is paid from the banner, not with a new subscription.
  // The free month needs no card: the offer is asked only once it is over (then before any automation).
  const needsOffer = !!me.hosted && !me.demo && !!account && account.blocked === 'trialOver'
  // Local preview only, on the demo: ?apercu=j25 (5 days left) or ?apercu=fin (the free month over).
  const freeMonthPreview = import.meta.env.DEV ? (/apercu=(j25|fin|impaye)/.exec(location.search)?.[1] ?? null) : null
  // Renewals paused (free month over, or a card still refused after the grace week): the page blurred behind one card.
  const paused: 'trialOver' | 'unpaid' | null =
    freeMonthPreview === 'fin' ? 'trialOver' : freeMonthPreview === 'impaye' ? 'unpaid'
      : !me.demo && (account?.blocked === 'trialOver' || account?.blocked === 'unpaid') ? account.blocked : null
  const [backPlate, setBackPlate] = useState<string | undefined>() // back to the wizard, on the car it left
  const [residentFor, setResidentFor] = useState<string | null>(null) // a resident car chosen in « Programmer un ticket »
  const [programAsked, setProgramAsked] = useState(0) // « Programmer un ticket »: each click opens the ticket wizard
  const [cmisAsked, setCmisAsked] = useState(0) // « Carte mobilité CMI-S »: the wizard on that ticket only
  const live = data?.sessions.filter((s) => new Date(s.expire).getTime() > Date.now()) ?? []
  const isResidentCar = (plate: string) => (residentPlates ? residentPlates.has(plateKey(plate)) : true)
  // The car whose renewal opens: a resident ticket running, else a resident car without a ticket (its card is shown),
  // else a car known to have the resident rate even if PayByPhone does not call its running ticket « resident » (its
  // ticket card shows « Ticket résident » and the renewal switch: that is the one to open, never the ticket wizard).
  const knownResident = (plate: string) => !!residentPlates?.has(plateKey(plate))
  const residentPlate = data
    ? (live.find((s) => s.resident !== false && isResidentCar(s.plate))?.plate ??
      data.vehicles.find((v) => isResidentCar(v.plate) && !live.some((s) => sameCar(s.plate, v.plate)))?.plate ??
      live.find((s) => knownResident(s.plate))?.plate ??
      null)
    : null
  // Not once « Programmer un ticket » was asked: the wizard the owner opened is never covered by the renewal (the
  // resident rate often arrives after the click). The wizard's « Activer » leads to the offer all the same.
  const locked = needsOffer && !renewing && !!residentPlates && !!residentPlate && !programAsked
  // No offer yet and no resident car: the ticket wizard opens by itself, but can be closed (the page stays usable);
  // its « Activer » leads to the offer, and the server refuses any ticket without one.
  const offerDaily = needsOffer && !!data && data.vehicles.length > 0 && !data.autopilots.length && !!residentPlates && !residentPlate
  const autoPlate = ((autoRenew && !autoUsed) || locked) && data && !renewing ? (residentPlate ?? data.vehicles[0]?.plate ?? null) : null

  // Fresh data when coming back to the tab (it also refreshes every minute).
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && onRefresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [onRefresh])

  if (!accountAsked) return <Loading label={<>Chargement de votre compte <PayByPhone />…</>} />

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {checkoutDone && (
        <CheckoutDone
          // The car whose renewal was just activated (else the first car of the account).
          vehicle={(() => {
            const key = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
            const renewed = data?.autopilots.find((ap) => ap.label === WEEKLY_LABEL) ?? data?.autopilots.at(-1) // or the ticket just programmed
            const car = data?.vehicles.find((v) => !renewed || key(v.plate) === key(renewed.plate)) ?? data?.vehicles[0]
            return car ? { plate: car.plate, type: car.type, zone: car.zone ?? renewed?.location ?? null } : null
          })()}
          onClose={() => setCheckoutDone(false)}
        />
      )}
      {/* No card saved on PayByPhone (removed since, Apple Pay only): PayByBot cannot pay, so it is not usable. The
          only requirement: no resident rate is needed (non-residents take tickets on chosen days). */}
      {data && !me.demo && !data.payments.some((p) => p.kind === 'card') && (
        <CardGate account={<AccountButton data={data} onDeleted={onDeleted ?? onLogout} demo={me.demo} label />} />
      )}
      <TrialBanner
        blocked={paused ?? account?.blocked ?? null}
        graceEnd={account?.graceEnd ?? null}
      />
      {/* Free month running: the same light blue bar, with the days left. */}
      {!needsOffer && !me.demo && !account?.blocked && account?.trialEnd &&
        new Date(account.trialEnd).getTime() > Date.now() && (() => {
          const days = Math.ceil((new Date(account.trialEnd).getTime() - Date.now()) / 86_400_000)
          return (
            <div className="trial-bar flex w-full items-center justify-center gap-1.5 bg-[#e3efff] px-4 py-2 text-sm font-semibold text-[#1f55e6]">
              Mois offert
              <span className="font-normal text-[#1f55e6]/70">
                · {days} jour{days > 1 ? 's' : ''} restant{days > 1 ? 's' : ''}
              </span>
            </div>
          )
        })()}
      <TopBar>
        {me.demo && (
          <span className="hidden h-9 items-center rounded-full bg-amber/25 px-3 text-sm font-semibold text-ink min-[400px]:inline-flex sm:h-10 sm:px-4 sm:text-[0.95rem]">
            Démo
          </span>
        )}
        {/* Inviting a friend: always offered to a signed-in account (word of mouth is the only way in). */}
        {/* Programming a non-resident ticket: a sober button beside the invitation, no card in the page. */}
{programmable && !paused && (
        <button
          onClick={() => (setBackPlate(undefined), setProgramAsked((n) => n + 1))}
          disabled={!data}
          aria-label="Programmer un ticket"
          className={cn(ui.pillGray, 'gap-2')}
        >
          <Plus className="size-4" /> <span className="hidden sm:inline">Programmer un ticket</span>
        </button>
        )}
        {!me.demo && <InviteButton disabled={!data} />}
        <HistoryButton disabled={!data} />
        <AccountButton data={data} onDeleted={onDeleted ?? onLogout} demo={me.demo} />
        <button onClick={onLogout} className={ui.navText} aria-label="Déconnexion">
          <LogOut className="size-5 sm:hidden" />
          <span className="hidden sm:inline">Déconnexion</span>
        </button>
      </TopBar>

      {data && <CardBanner payments={data.payments} />}

      {/* Free month over: the page blurred behind « Réactivez votre compte » (the top bar stays usable). */}
      {paused && <ReactivateCard kind={paused} ticketEnd={live.reduce<string | null>((end, x) => (!end || x.expire > end ? x.expire : end), null)} />}
      <main
        aria-hidden={!!paused || undefined}
        className={cn('mx-auto w-full max-w-[34rem] flex-1 px-6 pt-4 pb-6', paused && 'pointer-events-none opacity-30 blur-[6px] select-none')}
      >
        {/* The free month's last 7 days (local preview: ?apercu=j25 on the demo). */}
        {(freeMonthPreview === 'j25' || (!me.demo && !!me.hosted && account && !account.subscribed && !account.blocked)) && (
          <FreeMonthCard trialEnd={freeMonthPreview === 'j25' ? new Date(Date.now() + 5 * 86_400_000).toISOString() : (account?.trialEnd ?? null)} />
        )}
        {/* No greeting: the page opens on what matters, whether a ticket is running. */}
        <h1 className="mt-2 text-[1.05rem] text-ink/60">
          {!data
            ? withPayByPhone('Chargement de votre compte PayByPhone.')
            : !data.autopilots.some((ap) => ap.enabled && !ruleState(ap).finished)
              ? // Nothing automated (a finished one-off ticket does not count): say it plainly.
                "Votre stationnement n'est pas encore automatisé."
            : running.length
              ? // One card: « Votre ticket en cours », several (running or programmed): « Vos tickets ».
                sessions.length + shownDaily > 1
                ? 'Vos tickets en cours :'
                : 'Votre ticket en cours :'
              : nextPlanned
                ? `Aucun ticket en cours : le prochain est prévu ${whenAt(nextPlanned)}.`
                : "Aucun véhicule n'est couvert en ce moment."}
        </h1>

        {data && sessions.length > 0 && (
          <div className="mt-5 space-y-3">
            {sessions.map((s) => (
              <Ticket
                key={s.id}
                session={s}
                now={now}
                data={data}
                onRefresh={onRefresh}
                hosted={!!me.hosted}
                demo={me.demo}
                autoOpen={!!autoPlate && sameCar(autoPlate, s.plate)}
                locked={locked}
                onLogout={onLogout}
                // A resident ticket only when PayByPhone says so, or when the car has the resident rate (checked by
                // the server with PayByPhone). Anything else is a non-resident ticket, whatever its length.
                daily={!(s.resident === true || !!residentPlates?.has(plateKey(s.plate)))}
                pending={pricedResidents === null && s.resident !== false}
                place={placeOf(s)}
                group={groupOf(s)}
                needsOffer={needsOffer}
              />
            ))}
          </div>
        )}

        {/* No resident car and nothing running or programmed: the page says what to do, car by car. */}
        {data && !running.length && !shownDaily && residentPlates && data.vehicles.length > 0 &&
          !data.vehicles.some((v) => residentPlates.has(plateKey(v.plate))) && (
            <FirstTicket
              plates={data.vehicles.map((v) => v.plate)}
              onPick={(p) => (setBackPlate(p), setProgramAsked((n) => n + 1))}
            />
          )}

        {/* The renewal is the one action of the app: no one-off payment button. */}
        {/* The cars with neither a ticket nor a renewal: one card each, with its button. */}
        {data && <IdleVehicles data={data} onChanged={onRefresh} hosted={!!me.hosted} demo={me.demo} autoPlate={autoPlate} locked={locked} onLogout={onLogout} />}

        {/* Tickets on precise days (visitor, Handi…), for everyone. */}
        {data && (
          <DailyTickets
            data={data}
            onChanged={onRefresh}
            needsOffer={needsOffer}
            openAsked={programAsked}
            cmisAsked={cmisAsked}
            onResident={(p) => (setBackPlate(undefined), setResidentFor(p))}
            openPlate={backPlate}
            // Just past the welcome page (or no offer yet) without a resident car to renew: the wizard opens by itself.
            autoOpen={offerDaily || (autoRenew && !renewing && !!residentPlates && !residentPlate)}
            onLogout={onLogout}
            residentPlates={residentPlates}
          />
        )}


        {/* Every car's card has its own button: this block only lists renewals without a ticket (or offers one
            when PayByPhone lists no car). */}
        {renewing && (
          <div className="mt-6">
            <RiverainCard data={data} onChanged={onRefresh} hosted={!!me.hosted} demo={me.demo} />
          </div>
        )}
        {/* No car on the PayByPhone account: nothing to renew or programme yet, said plainly, with the way to add one. */}
        {data && !data.vehicles.length && <NoVehicle onRefresh={onRefresh} />}

        {/* The page's call to action, always: any car, any ticket (the wizard asks the car first, then the resident
            renewal or the vehicle type). It replaces « Renouveler un autre véhicule », which did the same. */}
        {data && data.vehicles.length > 0 && programmable && (
          <div className="mt-6">
            <RippleButton
              onClick={() => (setBackPlate(undefined), setProgramAsked((n) => n + 1))}
              rippleColor="#ADD8E6"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-eu text-lg font-bold text-white shadow-[0_6px_20px_-8px_rgb(29_78_163/0.55)] transition hover:bg-[#173f86] active:scale-[0.99]"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="size-5" /> Programmer un stationnement
              </span>
            </RippleButton>
          </div>
        )}
        {/* The CMI-S card's free ticket, on its own: for any vehicle of the account, resident or not. */}
        {data && data.vehicles.length > 0 && (
          <button onClick={() => setCmisAsked((n) => n + 1)} className={cn(ui.primary, programmable ? 'mt-3' : 'mt-6')}>
            <Accessibility className="size-5" /> Carte mobilité CMI-S
          </button>
        )}
        {data && residentFor && (
          <RiverainDialog
            open
            onOpenChange={(o) => !o && setResidentFor(null)}
            data={data}
            onDone={onRefresh}
            hosted={!!me.hosted}
            demo={me.demo}
            plate={residentFor}
            onBack={() => {
              setBackPlate(residentFor)
              setResidentFor(null)
              setProgramAsked((n) => n + 1)
            }}
          />
        )}
      </main>

      <HostedFooter className="px-6 pb-5" hosted={!!me.hosted} />
    </div>
  )
}

/** « Renouveler un autre véhicule », under the cards: a car with the resident rate not renewed yet gets the resident
 *  renewal; otherwise the ticket wizard, for any other car. */
/** A first visit without a resident car: one card per car, like the ticket cards, its switch off; turning it on
 *  opens « Programmer un ticket » on that car. */
function FirstTicket({ plates, onPick }: { plates: string[]; onPick: (plate: string) => void }) {
  return (
    <div className="mt-5 space-y-3">
      {plates.map((plate) => (
        <IdleCar key={plate} plate={plate} onPick={() => onPick(plate)} />
      ))}
    </div>
  )
}

function IdleCar({ plate, onPick }: { plate: string; onPick: () => void }) {
  const [pressed, setPressed] = useState(false)
  return (
    <article className="rise overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <span className="shrink-0">
          <Plate plate={plate} size="sm" />
        </span>
        <span className="rounded-full border border-ink/10 px-3 py-1 text-sm text-ink/50">Non couvert</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-ink/[0.06] px-5 py-5">
        <span className="text-base text-ink sm:text-[1.05rem]">Renouvellement auto</span>
        <ToggleSwitch
          checked={pressed}
          label={`Programmer un renouvellement pour ${plate}`}
          onPress={() => {
            if (pressed) return
            setPressed(true)
            setTimeout(onPick, 280) // the knob slides to green, then the window opens
            setTimeout(() => setPressed(false), 900) // off again behind it: on only once a ticket is programmed
          }}
        />
      </div>
    </article>
  )
}

/** PayByPhone's vehicle type, in French (unknown: as given). */
function vehicleTypeLabel(type?: string) {
  if (!type) return null
  return vehicleType(type) ?? type
}
