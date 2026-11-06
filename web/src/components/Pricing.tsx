import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Dialog, DialogPortal, DialogTitle } from '@/components/ui/dialog'
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
        <h1 className="rise text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
          Tarifs
        </h1>
        <p className="mx-auto mt-4 max-w-[32rem] text-center text-[1.05rem] text-ink/60 sm:text-lg">
          Un prix unique pour tous vos véhicules, quel que soit le ticket.
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
  onPay,
}: {
  onClose: () => void
  text?: string
  onPay?: () => void
}) {
  // One offer (monthly): no screen to choose from, straight to Stripe, which says when the first payment is (the end
  // of the free month, nothing before).
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    api.checkout('monthly').then(
      ({ url }) => {
        if (onPay) onPay()
        else clearPending() // from the banner: a choice left unpaid earlier is not activated by this payment
        window.location.assign(url)
      },
      (e) => {
        toast((e as Error).message)
        onClose()
      },
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogPortal>
        <DialogPrimitive.Popup className="fixed inset-0 z-[70] grid place-items-center bg-background/95 outline-none">
          <DialogTitle className="sr-only">Paiement sécurisé</DialogTitle>
          <p className="flex items-center gap-3 text-ink/70">
            <Loader2 className="size-5 animate-spin text-eu" /> Ouverture du paiement sécurisé…
          </p>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
