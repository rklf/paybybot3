import { useEffect, useState } from 'react'
import { Check, Gift, Loader2, Lock, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Dialog, DialogClose, DialogDescription, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Horodateur } from '@/components/Horodateur'
import { Wordmark } from '@/components/signs'
import { HostedFooter } from '@/components/Footer'
import { PublicTopBar } from '@/components/TopBar'
import { clearPending } from '@/components/Riverain'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TRY_LABEL, ui } from '@/lib/styles'

// Round amounts without cents: « 5 € », « 48 € », but « 4,50 € ».
const euros = (cents: number) => (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) + ' €'

/** One price for all the account's vehicles, whatever their number, tickets and types (the server's MONTHLY_PRICE). */
const MONTHLY = 950

const INCLUDED = [
  'Tickets renouvelés automatiquement',
  'Pause en un clic, reprise automatique',
  'Alertes en cas d’échec',
  'Annulable à tout moment',
]

/** The offer: one card, the same for everyone, signed in or not (paid on Stripe when an automation is activated). */
export function PlanCards({ signedIn }: { signedIn: boolean }) {
  const cards: { name: string; perMonth: number; note: string; badge?: string; popular?: boolean }[] = [
    { name: 'Mensuel', perMonth: MONTHLY, note: 'facturé chaque mois, sans engagement', popular: true },
  ]
  return (
    <>
      <div className="mx-auto grid max-w-md items-center gap-5">
        {cards.map((c) => (
          <div
            key={c.name}
            className={cn(
              'relative flex flex-col rounded-2xl border bg-white p-7 text-center',
              c.popular
                ? 'border-eu shadow-[0_30px_60px_-30px_color-mix(in_srgb,var(--eu)_55%,transparent)] ring-1 ring-eu md:py-10'
                : 'border-ink/10',
            )}
          >
            {c.badge && (
              <span className="absolute top-5 right-5 rounded-full bg-[#4e9aa0]/[0.12] px-2.5 py-1 text-sm font-semibold text-[#3d7f84]">{c.badge}</span>
            )}
            <p className="text-sm font-semibold tracking-[0.12em] text-ink/60 uppercase">{c.name}</p>
            <p className="mt-5 font-heading leading-none font-semibold tracking-tight text-ink">
              <span className="text-[3.2rem]">{euros(c.perMonth).replace(' €', '')}</span>
              <span className="text-[2rem]"> €</span>
              <span className="ml-1.5 text-[0.95rem] font-normal text-ink/60">/ mois</span>
            </p>
            <p className="mt-2 text-sm text-ink/60">{c.note}</p>
            <ul className="mt-7 space-y-2.5 border-t border-ink/10 pt-6 text-left text-[0.95rem] text-ink/60">
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
        Tous vos véhicules pour ce prix : voiture, deux-roues ou utilitaire · ticket résident, visiteur ou, à Paris, carte mobilité CMI-S.
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
        <h1 className={cn(ui.title, 'rise text-center')}>
          Tarifs
        </h1>
        <p className="mx-auto mt-4 max-w-[32rem] text-center text-[1.05rem] text-ink/60">
          Un prix unique pour tous vos véhicules, quel que soit le ticket.
        </p>
        <div className="mt-8 lg:mt-10">
          <PlanCards signedIn={signedIn} />
        </div>
        <p className="mt-8 text-center text-sm text-ink/60">
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
                ? 'Paiement refusé : votre renouvellement est en pause.'
                : 'Mois offert terminé : votre renouvellement est en pause.'}
            {blocked === 'grace' && (
              <span className="font-normal text-white/80">
                {' '}
                {blocked === 'grace'
                  ? `Vos renouvellements continuent jusqu'au ${graceDay(graceEnd)}, mettez à jour votre carte d'ici là.`
                  : 'Le prochain renouvellement ne sera pas payé.'}
              </span>
            )}
          </span>
          {blocked === 'grace' && (
          <button
            onClick={unlock}
            disabled={busy}
            className="inline-flex items-center rounded-[10px] bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : 'Se régulariser'}
          </button>
          )}
        </div>
        {open && (
          <PlansDialog onClose={() => setOpen(false)} text="Le renouvellement reprend dès que le paiement est fait." />
        )}
      </>
    )
  }

  return null
}

/** The free month's last 7 days (no card was asked): a light card with the days left and the way on. */
export function FreeMonthCard({ trialEnd }: { trialEnd: string | null }) {
  const [open, setOpen] = useState(false)
  const left = trialEnd ? Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86_400_000) : 0
  if (!(left > 0 && left <= 7)) return null
  return (
    <div className="rise mb-6 rounded-2xl border border-ink/10 bg-white p-5">
      <p className="text-[1.05rem] font-medium text-ink">{left > 1 ? `Plus que ${left} jours offerts` : 'Dernier jour offert'}</p>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-ink/60">Ensuite, votre renouvellement continue pour 9,50 € par mois, tous vos véhicules, sans engagement.</p>
      <button onClick={() => setOpen(true)} className={cn(ui.primary, 'mt-4')}>
        Continuer pour 9,50 €/mois
      </button>
      {open && <PlansDialog onClose={() => setOpen(false)} text="Le renouvellement reprend dès que le paiement est fait." />}
    </div>
  )
}

/** Over the blurred dashboard (the top bar stays usable: « Mon compte », sign out), the one thing to do. The free month
 *  over: activate the subscription (the offer screen). A card still refused after the grace week: reactivate the
 *  account (straight to the invoice to pay). What still runs is said: the ticket running stays valid until its end. */
export function ReactivateCard({ kind, ticketEnd, ended = false }: { kind: 'trialOver' | 'unpaid'; ticketEnd?: string | null; ended?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const until = ticketEnd && new Date(ticketEnd).getTime() > Date.now()
    ? new Date(ticketEnd).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h').replace(' à ', ', ')
    : null
  const trial = kind === 'trialOver'
  async function go() {
    if (trial) return setOpen(true)
    setBusy(true)
    try {
      window.location.assign((await api.unlock()).url)
    } catch (e) {
      toast((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div role="dialog" aria-labelledby="reactivate-title" className="rise fixed inset-x-4 top-1/2 z-30 mx-auto max-w-lg -translate-y-1/2 rounded-2xl bg-white p-8 shadow sm:p-12-[0_30px_60px_-20px_rgb(11_16_36/0.4)] ring-1 ring-ink/10">
      <p id="reactivate-title" className={ui.dialogTitle}>
        {trial ? 'Activez votre abonnement' : 'Réactivez votre compte'}
      </p>
      <p className="mt-4 text-[1.05rem] leading-relaxed text-ink/60">
        {trial
          ? ended ? 'Votre abonnement est terminé : le renouvellement automatique est en pause.' : 'Votre mois offert est terminé : le renouvellement automatique est en pause.'
          : 'Le paiement de votre abonnement n’a pas été régularisé : le renouvellement automatique est en pause.'}
        {until && <> Votre ticket actuel reste valable jusqu’au <strong className="font-semibold text-ink">{until}</strong>.</>}
      </p>
      <button onClick={go} disabled={busy} className={cn(ui.primary, 'mt-8')}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : trial ? 'Activer mon abonnement' : 'Réactiver mon compte'}
      </button>
      {open && <PlansDialog onClose={() => setOpen(false)} text="Le renouvellement reprend dès que le paiement est fait." />}
    </div>
  )
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
}: {
  onClose: () => void
  text?: string
  onPay?: () => void
}) {
  const [busy, setBusy] = useState(false)
  // Still in the free month: nothing is charged before its end (Stripe starts billing then).
  const [trialEnd, setTrialEnd] = useState<Date | null>(null)
  const [trialStarted, setTrialStarted] = useState(false) // kept from an earlier account: only what is left of it
  useEffect(() => {
    api.account().then(
      (a) => {
        // Started: its end. Not started yet: it starts today with the subscription, so nothing is due for trialDays days.
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
      const { url } = await api.checkout('monthly')
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
            <Horodateur className="mx-auto mt-6 h-44 lg:hidden" />
            <div className="mx-auto w-full max-w-md lg:my-auto lg:max-w-xl lg:pt-4">
              <DialogTitle className={cn(ui.title, 'mt-6 lg:mt-0')}>Votre abonnement</DialogTitle>
              {text && <DialogDescription className={ui.subtitle}>{text}</DialogDescription>}

              {trialEnd && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-ink/[0.04] px-4 py-2.5 text-ink">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-ink">
                    <Gift className="size-5" />
                  </span>
                  <span>
                    <span className="block text-[1.05rem] leading-tight font-medium">{trialStarted ? 'Reste de votre mois offert' : '1er mois offert'}</span>
                    <span className="block text-sm text-ink/60">
                      Rien à payer avant le {trialEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}.
                    </span>
                  </span>
                </div>
              )}

              {/* The one offer: monthly, the same price for every vehicle of the account. */}
              <div className="mt-5 flex w-full items-center gap-4 rounded-2xl border border-eu bg-eu/[0.04] px-4 py-3 ring-1 ring-eu">
                <span className="flex-1">
                  <span className="block text-[1.05rem] font-medium text-ink">Mensuel</span>
                  <span className="block text-sm text-ink/60">Tous vos véhicules, sans engagement</span>
                </span>
                <span className="text-right">
                  <span className="font-heading text-2xl font-semibold text-ink">{euros(MONTHLY)}</span>{' '}
                  <span className="text-sm text-ink/60">/ mois</span>
                </span>
              </div>

              <ul className="mt-4 grid gap-1.5 text-sm text-ink/60 sm:grid-cols-2">
                {INCLUDED.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-eu" /> {x}
                  </li>
                ))}
              </ul>

              <button onClick={pay} disabled={busy} className={cn('mt-5', ui.primary)}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : 'Continuer vers le paiement'}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-ink/60">
                <Lock className="size-3.5" /> Paiement sécurisé par Stripe. Sans engagement.
              </p>
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
