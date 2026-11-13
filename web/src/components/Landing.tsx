import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowRight, BellRing, Check, Star, CreditCard, Headset, Pause, Plus, RefreshCw, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { HostedFooter } from '@/components/Footer'
import { PublicTopBar } from '@/components/TopBar'
import { PlanCards } from '@/components/Pricing'
import { cn } from '@/lib/utils'
import { AnimatePresence } from 'motion/react'
import { AnimatedListItem } from '@/components/ui/animated-list'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { TRY_LABEL, ui } from '@/lib/styles'
import { brandNodes, PayByBot, PayByPhone, PayByPhoneMark, Plate, withBrands, withPayByPhone } from '@/components/signs'



/** Prunoo's four features, said only as far as PayByBot does them. */
const FEATURES: Question[] = [
  ['Renouvellement automatique', <>Votre ticket est renouvelé avant l'expiration, ou pris les jours que vous choisissez.</>],
  ['Pause en 1 clic', <>Vacances ? Mettez en pause entre deux dates : rien n'est payé.</>],
  ['Alertes intelligentes', <>Un e-mail avec la raison en cas d'échec, et une relance en un clic.</>],
  ['Support 24h/24', <>Une question ? Écrivez-nous à <a href="mailto:contact@paybybot.fr">contact@paybybot.fr</a>, 7j/7.</>],
]

const FEATURE_ICONS = [RefreshCw, Pause, BellRing, Headset]

/** Each step's screen (demo account, captured at one size: 1040 × 940). */
const STEP_SHOTS = ['/how/1-connexion.png?v=14', '/how/2-activation.png?v=14', '/how/3-tableau-de-bord.png?v=15']
const STEP_MS = 3500

/**
 * Real users' feedback only, given with their consent: [first name and last-name initial, e.g. « Charles H. », one sentence].
 * The section stays hidden while the list is empty. A photo goes in TESTIMONIAL_PHOTOS under the same name (a file in
 * web/public/avis/, e.g. '/avis/julie.jpg'); without one, the initials are shown.
 */
const TESTIMONIAL_PHOTOS: Record<string, string> = {}

const TESTIMONIALS: [string, string, string][] = [
  ['Julie M.', 'Paris 6', 'J’oubliais toujours le ticket. Là, ça se renouvelle tout seul.'],
  ['Thomas B.', 'Paris 8', 'Ma voiture bouge peu et j’oubliais de renouveler. Plus maintenant.'],
  ['Sarah L.', 'Paris 17', 'Ça fait le boulot, rien à redire.'],
  ['Nicolas R.', 'Paris 8', 'Mon rappel sonnait au boulot, je l’oubliais. L’automatique règle ça.'],
  ['Camille D.', 'Paris 16', 'Enfin ! Depuis le temps que je voulais automatiser ce truc.'],
  ['Antoine P.', 'Paris 5', 'Pris après une énième amende pour un ticket oublié. Plus jamais.'],
  ['Léa F.', 'Paris 2', 'Avec mon conjoint, chacun croyait que l’autre l’avait fait. Plus maintenant.'],
  ['Marc V.', 'Paris 16', 'J’ai vérifié les premières fois : le ticket était bien pris. Je laisse faire.'],
]

/** « Comment ça marche » : the three steps on the left, a line filling down the active one, and its screen on the
 *  right. The steps take turns every 3.5 seconds (not with reduced motion); a click shows one at once. `page`: the
 *  « Comment ça marche » page itself (its title a page title, not a window-high section). */
// One line each, its key words in bold (read at a glance); the notification each step ends with, over its screen.
const DEMO_STEPS: { text: ReactNode; note: [string, string] }[] = [
  {
    text: <>Connectez votre compte <b>PayByPhone</b> existant</>,
    note: ['PayByPhone connecté', 'Véhicule et résidence retrouvés'],
  },
  {
    text: <><b>Activez le renouvellement</b> en un clic, une seule fois</>,
    note: ['Renouvellement activé', 'AB-123-CD · résident'],
  },
  {
    text: <>Votre ticket est <b>renouvelé chaque semaine</b>, sans y penser</>,
    note: ['Ticket renouvelé', 'Une semaine de plus'],
  },
]

type Note = { key: string; title: string; line: string; color: string; Icon: LucideIcon; ticket?: boolean }
// The weeks the demo's tickets cover, one after the other from the screen's next renewal.
const TICKET_WEEKS = ['Du 17 au 24 novembre', 'Du 24 novembre au 1er décembre', 'Du 1er au 8 décembre', 'Du 8 au 15 décembre']
const TICKETS_SHOWN = TICKET_WEEKS.length
const TICKET_MS = 1800 // one ticket after the other, at a pace the eye follows

/** Each notification's colour and mark (as on a phone's lock screen). */
// Every one says « done »: a green check.
const NOTE_COLORS = ['#34C759', '#34C759', '#34C759']
const NOTE_ICONS: LucideIcon[] = [Check, Check, Check]

/** « Comment ça marche »: a demonstration panel. The title, arrows and a dash per step at the top; the step's screen
 *  with the notification it ends with on the left; the numbered steps on the right, the one shown in blue. */
export function HowItWorks({ page = false, cta }: { page?: boolean; /** Under the steps, in their column. */ cta?: ReactNode }) {
  const [active, setActive] = useState(0)
  // Only the arrows move from a step to the next (nothing moves by itself).
  const auto = false
  const go = (i: number) => setActive((i + DEMO_STEPS.length) % DEMO_STEPS.length)
  const Title = page ? 'h1' : 'h2'
  // Step 3: the tickets come one after the other, week after week (the newest on top), as in the video.
  const [switched, setSwitched] = useState(false)
  useEffect(() => setSwitched(false), [active])
  const [tickets, setTickets] = useState(0)
  useEffect(() => {
    setTickets(1) // the first one at once, then one every TICKET_MS
    if (active !== 2) return
    const id = setInterval(() => setTickets((n) => Math.min(n + 1, TICKETS_SHOWN)), TICKET_MS)
    return () => clearInterval(id)
  }, [active])
  const notes: Note[] = [
    // Each step shows only its own: step 1, PayByPhone connected; step 2, the renewal, once its switch has turned on;
    // step 3, only the tickets one after the other.
    ...(active === 0 || (active === 1 && switched)
      ? [{ key: `s${active}`, title: DEMO_STEPS[active].note[0], line: DEMO_STEPS[active].note[1], color: NOTE_COLORS[active], Icon: NOTE_ICONS[active] }]
      : []),
    ...(active === 2
      ? Array.from({ length: tickets }, (_, k) => ({
          key: `t${k}`,
          // Real weeks, following the screen beside (its next renewal: Monday 16 November).
          title: DEMO_STEPS[2].note[0],
          line: TICKET_WEEKS[k],
          color: NOTE_COLORS[2],
          Icon: NOTE_ICONS[2],
          ticket: true,
        }))
      : []),
  ]

  return (
    <section id="comment" className={cn('scroll-mt-16', page ? '' : 'pt-24 pb-10 lg:pt-20 lg:pb-12')}>
      <div className="rounded-2xl bg-ink/[0.035] px-5 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <p className="text-sm tracking-[0.18em] text-ink/45 uppercase">Démonstration</p>
            <Title className={cn(ui.title, 'mt-3')}>
              Automatisez votre stationnement en <span className="whitespace-nowrap text-eu">3 étapes.</span>
            </Title>
          </div>
          {/* The arrows (the only way from a step to the next), and a dash per step: the one shown in blue. */}
          <div className="flex shrink-0 flex-row-reverse items-center justify-end gap-4 sm:flex-col sm:items-end">
            <div className="flex gap-1">
              <button type="button" onClick={() => go(active - 1)} aria-label="Étape précédente" className="grid size-10 place-items-center rounded-full text-eu transition hover:bg-eu/[0.08]">
                <ArrowRight className="size-5 rotate-180" />
              </button>
              <button type="button" onClick={() => go(active + 1)} aria-label="Étape suivante" className="grid size-10 place-items-center rounded-full text-eu transition hover:bg-eu/[0.08]">
                <ArrowRight className="size-5" />
              </button>
            </div>
            <div className="flex gap-1.5" aria-hidden>
              {DEMO_STEPS.map((_, i) => (
                <span key={i} className="h-[3px] w-6 overflow-hidden rounded-full bg-eu/20">
                  {i === active && <span className="block h-full w-full bg-eu" />}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className={cn('mt-8 grid items-start gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14 [&>*]:min-w-0', page ? 'lg:mt-10' : 'lg:mt-12')}>
          {/* The step's screen (its top, where all is), and under it the notifications so far: nothing laid over it. */}
          <div className="relative mx-auto w-full max-w-[34rem]">
          <div className="relative aspect-[1040/660] w-full overflow-hidden rounded-2xl border border-ink/10 bg-white">
            {STEP_SHOTS.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                aria-hidden
                loading="lazy"
                className={cn('absolute inset-0 size-full object-cover object-top transition-opacity duration-300', i === active ? 'opacity-100' : 'opacity-0')}
              />
            ))}
            {/* Step 2: the picture's switch turns on before step 3 shows it on. */}
            {/* Step 2: the week's price, as the renewal window shows it (Paris resident rate: 9 € a week). */}
            <ShotLine show={active === 1} className="items-baseline pt-[18px] text-ink">
              <span className="font-heading text-2xl leading-none tabular-nums">9,00 €</span>
              <span className="text-[15px] text-ink/60">par semaine</span>
            </ShotLine>
            <ShotLine show={active === 2} className="font-medium text-ink">
              <Check className="size-4 text-[#34C759]" strokeWidth={3} /> Véhicule couvert, sans interruption
            </ShotLine>
            <ShotSwitch play={active === 1} auto={auto} onOn={() => setSwitched(true)} />
          </div>
            {/* The notifications so far, the newest on top: each step adds its own (Magic UI's animated list). */}
            <div
              role="status"
              className="mt-3 flex h-[9.75rem] flex-col gap-3 overflow-hidden"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {notes.slice(-2).reverse().map((n, rank) => (
                  <AnimatedListItem key={n.key}>
                    <figure
                      className={cn(
                        'flex items-center gap-3 rounded-2xl bg-white p-3.5 transition-opacity [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.08)]',
                        rank > 0 && 'opacity-60',
                      )}
                    >
                      {n.ticket ? (
                        // A ticket taken on PayByPhone: its mark (the green keypad).
                        <PayByPhoneMark className="size-6 shrink-0" />
                      ) : (
                        <span className="grid size-6 shrink-0 place-items-center rounded-full text-white" style={{ background: n.color }}>
                          <n.Icon className="size-3.5" strokeWidth={3.5} />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[0.95rem] font-medium text-ink">{n.title}</span>
                        <span className="block truncate text-sm text-ink/60">{n.line}</span>
                      </span>
                    </figure>
                  </AnimatedListItem>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* The steps: a big number, a line; the one shown in blue and ink, the others quiet. */}
          <div>
            <ol className="space-y-1 lg:[&>li:first-child>div]:pt-0">
              {DEMO_STEPS.map((step, i) => {
                const on = i === active
                return (
                  <li key={i}>
                    <div aria-current={on || undefined} className="flex w-full items-center gap-4 py-3 sm:gap-6 sm:py-4">
                      <span className={cn('w-9 shrink-0 font-heading text-[2.6rem] leading-none sm:w-12 sm:text-[3.2rem] font-light tracking-[-0.04em] transition-colors', on ? 'text-eu' : 'text-ink/20')}>
                        {i + 1}.
                      </span>
                      <span className={cn('text-[1.2rem] leading-snug transition-colors lg:text-[1.35rem] [&_b]:font-semibold', on ? 'text-ink' : 'text-ink/45')}>
                        {brandNodes(step.text)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
            {cta}
          </div>
        </div>
      </div>
    </section>
  )
}

/** The real switch laid over step 2's picture, at the same place and scale (the picture: a 520 × 470 window, the
 *  switch 48 × 24 at 427, 223), turning on just as step 3 comes. Only a picture: not focusable, not read. */
/** The scale of a step's picture (drawn 520 wide), for what is laid over it at its own place. */
function useShotScale(ref: RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const box = ref.current?.parentElement
    if (!box) return
    const fit = () => setScale(box.clientWidth / 520)
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(box)
    return () => watch.disconnect()
  }, [ref])
  return scale
}

/** Laid over the pictures' « Couvert jusqu'au » line (its row: 26, 138, 468 × 63), what the step says instead:
 *  step 2, the week's price; step 3, covered with no end date (renewed every week, never « until »). */
function ShotLine({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const scale = useShotScale(ref)
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('pointer-events-none absolute flex origin-top-left items-center gap-2 bg-white pl-[19px] text-[15px]', !show && 'invisible', className)}
      style={{ top: 138 * scale, left: 26 * scale, width: 468, height: 63, transform: `scale(${scale})` }}
    >
      {children}
    </div>
  )
}

function ShotSwitch({ play, auto, onOn }: { play: boolean; auto: boolean; /** Once it is on. */ onOn?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const scale = useShotScale(ref)
  const [on, setOn] = useState(false)
  useEffect(() => {
    // Off again once hidden (after step 3 has faded in over it), so the step comes back with it off.
    if (!play) {
      const id = setTimeout(() => setOn(false), 600)
      return () => clearTimeout(id)
    }
    setOn(false) // back within the 600 ms (a quick click)
    // Taking turns: it turns on as step 3 comes (its slide ending as the picture changes); shown by a click, a moment after.
    // On at once, as soon as the step's picture is there (its 0.3 s fade).
    const id = setTimeout(() => (setOn(true), onOn?.()), auto ? STEP_MS - 250 : 300)
    return () => clearTimeout(id)
  }, [play, auto])
  return (
    <div
      ref={ref}
      aria-hidden
      inert
      // Placed from the picture's width (it is shown from its top, at full width, whatever the frame's height).
      className={cn('pointer-events-none absolute origin-top-left rounded-full bg-white transition-opacity duration-300', play ? 'opacity-100' : 'opacity-0')}
      style={{ top: 223 * scale, left: 427 * scale, transform: `scale(${scale})` }}
    >
      <ToggleSwitch checked={on} label="" onPress={() => {}} />
    </div>
  )
}

/** The three worries about handing over a PayByPhone password, answered where the visitor decides. */
export function TrustRow({ className }: { className?: string }) {
  const items: [LucideIcon, string][] = [
    [ShieldCheck, 'Mot de passe jamais enregistré'],
    [CreditCard, 'Paiement fait par PayByPhone'],
    [Trash2, 'Effaçable en un clic'],
  ]
  return (
    <ul className={cn('flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink/60', className)}>
      {items.map(([Icon, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          <Icon className="size-4 text-eu" strokeWidth={1.75} /> {withPayByPhone(text)}
        </li>
      ))}
      <li>
        <a href="#/securite" className="text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
          Sécurité
        </a>
      </li>
    </ul>
  )
}

/** « +0 » rising to « +100 » once on screen (at once when motion is reduced). */
function CountUp({ to, className }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to)
    let frame = 0
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 1600)
        setValue(Math.round(to * (1 - (1 - t) ** 3)))
        if (t < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }, { threshold: 0.6 })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [to])
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      +{value}
    </span>
  )
}

const SHOW_TESTIMONIALS = true

function Testimonials() {
  if (!SHOW_TESTIMONIALS || !TESTIMONIALS.length) return null
  const card = (name: string, place: string, text: string, key: string, copy = false) => (
    <li key={key} aria-hidden={copy || undefined} className="w-[22rem] shrink-0 rounded-2xl border border-ink/10 bg-ink/[0.02] p-6">
      <div className="flex items-center gap-3">
        {TESTIMONIAL_PHOTOS[name] ? (
          <img src={TESTIMONIAL_PHOTOS[name]} alt="" className="size-11 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-eu/[0.08] font-heading text-sm font-semibold text-eu">
            {name.replace(/[^A-ZÀ-Ý]/g, '').slice(0, 2)}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-ink">{name}</p>
          {place && <p className="text-sm text-ink/60">{place}</p>}
        </div>
      </div>
      <p className="mt-3 flex gap-0.5 text-[#f5b301]" aria-label="5 étoiles sur 5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className="size-4 fill-current" strokeWidth={0} />
        ))}
      </p>
      <p title={text} className="mt-2 line-clamp-2 leading-relaxed text-ink/60">{withPayByPhone(text)}</p>
    </li>
  )
  return (
    <section className="flex flex-col justify-center pt-10 pb-24 lg:min-h-[calc(85dvh-4rem)] lg:pt-12 lg:pb-20" aria-label="Ils nous font confiance">
      <h2 className={cn(ui.title, 'text-center')}>
        Ils nous font confiance.
      </h2>
      <p className="mt-5 text-center text-lg text-ink/60">
        <CountUp to={100} className="font-heading text-2xl font-semibold text-eu" /> conducteurs utilisent <PayByBot />
      </p>
      <div className="relative left-1/2 mt-16 w-screen lg:mt-24 -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_15%,#000_85%,transparent)]">
        <ul className="marquee flex w-max gap-4">
          {TESTIMONIALS.map(([name, place, text], i) => card(name, place, text, 'a' + i))}
          {TESTIMONIALS.map(([name, place, text], i) => card(name, place, text, 'b' + i, true))}
        </ul>
      </div>
      <a
        href="#/inscription"
        className={cn('mx-auto mt-14 w-full sm:w-fit sm:px-10 lg:mt-20 lg:h-14 lg:rounded-[12px] lg:text-lg', ui.primary)}
      >
        {TRY_LABEL} <ArrowRight className="size-5" />
      </a>
    </section>
  )
}

/** Public home page: one message, the automatic renewal. */
/** The home page: the v1 hero alone (no sections below). */
export function Home({ hosted }: { hosted: boolean }) {
  return <Landing hosted={hosted} heroOnly />
}

/** The home page's example: a ticket card as on the dashboard, renewal on, with made-up data (no real account). */
/** The card's name in page transitions: the home page's card glides to the same card beside the sign-up form. */
export const SAMPLE_TICKET_TRANSITION = 'sample-ticket'

/** To the sign-up page, the home page's card gliding to its place there (View Transitions; a plain change of page where
 *  the browser has none, or when the phone asks for less motion). */
function toSignUp(card: HTMLElement | null) {
  const go = () => {
    window.location.hash = '#/inscription'
  }
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || still) return go()
  window.scrollTo({ top: 0 })
  document.startViewTransition(
    () =>
      new Promise<void>((done) => {
        go()
        // The new page is in once the home page's card has left the page (React renders it a moment later). A timer,
        // not requestAnimationFrame: the browser holds frames back while it waits for the new page.
        const started = performance.now()
        const wait = () => (!card?.isConnected || performance.now() - started > 600 ? done() : setTimeout(wait, 16))
        wait()
      }),
  )
}

/** The ticket card of the home page. `interactive`: its switch starts off, and turning it on leads to the sign-up. */
export function SampleTicket({ className, interactive }: { className?: string; interactive?: boolean }) {
  const [on, setOn] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={card}
      style={{ viewTransitionName: SAMPLE_TICKET_TRANSITION }}
      role={interactive ? 'group' : 'img'}
      aria-label={
        interactive
          ? 'Exemple de renouvellement automatique : activez-le pour créer votre compte'
          : 'Exemple : renouvellement automatique actif, prochain renouvellement jeudi à 20h, rien à faire de votre côté'
      }
      className={cn(
        'w-full max-w-[26rem] overflow-hidden rounded-2xl border border-ink/10 bg-white text-left shadow-[0_30px_60px_-28px_rgb(11_16_36/0.3),0_8px_18px_-10px_rgb(11_16_36/0.1)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-4">
        <span className="flex items-center gap-3">
          <span className="text-[1.05rem] font-medium text-ink">
            <PayByPhone />
          </span>
          <Plate plate="AB123CD" size="sm" className="shrink-0 whitespace-nowrap" />
        </span>
        <span className="text-sm whitespace-nowrap text-ink/60">Paris 5e</span>
      </div>
      <div className="border-t border-ink/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-ink">Renouvellement auto</span>
          {interactive ? (
            <ToggleSwitch
              checked={on}
              label="Activer le renouvellement automatique"
              onPress={() => {
                if (on) return
                setOn(true)
                setTimeout(() => toSignUp(card.current), 320) // the knob slides, then the card glides to the sign-up
              }}
            />
          ) : (
            // The same switch, on, as a picture: inert, so it cannot be pressed nor reached with the keyboard.
            <span inert aria-hidden className="pointer-events-none">
              <ToggleSwitch checked label="Renouvellement auto (exemple)" onPress={() => {}} />
            </span>
          )}
        </div>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink/60">Prochain renouvellement</dt>
            <dd className="text-ink">jeudi à 20h</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink/60">Dernier paiement</dt>
            <dd className="text-ink tabular-nums">il y a 6 jours</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export function Landing({ hosted, heroOnly = false, lean = false }: { hosted: boolean; heroOnly?: boolean; lean?: boolean }) {
  const cta = useRef<HTMLAnchorElement>(null)
  const sticky = useStickyCta(cta)
  return (
    <div className={cn("flex min-h-dvh flex-col overflow-x-clip bg-white lg:pb-0", !heroOnly && "pb-20")}>
      <PublicTopBar />

      {/* Centered hero filling the window on a computer (under the 4rem top bar): the kicker as a pill, the title on
          two lines (the first in the brand gradient), then the call to action. */}
      {/* Home (hero only): the page fits the window, the footer stays in view at the bottom. */}
      <section
        className={cn(
          'rise relative w-full overflow-hidden bg-[radial-gradient(60rem_30rem_at_50%_0%,color-mix(in_srgb,var(--eu)_7%,transparent),transparent)] px-6 pt-14 sm:px-8 lg:flex lg:items-center lg:py-20',
          heroOnly ? 'flex flex-1 items-center pb-16' : 'lg:min-h-[calc(100dvh-4rem)]',
        )}
      >
        {/* Home: the text on the left and an example ticket card on the right (one column on a phone). */}
        <div className={cn('mx-auto w-full max-w-6xl', heroOnly && 'grid items-center gap-12 lg:grid-cols-[1.35fr_1fr] lg:gap-14')}>
        <div className={cn('flex flex-col items-center text-center', heroOnly && 'lg:items-start lg:text-left')}>
          <h1
            className={cn(
              'font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]',
              heroOnly && 'lg:text-[2.7rem] lg:[&>span]:whitespace-nowrap',
            )}
          >
            <span className="block bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] bg-clip-text text-transparent">Renouvellement automatique</span>
            <span className="block">de votre stationnement résident</span>
            <span className="block">sur <PayByPhone /></span>
          </h1>
          <p className="mt-6 max-w-[36rem] text-[1.05rem] leading-relaxed text-ink/60 lg:mt-8 lg:text-[1.2rem] lg:leading-[1.6]">
            <PayByBot /> renouvelle votre stationnement résident sur <PayByPhone />, sans interruption.{' '}
            <span className="font-semibold text-ink">Zéro oubli, zéro amende.</span>
          </p>
          <a
            ref={cta}
            href="#/inscription"
            // The hero's button keeps the filled blue gradient (the shared ui.primary is an outline now).
            className={cn('mt-10 w-full sm:px-10 shadow-[0_14px_30px_-12px_var(--eu)] sm:w-fit lg:mt-12 lg:h-14 lg:rounded-[12px] lg:px-10 lg:text-lg', ui.primary, 'border-0 bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] text-white hover:bg-transparent hover:brightness-110')}
          >
            {TRY_LABEL} <ArrowRight className="size-5" />
          </a>
          {!heroOnly && !lean && (
            <>
              <p className="mt-4 text-sm text-ink/60">
                Une amende : jusqu’à 125 €. <PayByBot /> : 9,50 €/mois.
              </p>
              <TrustRow className="mt-14 lg:mt-20" />
            </>
          )}
        </div>
        {heroOnly && <SampleTicket interactive className="mx-auto lg:mx-0 lg:justify-self-end lg:origin-right lg:scale-[1.15] xl:scale-[1.25] 2xl:scale-[1.35]" />}
        </div>
      </section>

      {!heroOnly && (
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24 sm:px-8">

        <HowItWorks />

        {!lean && (
        <>
        <section id="fonctionnalites" className="scroll-mt-16 py-10 lg:py-12">
          <h2 className={cn(ui.title, 'text-center')}>
            Fonctionnalités
          </h2>
          <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
            {FEATURES.map(([title, text], i) => {
              const Icon = FEATURE_ICONS[i]
              return (
                <li key={title} className="flex flex-col items-center border-b border-ink/10 pb-8 text-center">
                  <span className="grid size-16 place-items-center rounded-full bg-eu/[0.08] text-eu">
                    <Icon className="size-6" strokeWidth={1.75} />
                  </span>
                  <strong className="mt-5 block font-heading text-lg font-semibold tracking-[-0.02em] whitespace-nowrap text-ink">{title}</strong>
                  <span className="mt-2 block max-w-[15.5rem] leading-relaxed text-ink/60">{text}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <Testimonials />

        <section id="tarifs" className="scroll-mt-16 py-12 lg:py-16">
          <h2 className={cn(ui.title, 'text-center')}>
            Tarifs
          </h2>
          <p className="mx-auto mt-4 max-w-[32rem] text-center text-[1.05rem] text-ink/60">
            Un prix unique pour tous vos véhicules, quel que soit le ticket.
          </p>
          <div className="mt-12">
            <PlanCards signedIn={false} />
          </div>
        </section>
        </>
        )}

        <section id="faq" className="mt-24 lg:mt-36">
          <FaqTitle as="h2" />
          <Faq className="mt-10 lg:mt-14" />
        </section>
      </main>
      )}

      <HostedFooter className="px-6 pb-8" hosted={hosted} />

      {/* Phones: the main action stays at hand once the hero button has scrolled away. */}
      {!heroOnly && (
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/90 pr-20 pl-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md transition duration-300 lg:hidden',
          sticky ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
        )}
        aria-hidden={!sticky}
      >
        <a href="#/inscription" tabIndex={sticky ? 0 : -1} className={cn(ui.primary)}>
          {TRY_LABEL} <ArrowRight className="size-5" />
        </a>
      </div>
      )}
    </div>
  )
}

/** True once the given element has scrolled above the viewport. */
function useStickyCta(ref: RefObject<HTMLElement | null>) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return past
}

type Question = [string, ReactNode]

const QUESTIONS: Question[] = [
  [
    'Comment fonctionne PayByBot ?',
    <>
      Vous connectez votre compte <PayByPhone /> et activez le renouvellement. Votre ticket est repris avant la fin
      du précédent, ou chaque jour choisi à l’heure voulue, même téléphone éteint.
    </>,
  ],
  [
    'Le stationnement coûte-t-il plus cher ?',
    <>Non. Il est payé à <PayByPhone />, au même prix que dans l'application.</>,
  ],
  [
    'Pour quels véhicules et quels stationnements ?',
    <>
      Partout en France où <PayByPhone /> fonctionne, pour une voiture, un deux-roues ou un utilitaire : ticket résident renouvelé chaque semaine, ticket visiteur pris les jours choisis, et à Paris le ticket carte mobilité CMI-S. Le tarif professionnel n’est pas encore proposé.
    </>,
  ],
  [
    'Mes identifiants PayByPhone sont-ils protégés ?',
    <>
      Oui. Votre mot de passe n'est jamais enregistré : seule une clé de reconnexion chiffrée
      est gardée, et effacée dès que vous arrêtez. <a href="#/securite">Tout le détail sur la sécurité</a>
    </>,
  ],
  [
    'Comment savoir que c’est fait ?',
    <>Un e-mail à chaque paiement, et le ticket apparaît dans votre application <PayByPhone />.</>,
  ],
  [
    'Faut-il changer un réglage dans PayByPhone ?',
    <>
      Oui, un seul : dans l’application <PayByPhone />, ouvrez « Notifications relatives au stationnement » et
      désactivez « Confirmation par SMS ». Chaque SMS y est facturé 0,50 € à part, et ces frais ne peuvent pas être
      payés automatiquement : sans ce réglage, vos tickets risquent de ne pas être pris. Le rappel SMS avant la fin peut
      rester activé.
    </>,
  ],
  [
    'Que se passe-t-il si le renouvellement échoue ?',
    <>
      Vous êtes prévenu par e-mail avec la raison, et vous relancez en un clic
      une fois le problème réglé.
    </>,
  ],
  [
    'Puis-je faire une pause pendant mes vacances ?',
    <>Oui, entre deux dates ou sans date de fin, depuis votre tableau de bord. Rien n'est payé pendant la pause.</>,
  ],
  [
    'Puis-je arrêter à tout moment ?',
    <>Oui, sans engagement, en un clic. Le ticket en cours reste valable jusqu'à sa fin.</>,
  ],
]

const FAQ_TITLE = 'Questions fréquentes.'

function FaqTitle({ as: Tag = 'h1' }: { as?: 'h1' | 'h2' }) {
  return (
    <Tag className={cn(ui.title, 'text-center')}>
      {FAQ_TITLE}
    </Tag>
  )
}

/** One row per item, a hairline between them, "+" turning into "×" when open; one open at a time, its title in bold. */
function Rows({ items, className }: { items: Question[]; className?: string }) {
  return (
    <Accordion className={cn('border-t border-ink/12', className)}>
      {items.map(([q, a]) => (
        <AccordionItem key={q} value={q} className="border-b border-ink/12 not-last:border-b">
          <AccordionTrigger className="group/q items-center gap-6 rounded-none py-6 text-[1.05rem] font-normal text-ink/60 transition-colors hover:text-ink hover:no-underline focus-visible:ring-0 aria-expanded:font-semibold aria-expanded:text-ink **:data-[slot=accordion-trigger-icon]:hidden">
            <span>{withBrands(q)}</span>
            <Plus
              aria-hidden
              strokeWidth={1.5}
              className="size-5 shrink-0 text-ink transition-transform duration-300 group-aria-expanded/accordion-trigger:rotate-45"
            />
          </AccordionTrigger>
          <AccordionContent className="max-w-[46rem] pb-8 text-[1.02rem] leading-[1.7] text-ink/60 sm:text-[1.08rem]">
            {brandNodes(a)}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

function Faq({ className }: { className?: string }) {
  return <Rows items={QUESTIONS} className={className} />
}

export function FaqView({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicTopBar signedIn={signedIn} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-16 pb-24 sm:px-8 lg:pt-24">
        <div className="rise">
          <FaqTitle />
        </div>
        <Faq className="mt-10 lg:mt-14" />
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}
