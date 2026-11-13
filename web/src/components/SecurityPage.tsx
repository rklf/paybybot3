import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import type { ReactNode } from 'react'
import { ArrowLeft, Building2, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { legalBack, LEGAL_UPDATED, Mailto, PUBLISHER } from '@/components/Legal'

const PRACTICE = [
  [Lock, 'Chiffrement', 'AES-128 avec signature HMAC-SHA256, une clé distincte par usage. HTTPS imposé partout (HSTS).'],
  [Building2, 'Hébergement en UE', 'Application et base de données hébergées à Paris, dans l’Union européenne.'],
  [KeyRound, 'Zéro mot de passe stocké', 'Seul un jeton de connexion chiffré est utilisé, effacé au bout de 24 h au plus.'],
  [ShieldCheck, 'Accès verrouillé', 'Base de données fermée, tentatives de connexion limitées, requêtes d’autres sites refusées, vérification anti-robots à l’inscription et à la connexion, pare-feu qui bloque les appels en rafale.'],
] as const

const FRAMEWORK: { title: string; icon: typeof Lock; rows: [string, ReactNode][] }[] = [
  {
    title: 'Chiffrement',
    icon: Lock,
    rows: [
      ['Algorithme', 'AES-128-CBC + HMAC-SHA256'],
      ['Clés', 'Une par usage, rotation possible'],
      ['Transport', 'HTTPS (TLS), HSTS 2 ans'],
      ['Mots de passe', 'Jamais stockés'],
    ],
  },
  {
    title: 'RGPD',
    icon: ShieldCheck,
    rows: [
      ['Responsable', `${PUBLISHER.name}, Paris`],
      ['Hébergement', 'Union européenne (Paris)'],
      ['Droits garantis', 'Accès, rectification, effacement, portabilité'],
      ['Réclamation', 'Auprès de la CNIL'],
    ],
  },
]

const SUBPROCESSORS = [
  ['Vercel', 'Hébergement de l’application', 'Paris (UE)', 'ISO 27001, SOC 2'],
  ['Supabase', 'Base de données des renouvellements', 'Paris (UE)', 'SOC 2'],
  ['Resend', 'E-mails de confirmation', 'Irlande (UE)', 'SOC 2'],
  ['Stripe', 'Paiement de l’abonnement', 'Irlande (UE)', 'PCI DSS niveau 1, SOC 2'],
]

/** The security page, like the other legal pages: a way back, the title, the date, then small text in one column. */
export function SecurityPage({ signedIn = false }: { hosted: boolean; signedIn?: boolean }) {
  const back = legalBack(signedIn)
  return (
    <div className="min-h-dvh bg-background text-ink">
      <main className="max-w-[34rem] px-4 pt-5 pb-20 sm:px-6">
        <a href={back.href} className="inline-flex items-center gap-1.5 text-[0.95rem] text-ink hover:text-ink/60">
          <ArrowLeft className="size-4" strokeWidth={1.75} /> {back.label}
        </a>
        <h1 className={cn(ui.title, 'mt-9')}>Sécurité et données</h1>
        <p className="mt-4 text-[0.95rem] text-ink/60">Dernière mise à jour le {LEGAL_UPDATED}</p>
        <p className="mt-4 text-[0.95rem] leading-[1.5] text-ink/60">
          Votre mot de passe n’est jamais stocké. Vos données sont chiffrées, hébergées à Paris, et effacées dès que vous
          arrêtez.
        </p>

        <Part title="La sécurité, concrètement">
          {PRACTICE.map(([, title, text]) => (
            <p key={title}>
              <strong className="font-semibold text-ink">{title}.</strong> {text}
            </p>
          ))}
        </Part>

        {FRAMEWORK.map(({ title, rows }) => (
          <Part key={title} title={title}>
            <ul className="ml-5 list-disc space-y-1">
              {rows.map(([k, v]) => (
                <li key={k} className="pl-1">
                  {k} : {typeof v === 'string' && /^[A-ZÀ-Ý][a-zà-ÿ]/.test(v) && !/^(Studio|Union)/.test(v) ? v[0].toLowerCase() + v.slice(1) : v}
                </li>
              ))}
            </ul>
          </Part>
        ))}

        <Part title="Sous-traitants">
          <ul className="ml-5 list-disc space-y-1">
            {SUBPROCESSORS.map(([name, role, where, certs]) => (
              <li key={name} className="pl-1">
                <strong className="font-semibold text-ink">{name}</strong> : {role.toLowerCase()}, {where}. {certs}.
              </li>
            ))}
          </ul>
        </Part>

        <p className="mt-10 text-[0.95rem] leading-[1.5] text-ink/60">
          Une question sur la sécurité ? <Mailto />
        </p>
      </main>
    </div>
  )
}

/** A section: bold title at text size, then small text. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[0.95rem] leading-[1.5] font-semibold text-ink">{title}</h2>
      <div className="mt-1.5 space-y-3 text-[0.95rem] leading-[1.5] text-ink/60">{children}</div>
    </section>
  )
}
