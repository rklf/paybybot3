import { ShieldCheck } from 'lucide-react'
import { HostedFooter } from '@/components/Footer'
import { HowItWorks } from '@/components/Landing'
import { PublicTopBar } from '@/components/TopBar'
import { TRY_LABEL, ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** « Comment ça marche », in the top bar: the three steps with their screens, the button, and what PayByBot never asks
 *  for in one quiet line under it. */
export function HowPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <PublicTopBar signedIn={signedIn} />
      {/* Centred in the window on a computer. */}
      <main className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col px-6 pt-10 pb-16 lg:justify-center lg:py-6">
        {/* The three steps, a line filling down the one shown, and its screen beside it (as on the home page); the
            button and the promise under the steps, in their column. */}
        <HowItWorks
          page
          cta={
            <>
              {!signedIn && (
                <a href="#/inscription" className={cn(ui.primary, 'mt-6 w-full sm:w-fit sm:px-8')}>
                  {TRY_LABEL}
                </a>
              )}
              <p className="mt-4 flex items-center gap-2 text-sm text-ink/60">
                <ShieldCheck className="size-4 shrink-0 text-[#3d7f84]" />
                Ni carte bancaire, ni mot de passe enregistrés.
              </p>
            </>
          }
        />
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}
