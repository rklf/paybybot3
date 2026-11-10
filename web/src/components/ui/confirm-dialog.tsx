import { AlertDialog } from '@heroui/react'
import { Loader2 } from 'lucide-react'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** « Are you sure? » before an action that cannot be undone (stop a renewal, e-mail every customer…): HeroUI's
 *  AlertDialog, with a red button for a destructive action. The window stays open while the action runs. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy = false,
  danger = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  busy?: boolean
  danger?: boolean
}) {
  return (
    <AlertDialog.Backdrop isOpen={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[26rem]">
          <AlertDialog.Header>
            <AlertDialog.Icon status={danger ? 'danger' : 'accent'} />
            <AlertDialog.Heading className="font-heading text-xl font-semibold tracking-tight text-ink">{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          {description && (
            <AlertDialog.Body>
              <p className="text-[1.02rem] leading-relaxed text-ink/65">{description}</p>
            </AlertDialog.Body>
          )}
          <AlertDialog.Footer className="flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className={cn(ui.primaryGray, 'h-12 text-base sm:w-auto sm:px-5')}>
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-bold transition active:scale-[0.99] disabled:opacity-60 sm:w-auto',
                danger ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-eu text-white hover:bg-[#173f86]',
              )}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} {confirmLabel}
            </button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
