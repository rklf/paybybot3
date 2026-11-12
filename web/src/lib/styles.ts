import { cn } from '@/lib/utils'

/** The one sign-up call to action, worded the same everywhere. */
export const TRY_LABEL = 'Essayer 1 mois gratuit'

/** The few building blocks of the minimal look (blue accent), shared by every screen. */
/** The one norm, everywhere (checked by measuring every screen): text in ink, or ink at 60 % (secondary) or 45 %
 *  (discreet), nothing else; sizes 14 px (text-sm), 15 px (text-[0.95rem]), 16.8 px (card titles, text-[1.05rem]),
 *  24 px (window titles), page titles (ui.title); buttons 56 px (main), 44 px, 36 px (top bar); corners 10 px (small
 *  things), rounded-xl (buttons, fields), rounded-2xl (cards, windows), full (pills). */
export const ui = {
  /** The one main action of a screen: blue outline on a clear background, a light blue fill on hover. */
  primary:
    'flex h-14 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-eu bg-transparent text-lg font-bold text-eu transition hover:bg-eu/[0.06] active:scale-[0.99] disabled:opacity-50',
  /** Same size as the main button, in grey: a second, quieter action. */
  primaryGray:
    'flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-ink/[0.06] text-lg font-bold text-ink transition hover:bg-ink/[0.1] active:scale-[0.99] disabled:opacity-50',
  /** Top bar buttons: a grey pill and a blue one (blue outline, a light blue fill on hover). */
  pillGray:
    'inline-flex h-9 items-center rounded-[10px] bg-ink/[0.06] px-3 text-sm sm:h-10 sm:px-4 sm:text-[0.95rem] font-semibold whitespace-nowrap text-ink transition hover:bg-ink/[0.1]',
  /** A top bar action as plain text: a light highlight on hover and while pressed. */
  navText:
    'inline-flex h-9 items-center rounded-[10px] px-3 text-sm font-medium whitespace-nowrap text-ink/60 transition hover:bg-ink/[0.04] hover:text-ink active:bg-ink/[0.08] disabled:opacity-50 sm:h-10 sm:text-[0.95rem]',
  pillBlue:
    'inline-flex h-9 items-center rounded-[10px] border-[1.5px] border-eu bg-transparent px-3 text-sm font-semibold whitespace-nowrap text-eu sm:h-10 sm:px-4 sm:text-[0.95rem] transition hover:bg-eu/[0.06]',
  /** A secondary action, outlined. */
  secondary:
    'flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-eu/30 bg-white font-bold text-eu transition hover:border-eu disabled:opacity-50',
  /** Small text actions. */
  link: 'font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink',
  /** Text inputs. */
  field:
    'h-14 w-full rounded-xl border border-ink/20 bg-white px-4 text-lg text-ink outline-none transition placeholder:text-ink/30 focus:border-eu focus:ring-3 focus:ring-eu/15',
  /** Field label. */
  label: 'mb-2 block text-sm font-bold text-ink/60',
  title: 'font-heading text-[2.2rem] leading-[1.05] font-medium tracking-[-0.035em] text-ink sm:text-[2.6rem]',
  subtitle: 'mt-3 text-[1.05rem] leading-relaxed text-ink/60',
  /** Dialog content shell and its plain header. */
  dialog: 'max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl bg-white p-0 sm:max-w-md',
  /** Every window's title (« Mon compte », « Programmer un ticket », « Inviter un proche »…): one size, one weight. */
  dialogTitle: 'font-heading text-2xl font-semibold tracking-tight text-ink',
  error: 'rounded-xl bg-destructive/8 px-4 py-3 text-destructive',
  note: 'rounded-xl bg-muted px-4 py-3 text-ink/60',
}

/** A selectable option (card, chip): hairline border, PayByBot blue when selected. */
export function choice(selected: boolean, extra?: string) {
  return cn(
    'rounded-xl border bg-white text-left transition',
    selected ? 'border-eu bg-eu/[0.04] ring-1 ring-eu' : 'border-ink/15 hover:border-ink/40',
    extra,
  )
}
