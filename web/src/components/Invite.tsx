import { useEffect, useState, type ReactNode } from 'react'
import { Check, Link2, Mail, MessageSquare, Send, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { LoadingLine } from '@/components/Loading'

// The message sent with the link (copied or shared), in the user's own voice.
const MESSAGE =
  // Straight apostrophes: some apps mangle the typographic ones (’) when the text is passed in a link.
  "Hello ! J'ai découvert PayByBot, une app qui renouvelle automatiquement mon stationnement résident PayByPhone. Voici mon lien d'affiliation :"

/** WhatsApp's mark (Simple Icons), white on its green. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.8h-.01a9.8 9.8 0 0 1-4.99-1.37l-.36-.21-3.71.97.99-3.62-.23-.37a9.78 9.78 0 0 1-1.5-5.22c0-5.42 4.41-9.83 9.84-9.83 2.63 0 5.1 1.03 6.95 2.88a9.77 9.77 0 0 1 2.88 6.96c0 5.42-4.41 9.82-9.84 9.82zm8.37-18.2A11.76 11.76 0 0 0 12.05.13C5.53.13.22 5.43.22 11.96c0 2.09.55 4.12 1.58 5.92L.12 24l6.27-1.64a11.8 11.8 0 0 0 5.65 1.44h.01c6.52 0 11.83-5.31 11.83-11.84 0-3.16-1.23-6.13-3.46-8.36z" />
    </svg>
  )
}

/** One round share option with its label, like Instagram's share sheet. */
function Option({
  label,
  className,
  icon,
  href,
  onClick,
}: {
  label: string
  className: string
  icon: ReactNode
  href?: string
  onClick?: () => void
}) {
  const round = cn('grid size-14 place-items-center rounded-full transition group-hover:scale-105 group-active:scale-95', className)
  const body = (
    <>
      <span className={round}>{icon}</span>
      <span className="text-[0.8rem] leading-tight text-ink/70">{label}</span>
    </>
  )
  // No square outline when the sheet opens with the focus on the first option; a ring on the round for the keyboard.
  const box = 'group flex w-[4.5rem] flex-col items-center gap-2 text-center outline-none [&:focus-visible>span:first-child]:ring-2 [&:focus-visible>span:first-child]:ring-ink/30'
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={box}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={box}>
      {body}
    </button>
  )
}

/** The share options with the user's own link (WhatsApp, SMS, e-mail…), and the link itself unless withLink is false. */
export function InviteShare({ withLink = false, className }: { withLink?: boolean; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.myInvite().then((r) => setUrl(r.url), () => toast.error('Lien indisponible pour le moment.'))
  }, [])

  // Each way of sharing tags the link (?s=…), so the admin sees where an opened link came from.
  const tagged = (s: string) => (url ? `${url}${url.includes('?') ? '&' : '?'}s=${s}` : '')
  const text = url ? `${MESSAGE} ${tagged('copy')}` : ''
  const textFor = (s: string) => `${MESSAGE} ${tagged(s)}`
  const enc = encodeURIComponent

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(text) // the message with the link, ready to paste
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copie impossible : sélectionnez le lien.')
    }
  }

  return (
    <div className={className}>
      {/* The share options, in a row that scrolls on a phone */}
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">
        <Option
          label={copied ? 'Copié' : 'Copier le lien'}
          className="bg-ink/[0.06] text-ink"
          icon={copied ? <Check className="size-6" /> : <Link2 className="size-6" />}
          onClick={copy}
        />
        <Option
          label="WhatsApp"
          className="bg-[#25d366] text-white"
          icon={<WhatsAppIcon className="size-7" />}
          href={url ? `https://wa.me/?text=${enc(textFor('wa'))}` : undefined}
        />
        <Option
          label="SMS"
          className="bg-[#34c759] text-white"
          icon={<MessageSquare className="size-6" />}
          href={url ? `sms:?&body=${enc(textFor('sms'))}` : undefined}
        />
        <Option
          label="E-mail"
          className="bg-eu text-white"
          icon={<Mail className="size-6" />}
          href={url ? `mailto:?subject=${enc('Fini les amendes de stationnement')}&body=${enc(textFor('mail'))}` : undefined}
        />
        <Option
          label="Telegram"
          className="bg-[#229ed9] text-white"
          icon={<Send className="size-6" />}
          href={url ? `https://t.me/share/url?url=${enc(tagged('tg'))}&text=${enc(MESSAGE)}` : undefined}
        />
      </div>

      {withLink && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-ink/[0.04] py-2 pr-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-left text-sm text-ink/70">
            {url ? url.replace(/^https?:\/\//, '') : <LoadingLine className="py-1.5" />}
          </span>
          <button onClick={copy} disabled={!url} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      )}
    </div>
  )
}

/** « Inviter un proche » in the top bar: a share sheet with the user's own link. */
export function InviteButton({
  disabled = false,
  big = false,
  openAfter,
}: {
  disabled?: boolean
  big?: boolean
  /** Opens the share sheet by itself after this many milliseconds (the after-payment screen). */
  openAfter?: number
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (openAfter === undefined) return
    const id = setTimeout(() => setOpen(true), openAfter)
    return () => clearTimeout(id)
  }, [openAfter])
  return (
    <>
      {big ? (
        <button onClick={() => setOpen(true)} disabled={disabled} className={cn(ui.primary, 'sm:w-fit sm:px-10')}>
          <UserPlus className="size-5" /> Inviter un proche
        </button>
      ) : (
        <button onClick={() => setOpen(true)} disabled={disabled} className={cn(ui.pillGray, 'gap-2')}>
          <UserPlus className="size-4" /> <span className="hidden sm:inline">Inviter un proche</span>
        </button>
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className={ui.dialog}>
            <div className="px-6 pt-7">
              <DialogTitle className={ui.dialogTitle}>Inviter un proche</DialogTitle>
              <DialogDescription className="sr-only">Partagez votre lien d’invitation.</DialogDescription>
            </div>
            <InviteShare className="m-6 mt-6" />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
