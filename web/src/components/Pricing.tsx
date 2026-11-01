import { useCallback, useEffect, useState } from 'react'
import { Check, Gift, Loader2, Lock, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Dialog, DialogClose, DialogDescription, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Horodateur } from '@/components/Horodateur'
import { LoadingLine } from '@/components/Loading'
import { PayByPhone, Plate, Wordmark } from '@/components/signs'
import { HostedFooter } from '@/components/Footer'
import { PublicTopBar } from '@/components/TopBar'
import { clearPending } from '@/components/Riverain'
import { api, type PricedVehicle, type Pricing } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TRY_LABEL, ui } from '@/lib/styles'

export type Plan = 'monthly' | 'yearly'

const PLANS: { id: Plan; name: string; popular?: boolean }[] = [
  { id: 'yearly', name: 'Annuel', popular: true },
  { id: 'monthly', name: 'Mensuel' },
]

// Round amounts without cents: « 5 € », « 48 € », but « 4,50 € ».
const euros = (cents: number) => (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) + ' €'
const yearOf = (monthly: number) => Math.round(monthly * 12 * 0.8)

/** One price per vehicle, whatever its ticket and type (the server's MONTHLY_PRICE). */
const MONTHLY = 950
const GRID: [string, number][] = [['Par véhicule', MONTHLY]]

/** The signed-in account's prices (null while loading). */
function usePricing(enabled: boolean) {
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const load = useCallback(() => {
    if (!enabled) return
    setPricing(null)
    api.pricing().then(setPricing, () => setPricing({ zone: null, monthly: null, yearly: null }))
  }, [enabled])
  useEffect(load, [load])
  return [pricing, load] as const
}

/** The price by vehicle type (the same in every zone), per month or per year. */
function PriceGrid({ plan, className }: { plan: Plan; className?: string }) {
  const price = (m: number) => (plan === 'monthly' ? euros(m) : euros(yearOf(m)))
  const per = plan === 'monthly' ? '/ mois' : '/ an'
  return (
    <table className={cn('w-full text-left text-[0.95rem]', className)}>
      <thead>
        <tr className="text-sm text-ink/50">
          <th className="pb-3 text-left text-xs font-normal sm:hidden">{plan === 'monthly' ? 'Par mois' : 'Par an'}</th>
          <th className="hidden pb-3 font-normal sm:table-cell" />
          <th className="hidden pb-3 text-right font-normal sm:table-cell">{plan === 'monthly' ? 'Par mois' : 'Par an'}</th>
        </tr>
      </thead>
      <tbody>
        {GRID.map(([name, m]) => (
          <tr key={name} className="border-t border-ink/10">
            <td className="py-3 font-semibold text-ink">{name}</td>
            <td className="py-3 text-right text-ink tabular-nums">{price(m)} <span className="hidden text-ink/50 sm:inline">{per}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const plateKey = (p: string) => p.replace(/[^0-9a-z]/gi, '').toUpperCase()

/** The offer screen's vehicles: tick those to cover, the price follows their number. */
function VehicleChoice({
  plan,
  vehicles,
  chosen,
  onToggle,
  className,
}: {
  plan: Plan
  vehicles: PricedVehicle[]
  chosen: string[]
  onToggle: (plate: string) => void
  className?: string
}) {
  if (vehicles.length < 2) return null
  const n = chosen.length
  return (
    <div className={className}>
      <p className="mb-1 px-2 text-sm font-semibold text-ink">Véhicules couverts</p>
      <ul className="space-y-0.5">
        {vehicles.map((v) => {
          const on = chosen.includes(plateKey(v.plate))
          return (
            <li key={v.plate}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(v.plate)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-1 text-left text-sm transition hover:bg-ink/[0.04]"
              >
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-md border-2 transition',
                    on ? 'border-eu bg-eu text-white' : 'border-ink/25 bg-white',
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <Plate plate={v.plate} size="sm" />
                {/* A ticked vehicle shows its price per month only; the others none, they are not counted. */}
                {on && (
                  <span className="ml-auto text-right whitespace-nowrap text-ink tabular-nums">
                    {plan === 'monthly' ? euros(v.monthly) : euros(Math.round(v.yearly / 12))} / mois
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-1 px-2 text-xs leading-relaxed text-ink/50">
        {n > 1 ? `${n} véhicules couverts : le prix ci-dessus est leur total.` : '1 véhicule couvert.'} Un véhicule
        automatisé plus tard s’ajoute à l’abonnement.
      </p>
    </div>
  )
}

/** What a plan shows with the account's own price. */
function planText(id: Plan, pricing: Pricing) {
  return id === 'monthly'
    ? { price: euros(pricing.monthly!), per: '/ mois', note: 'Sans engagement' }
    : // The yearly plan shown per month (what people compare), the yearly total small underneath.
      { price: euros(Math.round(pricing.yearly! / 12)), per: '/ mois', note: `Soit ${euros(pricing.yearly!)} / an` }
}

const INCLUDED = [
  'Tickets renouvelés automatiquement',
  'Pause en un clic, reprise automatique',
  'Alertes en cas d’échec',
  'Annulable à tout moment',
]

/** The offer: two cards, the same for everyone, signed in or not (the offer itself is chosen when an automation is
 *  activated, on the offer screen). */
export function PlanCards({ signedIn }: { signedIn: boolean }) {
  // Yearly on the left (shown per month, billed once a year), monthly on the right, put forward.
  const cards: { name: string; perMonth: number; note: string; badge?: string; popular?: boolean }[] = [
    { name: 'Annuel', perMonth: Math.round(yearOf(MONTHLY) / 12), note: `facturé ${euros(yearOf(MONTHLY))} par an`, badge: '−20 %' },
    { name: 'Mensuel', perMonth: MONTHLY, note: 'facturé chaque mois, sans engagement', popular: true },
  ]
  return (
    <>
      <div className="mx-auto grid max-w-3xl items-center gap-5 md:grid-cols-2">
        {cards.map((c) => (
          <div
            key={c.name}
            className={cn(
              'relative flex flex-col rounded-3xl border bg-white p-7 text-center',
              c.popular
                ? 'border-eu shadow-[0_30px_60px_-30px_color-mix(in_srgb,var(--eu)_55%,transparent)] ring-1 ring-eu md:py-10'
                : 'border-ink/10',
            )}
          >
            {c.badge && (
              <span className="absolute top-5 right-5 rounded-full bg-[#4e9aa0]/[0.12] px-2.5 py-1 text-xs font-semibold text-[#3d7f84]">{c.badge}</span>
            )}
            <p className="text-sm font-semibold tracking-[0.12em] text-ink/55 uppercase">{c.name}</p>
            <p className="mt-5 font-heading leading-none font-semibold tracking-tight text-ink">
              <span className="text-[3.2rem]">{euros(c.perMonth).replace(' €', '')}</span>
              <span className="text-[2rem]"> €</span>
              <span className="ml-1.5 text-base font-normal text-ink/50">/ mois</span>
            </p>
            <p className="mt-2 text-sm text-ink/50">{c.note}</p>
            <ul className="mt-7 space-y-2.5 border-t border-ink/10 pt-6 text-left text-[0.95rem] text-ink/75">
              {INCLUDED.map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-eu" /> {x}
                </li>
              ))}
            </ul>
            <a href={signedIn ? '#/' : '#/inscription'} className={cn('mt-7', c.popular ? ui.primary : ui.primaryGray)}>
              {signedIn ? 'Mon tableau de bord' : TRY_LABEL}
            </a>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-ink/45">
        Par véhicule : voiture, deux-roues ou utilitaire · ticket résident, visiteur ou carte mobilité CMI-S.
      </p>
    </>
  )
}

/** Pricing page (#/tarifs): the same two plans for everyone. */
export function PricingPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicTopBar signedIn={signedIn} />
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10 lg:py-12">
        <h1 className="rise text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
          Tarifs
        </h1>
        <p className="mx-auto mt-4 max-w-[32rem] text-center text-[1.05rem] text-ink/60 sm:text-lg">
          Un prix unique par véhicule, quel que soit le ticket.
        </p>
        <div className="mt-8 lg:mt-10">
          <PlanCards signedIn={signedIn} />
        </div>
        <p className="mt-8 text-center text-sm text-ink/50">
          Prix TTC, sans engagement.
        </p>
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}

/** Dashboard banner, only when the account is blocked or a charge was refused: the way to pay. */
export function TrialBanner({
  blocked = null,
  graceEnd = null,
}: {
  blocked?: 'grace' | 'unpaid' | 'trialOver' | null
  graceEnd?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Failed charge: straight to the invoice to pay. No subscription: choose a plan.
  const refused = blocked === 'grace' || blocked === 'unpaid'
  async function unlock() {
    if (!refused) return setOpen(true)
    setBusy(true)
    try {
      window.location.assign((await api.unlock()).url)
    } catch (e) {
      toast((e as Error).message)
      setBusy(false)
    }
  }

  if (blocked) {
    return (
      <>
        <div
          role="alert"
          className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-[linear-gradient(90deg,#5c0f12_0%,#9b1c1f_100%)] px-4 py-2.5 text-sm text-white"
        >
          <span className="font-semibold">
            {blocked === 'grace'
              ? 'Paiement refusé.'
              : blocked === 'unpaid'
                ? 'Paiement refusé : renouvellement arrêté.'
                : 'Mois offert terminé : compte bloqué.'}{' '}
            <span className="font-normal text-white/80">
              {blocked === 'grace'
                ? `Vos renouvellements continuent jusqu'au ${graceDay(graceEnd)}, mettez à jour votre carte d'ici là.`
                : 'Le prochain renouvellement ne sera pas payé.'}
            </span>
          </span>
          <button
            onClick={unlock}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : refused ? 'Se régulariser' : 'Débloquer mon compte'}
          </button>
        </div>
        {open && (
          <PlansDialog onClose={() => setOpen(false)} text="Le renouvellement reprend dès que le paiement est fait." />
        )}
      </>
    )
  }

  // During the free month, nothing: the offer is chosen when the renewal is activated (it cannot be skipped).
  return null
}

/** « mardi 28 octobre » for the end of the grace week. */
function graceDay(iso: string | null) {
  if (!iso) return 'la fin de la semaine'
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })
}

/** Full-page paywall: the offer and the way to pay on the left, the parking meter on the right. onPay runs just
 *  before leaving for Stripe. */
export function PlansDialog({
  onClose,
  text,
  onPay,
  plates,
}: {
  onClose: () => void
  text?: string
  onPay?: () => void
  /** The vehicles being activated: ticked first among the account's vehicles. */
  plates?: string[]
}) {
  const [plan, setPlan] = useState<Plan>('yearly')
  const [busy, setBusy] = useState(false)
  const [loaded] = usePricing(true)
  // The vehicles the subscription is for: those being activated, else those already billed, else the first one.
  const [chosen, setChosen] = useState<string[] | null>(null)
  useEffect(() => {
    const vehicles = loaded?.vehicles ?? []
    if (!vehicles.length || chosen) return
    const all = vehicles.map((v) => plateKey(v.plate))
    const wanted = [...(plates ?? []), ...(loaded?.billed ?? [])].map(plateKey).filter((k) => all.includes(k))
    setChosen(wanted.length ? [...new Set(wanted)] : all.slice(0, 1))
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  // The prices shown are those of the chosen vehicles (the price per vehicle times their number).
  const picked = (loaded?.vehicles ?? []).filter((v) => chosen?.includes(plateKey(v.plate)))
  const pricing: Pricing | null =
    loaded && picked.length
      ? { ...loaded, monthly: picked.reduce((t, v) => t + v.monthly, 0), yearly: picked.reduce((t, v) => t + v.yearly, 0) }
      : loaded
  const toggle = (plate: string) =>
    setChosen((list) => {
      const k = plateKey(plate)
      const next = list?.includes(k) ? list.filter((x) => x !== k) : [...(list ?? []), k]
      return next.length ? next : list // at least one vehicle
    })
  const locked = false // no resident rate needed any more
  // Still in the free month: nothing is charged before its end (Stripe starts billing then).
  const [trialEnd, setTrialEnd] = useState<Date | null>(null)
  const [trialStarted, setTrialStarted] = useState(false) // kept from an earlier account: only what is left of it
  useEffect(() => {
    api.account().then(
      (a) => {
        // Started: its end. Not started yet: it starts today with the offer, so nothing is due for trialDays days.
        const end = a.trialEnd ? new Date(a.trialEnd) : a.trialDays ? new Date(Date.now() + a.trialDays * 86_400_000) : null
        setTrialEnd(end && end.getTime() > Date.now() ? end : null)
        setTrialStarted(!!a.trialEnd)
      },
      () => {},
    )
  }, [])

  async function pay() {
    setBusy(true)
    try {
      const { url } = await api.checkout(plan, chosen ?? [])
      if (onPay) onPay()
      else clearPending() // from the banner: a choice left unpaid earlier is not activated by this payment
      window.location.assign(url)
    } catch (e) {
      toast((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogPortal>
        <DialogPrimitive.Popup className="fixed inset-0 z-[70] grid overflow-y-auto bg-background outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col px-6 pt-5 pb-10 sm:px-10 lg:px-[clamp(2.5rem,8vw,8rem)] lg:pb-6">
            <div className="flex items-center justify-between">
              <Wordmark />
              <DialogClose
                aria-label="Fermer"
                disabled={busy}
                className="grid size-10 place-items-center rounded-full bg-ink/[0.06] text-ink transition hover:bg-ink/[0.1]"
              >
                <X className="size-5" />
              </DialogClose>
            </div>
            <Horodateur className={cn('mx-auto mt-6 h-44 lg:hidden', locked && 'opacity-50 grayscale')} />
            <div className="mx-auto w-full max-w-md lg:my-auto lg:max-w-xl lg:pt-4">
              <DialogTitle className={cn(ui.title, 'mt-6 lg:mt-0')}>Choisissez votre offre</DialogTitle>
              {text && <DialogDescription className={ui.subtitle}>{text}</DialogDescription>}
              {trialEnd && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-[#e7f6ec] px-4 py-2.5 text-[#14703a]">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1a9a4a] text-white">
                    <Gift className="size-5" />
                  </span>
                  <span>
                    <span className="block font-heading text-lg leading-tight font-bold">{trialStarted ? 'Reste de votre mois offert' : '1er mois offert'}</span>
                    <span className="block text-sm text-[#14703a]/80">
                      Rien à payer avant le {trialEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
                    </span>
                  </span>
                </div>
              )}

              {/* No resident status on PayByPhone: the offer stays visible but greyed and out of reach. */}
              <div
                aria-hidden={locked || undefined}
                className={cn(locked && 'pointer-events-none select-none opacity-50 blur-[2px] grayscale')}
              >
              <div role="radiogroup" aria-label="Offre" className="mt-5 space-y-2.5">
                {pricing && pricing.monthly == null && !locked && (
                  <p className="rounded-2xl border border-ink/10 p-4 text-sm text-ink/60">
                    Votre prix n’a pas pu être calculé avec <PayByPhone /> pour le moment. Réessayez dans quelques minutes.
                  </p>
                )}
                {/* The account's price is being worked out with PayByPhone: the app's loading bar. */}
                {!pricing && (
                  <div className="grid h-40 place-items-center rounded-2xl border border-ink/10">
                    <LoadingLine className="items-center" label="Calcul de votre prix…" />
                  </div>
                )}
                {pricing?.monthly != null && pricing.yearly != null &&
                  PLANS.map((p) => ({ ...p, ...planText(p.id, pricing) })).map((p) => (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={plan === p.id}
                      onClick={() => setPlan(p.id)}
                      className={cn(
                        'flex w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition',
                        plan === p.id ? 'border-eu bg-eu/[0.04] ring-1 ring-eu' : 'border-ink/15 hover:border-ink/30',
                      )}
                    >
                      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border-2', plan === p.id ? 'border-eu' : 'border-ink/25')}>
                        {plan === p.id && <span className="size-2.5 rounded-full bg-eu" />}
                      </span>
                      <span className="flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                          {p.name}
                          {p.popular && (
                            <>
                              <span className="rounded-full bg-eu px-2 py-0.5 text-xs font-semibold text-white">Offre populaire</span>
                              <span className="rounded-full bg-eu/[0.08] px-2 py-0.5 text-xs font-semibold text-eu">-20 %</span>
                            </>
                          )}
                        </span>
                        <span className="block text-sm text-ink/55">{p.note}</span>
                      </span>
                      <span className="text-right">
                        <span className="font-heading text-xl font-semibold text-ink">{p.price}</span>{' '}
                        <span className="text-sm text-ink/50">{p.per}</span>
                      </span>
                    </button>
                  ))}
                {locked && <PriceGrid plan={plan} className="rounded-2xl border border-ink/10 p-4" />}
              </div>

              <VehicleChoice
                plan={plan}
                vehicles={loaded?.vehicles ?? []}
                chosen={chosen ?? []}
                onToggle={toggle}
                className="mt-4 rounded-2xl bg-ink/[0.03] px-3 py-3"
              />
              <ul className="mt-4 grid gap-1.5 text-sm text-ink/70 sm:grid-cols-2">
                {INCLUDED.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-eu" /> {x}
                  </li>
                ))}
              </ul>

              <button onClick={pay} disabled={busy || pricing?.monthly == null} className={cn('mt-5', ui.primary)}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : 'Continuer vers le paiement'}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-ink/50">
                <Lock className="size-3.5" /> Paiement sécurisé par Stripe. Sans engagement.
              </p>
              <p className="mt-2 text-center text-sm text-ink/60">
                Si votre carte bancaire est refusée, PayByBot peut avancer votre ticket pour que votre véhicule reste
                couvert. Son montant est alors ajouté à votre prochain prélèvement.
              </p>
              </div>
            </div>
          </div>

          {/* The parking meter robot, on its soft blue backdrop. */}
          <div className="relative hidden items-center justify-center overflow-hidden bg-[radial-gradient(70%_60%_at_50%_45%,#e6ecfb_0%,#f4f6fb_60%,#f7f8fb_100%)] lg:flex">
            <Horodateur className="w-[min(78%,30rem)] drop-shadow-[0_30px_40px_rgb(29_42_107/0.12)]" />
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
