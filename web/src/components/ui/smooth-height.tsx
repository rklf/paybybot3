import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A block whose height follows its content smoothly: a line arriving a moment later (PayByPhone answering) makes it
 *  grow in 250 ms instead of all at once. The first height is taken as it is (nothing moves on opening); with reduced
 *  motion, no transition. */
export function SmoothHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <div
      className={cn('overflow-hidden transition-[height] duration-250 ease-out motion-reduce:transition-none', className)}
      style={{ height }}
    >
      <div ref={inner}>{children}</div>
    </div>
  )
}
