import { useEffect, useState } from 'react'
import { CreditCard, Loader2, Mail, Receipt, UserRound, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { arrondissement, PayByBot, PayByPhone, Plate, ZonePlate } from '@/components/signs'
import { api, clock, type Account, type Overview, type PricedVehicle } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LineBone, PlateBone } from '@/components/Skeletons'
import { ui } from '@/lib/styles'
import { SmoothHeight } from '@/components/ui/smooth-height'
import { PlansDialog } from '@/components/Pricing'

/** "Mon compte" in the top bar: what PayByBot reads from the PayByPhone account, the home zone and e-mail. */
export function AccountButton({
  data,
  onDeleted,
  demo = false,
  label = false,
}: {
  data: Overview | null
  onDeleted: () => void
  demo?: boolean
  /** A text link (« Mon compte ») instead of the top bar's button. */
  label?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {label ? (
        <button onClick={() => setOpen(true)} disabled={!data} className={ui.link}>
          Mon compte
        </button>
      ) : (
        // On a phone, the icon alone (the top bar must fit 375 px).
        <button onClick={() => setOpen(true)} disabled={!data} className={ui.navText} aria-label="Mon compte">
          <UserRound className="size-5 lg:hidden" />
          <span className="hidden lg:inline">Mon compte</span>
        </button>
      )}
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
  const [plans, setPlans] = useState(false)
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  // Only the « riverain » vehicles, each with the arrondissement PayByPhone gives it the resident rate in (never
  // typed); undefined: looking.
  const [vehicles, setVehicles] = useState<PricedVehicle[] | undefined>(undefined)
  useEffect(() => {
    api.pricing().then(
      (p) => setVehicles(p.vehicles ?? []),
      () => setVehicles([]),
    )
  }, [])

  // « Gérer »: Stripe's customer portal (card, invoices, cancel), back here after.
  const [opening, setOpening] = useState(false)
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

  if (plans) return <PlansDialog onClose={onClose} />
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

        {/* What arrives a moment later (PayByPhone, the account) makes the window grow smoothly, never in one jump. */}
        <SmoothHeight>
          <div className="space-y-6 px-6 pt-6 pb-7">
            {/* The vehicles, one row each: the plate on the left, the resident rate on the right. */}
            <Section>
              <Rows>
                {vehicles === undefined ? (
                  // The rows' own shapes while PayByPhone answers (as many as the account's cars).
                  (data.vehicles.length ? data.vehicles : [null]).map((_, i) => (
                    <li key={i} className={rowClass}>
                      <PlateBone />
                      <LineBone className="w-28" />
                    </li>
                  ))
                ) : vehicles.length ? (
                  vehicles.map((v) => {
                    const zone = arrondissement(v.zone)
                    return (
                      <li key={v.plate} className={rowClass}>
                        <Plate plate={v.plate} size="sm" />
                        <span className={cn('text-right', v.zone ? 'text-ink' : 'text-ink/60')}>
                          {zone ? `Résident · ${zone}` : v.zone ? <ZonePlate zone={v.zone} /> : 'Non résident'}
                        </span>
                      </li>
                    )
                  })
                ) : (
                  <li className={cn(rowClass, 'text-ink/60')}>{data.vehicles.length ? 'Aucun véhicule au tarif résident' : 'Aucun véhicule'}</li>
                )}
              </Rows>
              <p className={note}>
                Un véhicule manque ? Ajoutez-le sur{' '}
                {/* PayByPhone's own app link (as in the e-mails): on an iPhone it opens the app when installed (a universal
                    link), else its App Store page. */}
                <a href="https://paybyphone.onelink.me/ZQkh/" target="_blank" rel="noreferrer" className={ui.link}>
                  <PayByPhone />
                </a>
              </p>
            </Section>

            <Section title="Paiement et contact">
              <Rows>
                <Row icon={CreditCard} label={cards.length > 1 ? 'Cartes bancaires' : 'Carte bancaire'}>
                  {cards.length ? (
                    <span className="flex flex-col gap-0.5">
                      {cards.map((c) => (
                        <span key={c.id}>
                          {c.label}
                          {c.expired && <span className="ml-2 font-semibold text-destructive">Expirée</span>}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink/60">Aucune carte</span>
                  )}
                </Row>
                {/* Paying subscribers: Stripe's portal (card, invoices, cancelling) — the offer itself is not shown here. While
                    the account is read, its place is kept (a grey line), so the window does not jump when it arrives. */}
                {!demo && account === undefined && (
                  <li className={cn(rowClass, 'justify-start')}>
                    <Receipt className="size-[1.15rem] shrink-0 text-ink/45" aria-hidden />
                    <LineBone className="w-44" />
                  </li>
                )}
                {/* No subscription yet (free month or over): the way to activate it, here too. */}
                {!demo && account && !account.plan && (
                  <Row icon={Receipt} label="Abonnement">
                    <button onClick={() => setPlans(true)} className={ui.link}>
                      Activer mon compte
                    </button>
                  </Row>
                )}
                {!demo && account?.plan && (
                  <Row icon={Receipt} label="Abonnement">
                    <button onClick={manage} disabled={opening} className={cn('inline-flex items-center gap-1.5', ui.link)}>
                      {opening && <Loader2 className="size-3.5 animate-spin" />}
                      Gérer mon abonnement
                    </button>
                  </Row>
                )}
                <Row icon={Mail} label="E-mail">
                  {email === undefined ? <LineBone className="w-52" /> : <span className="block truncate">{email || '—'}</span>}
                </Row>
              </Rows>
            </Section>

            {!demo && (
              <button onClick={() => setDeleting(true)} className="text-sm font-medium text-destructive/80 underline-offset-[3px] transition hover:text-destructive hover:underline">
                Supprimer mon compte
              </button>
            )}
          </div>
        </SmoothHeight>
      </DialogContent>
    </Dialog>
  )
}

// One look for every part of the window: a section title, a white box of rows of one height, the label on the left
// and the value on the right, all in the same text size.
const rowClass = 'flex min-h-14 items-center justify-between gap-4 px-4 py-3 text-[0.95rem]'
const note = 'mt-2 px-1 text-sm text-ink/60'

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h3 className="mb-2 px-1 text-[1.05rem] text-ink/60">{title}</h3>}
      {children}
    </section>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-ink/[0.08] overflow-hidden rounded-xl border border-ink/10 bg-white">{children}</ul>
}

/** An icon in place of the label (the label kept for screen readers), the value beside it, an action on the right. */
function Row({ icon: Icon, label, action, children }: { icon: LucideIcon; label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className={cn(rowClass, 'justify-start')}>
      <Icon className="size-[1.15rem] shrink-0 text-ink/45" aria-hidden />
      <span className="sr-only">{label} : </span>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
      {action && <span className="shrink-0">{action}</span>}
    </li>
  )
}

/** Validation before erasing everything PayByBot keeps; a confirmation e-mail follows. */
function DeleteConfirm({ data, onCancel, onDeleted }: { data: Overview; onCancel: () => void; onDeleted: () => void }) {
  // One line per car (a CMI-S car holds a ticket in each arrondissement): its zones together, its last end.
  const running = Object.values(
    data.sessions
      .filter((s) => !s.stopped && new Date(s.expire).getTime() > Date.now())
      .reduce<Record<string, { plate: string; zones: string[]; expire: string }>>((cars, s) => {
        const k = s.plate.replace(/[^0-9a-z]/gi, '').toUpperCase()
        const car = (cars[k] ??= { plate: s.plate, zones: [], expire: s.expire })
        car.zones.push(s.location)
        if (new Date(s.expire) > new Date(car.expire)) car.expire = s.expire
        return cars
      }, {}),
  )
  const zonesText = (zones: string[]) => {
    const z = [...new Set(zones)].sort()
    return z.length < 2 ? z[0] : z.length >= 20 ? '75001-75020' : `${z[0]} + ${z.length - 1} autre${z.length > 2 ? 's' : ''}`
  }
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
          <DialogDescription className="mt-2 leading-relaxed text-ink/60">
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
                    <li key={t.plate} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Plate plate={t.plate} size="sm" />
                      <ZonePlate zone={zonesText(t.zones)} />
                      <span className="text-ink/60">expire {clock(t.expire)}</span>
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
