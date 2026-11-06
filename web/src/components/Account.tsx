import { useEffect, useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PlansDialog } from '@/components/Pricing'
import { arrondissement, PayByBot, PayByPhone, Plate, ZonePlate } from '@/components/signs'
import { api, clock, type Account, type Overview, type PricedVehicle, type Pricing } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { LoadingLine } from '@/components/Loading'

const euros = (cents: number) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

/** "Mon compte" in the top bar: what PayByBot reads from the PayByPhone account, the home zone and e-mail. */
export function AccountButton({
  data,
  onDeleted,
  demo = false,
}: {
  data: Overview | null
  onDeleted: () => void
  demo?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* On a phone, the icon alone (the top bar must fit 375 px). */}
      <button onClick={() => setOpen(true)} disabled={!data} className={ui.navText} aria-label="Mon compte">
        <UserRound className="size-5 sm:hidden" />
        <span className="hidden sm:inline">Mon compte</span>
      </button>
      {open && data && <AccountDialog data={data} onClose={() => setOpen(false)} onDeleted={onDeleted} demo={demo} />}
    </>
  )
}

function AccountDialog({
  data,
  onClose,
  onDeleted,
  demo,
}: {
  data: Overview
  onClose: () => void
  onDeleted: () => void
  demo: boolean
}) {
  const [email, setEmail] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  // Only the « riverain » vehicles, each with the arrondissement PayByPhone gives it the resident rate in (never
  // typed); undefined: looking.
  const [vehicles, setVehicles] = useState<PricedVehicle[] | undefined>(undefined)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  useEffect(() => {
    api.pricing().then(
      (p) => {
        setPricing(p)
        setVehicles(p.vehicles ?? [])
      },
      () => setVehicles([]),
    )
  }, [])
  const yearly = account?.plan === 'yearly'

  // « Gérer »: Stripe's customer portal (card, invoices, cancel), back here after.
  const [opening, setOpening] = useState(false)
  const [plans, setPlans] = useState(false) // « Choisir mon offre »: the offer screen
  function manage() {
    setOpening(true)
    api.billingPortal().then(
      (r) => window.location.assign(r.url),
      () => {
        setOpening(false)
        toast.error('Impossible d’ouvrir la gestion de l’abonnement. Réessayez dans un instant.')
      },
    )
  }

  useEffect(() => {
    api.account().then(
      (a) => {
        setEmail(a.email)
        setAccount(a)
      },
      () => {
        setEmail('')
        setAccount(null)
      },
    )
  }, [])

  const row = 'flex items-start justify-between gap-6 py-4'
  const label = 'shrink-0 pt-1 text-sm text-ink/55'

  if (deleting) return <DeleteConfirm data={data} onCancel={() => setDeleting(false)} onDeleted={onDeleted} />

  const cards = data.payments.filter((p) => p.kind === 'card')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Mon compte</DialogTitle>
          <DialogDescription className="mt-1 text-ink/60">
            Ce que <PayByBot /> lit dans votre compte <PayByPhone />.
          </DialogDescription>
        </div>

        {/* The vehicles, one row each (plate and zone); one price covers them all. */}
        <section className="mx-6 mt-6">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="font-heading text-lg font-bold text-ink">
              {vehicles && vehicles.length > 1 ? 'Vos véhicules' : 'Votre véhicule'}
            </h3>
            {!demo && account?.plan && (
              <button onClick={manage} disabled={opening} className={cn('inline-flex items-center gap-1.5 text-sm', ui.link)}>
                {opening && <Loader2 className="size-3.5 animate-spin" />}
                Gérer l’abonnement
              </button>
            )}
          </div>

          <ul className="mt-3 divide-y divide-ink/10 rounded-xl border border-ink/12 bg-white">
            {vehicles === undefined ? (
              <LoadingLine className="px-3 py-4" />
            ) : vehicles.length ? (
              vehicles.map((v) => {
                const zone = arrondissement(v.zone)
                return (
                  <li key={v.plate} className="flex items-center gap-3 px-3 py-3">
                    <Plate plate={v.plate} size="sm" />
                    <span className="min-w-0 flex-1 text-[0.95rem] font-semibold text-ink">
                      {zone ?? (v.zone ? <ZonePlate zone={v.zone} /> : <span className="font-normal text-ink/60">Sans tarif résident</span>)}
                    </span>
                  </li>
                )
              })
            ) : (
              <li className="px-3 py-3 text-ink/60">{data.vehicles.length ? 'Aucun véhicule au tarif résident' : 'Aucun véhicule'}</li>
            )}
          </ul>

          {account?.subscribed && pricing?.monthly != null && !!vehicles?.length && (
            <p className="mt-3 flex items-baseline justify-between gap-3 rounded-xl bg-ink/[0.04] px-4 py-3 text-ink">
              <span>
                Abonnement {yearly ? 'annuel' : 'mensuel'}
                {vehicles.length > 1 && <span className="block text-sm text-ink/60">Tous vos véhicules sont inclus.</span>}
              </span>
              <span className="font-bold whitespace-nowrap">
                {euros((yearly ? pricing.yearly : pricing.monthly) ?? 0)}
                {yearly ? '/an' : '/mois'}
              </span>
            </p>
          )}

          <p className="mt-3 text-sm text-ink/55">
            Un véhicule manque ? Ajoutez-le dans l’application <PayByPhone /> : il apparaîtra ici.{' '}
            {/* PayByPhone's own app link (as in the e-mails): the app when installed, else its store or site. */}
            <a href="https://paybyphone.onelink.me/ZQkh/" target="_blank" rel="noreferrer" className={ui.link}>
              Ouvrir <PayByPhone />
            </a>
          </p>
        </section>

        <dl className="mx-6 mt-6 divide-y divide-ink/10 border-y border-ink/10">
          <div className={row}>
            <dt className={label}>{cards.length > 1 ? 'Cartes bancaires' : 'Carte bancaire'}</dt>
            <dd className="flex flex-col items-end gap-1 text-right font-medium text-ink">
              {cards.length ? (
                cards.map((c) => (
                  <span key={c.id}>
                    {c.label}
                    {c.expired && <span className="ml-2 text-sm font-semibold text-destructive">Expirée</span>}
                  </span>
                ))
              ) : (
                <span className="font-normal text-ink/60">Aucune carte</span>
              )}
            </dd>
          </div>

          {/* With an offer, it is managed from the vehicles' header. */}
          {!demo && !account?.plan && (
            <div className={row}>
              <dt className={label}>Abonnement</dt>
              <dd className="text-right">
                {account === undefined ? (
                  <Loader2 className="ml-auto size-4 animate-spin text-ink/40" />
                ) : (
                  <span className="flex flex-col items-end gap-1">
                    {account?.trialEnd && (
                      <span className="text-ink/60">
                        Mois offert jusqu’au{' '}
                        {new Date(account.trialEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                      </span>
                    )}
                    {account?.trialDays && !account.trialEnd && (
                      <span className="text-ink/60">1er mois offert dès le choix de l’offre</span>
                    )}
                    <button type="button" onClick={() => setPlans(true)} className={cn('text-sm', ui.link)}>
                      Choisir mon offre
                    </button>
                  </span>
                )}
              </dd>
            </div>
          )}

          <div className={row}>
            <dt className={label}>E-mail</dt>
            <dd className="min-w-0 truncate text-right font-medium text-ink">
              {email === undefined ? <Loader2 className="ml-auto size-4 animate-spin text-ink/40" /> : email || '—'}
            </dd>
          </div>

        </dl>

        <div className={cn('px-6 pb-7', demo ? 'pt-2' : 'pt-6')}>
          {!demo && (
            <button
              onClick={() => setDeleting(true)}
              className="inline-flex h-10 items-center rounded-[10px] border border-destructive/30 px-4 text-sm font-semibold text-destructive transition hover:bg-destructive/5"
            >
              Supprimer mon compte
            </button>
          )}
        </div>
      </DialogContent>
      {plans && <PlansDialog onClose={() => setPlans(false)} />}
    </Dialog>
  )
}

/** Validation before erasing everything PayByBot keeps; a confirmation e-mail follows. */
function DeleteConfirm({ data, onCancel, onDeleted }: { data: Overview; onCancel: () => void; onDeleted: () => void }) {
  const running = data.sessions.filter((s) => new Date(s.expire).getTime() > Date.now())
  const [busy, setBusy] = useState(false)

  async function erase() {
    setBusy(true)
    try {
      await api.deleteData()
      toast.success('Votre compte PayByBot est supprimé.', {
        description: 'Une confirmation vous est envoyée par e-mail.',
      })
      onDeleted() // straight back to the home page, without reloading
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className={ui.dialog}>
        <div className="p-6 pt-7">
          <DialogTitle className={ui.dialogTitle}>Supprimer votre compte ?</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed text-ink/65">
            Tout ce que <PayByBot /> garde est effacé, et votre compte <PayByPhone /> n’est pas touché. Vous recevrez une
            confirmation par e-mail.
          </DialogDescription>
          {/* Which ticket stays valid, and until when: plate, zone, end. */}
          <div role="note" className="mt-4 rounded-xl border border-border bg-white px-4 py-3 text-sm leading-relaxed text-ink">
            {running.length ? (
              <>
                <p>{running.length > 1 ? 'Vos tickets en cours restent valables jusqu’à leur fin :' : 'Votre ticket en cours reste valable jusqu’à sa fin :'}</p>
                <ul className="mt-3 space-y-2">
                  {running.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Plate plate={t.plate} size="sm" />
                      <ZonePlate zone={t.location} />
                      <span className="text-ink/70">expire {clock(t.expire)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3">Ensuite, {running.length > 1 ? 'ils ne seront' : 'il ne sera'} plus renouvelé{running.length > 1 ? 's' : ''}.</p>
              </>
            ) : (
              <p>Aucun ticket en cours : plus aucun stationnement ne sera renouvelé.</p>
            )}
          </div>
          <div className="mt-7 grid gap-3">
            <button
              onClick={erase}
              disabled={busy}
              className="flex h-14 w-full items-center justify-center rounded-xl border border-destructive/30 text-lg font-semibold text-destructive transition hover:bg-destructive/5 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : 'Supprimer définitivement'}
            </button>
            <button onClick={onCancel} disabled={busy} className={ui.primaryGray}>
              Annuler
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
