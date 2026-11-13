import { useEffect, useState } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api, type Subscription } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { LoadingLine } from '@/components/Loading'

const euros = (cents: number | null) => (cents == null ? '—' : (cents / 100).toFixed(2).replace('.', ',') + ' €')
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '—'
const BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', cartes_bancaires: 'CB' }

/** « Mon abonnement », inside PayByBot (instead of Stripe's page): the offer, the next payment, the card, the
 *  invoices, and stopping at the end of the period already paid. Only changing the card goes to Stripe's page. */
export function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'cancel' | 'card' | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    api.subscription().then(setSub, (e) => setError((e as Error).message))
  }, [])

  async function cancel(stop: boolean) {
    setBusy('cancel')
    try {
      setSub(await api.cancelSubscription(stop))
      toast.success(stop ? 'Abonnement résilié.' : 'Abonnement conservé.', {
        description: stop ? 'Il reste actif jusqu’à la fin de la période payée.' : undefined,
      })
      setConfirming(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
  }

  async function changeCard() {
    setBusy('card')
    try {
      window.location.assign((await api.changeCard()).url)
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(null)
    }
  }

  const row = 'flex items-center justify-between gap-4 py-4'
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Mon abonnement</DialogTitle>
          <DialogDescription className="sr-only">Votre offre PayByBot, votre carte et vos factures.</DialogDescription>
        </div>
        {error ? (
          <p className="mx-6 mb-6 rounded-xl bg-destructive/8 px-4 py-3 text-sm text-destructive">{error}</p>
        ) : !sub ? (
          <div className="mx-6 mb-6 grid h-48 place-items-center rounded-xl border border-ink/10">
            <LoadingLine className="items-center" label="Chargement de votre abonnement…" />
          </div>
        ) : (
          <div className="px-6 pb-6">
            <div className="mt-4 rounded-2xl border border-ink/10 p-5">
              <p className="text-sm text-ink/60">{sub.plan === 'yearly' ? 'Annuel' : 'Mensuel'}</p>
              <p className="mt-1 font-heading text-2xl leading-none font-semibold tracking-tight text-ink">
                {euros(sub.amount)} <span className="text-[0.95rem] font-normal text-ink/60">{sub.plan === 'yearly' ? '/ an' : '/ mois'}</span>
              </p>
              <p className={cn('mt-3 text-sm', sub.cancelAtPeriodEnd ? 'font-medium text-destructive' : 'text-ink/60')}>
                {sub.cancelAtPeriodEnd ? `Résilié : actif jusqu’au ${day(sub.nextBilling)}` : `Prochain paiement le ${day(sub.nextBilling)}`}
              </p>
            </div>

            <dl className="mt-2 divide-y divide-ink/[0.06]">
              <div className={row}>
                <dt className="text-ink/60">Carte</dt>
                <dd className="flex items-center gap-3">
                  <span className="flex items-center gap-2 text-ink">
                    <CreditCard className="size-4 text-ink/60" />
                    {sub.card?.last4 ? `${BRANDS[sub.card.brand ?? ''] ?? 'Carte'} •••• ${sub.card.last4}` : 'Aucune'}
                  </span>
                  <button onClick={changeCard} disabled={!!busy} className={cn('text-sm', ui.link)}>
                    {busy === 'card' ? <Loader2 className="size-4 animate-spin" /> : 'Changer'}
                  </button>
                </dd>
              </div>
              {sub.invoices.length > 0 && (
                <div className="py-4">
                  <dt className="text-ink/60">Factures</dt>
                  <dd className="mt-2 space-y-2">
                    {sub.invoices.map((i) => (
                      <a
                        key={i.date}
                        href={i.url ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between text-sm text-ink hover:underline"
                      >
                        <span>{day(i.date)}</span>
                        <span className="flex items-center gap-1.5 text-ink/60">
                          {euros(i.amount)} <ExternalLink className="size-3.5" />
                        </span>
                      </a>
                    ))}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-4">
              {sub.cancelAtPeriodEnd ? (
                <button onClick={() => cancel(false)} disabled={!!busy} className={ui.primaryGray}>
                  {busy === 'cancel' ? <Loader2 className="size-5 animate-spin" /> : 'Garder mon abonnement'}
                </button>
              ) : confirming ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/[0.04] p-4">
                  <p className="text-sm text-ink">
                    Résilier ? Votre abonnement reste actif jusqu’au {day(sub.nextBilling)}, puis les renouvellements s’arrêtent.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setConfirming(false)} className="flex-1 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink/60 hover:bg-ink/[0.05]">
                      Annuler
                    </button>
                    <button onClick={() => cancel(true)} disabled={!!busy} className="flex-1 rounded-[10px] bg-destructive px-3 py-2 text-sm font-semibold text-white">
                      {busy === 'cancel' ? <Loader2 className="mx-auto size-4 animate-spin" /> : 'Résilier'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="w-full text-center text-sm text-destructive hover:underline">
                  Résilier l’abonnement
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
