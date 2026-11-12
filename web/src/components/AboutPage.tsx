import { HostedFooter } from '@/components/Footer'
import { PUBLISHER } from '@/components/Legal'
import { PayByBot } from '@/components/signs'
import { PublicTopBar } from '@/components/TopBar'
import { TRY_LABEL, ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

const STUDIO_URL = 'https://studiopresto.fr/'

// The founders; `photo` stays empty until the pictures are ready (their initials show in the meantime).
const FOUNDERS: { name: string; role: string; photo?: string; linkedin: string }[] = [
  { name: 'Rafaël Maurin', role: 'Cofondateur, CEO', photo: '/team/rafael.webp', linkedin: 'https://www.linkedin.com/in/rafa%C3%ABl-maurin-040652205/' },
  { name: 'David Guenoun', role: 'Cofondateur, CTO', photo: '/team/david.webp', linkedin: 'https://www.linkedin.com/in/david-guenoun-2758b9133/' },
]

/** LinkedIn's « in » mark (Simple Icons), in the current colour. */
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')

/** « Qui sommes-nous », in the top bar: who runs PayByBot. Text only. */
export function AboutPage({ hosted, signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-ink">
      <PublicTopBar signedIn={signedIn} />
      <main className="mx-auto w-full max-w-[40rem] flex-1 px-6 pt-16 pb-20 sm:pt-20">
        <h1 className={ui.title}>Qui sommes-nous</h1>
        <p className={ui.subtitle}>
          <PayByBot /> est un service français, édité par{' '}
          <a href={STUDIO_URL} target="_blank" rel="noopener noreferrer" className={ui.link}>
            {PUBLISHER.name}
          </a>
          , une société basée à Paris.
        </p>

        <h2 className="mt-12 font-heading text-[1.2rem] leading-snug font-semibold tracking-[-0.01em]">Les fondateurs</h2>
        <ul className="mt-5 grid grid-cols-2 gap-4">
          {FOUNDERS.map((f) => (
            <li key={f.name} className="flex flex-col items-center rounded-2xl border border-ink/10 px-4 py-6 text-center">
              {f.photo ? (
                <img src={f.photo} alt={f.name} className="size-32 rounded-full object-cover sm:size-36" />
              ) : (
                <span aria-hidden className="grid size-32 place-items-center rounded-full sm:size-36 bg-ink/[0.05] font-heading text-2xl font-medium text-ink/45">
                  {initials(f.name)}
                </span>
              )}
              {/* The name alone is centred under the photo, the LinkedIn mark hangs just after it (in the line on a phone). */}
              <span className="relative mt-4 font-medium text-ink">
                {f.name}
                <a
                  href={f.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${f.name} sur LinkedIn`}
                  className="ml-1.5 inline-block align-[-2px] text-[#0a66c2] transition hover:opacity-75 sm:absolute sm:top-1/2 sm:left-full sm:ml-2 sm:-translate-y-1/2"
                >
                  <LinkedInIcon className="size-4" />
                </a>
              </span>
              <span className="text-sm text-ink/60">{f.role}</span>
            </li>
          ))}
        </ul>

        {!signedIn && (
          <a href="#/inscription" className={cn(ui.primary, 'mt-14 w-full sm:w-fit sm:px-8')}>
            {TRY_LABEL}
          </a>
        )}
      </main>
      <HostedFooter className="px-6 pb-8" hosted={hosted} />
    </div>
  )
}
