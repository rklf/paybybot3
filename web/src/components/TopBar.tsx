import { cn } from '@/lib/utils'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Menu, X } from 'lucide-react'
import { Wordmark } from '@/components/signs'
import { TRY_LABEL, ui } from '@/lib/styles'

/** The bar on top of every page: logo on the left, links in the middle (if any), actions on the right. */
export function TopBar({ center, children, className }: { center?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn('sticky top-0 z-30 border-b border-ink/10 bg-background/90 backdrop-blur-md', className)}>
      <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-8">
        <a href="#/" aria-label="PayByBot, accueil" className="shrink-0 justify-self-start">
          <Wordmark />
        </a>
        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Pages">
          {center}
        </nav>
        {/* Tight on a phone: logo and five icons in 375 px. */}
        {children ? <div className="flex items-center gap-0.5 justify-self-end sm:gap-2.5 [&>*]:max-sm:px-2.5">{children}</div> : <span />}
      </div>
    </header>
  )
}

const navLink = 'hidden px-2 text-[0.95rem] font-medium text-ink/60 transition hover:text-ink sm:inline'

const PAGES = [
  ['#/tarifs', 'Tarifs'],
  ['#/faq', 'FAQ'],
  ['#/securite', 'Sécurité'],
  ['#/comment-ca-marche', 'Comment ça marche'],
  ['#/qui-sommes-nous', 'Qui sommes-nous'],
] as const

/** On a phone, where the links do not fit in the bar: a ☰ button that opens them full screen, one per line. */
function MobileMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false)
  // Any page change (a link tapped, the back button) closes it.
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('hashchange', close)
    return () => window.removeEventListener('hashchange', close)
  }, [])
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        className="grid size-10 place-items-center rounded-lg text-ink transition hover:bg-ink/[0.05] sm:hidden"
      >
        {open ? <X className="size-6" /> : <Menu className="size-6" />}
      </button>
 {/* In a portal: the bar's backdrop blur would otherwise hold a « fixed » panel inside its own 4rem. */}
      {open &&
        createPortal(
        <nav aria-label="Pages" className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto bg-background px-6 pt-2 sm:hidden">
          {PAGES.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="block border-b border-ink/10 py-4 text-xl font-medium text-ink">
              {label}
            </a>
          ))}
          {/* On a phone the bar keeps « Se connecter »: signing up is here instead. */}
          {!signedIn && (
            <a href="#/inscription" onClick={() => setOpen(false)} className="block border-b border-ink/10 py-4 text-xl font-medium text-ink">
              S’inscrire
            </a>
          )}
        </nav>,
          document.body,
        )}
    </>
  )
}

/** The same top bar on every public page (home, FAQ, security, legal, login, sign-up): nothing moves. */
export function PublicTopBar({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <TopBar
      center={
        <>
          {PAGES.map(([href, label]) => (
            <a key={href} href={href} className={navLink}>
              {label}
            </a>
          ))}
        </>
      }
    >
      {signedIn ? (
        <a href="#/" className={ui.pillBlue}>
          Mon tableau de bord
        </a>
      ) : (
        <>
          <a href="#/connexion" className={cn(ui.pillGray, 'hidden sm:inline-flex')}>
            Se connecter
          </a>
          <a href="#/inscription" className={cn(ui.pillBlue, 'hidden sm:inline-flex')}>
            {TRY_LABEL}
          </a>
          {/* On a phone, room for one button: « Se connecter » (signing up is in the ☰ menu and on the page). */}
          <a href="#/connexion" className={cn(ui.pillBlue, 'sm:hidden')}>
            Se connecter
          </a>
        </>
      )}
      <MobileMenu signedIn={signedIn} />
    </TopBar>
  )
}
