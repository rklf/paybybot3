import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Loader2, Mail, Phone, type LucideIcon } from 'lucide-react'
import { RemotePanel } from '@/components/RemoteScene'
import { PayByBot, PayByPhone, Plate, withPayByPhone, Wordmark } from '@/components/signs'
import { api, type Me, type Overview, type PricedVehicle } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { LineBone, PlateBone } from '@/components/Skeletons'
import { SmoothHeight } from '@/components/ui/smooth-height'

/** +33612345678 -> +33 6 12 34 56 78 (other formats are shown as they are). */
function phoneText(username: string) {
  const m = username.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/)
  return m ? `+33 ${m.slice(1).join(' ')}` : username
}

/** One line of the welcome page: the label on the left, the value on the right. */
function Line({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      {/* An icon in place of the label (the label kept for screen readers), as in « Mon compte ». */}
      <dt className="pt-0.5 text-ink/55">
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
  onRefresh,
  onLogout,
}: {
  me: Me
  data: Overview
  onContinue: () => void
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
  useEffect(() => {
    api.account().then(
      (a) => setEmail(a.email ?? ''),
      () => setEmail(''),
    )
  }, [])
  const n = vehicles?.length ?? 0
  const zones = [...new Set((vehicles ?? []).flatMap((v) => (v.zone ? [v.zone] : [])))]

  // PayByBot pays with a card saved on PayByPhone (not Apple Pay, Google Pay or PayPal), not expired: without one
  // the next step waits, and « Rafraîchir » looks again once it is added.
  const cards = data.payments.filter((p) => p.kind === 'card')
  const valid = cards.filter((p) => !p.expired)

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col px-6 pt-5 pb-10 sm:px-10 lg:px-[clamp(2.5rem,7vw,7rem)] lg:pb-6">
        <Wordmark />
        <div className="rise mx-auto w-full max-w-lg lg:my-auto lg:pt-2">
          <h1 className={cn(ui.title, 'mt-10 lg:mt-0')}>Bienvenue{me.firstName ? `, ${me.firstName}` : ''}.</h1>
          <p className={ui.subtitle}>
            Vos informations <PayByPhone />.
          </p>

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
              {/* The card only when it blocks (none valid): a card number on the welcome page alarms more than it helps. */}
              {!valid.length && (
                <Line label={cards.length > 1 ? 'Cartes' : 'Carte'}>
                  {cards.length ? (
                    <span className="flex flex-col items-end gap-0.5 font-heading font-medium">
                      {cards.map((p) => (
                        <span key={p.id} className={cn(p.expired && 'text-ink/45 line-through decoration-ink/30')}>
                          {p.label.replace(/ — exp\..*$/, '')}
                          {p.expired && <span className="ml-2 text-sm font-normal text-destructive">expirée</span>}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="font-heading font-medium text-destructive">Aucune</span>
                  )}
                </Line>
              )}
            </dl>

            {/* Only when something blocks: what to do, in one place. */}
            {vehicles !== undefined && (!vehicles.length || !valid.length) && (
              <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">
                {withPayByPhone(
                  !vehicles.length
                    ? 'Aucun véhicule : ajoutez-le dans l’application PayByPhone, puis touchez « Rafraîchir ».'
                    : cards.length
                      ? 'Carte expirée : ajoutez une carte bancaire valide dans l’application PayByPhone, puis touchez « Rafraîchir ».'
                      : 'Aucune carte bancaire : ajoutez-en une dans l’application PayByPhone, puis touchez « Rafraîchir ».',
                )}
                {vehicles.length > 0 && (
                  <span className="mt-1 block text-ink/55">
                    Apple Pay, Google Pay et PayPal ne fonctionnent pas avec <PayByBot /> : seule une carte bancaire convient.
                  </span>
                )}
              </p>
            )}
          </SmoothHeight>

          <button onClick={onContinue} disabled={!vehicles?.length || !valid.length} className={cn(ui.primary, 'mt-8')}>
            C’est bien moi, continuer <ArrowRight className="size-5" />
          </button>
          <p className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink/55">
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
    </div>
  )
}
