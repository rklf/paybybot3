import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CreditCard, Loader2, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NoPayment } from '@/components/NoPayment'
import { Plate, ZonePlate, PayByPhone } from '@/components/signs'
import { cn } from '@/lib/utils'
import { Notice } from '@/components/ui/notice'
import { choice, ui } from '@/lib/styles'
import { api, ApiError, clock, money, unitLabel, type Money, type Overview, type Parking, type Rate, type Unit } from '@/lib/api'

const STEPS = ['Véhicule', 'Zone', 'Tarif', 'Durée', 'Paiement', 'Confirmer'] as const
export const PRESETS: Record<Unit, number[]> = { Days: [1, 2, 3, 7], Hours: [1, 2, 3, 4], Minutes: [15, 30, 45, 60] }
const LAST_KEY = 'paybybot3:last'

export function loadLast(): Partial<Parking> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveLast(p: Parking) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(p))
  } catch {
    /* private window: not remembering is fine */
  }
}

function Choice({ selected, onClick, children, disabled }: { selected: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        choice(selected, 'relative flex min-h-16 w-full items-center gap-4 p-4'),
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
      {selected && (
        <span className="absolute top-1/2 right-4 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-eu text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

export function PayWizard({
  data,
  demo,
  onClose,
  onPaid,
  onRefresh,
}: {
  data: Overview
  demo: boolean
  onClose: () => void
  onPaid: () => void
  onRefresh: () => Promise<void>
}) {
  const last = useMemo(loadLast, [])
  const [step, setStep] = useState(0)
  const [plate, setPlate] = useState(
    data.vehicles.find((v) => v.plate === last.plate)?.plate ?? data.vehicles[0]?.plate ?? '',
  )
  const [location, setLocation] = useState(last.location ?? '')
  const [rates, setRates] = useState<Rate[]>([])
  const [rate, setRate] = useState<Rate | null>(null)
  const [unit, setUnit] = useState<Unit>('Days')
  const [duration, setDuration] = useState(1)
  const [payment, setPayment] = useState(
    data.payments.find((p) => p.id === last.paymentAccountId)?.id ?? data.payments[0]?.id ?? '',
  )
  const [quote, setQuote] = useState<{ cost: Money; expire: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ expire: string; cost: Money } | null>(null)
  // After an unconfirmed payment, never offer to pay again from here: it could charge twice.
  const [unconfirmed, setUnconfirmed] = useState(false)

  useEffect(() => {
    if (!payment && data.payments[0]) setPayment(data.payments[0].id)
  }, [data.payments, payment])

  const parking: Parking = { location: location.trim(), rate: rate?.ratePolicyId ?? '', duration, unit, plate, paymentAccountId: payment }

  // Fetch the exact price when reaching the last step.
  useEffect(() => {
    if (step !== 5) return
    setQuote(null)
    setError(null)
    api.quote(parking).then(setQuote, (e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function pickRate(r: Rate) {
    setRate(r)
    const u = r.acceptedTimeUnits.includes(unit)
      ? unit
      : r.acceptedTimeUnits.includes('Hours')
        ? 'Hours'
        : r.acceptedTimeUnits[0] ?? 'Days'
    setUnit(u)
    setDuration(PRESETS[u][0])
  }

  async function next() {
    setError(null)
    if (step === 1) {
      setBusy(true)
      try {
        const [found, history] = await Promise.all([
          api.rates(parking.location, plate),
          api.lastRate(parking.location, plate).catch(() => ({ rate: null, inZone: false })),
        ])
        if (!found.length) throw new Error("Aucun tarif trouvé pour cette zone. Vérifiez le numéro affiché sur l'horodateur.")
        setRates(found)
        const allowed = found.filter((r) => !r.parkingNotAllowedReason)
        // Known rate: chosen last time on this device, or found in PayByPhone's history for this car.
        const remembered =
          allowed.find((r) => r.ratePolicyId === last.rate) ?? allowed.find((r) => r.ratePolicyId === history.rate)
        const known = remembered ?? (allowed.length === 1 ? allowed[0] : undefined)
        pickRate(known ?? allowed[0] ?? found[0])
        if (remembered && last.rate === remembered.ratePolicyId && last.unit && remembered.acceptedTimeUnits.includes(last.unit)) {
          setUnit(last.unit)
          setDuration(last.duration ?? PRESETS[last.unit][0])
        }
        if (known) {
          // No need to ask: go straight to the duration, where the rate can still be changed.
          setStep(3)
          return
        }
      } catch (e) {
        setError((e as Error).message)
        return
      } finally {
        setBusy(false)
      }
    }
    setStep((s) => s + 1)
  }

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.pay(parking)
      saveLast(parking)
      setDone(res)
    } catch (e) {
      setError((e as Error).message)
      if (e instanceof ApiError && (e.status === 504 || e.status === 423)) setUnconfirmed(true)
    } finally {
      setBusy(false)
    }
  }

  const canContinue = [
    !!plate,
    /^\w{3,}$/.test(location.trim()),
    !!rate && !rate.parkingNotAllowedReason,
    duration > 0,
    !!payment,
    !!quote,
  ][step]

  if (done) {
    return (
      <div className="fixed inset-0 z-50 grid center-safe overflow-y-auto bg-background p-6">
        <div className="rise flex max-w-md flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-full bg-eu text-white">
            <Check className="size-8" strokeWidth={3} />
          </span>
          <h1 className={cn('mt-6', ui.title)}>{demo ? 'Paiement simulé' : "C'est payé !"}</h1>
          {demo && (
            <p className="mt-3 rounded-xl bg-amber/25 px-4 py-2 font-bold text-ink">
              Mode démo : rien n'a été payé ni envoyé à <PayByPhone />.
            </p>
          )}
          <p className={ui.subtitle}>
            Votre véhicule <Plate plate={plate} size="sm" className="mx-1 align-middle" /> est en règle jusqu'à{' '}
            <strong className="font-bold text-ink">{clock(done.expire)}</strong>.
          </p>
          <button onClick={onPaid} className={cn('mt-10', ui.primary)}>
            Retour à l'accueil
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-5 py-4">
          <Button variant="ghost" size="icon-lg" onClick={onClose} aria-label="Annuler">
            <X className="size-6" />
          </Button>
          <ol className="flex flex-1 gap-1.5" aria-label="Étapes">
            {STEPS.map((label, i) => (
              <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
                <span className={cn('block h-1 rounded-full transition-colors', i <= step ? 'bg-eu' : 'bg-border')} />
                <span className={cn('mt-1.5 hidden text-xs sm:block', i === step ? 'font-bold text-eu' : 'text-ink/40')}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main key={step} className="rise mx-auto w-full max-w-2xl flex-1 px-5 pt-10 pb-36">
        <p className="text-sm text-ink/50">
          Étape {step + 1} sur {STEPS.length}
        </p>

        {step === 0 && (
          <>
            <h1 className={cn('mt-2', ui.title)}>Quel véhicule ?</h1>
            <div className="mt-8 grid gap-3">
              {data.vehicles.map((v) => (
                <Choice key={v.plate} selected={plate === v.plate} onClick={() => setPlate(v.plate)}>
                  <Plate plate={v.plate} size="lg" />
                </Choice>
              ))}
              {!data.vehicles.length && (
                <p className="text-muted-foreground">Aucun véhicule : ajoutez-en un dans l'application <PayByPhone />.</p>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className={cn('mt-2', ui.title)}>Où êtes-vous garé ?</h1>
            <p className={ui.subtitle}>
              Tapez le <strong className="font-bold text-ink">numéro de zone</strong> affiché sur l'horodateur ou les panneaux. À Paris,
              c'est le code postal de la rue (par exemple <strong className="font-bold text-ink">75015</strong>).
            </p>
            <div className="mt-8 flex items-center gap-5">
              <Input
                autoFocus
                inputMode="numeric"
                placeholder="75015"
                value={location}
                onChange={(e) => setLocation(e.target.value.replace(/\s/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && canContinue && next()}
                className={cn(ui.field, 'h-16 max-w-56 font-heading text-3xl font-bold tracking-[0.08em] tabular-nums')}
                aria-label="Numéro de zone"
              />
              {location.trim() && <ZonePlate zone={location.trim()} className="scale-125" />}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className={cn('mt-2', ui.title)}>Quel tarif ?</h1>
            <p className={ui.subtitle}>
              Si vous habitez le quartier et avez une carte résident, choisissez <strong className="font-bold text-ink">Résident</strong>.
            </p>
            <div className="mt-8 grid gap-3">
              {rates.map((r) => (
                <Choice
                  key={r.ratePolicyId}
                  selected={rate?.ratePolicyId === r.ratePolicyId}
                  onClick={() => pickRate(r)}
                  disabled={!!r.parkingNotAllowedReason}
                >
                  <span>
                    <span className="block font-heading text-lg font-bold">{r.name}</span>
                    <span className="text-muted-foreground">
                      {r.parkingNotAllowedReason ?? `Par ${r.acceptedTimeUnits.map((u) => unitLabel(u, 1)).join(', ')}`}
                    </span>
                  </span>
                </Choice>
              ))}
            </div>
          </>
        )}

        {step === 3 && rate && (
          <>
            <h1 className={cn('mt-2', ui.title)}>Pour combien de temps ?</h1>
            <p className={ui.subtitle}>
              Tarif : <strong className="font-bold text-ink">{rate.name}</strong>
              {rates.length > 1 && (
                <>
                  {' · '}
                  <button onClick={() => setStep(2)} className={ui.link}>
                    Changer
                  </button>
                </>
              )}
            </p>
            {rate.acceptedTimeUnits.length > 1 && (
              <div className="mt-8 inline-flex rounded-xl bg-muted p-1.5">
                {rate.acceptedTimeUnits.map((u) => (
                  <button
                    key={u}
                    onClick={() => {
                      setUnit(u)
                      setDuration(PRESETS[u][0])
                    }}
                    className={cn('rounded-lg px-5 py-2.5 font-bold capitalize transition', unit === u ? 'bg-white text-eu shadow-sm' : 'text-ink/50')}
                  >
                    {unitLabel(u, 2)}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-8 flex items-center justify-center gap-3 rounded-2xl border border-border px-3 py-8 sm:gap-6">
              <Button variant="outline" className="size-14 shrink-0 rounded-full sm:size-16" onClick={() => setDuration((d) => Math.max(1, d - (unit === 'Minutes' ? 15 : 1)))} aria-label="Moins">
                <Minus className="size-6" />
              </Button>
              <p className="min-w-28 text-center sm:min-w-44">
                <span className="block font-heading text-6xl leading-none font-bold tracking-tight tabular-nums">{duration}</span>
                <span className="text-xl text-muted-foreground">{unitLabel(unit, duration)}</span>
              </p>
              <Button variant="outline" className="size-14 shrink-0 rounded-full sm:size-16" onClick={() => setDuration((d) => d + (unit === 'Minutes' ? 15 : 1))} aria-label="Plus">
                <Plus className="size-6" />
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {PRESETS[unit].map((n) => (
                <button
                  key={n}
                  onClick={() => setDuration(n)}
                  className={choice(duration === n, 'py-3 text-center font-bold')}
                >
                  {n} {unit === 'Minutes' ? 'min' : unit === 'Hours' ? 'h' : 'j'}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className={cn('mt-2', ui.title)}>Comment payer ?</h1>
            <p className={ui.subtitle}>Les moyens de paiement enregistrés dans votre compte <PayByPhone />.</p>
            {!data.payments.length && (
              <div className="mt-8">
                <NoPayment onRefresh={onRefresh} />
              </div>
            )}
            <div className="mt-8 grid gap-3">
              {data.payments.map((p) => (
                <Choice key={p.id} selected={payment === p.id} onClick={() => setPayment(p.id)}>
                  <CreditCard className="size-6 text-ink/60" />
                  <span className="text-xl font-bold">{p.label}</span>
                </Choice>
              ))}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className={cn('mt-2', ui.title)}>On vérifie ?</h1>
            <div className="mt-8 overflow-hidden rounded-2xl border border-border">
              <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
                <Plate plate={plate} size="sm" />
                <ZonePlate zone={parking.location} />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-4 p-5 text-base sm:gap-y-5 sm:p-6 sm:text-lg">
                <dt className="text-muted-foreground">Tarif</dt>
                <dd className="text-right font-bold">{rate?.name}</dd>
                <dt className="text-muted-foreground">Durée</dt>
                <dd className="text-right font-bold">
                  {duration} {unitLabel(unit, duration)}
                </dd>
                <dt className="text-muted-foreground">Fin</dt>
                <dd className="text-right font-bold">{quote ? clock(quote.expire) : '…'}</dd>
                <dt className="text-muted-foreground">Paiement</dt>
                <dd className="text-right font-bold">{data.payments.find((p) => p.id === payment)?.label.split(' — ')[0]}</dd>
              </dl>
              <div className="flex items-center justify-between border-t border-border px-5 py-4">
                <span className="text-lg text-ink/60">Total</span>
                <span className="font-heading text-3xl font-bold">{quote ? money(quote.cost) : <Loader2 className="size-7 animate-spin" />}</span>
              </div>
            </div>

          </>
        )}

        {busy && step === 5 && (
          <p className={cn('mt-6', ui.note)}>
            Paiement envoyé. On attend que <PayByPhone /> confirme le stationnement, cela peut prendre jusqu'à une minute.
            Ne fermez pas cette page.
          </p>
        )}

        {error && (
          <Notice className="mt-6">
            {error}
          </Notice>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3 px-5 py-4">
          {step > 0 && !unconfirmed && (
            <button onClick={() => setStep((s) => s - 1)} className="grid h-14 shrink-0 place-items-center rounded-xl border border-ink/20 px-4 text-ink transition hover:border-ink" aria-label="Retour">
              <ArrowLeft className="size-5" />
            </button>
          )}
          {unconfirmed ? (
            <button onClick={onPaid} className={ui.primary}>
              Retour à l'accueil
            </button>
          ) : step < 5 ? (
            <button onClick={next} disabled={!canContinue || busy} className={ui.primary}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <>Continuer <ArrowRight className="size-5" /></>}
            </button>
          ) : (
            <button onClick={pay} disabled={!canContinue || busy} className={ui.primary}>
              {busy ? (
                <>
                  <Loader2 className="size-5 animate-spin" /> Confirmation par <PayByPhone />…
                </>
              ) : (
                <>Payer {quote ? money(quote.cost) : ''}</>
              )}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
