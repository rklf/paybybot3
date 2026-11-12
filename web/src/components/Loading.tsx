import { useEffect, useState, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Wordmark } from '@/components/signs'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

const SLOW_AFTER = 8000
const SHOW_AFTER = 300

/** Full-page wait: the logo and a short line, then a way out if it takes too long or fails. */
export function Loading({
  label,
  error,
  onRetry,
  onLogout,
}: {
  label?: ReactNode
  /** Shown at once, with the retry button. */
  error?: string | null
  /** Default: reload the page. */
  onRetry?: () => void
  /** Signed in: a way out when the account keeps failing to load. */
  onLogout?: () => void
}) {
  const [slow, setSlow] = useState(false)
  // A quick load shows nothing (a plain white page for a blink, no logo flashing on and off).
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_AFTER)
    const show = setTimeout(() => setVisible(true), SHOW_AFTER)
    return () => (clearTimeout(id), clearTimeout(show))
  }, [])
  const stuck = !!error || slow

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6" aria-busy={!stuck} aria-live="polite">
      <div className={cn('flex w-full max-w-xs flex-col items-center gap-6 text-center', visible || stuck ? 'rise' : 'invisible')}>
        <span className={stuck ? undefined : 'animate-pulse'}>
          <Wordmark />
        </span>
        {!stuck && <span className="loading-bar" aria-hidden />}
        {stuck ? (
          <>
            <p className="text-[1.05rem] text-ink/60">{error || 'Le chargement prend plus de temps que prévu.'}</p>
            <button
              onClick={() => {
                setSlow(false)
                ;(onRetry ?? (() => window.location.reload()))()
              }}
              className={ui.primary}
            >
              <RotateCw className="size-5" /> Réessayer
            </button>
            {onLogout && (
              <button onClick={onLogout} className={ui.link}>
                Se déconnecter
              </button>
            )}
          </>
        ) : (
          label && <p className="max-w-64 text-[1.05rem] text-ink/60">{label}</p>
        )}
      </div>
    </div>
  )
}

/** The same sliding blue bar inside a page, wherever a part of it is being fetched, with what is happening. */
export function LoadingLine({ label, className }: { label?: ReactNode; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('flex flex-col items-start gap-2.5', className)}>
      <span className="loading-bar" aria-hidden />
      {label && <span className="text-sm text-ink/50">{label}</span>}
    </span>
  )
}
