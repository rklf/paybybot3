import { Component, useEffect, type ReactNode } from 'react'
import { HostedFooter } from '@/components/Footer'
import { PublicTopBar } from '@/components/TopBar'
import { Wordmark } from '@/components/signs'
import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'

const CONTACT = 'contact@paybybot.fr'

function Page({ code, title, text, action }: { code: string; title: string; text: ReactNode; action: ReactNode }) {
  return (
    <main className="rise mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-sm font-semibold tracking-[0.2em] text-eu">{code}</p>
      <h1 className={cn(ui.title, 'mt-4')}>{title}</h1>
      <p className={cn(ui.subtitle, 'max-w-md')}>{text}</p>
      <div className="mt-9 w-full max-w-xs">{action}</div>
    </main>
  )
}

/** Any path other than the home page (the app itself lives behind #/ routes). */
export function NotFoundPage({ hosted }: { hosted: boolean }) {
  // The top bar and footer link to #/ routes: follow them from the home page, not from the broken path.
  useEffect(() => {
    const go = () => window.location.replace('/' + window.location.hash)
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicTopBar />
      <Page
        code="ERREUR 404"
        title="Cette page n’existe pas."
        text="Le lien est peut-être incomplet, ou la page a été déplacée."
        action={
          <a href="/" className={ui.primary}>
            Retour à l’accueil
          </a>
        }
      />
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}

/** Last resort when the interface itself breaks: a calm page instead of a blank one. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex h-16 items-center border-b border-ink/10 px-4 sm:px-8">
          <a href="/" aria-label="PayByBot, accueil">
            <Wordmark />
          </a>
        </header>
        <Page
          code="OUPS"
          title="Un problème est survenu."
          text={
            <>
              Rechargez la page. Vos renouvellements continuent de tourner. Si ça recommence, écrivez-nous à{' '}
              <a href={`mailto:${CONTACT}`} className={ui.link}>
                {CONTACT}
              </a>
              .
            </>
          }
          action={
            <button onClick={() => window.location.reload()} className={ui.primary}>
              Recharger la page
            </button>
          }
        />
      </div>
    )
  }
}
