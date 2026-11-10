import { Alert } from '@heroui/react'
import { cn } from '@/lib/utils'

/** A message in a form or a window (an error by default): HeroUI's Alert, its icon and text. Read out at once by
 *  screen readers (role="alert"), as the hand-made boxes it replaces were. */
export function Notice({
  children,
  title,
  status = 'danger',
  className,
}: {
  children: React.ReactNode
  title?: React.ReactNode
  status?: 'danger' | 'warning' | 'success' | 'accent' | 'default'
  className?: string
}) {
  return (
    <Alert role="alert" status={status} className={cn('text-left', className)}>
      <Alert.Indicator />
      <Alert.Content>
        {title && <Alert.Title>{title}</Alert.Title>}
        <Alert.Description className="text-[0.98rem] leading-snug">{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  )
}
