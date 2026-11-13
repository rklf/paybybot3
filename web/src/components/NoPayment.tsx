import { useEffect, useRef } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PayByPhone } from '@/components/signs'

const EVERY = 5_000 // how often PayByPhone is asked again while the card is awaited
const FOR = 10 * 60_000 // then only when the page comes back to the front

/** Shown when the PayByPhone account has no saved payment method we can use. PayByBot looks again by itself (every
 *  few seconds, and as soon as the page is back in front): once a card is there, the parent shows the next step. */
export function NoPayment({ onRefresh, compact = false }: { onRefresh: () => Promise<void>; compact?: boolean }) {
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh

  useEffect(() => {
    let busy = false
    const started = Date.now()
    const look = () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      refresh.current().finally(() => (busy = false))
    }
    const id = setInterval(() => Date.now() - started < FOR && look(), EVERY)
    const onFront = () => look()
    document.addEventListener('visibilitychange', onFront)
    window.addEventListener('focus', onFront)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onFront)
      window.removeEventListener('focus', onFront)
    }
  }, [])

  return (
    <div className={compact ? 'rounded-xl border border-border p-4' : 'rounded-2xl border border-border p-6'}>
      <div className="flex items-start gap-4">
        <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-ink">
          <CreditCard className="size-6" />
          <span className="absolute h-0.5 w-9 rotate-45 rounded bg-destructive" aria-hidden />
        </span>
        <div>
          <p className={compact ? 'font-heading text-lg font-bold' : 'font-heading text-xl font-bold'}>
            Aucune carte enregistrée sur <PayByPhone />
          </p>
          <p className="mt-1 text-muted-foreground">
            Pour payer d'ici, ajoutez d'abord une carte bancaire à votre compte <PayByPhone /> : dans l'application, menu{' '}
            <strong className="text-ink">Compte → Moyens de paiement</strong>, ou sur le site <PayByPhone />.
          </p>
          {!compact && (
            <p className="mt-2 text-sm text-muted-foreground">
              Apple Pay et Google Pay ne fonctionnent que sur le téléphone : ils ne sont pas utilisables ici.
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          variant="outline"
          className="h-12 rounded-xl border-ink/20 bg-white px-5"
          render={<a href="https://m.paybyphone.com" target="_blank" rel="noreferrer" />}
        >
          Ouvrir <PayByPhone /> <ExternalLink className="size-4" />
        </Button>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 animate-spin" /> En attente de votre carte…
        </p>
      </div>
    </div>
  )
}
