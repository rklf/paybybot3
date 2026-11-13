import { useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { emailProblem } from '@/lib/validate'
import { useTurnstile } from '@/lib/turnstile'
import { ui } from '@/lib/styles'
import { Home } from '@/components/Landing'
import { LogoMark, PayByBot, PayByPhone } from '@/components/signs'
import { cn } from '@/lib/utils'

/** The logo, large, and the one rule: PayByBot opens through a user's link only. */
function GateMessage({ invalid = false, welcomed = false }: { invalid?: boolean; welcomed?: boolean }) {
  return (
    <div className="flex max-w-xl flex-col items-center px-6 text-center">
      <span className="inline-flex items-center gap-3 font-heading text-[2.6rem] leading-none font-semibold tracking-[-0.03em] text-ink sm:text-[3.2rem]">
        <LogoMark className="size-12 sm:size-14" />
        <span>
          Pay
          <span className="bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] bg-clip-text text-transparent">By</span>
          Bot
        </span>
      </span>
      <p className="mt-8 font-heading text-[1.5rem] leading-[1.15] font-medium tracking-[-0.025em] text-ink sm:text-[1.8rem]">
        Fonctionne uniquement sur parrainage
      </p>
      <p className="mt-3 text-[1.05rem] leading-relaxed text-ink/60">
        {welcomed ? (
          <span className="inline-flex items-center gap-2 font-medium text-[#3d7f84]">
            <Check className="size-5" /> Lien de parrainage reconnu, bienvenue.
          </span>
        ) : invalid ? (
          'Ce lien de parrainage n’est pas valable. Demandez le sien à un proche qui utilise déjà PayByBot.'
        ) : (
          <>
            Demandez son lien à un proche qui utilise déjà <PayByBot />.
          </>
        )}
      </p>
    </div>
  )
}

/** No link yet: the e-mail to send the private link to, then « check your inbox ». */
function AccessForm({ invalid = false }: { invalid?: boolean }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const human = useTurnstile()

  async function submit() {
    const problem = emailProblem(email)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await api.requestAccess(email.trim(), await human.token())
      setSent(email.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center px-6 text-center">
      <span className="inline-flex items-center gap-3 font-heading text-[2.4rem] leading-none font-semibold tracking-[-0.03em] text-ink sm:text-[2.8rem]">
        <LogoMark className="size-11 sm:size-12" />
        <span>
          Pay
          <span className="bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] bg-clip-text text-transparent">By</span>
          Bot
        </span>
      </span>
      {sent ? (
        <>
          <span className="mt-8 grid size-12 place-items-center rounded-full bg-[#4e9aa0]/12 text-[#3d7f84]">
            <Check className="size-6" />
          </span>
          <p className="mt-4 font-heading text-[1.5rem] leading-[1.15] font-medium tracking-[-0.025em] text-ink">Lien envoyé</p>
          <p className="mt-2 max-w-full truncate text-[1.05rem] text-ink/60">
            à <span className="font-medium text-ink">{sent}</span>
          </p>
          <p className="mt-4 text-sm text-ink/50">
            Rien reçu ? Vérifiez vos spams ou{' '}
            <button onClick={() => setSent(null)} className={ui.link}>
              changez d’adresse
            </button>
            .
          </p>
        </>
      ) : (
        <>
          <p className="mt-8 text-[1.05rem] leading-relaxed text-ink/60">
            {invalid && <span className="mb-1 block text-destructive">Ce lien n’est pas valable.</span>}
            Votre ticket résident <PayByPhone /> est renouvelé tout seul, chaque semaine. Zéro oubli, zéro amende.
          </p>
          <form
            className="mt-7 w-full text-left"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="prenom.nom@gmail.com"
              aria-label="Votre e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={ui.field}
            />
            {/* The place of Cloudflare's box kept from the start: nothing moves when it shows up. */}
            {human.enabled && <div ref={human.box} className="mt-3 h-[65px]" />}
            {(error || human.failed) && <p className={cn('mt-3', ui.error)}>{error || human.failed}</p>}
            <button
              type="submit"
              disabled={busy}
              className={cn(
                ui.primary,
                'mt-3 border-0 bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] text-white hover:bg-transparent hover:brightness-110',
              )}
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <>Recevoir mon lien d’accès <ArrowRight className="size-5" /></>}
            </button>
          </form>
          <p className="mt-5 text-[0.95rem] text-ink/60">
            Déjà un compte ?{' '}
            <a href="#/connexion" className={ui.link}>
              Se connecter
            </a>
          </p>
          <p className="mt-2 text-sm text-ink/50">
            Un proche vous a envoyé son lien <PayByBot /> ? Ouvrez-le simplement.
          </p>
        </>
      )}
    </div>
  )
}

/** Public link (no valid code): the home page stays blurred behind the e-mail form that sends the private link. */
export function InviteGate({ hosted, invalid = false }: { hosted: boolean; invalid?: boolean }) {
  return (
    <div className="relative h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none blur-[18px] select-none">
        <Home hosted={hosted} />
      </div>
      <div className="rise absolute inset-0 grid place-items-center overflow-y-auto bg-white/75">
        <AccessForm invalid={invalid} />
      </div>
    </div>
  )
}

/** Private link (a valid code, just opened): the same screen over the real site, which then lifts away. */
export function InviteCurtain() {
  const [phase, setPhase] = useState<'shown' | 'lifting' | 'gone'>('shown')
  useEffect(() => {
    const lift = setTimeout(() => setPhase('lifting'), 1600)
    const gone = setTimeout(() => setPhase('gone'), 1600 + 900)
    return () => {
      clearTimeout(lift)
      clearTimeout(gone)
    }
  }, [])
  if (phase === 'gone') return null
  return (
    <div
      aria-hidden={phase === 'lifting'}
      className={cn(
        'fixed inset-0 z-[60] grid place-items-center bg-white/80 backdrop-blur-[18px] transition-transform duration-[900ms] ease-[cubic-bezier(.7,0,.2,1)] motion-reduce:transition-none',
        phase === 'lifting' && '-translate-y-full',
      )}
    >
      <GateMessage welcomed />
    </div>
  )
}
