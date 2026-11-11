import { Check } from 'lucide-react'
import { HostedFooter } from '@/components/Footer'
import { HowItWorks } from '@/components/Landing'
import { PayByPhone } from '@/components/signs'
import { PublicTopBar } from '@/components/TopBar'
import { TRY_LABEL, ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

const NEVER = [
  <>
    Votre numéro de carte bancaire pour le stationnement : les tickets sont payés avec la carte déjà enregistrée dans votre
    compte <PayByPhone />.
  </>,
  <>
    Votre mot de passe <PayByPhone /> : il sert à vous connecter, puis il n’est jamais enregistré.
  </>,
]

/** « Comment ça marche », in the top bar: the three steps with their screens, then what PayByBot never asks for. */
export function HowPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <PublicTopBar signedIn={signedIn} />
      {/* Centred in the window on a computer when it fits. */}
      <main className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col px-6 pt-10 pb-16 lg:justify-center lg:py-8">
        {/* The three steps, a line filling down the one shown, and its screen beside it (as on the home page). */}
        <HowItWorks page />

        <h2 className="mt-12 font-heading text-[1.2rem] leading-snug font-semibold tracking-[-0.01em]">Ce que nous ne vous demandons jamais</h2>
        <ul className="mt-4 space-y-3">
          {NEVER.map((text, i) => (
            <li key={i} className="flex gap-3 leading-relaxed text-ink/75">
              <Check className="mt-1 size-4 shrink-0 text-[#3d7f84]" strokeWidth={2.5} />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        {!signedIn && (
          <a href="#/inscription" className={cn(ui.primary, 'mt-10 h-12 w-full text-base sm:w-fit sm:px-8')}>
            {TRY_LABEL}
          </a>
        )}
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}
