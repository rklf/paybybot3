import { BellRing, Pause, Power } from 'lucide-react'
import { HostedFooter } from '@/components/Footer'
import { HowItWorks } from '@/components/Landing'
import { PublicTopBar } from '@/components/TopBar'
import { TRY_LABEL, ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

const card = 'rounded-2xl border border-ink/10 bg-white'

const CONTROL = [
  [Pause, 'Pause', 'Mettez le renouvellement en pause pendant vos vacances : il reprend seul à la date choisie.'],
  [Power, 'Arrêt', 'Coupez l’interrupteur à tout moment. Le ticket en cours reste valable jusqu’à sa fin.'],
  [BellRing, 'Alerte', 'Si un paiement échoue, vous êtes prévenu par e-mail avec la cause.'],
] as const

/** « Comment ça marche », in the top bar: the three steps with their screens, then what stays in the user's hands. */
export function HowPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <PublicTopBar signedIn={signedIn} />
      <main className="mx-auto w-full max-w-[64rem] flex-1 px-6 pt-16 pb-20 sm:pt-20">
        {/* The three steps, a line filling down the one shown, and its screen beside it (as on the home page). */}
        <HowItWorks page />

        <h2 className="mt-16 font-heading text-[1.15rem] font-semibold tracking-[-0.01em]">Vous gardez la main</h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {CONTROL.map(([Icon, term, text]) => (
            <li key={term} className={cn(card, 'flex gap-4 p-5')}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-ink/60">
                <Icon className="size-4" />
              </span>
              <span className="leading-relaxed">
                <span className="block font-semibold">{term}</span>
                <span className="mt-0.5 block text-ink/65">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        {!signedIn && (
          <a href="#/inscription" className={cn(ui.primary, 'mt-14 h-12 w-full text-base sm:w-fit sm:px-8')}>
            {TRY_LABEL}
          </a>
        )}
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}
