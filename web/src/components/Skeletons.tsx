import { Skeleton } from '@heroui/react'
import { cn } from '@/lib/utils'

// Skeleton shapes: where a part of a page comes a moment later (PayByPhone answering), its own shape in light grey
// (HeroUI Skeleton), the real content then taking its exact place, so nothing moves under the finger.

/** One grey shape; its size and corners come from `className`. */
export function Bone({ className }: { className?: string }) {
  // The shimmer's light band in white: HeroUI's own grey is the shape's grey, so it would not show.
  return <Skeleton animationType="shimmer" className={cn('rounded-lg bg-ink/[0.07] after:via-white/80', className)} />
}

/** A plate's shape (the « sm » plate's size). */
export const PlateBone = ({ className }: { className?: string }) => <Bone className={cn('h-7 w-[7.5rem] rounded-[6px]', className)} />

/** A line of text of the given width, at the height of the text it stands for. */
export const LineBone = ({ className }: { className?: string }) => <Bone className={cn('h-4 w-40', className)} />
