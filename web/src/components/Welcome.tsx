import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Car, Check, CreditCard, Loader2, Minus, Phone, RefreshCw, Ticket, UserRound, X } from 'lucide-react'
import { LoadingLine } from '@/components/Loading'
import { RemotePanel } from '@/components/RemoteScene'
import { arrondissement, PayByBot, PayByPhone, Plate, withPayByPhone, Wordmark, ZonePlate } from '@/components/signs'
import { api, until, type Me, type Overview, type PricedVehicle } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'

/** +33612345678 -> +33 6 12 34 56 78 (other formats are shown as they are). */
function phoneText(username: string) {
  const m = username.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/)
  return m ? `+33 ${m.slice(1).join(' ')}` : username
}

const samePlate = (a: string, b: string) => a.replace(/[^0-9a-z]/gi, '').toUpperCase() === b.replace(/[^0-9a-z]/gi, '').toUpperCase()

function Row({
  icon,
  label,
  children,
  delay,
  found = true,
  loading = false,
  highlight = false,
  missing = false,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
  delay: number
  found?: boolean
  /** Still looking: a small spinner instead of the check or the dash. */
  loading?: boolean
  /** The resident vehicle, what the whole service is about: framed in blue. */
  highlight?: boolean
  /** Required and absent (no valid card): a red cross, and the next step waits for it. */
  missing?: boolean
}) {
  return (
    <li
      className={cn('rise flex items-start gap-4 py-3', highlight && '-mx-4 my-2 rounded-2xl border-2 border-eu bg-eu/[0.03] px-[14px]')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-eu/[0.08] text-eu">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink/55">{label}</p>
        <div className="mt-1 text-ink">{children}</div>
      </div>
      {loading ? (
        <span className="mt-2.5 size-6 shrink-0 rounded-full bg-ink/[0.05]" aria-hidden />
      ) : missing ? (
        <span className="mt-2.5 grid size-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
          <X className="size-3.5" strokeWidth={3} />
        </span>
      ) : found ? (
        <span className="mt-2.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#e7f6ec] text-[#1a9a4a]">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span className="mt-2.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-ink/40">
          <Minus className="size-3.5" strokeWidth={3} />
        </span>
      )}
    </li>
  )
}

/** First sign-in: everything PayByBot found in the PayByPhone account, so the user can check it is right. */
export function Welcome({
  me,
  data,
  onContinue,
  onRefresh,
}: {
  me: Me
  data: Overview
  onContinue: () => void
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
      data.vehicles.map((v): PricedVehicle => ({ plate: v.plate, type: v.type, zone: null, monthly: 0, yearly: 0, renewed: false }))
    api.pricing(reloads ? 0 : undefined).then(
      (p) => setVehicles(p.vehicles?.length ? p.vehicles : fallback()),
      () => setVehicles(fallback()),
    )
  }, [me.demo, reloads])

  // Without a resident rate, the pricing lists every vehicle with no zone: they take non-resident tickets.
  const residents = vehicles?.some((v) => v.zone) ?? false
  const n = vehicles?.length ?? 0
  // Only the vehicles with a resident rate are called « résident »: 3 vehicles, 1 of them resident, says so.
  const r = vehicles?.filter((v) => v.zone).length ?? 0
  const vehiclesLabel =
    r && r === n
      ? n > 1 ? `${n} véhicules résidents` : 'Véhicule résident'
      : r
        ? `${n} véhicules, dont ${r} résident${r > 1 ? 's' : ''}`
        : n > 1 ? `${n} véhicules` : 'Véhicule'

  // PayByBot pays with a card saved on PayByPhone (not Apple Pay, Google Pay or PayPal), not expired: without one
  // the next step waits, and « Rafraîchir » looks again once it is added.
  const cards = data.payments.filter((p) => p.kind === 'card')
  const valid = cards.filter((p) => !p.expired)

  const step = 140
  let i = 0
  const next = () => ++i * step

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col px-6 pt-5 pb-10 sm:px-10 lg:px-[clamp(2.5rem,7vw,7rem)] lg:pb-6">
        <Wordmark />
        <div className="mx-auto w-full max-w-lg lg:my-auto lg:pt-2">
          <h1 className={cn(ui.title, 'rise mt-10 lg:mt-0')}>
            Bienvenue{me.firstName ? `, ${me.firstName}` : ''}.
          </h1>
          <p className={cn(ui.subtitle, 'rise')}>
            Voici ce que <PayByBot /> a retrouvé dans votre compte <PayByPhone />. Vérifiez que tout est juste.
          </p>

          <ul className="mt-5 divide-y divide-ink/10 border-y border-ink/10">
            <Row icon={<Phone className="size-5" />} label="Compte PayByPhone" delay={next()}>
              <span className="font-semibold tabular-nums">{phoneText(me.username)}</span>
              <span className="ml-2 text-sm text-ink/55">connecté</span>
            </Row>
            {me.firstName && (
              <Row icon={<UserRound className="size-5" />} label="Titulaire" delay={next()}>
                <span className="font-semibold">{me.firstName}</span>
              </Row>
            )}
            <Row
              icon={<Car className="size-5" />}
              label={vehiclesLabel}
              delay={next()}
              found={!!vehicles?.length}
              loading={vehicles === undefined}
              highlight
            >
              {vehicles === undefined ? (
                // Looking for the vehicles on PayByPhone (a few seconds): the app's loading bar, and what is happening.
                <LoadingLine className="pt-1.5" label={<>Recherche de vos véhicules sur <PayByPhone />…</>} />
              ) : vehicles.length ? (
                <span className="flex flex-col gap-1.5 pt-0.5">
                  {vehicles.map((v) => {
                    // Its running ticket, if any, right under the car.
                    const ticket = data.sessions.find((s) => samePlate(s.plate, v.plate) && new Date(s.expire).getTime() > Date.now())
                    return (
                      <span key={v.plate} className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Plate plate={v.plate} size="sm" />
                          {arrondissement(v.zone) && <span className="font-semibold">{arrondissement(v.zone)}</span>}
                          <ZonePlate zone={v.zone} />
                        </span>
                        {ticket && (
                          <span className="flex items-start gap-1.5 text-sm text-ink/70">
                            <Ticket className="mt-0.5 size-4 shrink-0 text-eu" /> Ticket en cours {until(ticket.expire)}
                          </span>
                        )}
                      </span>
                    )
                  })}
                  {!residents && (
                    <span className="text-sm leading-relaxed text-ink/60">
                      Pas de tarif résident sur {withPayByPhone('PayByPhone')} : <PayByBot /> prendra vos tickets
                      non-résident les jours choisis.
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-ink/60">
                  {data.vehicles.length
                    ? 'Aucun véhicule au tarif résident.'
                    : withPayByPhone('Aucun véhicule : ajoutez-le dans l’application PayByPhone.')}
                </span>
              )}
            </Row>
            <Row
              icon={<CreditCard className="size-5" />}
              label={cards.length > 1 ? 'Cartes bancaires' : 'Carte bancaire'}
              delay={next()}
              found={valid.length > 0}
              missing={!valid.length}
            >
              {cards.length > 0 && (
                <span className="flex flex-col gap-0.5 font-semibold">
                  {cards.map((p) => (
                    <span key={p.id} className={cn(p.expired && 'text-ink/45 line-through decoration-ink/30')}>
                      {p.label}
                      {p.expired && <span className="ml-2 text-sm font-normal text-destructive no-underline">expirée</span>}
                    </span>
                  ))}
                </span>
              )}
              {!valid.length && (
                <span className={cn('block text-sm leading-relaxed text-destructive', cards.length > 0 && 'mt-2')}>
                  {withPayByPhone(
                    cards.length
                      ? 'Carte expirée : ajoutez une carte bancaire valide dans l’application PayByPhone, puis touchez « Rafraîchir ».'
                      : 'Aucune carte bancaire : ajoutez-en une dans l’application PayByPhone, puis touchez « Rafraîchir ».',
                  )}
                  <span className="mt-1 block text-ink/55">
                    Apple Pay, Google Pay et PayPal ne fonctionnent pas avec <PayByBot /> : seule une carte bancaire convient.
                  </span>
                </span>
              )}
            </Row>
          </ul>

          <p className="rise mt-4 text-sm leading-relaxed text-ink/55" style={{ animationDelay: `${next()}ms` }}>
            Rien n’a été modifié dans votre compte <PayByPhone />, et votre mot de passe n’est pas enregistré. Un véhicule
            ou une carte à changer ? Faites-le dans l’application <PayByPhone />, puis touchez « Rafraîchir ».
          </p>
          <button
            onClick={refresh}
            disabled={refreshing}
            className={cn('rise mt-3 gap-2', ui.pillGray)}
            style={{ animationDelay: `${next()}ms` }}
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rafraîchir
          </button>

          {/* The animation on a wrapper: on the button itself its opacity would hide the greyed-out state. */}
          <div className="rise mt-5" style={{ animationDelay: `${next()}ms` }}>
            <button onClick={onContinue} disabled={!vehicles?.length || !valid.length} className={ui.primary}>
              C’est bien moi, continuer <ArrowRight className="size-5" />
            </button>
          </div>
        </div>
      </div>

      {/* The same animated scene as the sign-in page and the offer screen. */}
      <RemotePanel className="hidden min-h-dvh lg:block" />
    </div>
  )
}
