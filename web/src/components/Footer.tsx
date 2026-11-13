import { cn } from '@/lib/utils'

const LINKS = [
  ['#/securite', 'Sécurité et données'],
  ['#/confidentialite', 'Confidentialité'],
  ['#/cgu', "Conditions d'utilisation"],
  ['#/mentions-legales', 'Mentions légales'],
  ['mailto:contact@paybybot.fr', 'contact@paybybot.fr'],
]

/** Legal links everywhere. */
export function HostedFooter({ className }: { className?: string; hosted?: boolean; linksOnly?: boolean }) {
  return (
    <footer className={cn('space-y-2 text-center text-sm text-ink/60', className)}>
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1" aria-label="Informations">
        {LINKS.map(([href, label]) => (
          <a key={href} href={href} className="underline-offset-4 hover:text-ink hover:underline">
            {label}
          </a>
        ))}
      </nav>
    </footer>
  )
}
