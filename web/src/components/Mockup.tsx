import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { PayByBot, PayByPhone, Plate } from '@/components/signs'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** Development only (#/maquette): the « one question, then nothing » journey, made-up data, nothing sent. The user
 *  says once how each car parks; after that the page is only a status, and PayByBot writes only when something is
 *  theirs to do. */

type Screen = 'question' | 'setup' | 'status' | 'action'
const SCREENS: [Screen, string][] = [
  ['question', '1 · La question'],
  ['setup', '2 · On s’en occupe'],
  ['status', '3 · Tout va bien'],
  ['action', '4 · Une chose à faire'],
]

// As found in PayByPhone after signing in: one car with the resident rate (no question), one without.
const RESIDENT = { plate: 'FJ-745-AC', zone: 'Paris 16e' }
const OTHER = 'FT-630-FH'

export function Mockup() {
  const [screen, setScreen] = useState<Screen>('question')
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="font-heading text-xl font-bold">
          <PayByBot />
        </span>
        {screen !== 'question' && screen !== 'setup' && <span className="text-sm text-ink/45">David</span>}
      </header>
      <main className="mx-auto w-full max-w-[30rem] flex-1 px-6 pt-6 pb-28 sm:pt-12">
        {screen === 'question' && <Question onDone={() => setScreen('setup')} />}
        {screen === 'setup' && <Setup onDone={() => setScreen('status')} />}
        {screen === 'status' && <Status />}
        {screen === 'action' && <Status action />}
      </main>
      {/* The mockup's own controls: not part of the design. */}
      <nav className="fixed inset-x-0 bottom-0 flex flex-wrap justify-center gap-1.5 border-t border-ink/10 bg-white/90 px-3 py-2.5 backdrop-blur">
        <span className="self-center pr-1 text-xs font-bold tracking-wide text-ink/40 uppercase">Maquette</span>
        {SCREENS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScreen(id)}
            className={cn('rounded-full px-3 py-1.5 text-xs font-semibold', screen === id ? 'bg-ink text-white' : 'bg-ink/[0.06] text-ink/70')}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Right after signing in: what PayByBot found, and the one question it cannot guess. */
function Question({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'cmis' | 'none' | null>(null)
  const [card, setCard] = useState(false)
  const ready = kind === 'none' || (kind === 'cmis' && card)
  return (
    <div className="rise">
      <h1 className={ui.title}>Une seule question.</h1>
      <p className={ui.subtitle}>Ensuite, on s’occupe de tout, chaque jour, sans que vous ayez à revenir.</p>

      {/* Guessed from PayByPhone: nothing to answer. */}
      <div className="mt-10 flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-4">
        <Plate plate={RESIDENT.plate} size="sm" />
        <span className="flex items-center gap-2 text-sm text-ink/70">
          <Check className="size-4 text-[#3d7f84]" strokeWidth={2.5} />
          Résident {RESIDENT.zone}, renouvelé chaque semaine
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-ink/10 bg-white px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <Plate plate={OTHER} size="sm" />
          <span className="text-sm text-ink/50">Pas de tarif résident</span>
        </div>
        <p className="mt-5 font-medium text-ink">Pour cette voiture, vous avez…</p>
        <div className="mt-3 grid gap-2">
          {(
            [
              ['cmis', 'Une carte mobilité CMI-S', 'Gratuit, dans tout Paris'],
              ['none', 'Rien de particulier', 'Je paie mes tickets visiteur moi-même'],
            ] as const
          ).map(([id, title, hint]) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              aria-pressed={kind === id}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition',
                kind === id ? 'border-[#4e9aa0] bg-[#4e9aa0]/[0.06]' : 'border-ink/15 hover:border-ink/30',
              )}
            >
              <span className="block font-medium text-ink">{title}</span>
              <span className="block text-sm text-ink/50">{hint}</span>
            </button>
          ))}
        </div>
        {kind === 'cmis' && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-ink/[0.03] px-4 py-3 text-sm leading-relaxed text-ink/80">
            <input type="checkbox" checked={card} onChange={(e) => setCard(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[#4e9aa0]" />
            <span>Je suis titulaire de la carte et je la place derrière le pare-brise.</span>
          </label>
        )}
      </div>

      <button onClick={onDone} disabled={!ready} className={cn(ui.primary, 'mt-8')}>
        C’est tout
      </button>
      <p className="mt-3 text-center text-sm text-ink/45">Vous pourrez changer d’avis à tout moment.</p>
    </div>
  )
}

/** The first tickets, taken while the user watches: only progress, never an error. */
function Setup({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= 20) {
      const t = setTimeout(onDone, 1400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setN((x) => Math.min(20, x + 5)), 700)
    return () => clearTimeout(t)
  }, [n, onDone])
  return (
    <div className="rise">
      <h1 className={ui.title}>C’est parti.</h1>
      <p className={ui.subtitle}>
        Vos tickets sont pris maintenant, dans <PayByPhone />. Vous pouvez fermer cette page.
      </p>
      <ul className="mt-10 divide-y divide-ink/[0.06] rounded-2xl border border-ink/10 bg-white">
        <li className="flex items-center justify-between gap-4 px-5 py-4">
          <Plate plate={RESIDENT.plate} size="sm" />
          <span className="flex items-center gap-2 text-sm text-ink/70">
            <Check className="size-4 text-[#3d7f84]" strokeWidth={2.5} /> Semaine renouvelée
          </span>
        </li>
        <li className="flex items-center justify-between gap-4 px-5 py-4">
          <Plate plate={OTHER} size="sm" />
          <span className="flex items-center gap-2 text-sm text-ink/70 tabular-nums">
            {n < 20 ? <Loader2 className="size-4 animate-spin text-[#4e9aa0]" /> : <Check className="size-4 text-[#3d7f84]" strokeWidth={2.5} />}
            {n < 20 ? `Tout Paris · ${n} / 20` : 'Tout Paris couvert'}
          </span>
        </li>
      </ul>
    </div>
  )
}

/** Every visit after that: one sentence, one line per car. Nothing to switch on or off. */
function Status({ action = false }: { action?: boolean }) {
  const cars = [
    { plate: RESIDENT.plate, until: 'lun. 9 nov. à 20h', how: 'Résident 16e · chaque semaine' },
    { plate: OTHER, until: 'sam. 7 nov. à 14h15', how: 'CMI-S · tout Paris, chaque jour' },
  ]
  return (
    <div className="rise">
      {action ? (
        // The only time PayByBot asks for something: one thing, one button, in plain words.
        <div className="rounded-2xl border border-[#c9822b]/30 bg-[#c9822b]/[0.07] px-5 py-5">
          <p className="font-heading text-xl font-bold text-ink">Une chose à faire</p>
          <p className="mt-2 leading-relaxed text-ink/75">
            Votre carte Visa •••• 4242 expire le 30 novembre. Ajoutez-en une autre dans <PayByPhone /> avant cette
            date : vos tickets continueront tout seuls.
          </p>
          <button className={cn(ui.primary, 'mt-5 h-12 text-base')}>
            Ouvrir <PayByPhone />
          </button>
        </div>
      ) : (
        <>
          <h1 className={ui.title}>Tout est couvert.</h1>
          <p className={ui.subtitle}>Rien à faire. On vous écrit seulement si on a besoin de vous.</p>
        </>
      )}
      <ul className={cn('divide-y divide-ink/[0.06] rounded-2xl border border-ink/10 bg-white', action ? 'mt-6' : 'mt-10')}>
        {cars.map((c) => (
          <li key={c.plate} className="px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <Plate plate={c.plate} size="sm" />
              <span className="text-right text-sm text-ink/50">
                jusqu’au <span className="text-ink">{c.until}</span>
              </span>
            </div>
            <p className="mt-2 text-sm text-ink/45">{c.how}</p>
          </li>
        ))}
      </ul>
      <button className={cn('mx-auto mt-6 block text-sm', ui.link)}>Modifier</button>
    </div>
  )
}
