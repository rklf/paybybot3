import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NoPayment } from '@/components/NoPayment'
import { loadLast, PRESETS } from '@/components/PayWizard'
import { Plate, ZonePlate, PayByPhone } from '@/components/signs'
import { cn } from '@/lib/utils'
import { Notice } from '@/components/ui/notice'
import { choice, ui } from '@/lib/styles'
import { api, ApiError, clock, money, until, unitLabel, type Money, type Overview, type Session, type Unit } from '@/lib/api'

const SHORT: Record<Unit, string> = { Days: 'j', Hours: 'h', Minutes: 'min' }

/** Adds time to an ongoing ticket (PayByPhone "Extend"), with the exact price shown first. */
export function ExtendDialog({
  session,
  data,
  open,
  onOpenChange,
  onDone,
}: {
  session: Session
  data: Overview
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void>
}) {
  const [units, setUnits] = useState<Unit[]>([])
  const [rateName, setRateName] = useState('')
  const [unit, setUnit] = useState<Unit>('Hours')
  const [duration, setDuration] = useState(1)
  const [payment, setPayment] = useState('')
  const [quote, setQuote] = useState<{ cost: Money; expire: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // After an unconfirmed payment, never offer to pay again from here.
  const [locked, setLocked] = useState(false)

  // Units accepted by the ticket's rate, and the usual card.
  useEffect(() => {
    if (!open) return
    setError(null)
    setLocked(false)
    const last = loadLast()
    setPayment(data.payments.find((p) => p.id === last.paymentAccountId)?.id ?? data.payments[0]?.id ?? '')
    api.rates(session.location, session.plate).then(
      (rates) => {
        const rate = rates.find((r) => r.ratePolicyId === session.rate)
        const accepted = rate?.acceptedTimeUnits.length ? rate.acceptedTimeUnits : (['Minutes', 'Hours'] as Unit[])
        setRateName(rate?.name ?? '')
        setUnits(accepted)
        const u = accepted.includes('Hours') ? 'Hours' : accepted[0]
        setUnit(u)
        setDuration(PRESETS[u][0])
      },
      (e) => setError(e.message),
    )
  }, [open, session, data.payments])

  // Price and new end time for the chosen extension.
  useEffect(() => {
    if (!open || !units.length || !payment) return
    let cancelled = false
    setLoading(true)
    setQuote(null)
    const timer = setTimeout(() => {
      api
        .quote({ location: session.location, rate: session.rate, duration, unit, plate: session.plate, paymentAccountId: payment, sessionId: session.id })
        .then(
          (q) => !cancelled && setQuote(q),
          (e) => !cancelled && setError(e.message),
        )
        .finally(() => !cancelled && setLoading(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, units, unit, duration, payment, session])

  async function extend() {
    setSaving(true)
    setError(null)
    try {
      const res = await api.extend({ location: session.location, rate: session.rate, duration, unit, plate: session.plate, paymentAccountId: payment, sessionId: session.id })
      toast.success('Ticket prolongé.', { description: `Valable ${until(res.expire)}.` })
      onOpenChange(false)
      await onDone()
    } catch (e) {
      setError((e as Error).message)
      if (e instanceof ApiError && (e.status === 504 || e.status === 423)) setLocked(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Prolonger le ticket</DialogTitle>
          <DialogDescription className="mt-1 text-ink/60">
            Fin actuelle : {clock(session.expire)}
          </DialogDescription>
        </div>

        <div className="space-y-6 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Plate plate={session.plate} size="sm" />
            <ZonePlate zone={session.location} />
            {rateName && <span className="text-sm text-ink/50">{rateName}</span>}
          </div>

          {!data.payments.length ? (
            <NoPayment compact onRefresh={onDone} />
          ) : (
            <>
              {units.length > 1 && (
                <div className="inline-flex rounded-xl bg-muted p-1.5">
                  {units.map((u) => (
                    <button
                      key={u}
                      onClick={() => {
                        setUnit(u)
                        setDuration(PRESETS[u][0])
                      }}
                      className={cn('rounded-lg px-4 py-2 font-bold capitalize transition', unit === u ? 'bg-white text-eu shadow-sm' : 'text-ink/50')}
                    >
                      {unitLabel(u, 2)}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <p className={ui.label}>Ajouter</p>
                <div className="grid grid-cols-4 gap-2">
                  {(PRESETS[unit] ?? []).map((n) => (
                    <button
                      key={n}
                      onClick={() => setDuration(n)}
                      aria-pressed={duration === n}
                      className={choice(duration === n, 'py-3 text-center font-bold')}
                    >
                      +{n} {SHORT[unit]}
                    </button>
                  ))}
                </div>
              </div>

              {data.payments.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {data.payments.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPayment(p.id)}
                      className={choice(payment === p.id, 'px-3 py-2 text-sm font-bold')}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="rounded-xl bg-muted p-4" aria-live="polite">
                {loading ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Calcul du prix…
                  </p>
                ) : quote ? (
                  <div className="flex items-end justify-between gap-4">
                    <span>
                      <span className="block text-sm text-muted-foreground">Nouvelle fin</span>
                      <strong>{clock(quote.expire)}</strong>
                    </span>
                    <span className="font-heading text-3xl font-bold">{money(quote.cost)}</span>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Choisissez une durée.</p>
                )}
              </div>
            </>
          )}

          {error && (
            <Notice>
              {error}
            </Notice>
          )}

          {locked ? (
            <button onClick={() => onOpenChange(false)} className={ui.primary}>
              Fermer
            </button>
          ) : (
            <button onClick={extend} disabled={!quote || saving || !payment} className={ui.primary}>
              {saving ? (
                <>
                  <Loader2 className="size-5 animate-spin" /> Confirmation par <PayByPhone />…
                </>
              ) : (
                <>
                  <Plus className="size-5" /> Prolonger {quote ? `· ${money(quote.cost)}` : ''}
                </>
              )}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
