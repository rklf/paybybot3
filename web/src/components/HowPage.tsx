import { HostedFooter } from '@/components/Footer'
import { HowItWorks } from '@/components/Landing'
import { PublicTopBar } from '@/components/TopBar'
import { TRY_LABEL, ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** « Comment ça marche », in the top bar: the three steps with their screens. */
export function HowPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <PublicTopBar signedIn={signedIn} />
      <main className="mx-auto w-full max-w-[64rem] flex-1 px-6 pt-16 pb-20 sm:pt-20">
        {/* The three steps, a line filling down the one shown, and its screen beside it (as on the home page). */}
        <HowItWorks page />

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
