import { useEffect, useState } from 'react'
import { Skeleton } from '@heroui/react'
import { RotateCw } from 'lucide-react'
import { TopBar } from '@/components/TopBar'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

// Skeleton screens: while PayByPhone answers, the page's own shapes in light grey (HeroUI Skeleton), the real content
// then taking their exact place, so nothing moves under the finger.

/** One grey shape; its size and corners come from `className`. */
export function Bone({ className }: { className?: string }) {
  return <Skeleton animationType="shimmer" className={cn('rounded-lg bg-ink/[0.07]', className)} />
}

/** A plate's shape (the « sm » plate's size). */
export const PlateBone = ({ className }: { className?: string }) => <Bone className={cn('h-7 w-[7.5rem] rounded-[6px]', className)} />

/** A line of text of the given width, at the height of the text it stands for. */
export const LineBone = ({ className }: { className?: string }) => <Bone className={cn('h-4 w-40', className)} />

const SLOW_AFTER = 8000

/** The dashboard while the account loads: its bar, the heading, a ticket card and the main button. After 8 seconds a
 *  way out under it (try again, sign out), as the full-page wait had. */
export function DashboardSkeleton({ onRetry, onLogout }: { onRetry: () => void; onLogout: () => void }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_AFTER)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="flex min-h-dvh flex-col bg-background" aria-busy={!slow} aria-live="polite">
      <TopBar>
        <Bone className="h-9 w-10 rounded-[10px] sm:h-10 sm:w-44" />
        <Bone className="hidden h-10 w-36 rounded-[10px] sm:block" />
        <Bone className="h-9 w-9 rounded-[10px] sm:h-10 sm:w-28" />
      </TopBar>
      <main className="mx-auto w-full max-w-[34rem] flex-1 px-6 pt-4 pb-6">
        <span className="sr-only">Chargement de votre compte PayByPhone…</span>
        <LineBone className="mt-3 h-5 w-56" />
        <div className="mt-5 overflow-hidden rounded-2xl border border-ink/10 bg-white">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <PlateBone />
            <Bone className="h-8 w-28 rounded-full" />
          </div>
          <div className="border-t border-ink/[0.06] px-5 py-5">
            <LineBone className="h-5 w-64 max-w-full" />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-ink/[0.06] px-5 py-5">
            <span className="space-y-2">
              <LineBone className="h-5 w-44" />
              <LineBone className="w-32" />
            </span>
            <Bone className="h-7 w-12 rounded-full" />
          </div>
        </div>
        <Bone className="mt-6 h-14 w-full rounded-xl" />
        {slow && (
          <div className="rise mt-8 flex flex-col items-center gap-4 text-center">
            <p className="text-ink/70">Le chargement prend plus de temps que prévu.</p>
            <button onClick={onRetry} className={cn(ui.primary, 'h-12 text-base')}>
              <RotateCw className="size-5" /> Réessayer
            </button>
            <button onClick={onLogout} className={ui.link}>
              Se déconnecter
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
