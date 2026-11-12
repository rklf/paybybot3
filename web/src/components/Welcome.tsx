import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Loader2, Mail, Phone, type LucideIcon } from 'lucide-react'
import { RemotePanel } from '@/components/RemoteScene'
import { PayByPhone, Plate, withPayByPhone, Wordmark } from '@/components/signs'
import { api, type Me, type Overview, type PricedVehicle } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { LineBone, PlateBone } from '@/components/Skeletons'
import { SmoothHeight } from '@/components/ui/smooth-height'
import { activateWeekly, AddCardGuide, clearPending, savePending, savePlateAfterPay, when, type PendingRenewal } from '@/components/Riverain'
import { PlansDialog } from '@/components/Pricing'

/** +33612345678 -> +33 6 12 34 56 78 (other formats are shown as they are). */
function phoneText(username: string) {
  const m = username.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/)
  return m ? `+33 ${m.slice(1).join(' ')}` : username
}

/** One line of the welcome page: the label on the left, the value on the right. */
function Line({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5 text-[1.05rem]">
      {/* An icon in place of the label (the label kept for screen readers), as in « Mon compte ». */}
      <dt className="pt-0.5 text-ink/60">
        {Icon ? (
          <>
            <Icon className="mt-0.5 size-[1.15rem] text-ink/45" aria-hidden />
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  )
}

/** First sign-in: everything PayByBot found in the PayByPhone account, so the user can check it is right. */
export function Welcome({
  me,
  data,
  onContinue,
  onActivated,
  onRefresh,
  onLogout,
}: {
  me: Me
  data: Overview
  /** On to the dashboard; with a plate, the ticket wizard opens on that car. */
  onContinue: (plate?: string) => void
  /** The renewal activated from this page: the dashboard, with nothing more to open. */
  onActivated?: () => void
  /** Not this PayByPhone account: back to the sign-in (else the only ways out were a greyed-out button and a reload). */
  onLogout?: () => void
  /** Read the PayByPhone account again (a vehicle or a card changed in the PayByPhone app meanwhile). */
  onRefresh?: () => Promise<void>
}) {
  // The account's vehicles: with the arrondissement of their resident rate when they have one (found on PayByPhone,
  // never typed); undefined: looking.
  const [vehicles, setVehicles] = useState<PricedVehicle[] | undefined>(undefined)
  const [reloads, setReloads] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    setRefreshing(true)
    try {
      await onRefresh?.()
      setReloads((n) => n + 1)
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => {
    // The pricing lists the vehicles with their resident zone; when it lists none (or fails), the account's
    // vehicles as PayByPhone gives them, without a zone: every vehicle shows, resident or not.
    const fallback = () =>
      data.vehicles.map((v): PricedVehicle => ({
        plate: v.plate,
        type: v.type,
        zone: null,
        monthly: 0,
        yearly: 0,
        renewed: false,
      }))
    api.pricing(reloads ? 0 : undefined).then(
      (p) => setVehicles(p.vehicles?.length ? p.vehicles : fallback()),
      () => setVehicles(fallback()),
    )
  }, [me.demo, reloads])

  // The e-mail PayByBot writes to (as in « Mon compte »); undefined: looking, '' : none.
  const [email, setEmail] = useState<string | undefined>(undefined)
  // Where the free month stands (one per person, kept when an account is deleted and made again): never started,
  // running, used up (the subscription first), or a subscription already. undefined: looking.
  const [trial, setTrial] = useState<'new' | 'running' | 'over' | 'paid' | undefined>(undefined)
  useEffect(() => {
    api.account().then(
      (a) => {
        setEmail(a.email ?? '')
        setTrial(a.plan ? 'paid' : a.blocked === 'trialOver' ? 'over' : !a.trialEnd ? 'new'
          : new Date(a.trialEnd).getTime() > Date.now() ? 'running' : 'over')
      },
      () => {
        setEmail('')
        setTrial('new')
      },
    )
  }, [])
  // The free month used up: the offer opens, the renewal chosen here is activated on the way back from Stripe.
  const [plans, setPlans] = useState<PendingRenewal[] | null>(null)
  const [afterPay, setAfterPay] = useState<string | null>(null)
  const n = vehicles?.length ?? 0
  const zones = [...new Set((vehicles ?? []).flatMap((v) => (v.zone ? [v.zone] : [])))]

  // PayByBot pays with a card saved on PayByPhone (not Apple Pay, Google Pay or PayPal), not expired: without one
  // the next step waits, and « Rafraîchir » looks again once it is added.
  const cards = data.payments.filter((p) => p.kind === 'card')
  const valid = cards.filter((p) => !p.expired)
  // The resident cars not renewed yet: « Activer le renouvellement » here, the welcome and the activation in one screen.
  // One vehicle to automate, chosen here: a resident one gets its weekly renewal at once; another goes on to the
  // usual ticket wizard, on that car. A resident car renewed already is shown, not offered.
  const offered = (vehicles ?? []).filter((v) => !(v.zone && v.renewed))
  // The latest end of a ticket running now for this car (stopped ones do not count).
  const key = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()
  const ticketEnd = (plate: string) =>
    data.sessions
      .filter((x) => key(x.plate) === key(plate) && !x.stopped && new Date(x.expire).getTime() > Date.now())
      .reduce<number | null>((end, x) => Math.max(end ?? 0, new Date(x.expire).getTime()), null)
  const [picked, setPicked] = useState<string | null>(null)
  const choice = offered.find((v) => v.plate === picked) ?? offered.find((v) => v.zone) ?? offered[0] ?? null
  const resident = choice?.zone ? { ...choice, zone: choice.zone } : null
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  async function go() {
    if (!choice) return onContinue()
    if (!resident && trial === 'over') {
      // No free month left: the subscription first, then the ticket wizard on this car (back from Stripe).
      setAfterPay(choice.plate)
      return setPlans([])
    }
    if (!resident) return onContinue(choice.plate) // the ticket wizard, on this car
    setActivating(true)
    setActivationError(null)
    const { done, failed, paywall, pending } = await activateWeekly([resident], valid[0].id)
    setActivating(false)
    if (paywall) return setPlans(pending) // no free month left: the subscription first
    if (done) return (onActivated ?? onContinue)()
    setActivationError(failed.join('\n'))
  }

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col px-6 pt-5 pb-10 sm:px-10 lg:px-[clamp(2.5rem,7vw,7rem)] lg:pb-6">
        <Wordmark />
        <div className="rise mx-auto w-full max-w-lg lg:my-auto lg:pt-2">
          {/* No big title: the page opens straight on what PayByPhone gave (this line is its heading). */}
          <h1 className={cn(ui.subtitle, 'mt-10 lg:mt-0')}>
            Vos informations <PayByPhone />.
          </h1>
          {/* What PayByBot keeps, said where the account's details show (same line as « Comment ça marche »). */}
          <p className="mt-2 text-sm text-ink/60">Ni carte bancaire, ni mot de passe enregistrés.</p>

          {/* Three lines, the label on the left and what PayByPhone gave on the right: nothing else. */}
          {/* Lines arriving with PayByPhone's answer: the block grows smoothly, never in one jump. */}
          <SmoothHeight className="mt-8">
            <dl className="divide-y divide-ink/10 border-y border-ink/10">
              <Line label="Compte" icon={Phone}>
                <span className="font-heading font-medium tabular-nums">{phoneText(me.username)}</span>
              </Line>
              {email !== '' && (
                <Line label="E-mail" icon={Mail}>
                  {email === undefined ? (
                    <LineBone className="ml-auto w-36" />
                  ) : (
                    <span className="block truncate font-heading font-medium">{email}</span>
                  )}
                </Line>
              )}
              {(vehicles === undefined || !vehicles.length) && (
              <Line label={n > 1 ? 'Véhicules' : 'Véhicule'}>
                {vehicles === undefined ? (
                  <PlateBone className="ml-auto" />
                ) : vehicles.length ? (
                  <span className="inline-flex flex-col items-end gap-1.5">
                    {vehicles.map((v) => (
                      <Plate key={v.plate} plate={v.plate} size="sm" />
                    ))}
                  </span>
                ) : (
                  <span className="text-ink/60">Aucun</span>
                )}
              </Line>
              )}
              {/* Its own line: the zone(s) where PayByPhone gives the resident rate (« 75001 »). */}
              {(vehicles === undefined || zones.length > 0) && (
                <Line label="Résidence">
                  {vehicles === undefined ? (
                    <LineBone className="ml-auto w-16" />
                  ) : (
                    <span className="flex flex-col items-end gap-0.5">
                      {zones.map((z) => (
                        <span key={z} className="font-heading font-medium">
                          {z}
                        </span>
                      ))}
                    </span>
                  )}
                </Line>
              )}
              {/* The card PayByPhone pays with: always shown, in red when there is none valid (the next step waits). */}
              <Line label={cards.length > 1 ? 'Cartes' : 'Carte'}>
                {cards.length ? (
                  <span className="flex flex-col items-end gap-0.5 font-heading font-medium">
                    {cards.map((p) => (
                      <span key={p.id} className={cn(p.expired && 'text-ink/45 line-through decoration-ink/30')}>
                        {p.label.replace(/ — exp\..*$/, '')}
                        {/* Its end date, quieter (« exp. 07/31 »). */}
                        {/ — exp\..*$/.test(p.label) && <span className="ml-2 font-sans text-ink/60">{p.label.replace(/^.* — /, '')}</span>}
                        {p.expired && <span className="ml-2 text-sm font-normal text-destructive">expirée</span>}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="font-heading font-medium text-destructive">Aucune</span>
                )}
              </Line>
            </dl>

            {/* Only when something blocks: what to do, in one place. */}
            {vehicles !== undefined && (!vehicles.length || !valid.length) && (
              <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">
                {withPayByPhone(
                  !vehicles.length
                    ? 'Aucun véhicule : ajoutez-le dans l’application PayByPhone, puis touchez « Rafraîchir ».'
                    : cards.length
                      ? 'Carte expirée dans PayByPhone : ajoutez-en une valide.'
                      : 'Aucune carte bancaire dans PayByPhone.',
                )}
              </p>
            )}
            {/* No valid card: how to add one in the PayByPhone app, with its screens. */}
            {vehicles !== undefined && vehicles.length > 0 && !valid.length && <AddCardGuide />}
          </SmoothHeight>

          {activationError && (
            <p role="alert" className="mt-6 text-sm leading-relaxed whitespace-pre-line text-destructive">
              {withPayByPhone(activationError)}
            </p>
          )}
          {/* The vehicle to automate: one, chosen with a tap (the resident one first). */}
          {offered.length > 0 && (
            <div className="mt-6" role="radiogroup" aria-label="Stationnement à automatiser">
              <p className="mb-2 text-sm text-ink/60">{offered.length > 1 ? 'Quel stationnement automatiser ?' : 'Stationnement à automatiser :'}</p>
              <div className="space-y-1.5">
                {offered.map((v) => {
                  const on = v.plate === choice?.plate
                  return (
                    <button
                      key={v.plate}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={v.plate}
                      onClick={() => setPicked(v.plate)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border bg-white px-4 py-2.5 text-left transition',
                        on ? 'border-eu ring-1 ring-eu' : 'border-ink/10 hover:border-ink/25',
                      )}
                    >
                      {offered.length > 1 && (
                        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-eu' : 'border-ink/25')}>
                          {on && <span className="size-2.5 rounded-full bg-eu" />}
                        </span>
                      )}
                      <Plate plate={v.plate} size="sm" className="shrink-0 whitespace-nowrap" />
                      {/* On the right: its ticket now (from PayByPhone). */}
                      <span className="ml-auto flex flex-col items-end gap-1 text-right">
                        <span className="text-sm text-ink/60">
                          {(() => {
                            const end = ticketEnd(v.plate)
                            return end ? `Ticket jusqu’au ${when(end)}` : 'Aucun ticket en cours'
                          })()}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <button
            onClick={go}
            disabled={activating || !trial || !vehicles?.length || !valid.length}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-eu text-lg font-bold text-white transition hover:bg-[#173f86] disabled:opacity-60"
          >
            {activating || !trial ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                {{ new: 'Commencer mon essai gratuit', running: 'Continuer mon essai gratuit', over: 'Activer mon compte', paid: 'Continuer' }[trial]}
                <ArrowRight className="size-5" />
              </>
            )}
          </button>
          <p className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink/60">
            <button onClick={refresh} disabled={refreshing} className={cn('inline-flex items-center gap-1.5', ui.link)}>
              {refreshing && <Loader2 className="size-3.5 animate-spin" />} Rafraîchir
            </button>
            {onLogout && (
              <button onClick={onLogout} className={ui.link}>
                Se déconnecter
              </button>
            )}
          </p>
        </div>
      </div>

      {/* The same animated scene as the sign-in page and the offer screen. */}
      <RemotePanel className="hidden min-h-dvh lg:block" />
      {plans && (
        <PlansDialog
          onPay={() => {
            savePending(plans)
            savePlateAfterPay(afterPay)
          }}
          onClose={() => {
            clearPending()
            savePlateAfterPay(null)
            setPlans(null)
            setAfterPay(null)
          }}
        />
      )}
    </div>
  )
}
