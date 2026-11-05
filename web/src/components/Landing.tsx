import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowRight, BellRing, Star, CreditCard, Headset, Pause, Link2, Plus, RefreshCw, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { HostedFooter } from '@/components/Footer'
import { PublicTopBar } from '@/components/TopBar'
import { PlanCards } from '@/components/Pricing'
import { cn } from '@/lib/utils'
import { TRY_LABEL, ui } from '@/lib/styles'
import { brandNodes, PayByBot, PayByPhone, Plate, withBrands, withPayByPhone } from '@/components/signs'



/** Prunoo's four features, said only as far as PayByBot does them. */
const FEATURES: Question[] = [
  ['Renouvellement automatique', <>Votre ticket est renouvelé avant l'expiration, ou pris les jours que vous choisissez.</>],
  ['Pause en 1 clic', <>Vacances ? Mettez en pause entre deux dates : rien n'est payé.</>],
  ['Alertes intelligentes', <>Un e-mail avec la raison en cas d'échec, et une relance en un clic.</>],
  ['Support 24h/24', <>Une question ? Écrivez-nous à <a href="mailto:contact@paybybot.fr">contact@paybybot.fr</a>, 7j/7.</>],
]

const FEATURE_ICONS = [RefreshCw, Pause, BellRing, Headset]

const STEP_ICONS = [Link2, RefreshCw, ShieldCheck]

/** Each step's screen (demo account, captured at one size: 1040 × 1100). */
const STEP_SHOTS = ['/how/1-connexion.png', '/how/2-activation.png', '/how/3-tableau-de-bord.png']
const STEP_MS = 3500

const STEPS = [
  ['Connectez PayByPhone', 'Reliez votre compte PayByPhone existant.'],
  ['Activez le renouvellement', 'Choisissez votre véhicule et activez le renouvellement hebdomadaire en un clic.'],
  ['Vous êtes tranquilles', 'PayByBot veille 24/7 et renouvelle votre stationnement avant chaque expiration.'],
]

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
 *  right. The steps take turns every 3.5 seconds (not with reduced motion); a click shows one at once. */
function HowItWorks() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (!auto) return
    const id = setTimeout(() => setActive((i) => (i + 1) % STEPS.length), STEP_MS)
    return () => clearTimeout(id)
  }, [active, auto])

  return (
    <section id="comment" className="flex scroll-mt-16 flex-col justify-center pt-24 pb-10 lg:min-h-[calc(100dvh-4rem)] lg:pt-20 lg:pb-12">
      <h2 className="text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
        Comment ça marche
      </h2>
      <div className="mt-12 grid items-center gap-10 lg:mt-16 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <ol className="space-y-2">
          {STEPS.map(([title, text], i) => {
            const Icon = STEP_ICONS[i]
            const on = i === active
            return (
              <li key={title}>
                <button
                  type="button"
                  onClick={() => {
                    setActive(i)
                    setAuto(false)
                  }}
                  aria-current={on || undefined}
                  className="group relative flex w-full gap-5 py-5 pl-6 text-left"
                >
                  {/* The line: grey, filling down in blue while the step is shown. */}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 overflow-hidden rounded-full bg-ink/10">
                    {on && (
                      <span
                        key={auto ? `run-${active}` : 'still'}
                        className={cn('block h-full w-full origin-top bg-eu', auto && 'animate-[fill-down_3.5s_linear_forwards]')}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      'grid size-12 shrink-0 place-items-center rounded-full transition-colors',
                      on ? 'bg-eu/[0.1] text-eu' : 'bg-ink/[0.04] text-ink/40 group-hover:text-ink/60',
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span>
                    <strong className={cn('block font-heading text-xl font-semibold tracking-[-0.02em] transition-colors lg:text-2xl', on ? 'text-ink' : 'text-ink/45')}>
                      {i + 1}. {withPayByPhone(title)}
                    </strong>
                    <span className={cn('mt-1.5 block text-[1.05rem] leading-relaxed transition-colors lg:text-lg', on ? 'text-ink/65' : 'text-ink/35')}>
                      {withPayByPhone(text)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        {/* The screen: a window frame, raised above the text, its picture changing with the step. */}
        <div className="mx-auto w-full max-w-[34rem] overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_40px_80px_-30px_rgb(11_16_36/0.35),0_12px_24px_-12px_rgb(11_16_36/0.12)]">
          <div className="flex items-center gap-1.5 border-b border-ink/[0.06] bg-ink/[0.02] px-4 py-3" aria-hidden>
            <span className="size-2.5 rounded-full bg-ink/15" />
            <span className="size-2.5 rounded-full bg-ink/15" />
            <span className="size-2.5 rounded-full bg-ink/15" />
            <span className="ml-3 truncate text-xs text-ink/40">paybybot.fr</span>
          </div>
          <div className="relative aspect-[1040/1100]">
            {STEP_SHOTS.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={i === active ? STEPS[i][0] : ''}
                aria-hidden={i !== active}
                loading="lazy"
                className={cn('absolute inset-0 size-full object-cover object-top transition-opacity duration-500', i === active ? 'opacity-100' : 'opacity-0')}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
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
    <ul className={cn('flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink/65', className)}>
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
          {place && <p className="text-sm text-ink/50">{place}</p>}
        </div>
      </div>
      <p className="mt-3 flex gap-0.5 text-[#f5b301]" aria-label="5 étoiles sur 5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className="size-4 fill-current" strokeWidth={0} />
        ))}
      </p>
      <p title={text} className="mt-2 line-clamp-2 leading-relaxed text-ink/70">{withPayByPhone(text)}</p>
    </li>
  )
  return (
    <section className="flex flex-col justify-center pt-10 pb-24 lg:min-h-[calc(85dvh-4rem)] lg:pt-12 lg:pb-20" aria-label="Ils nous font confiance">
      <h2 className="text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
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
export function SampleTicket({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Exemple : renouvellement automatique actif, prochain renouvellement jeudi à 20h, rien à faire de votre côté"
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
        <span className="text-sm whitespace-nowrap text-ink/50">Paris 5e</span>
      </div>
      <div className="border-t border-ink/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-ink">Renouvellement auto</span>
          <span className="relative h-6 w-11 rounded-full bg-[#4e9aa0]" aria-hidden>
            <span className="absolute top-1 right-1 size-4 rounded-full bg-white" />
          </span>
        </div>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink/50">Prochain renouvellement</dt>
            <dd className="text-ink">jeudi à 20h</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink/50">Dernier paiement</dt>
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
            <span className="font-semibold text-ink/80">Zéro oubli, zéro amende.</span>
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
              <p className="mt-4 text-sm text-ink/55">
                Une amende : jusqu’à 125 €. <PayByBot /> : 9,50 €/mois.
              </p>
              <TrustRow className="mt-14 lg:mt-20" />
            </>
          )}
        </div>
        {heroOnly && <SampleTicket className="mx-auto lg:mx-0 lg:justify-self-end lg:origin-right lg:scale-[1.15] xl:scale-[1.25] 2xl:scale-[1.35]" />}
        </div>
      </section>

      {!heroOnly && (
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24 sm:px-8">

        <HowItWorks />

        {!lean && (
        <>
        <section id="fonctionnalites" className="scroll-mt-16 py-10 lg:py-12">
          <h2 className="text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
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
          <h2 className="text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
            Tarifs
          </h2>
          <p className="mx-auto mt-4 max-w-[32rem] text-center text-[1.05rem] text-ink/60 sm:text-lg">
            Un prix unique par véhicule, quel que soit le ticket.
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
        <a href="#/inscription" tabIndex={sticky ? 0 : -1} className={cn('h-12 text-base', ui.primary)}>
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
      Partout en France où <PayByPhone /> fonctionne, pour une voiture, un deux-roues ou un utilitaire : ticket résident renouvelé chaque semaine, ticket visiteur ou carte mobilité CMI-S pris les jours choisis. Le tarif professionnel n’est pas encore proposé.
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
    <Tag className="text-center font-heading text-[2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem] lg:text-[3rem]">
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
          <AccordionTrigger className="group/q items-center gap-6 rounded-none py-6 text-[1.05rem] font-normal text-ink/70 transition-colors hover:text-ink hover:no-underline focus-visible:ring-0 aria-expanded:font-semibold aria-expanded:text-ink sm:text-[1.15rem] **:data-[slot=accordion-trigger-icon]:hidden">
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
