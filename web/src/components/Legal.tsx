import type { ReactNode } from 'react'
import { ArrowLeft, Check, X } from 'lucide-react'
import { PayByBot, PayByPhone, withPayByPhone } from '@/components/signs'

/** Who publishes paybybot. Shown in the legal pages. */
export const PUBLISHER = {
  name: 'Studio Presto',
  form: 'SAS',
  capital: '1 000 €',
  address: '47 rue Vivienne, 75002 Paris, France',
  siren: '103 811 097',
  siret: '103 811 097 00015',
  rcs: '103 811 097 R.C.S. Paris',
  vat: 'FR59103811097',
  director: 'David Guenoun, Président',
  email: 'contact@paybybot.fr',
}

export const LEGAL_UPDATED = '27 octobre 2026'
export const REPO_URL = 'https://github.com/davidstudiopresto/paybybot3/tree/web-interface'

import { type LegalPage } from '@/lib/legalPages'
export { LEGAL_PAGES, legalPageFromHash, type LegalPage } from '@/lib/legalPages'

/** The page a legal page was opened from (« ?from=inscription » in its hash, set by App), to go back to it. */
export function legalBack(signedIn: boolean): { href: string; label: string } {
  const from = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('from') ?? ''
  if (from === 'inscription') return { href: '#/inscription', label: 'Retour à l’inscription' }
  if (from === 'connexion') return { href: '#/connexion', label: 'Retour à la connexion' }
  if (from && /^[a-z-]+$/.test(from)) return { href: '#/' + from, label: 'Retour' }
  return { href: '#/', label: signedIn ? 'Mon espace' : 'Accueil' }
}

export const Mailto = () => (
  <a href={`mailto:${PUBLISHER.email}`} className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
    {PUBLISHER.email}
  </a>
)

function BaseSection({ title, children, plain = false }: { title: string; children: ReactNode; plain?: boolean }) {
  return (
    <section className="mt-7">
      <h2 className="text-[0.95rem] leading-[1.5] font-semibold text-ink">{plain ? title : withPayByPhone(title)}</h2>
      <div className="mt-1.5 space-y-3 text-[0.95rem] leading-[1.5] text-ink/70 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  )
}

/** Plain table of what is kept, where, and for how long. */
function DataTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left text-[0.95rem]">
        <thead>
          <tr className="text-sm text-muted-foreground">
            {['Donnée', 'Où', 'Protection', 'Combien de temps'].map((h) => (
              <th key={h} className="border-b-2 border-border px-2 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="align-top">
              {r.map((c, i) => (
                <td key={i} className={`border-b border-border px-2 py-2.5 ${i === 0 ? 'font-bold text-ink' : ''}`}>
                  {withPayByPhone(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The detailed part of the security page: how it works, what is kept, protections, control. */
export function SecurityDetails() {
  return (
    <>
      <Section title="Comment ça marche">
        <p>
          Quand vous vous connectez, votre identifiant et votre mot de passe sont transmis à <PayByPhone />, de façon chiffrée
          (HTTPS), le temps de la connexion. <PayByPhone /> renvoie un <strong>jeton d’accès</strong> : c’est lui, et non votre
          mot de passe, qui permet ensuite d’agir sur votre compte. Le mot de passe n’est écrit nulle part : ni base de
          données, ni fichier, ni journal.
        </p>
        <p>
          Pour payer, <PayByBot /> demande à <PayByPhone /> de prendre le ticket avec la carte enregistrée dans votre compte
          <PayByPhone />. Le paiement est fait par <PayByPhone />, au même tarif que dans son application. Le ticket apparaît dans
          votre application <PayByPhone /> comme si vous l’aviez pris vous-même.
        </p>
      </Section>

      <Section title="Le détail, sans rien cacher">
        <DataTable
          rows={[
            ['Jetons de connexion PayByPhone', 'Dans votre navigateur (cookie)', 'Chiffrés avec une clé que seul le serveur possède', '12 h sans activité, 24 h au plus'],
            ['Renouvellement ou ticket programmé : jeton de reconnexion PayByPhone', 'Base de données à Paris', 'Chiffré ; la clé est conservée ailleurs', 'Jusqu’à ce que vous l’arrêtiez'],
            ['Renouvellement ou ticket programmé : plaque, zone, tarif, durée, jours et heure, moyen de paiement choisi', 'Base de données à Paris', 'Chiffrés', 'Jusqu’à ce que vous l’arrêtiez'],
            ['Compte PayByBot : e-mail (seule donnée saisie), prénom et arrondissement de résidence repris de PayByPhone', 'Base de données à Paris', 'Chiffrés', 'Jusqu’à la suppression du compte'],
            ['Renouvellement ou ticket programmé : e-mail pour les confirmations', 'Base de données à Paris', 'Chiffré', 'Jusqu’à ce que vous le retiriez ou arrêtiez'],
            ['Historique des paiements par carte (payé, validation demandée, refusé), sans donnée de carte', 'Base de données à Paris', 'Chiffré', 'Jusqu’à la suppression du renouvellement ou du compte'],
            ['Alertes sur le téléphone, si vous les activez : adresse technique fournie par votre navigateur', 'Base de données à Paris', 'Chiffrée', 'Jusqu’à la suppression du compte ou le retrait de l’autorisation'],
            ['Renouvellement ou ticket programmé : dates de pause, de vérification et de paiement', 'Base de données à Paris', 'Dates seules, sans lien lisible avec vous', 'Jusqu’à ce que vous l’arrêtiez'],
            ['Identifiant de votre compte', 'Base de données à Paris', 'Seulement une empreinte : le numéro n’y figure pas', 'Jusqu’à ce que vous l’arrêtiez'],
            ['Tentatives de connexion (anti-piratage)', 'Base de données à Paris', 'Empreintes de l’appareil et du compte, jamais l’adresse IP ni l’identifiant en clair', '24 h au plus'],
            ['Journaux techniques', 'Hébergeur (Vercel)', 'Identifiant et plaque masqués', 'Durée limitée fixée par l’hébergeur'],
          ]}
        />
        <p>
          Vos véhicules, vos tickets et vos moyens de paiement ne sont pas copiés : ils sont lus chez <PayByPhone /> au moment
          où vous ouvrez <PayByBot />, pour les afficher.
        </p>
        <p>
          Sur votre appareil, <PayByBot /> retient aussi votre dernière zone, dernier véhicule et dernière carte pour pré-remplir le prochain
          paiement. Elles ne quittent pas votre navigateur.
        </p>
      </Section>

      <Section title="Les protections en place">
        <ul>
          <li>Connexion chiffrée (HTTPS) partout, imposée par le navigateur.</li>
          <li>Une clé de chiffrement différente pour chaque usage : une fuite de l’une ne débloque pas les autres.</li>
          <li>Base de données fermée : elle n’est accessible qu’au serveur de <PayByBot />, avec un jeton secret.</li>
          <li>Nombre de tentatives de connexion limité, pour empêcher de deviner des mots de passe.</li>
          <li>Requêtes venant d’un autre site refusées, et <PayByBot /> ne peut pas être affiché dans la page d’un autre site.</li>
          <li>
            Renouvellement automatique prudent : si <PayByPhone /> ne confirme pas un paiement, il se met en pause au lieu de
            réessayer, pour ne jamais payer deux fois.
          </li>
          <li>En cas d’incident, une seule action rend inutilisables d’un coup toutes les connexions et tous les jetons gardés.</li>
        </ul>
      </Section>

      <Section title="Garder la main">
        <ul>
          <li>Tous vos tickets restent visibles et gérables dans l’application <PayByPhone />.</li>
          <li>Le lien « Arrêter » sur la carte d’un renouvellement ou d’un ticket programmé le supprime, avec le jeton gardé.</li>
          <li>La « Pause vacances » suspend les paiements entre deux dates, sans rien supprimer.</li>
          <li>
            Les e-mails de confirmation sont facultatifs : retirez votre adresse à tout moment depuis la carte du renouvellement. Ils
            ne contiennent aucun suivi d’ouverture ni de clic.
          </li>
          <li>
            Changer votre mot de passe <PayByPhone /> met fin à l’accès de <PayByBot /> : il faudra vous reconnecter pour l’utiliser
            à nouveau.
          </li>
          <li>
            Pour effacer toutes vos données ou poser une question : <Mailto />.
          </li>
        </ul>
      </Section>

      <Section title="Signaler un problème de sécurité">
        <p>
          Vous pensez avoir trouvé une faille ? Écrivez à <Mailto /> : nous répondons rapidement et corrigeons en priorité.
          Le code est public sur{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
            GitHub
          </a>
          .
        </p>
      </Section>
    </>
  )
}

function Security() {
  return (
    <>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {[
          [true, 'Votre mot de passe n’est jamais enregistré'],
          [true, 'Aucun numéro de carte bancaire : PayByPhone ne montre que les 4 derniers chiffres'],
          [true, 'Données hébergées et traitées à Paris'],
          [true, 'Code source ouvert, vérifiable par tous'],
          [false, 'Aucune publicité, aucune revente de données'],
          [false, 'Aucun cookie de suivi ni outil de mesure d’audience'],
        ].map(([yes, text]) => (
          <p key={text as string} className="flex items-start gap-3 rounded-xl border border-border p-4 font-bold">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-eu text-white">
              {yes ? <Check className="size-4" strokeWidth={3} /> : <X className="size-4" strokeWidth={3} />}
            </span>
            {withPayByPhone(text as string)}
          </p>
        ))}
      </div>

      <SecurityDetails />
    </>
  )
}

function Privacy() {
  return (
    <>
      <p>
        Cette politique est propre à <PayByBot />. Elle explique quelles données le service traite, pourquoi, combien de temps,
        et quels sont vos droits, au sens du Règlement général sur la protection des données (RGPD).
      </p>

      <Section title="1. Qui est responsable">
        <p>
          <PayByBot /> appartient à {PUBLISHER.name}, responsable du traitement au sens du RGPD (coordonnées dans les{' '}
          <a href="#/mentions-legales" className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
            mentions légales
          </a>
          ). Pour toute question sur vos données : <Mailto />.
        </p>
      </Section>

      <Section title="2. Données traitées">
        <ul>
          <li>
            <strong>Connexion :</strong> votre identifiant <PayByPhone /> (téléphone ou e-mail) et votre mot de passe,
            transmis à <PayByPhone /> pour vous connecter. Le mot de passe n’est pas conservé. Les jetons de connexion renvoyés
            par <PayByPhone /> sont gardés chiffrés dans un cookie de votre navigateur.
          </li>
          <li>
            <strong>Données de votre compte <PayByPhone /> :</strong> véhicules, tickets en cours, moyens de paiement (masqués,
            4 derniers chiffres), tarifs. Ils sont lus à la demande pour être affichés et ne sont pas conservés.
          </li>
          <li>
            <strong>Paiements et prolongations :</strong> plaque, zone, tarif, durée et moyen de paiement choisis, transmis à
            <PayByPhone /> pour prendre le ticket.
          </li>
          <li>
            <strong>Compte <PayByBot /> :</strong> votre e-mail, vérifié par un code à l’inscription (la seule donnée que
            vous saisissez), ainsi que votre prénom et l’arrondissement de résidence de vos véhicules, repris de votre
            compte <PayByPhone />, chiffrés ; une empreinte de votre identifiant ; si vous vous abonnez, l’offre choisie et les
            identifiants de client et d’abonnement Stripe, chiffrés.
          </li>
          <li>
            <strong>Renouvellement résident ou ticket programmé (si vous l’activez) :</strong> un jeton de reconnexion <PayByPhone />, la plaque,
            la zone, le tarif, la durée, les jours et l’heure choisis et le moyen de paiement, tous chiffrés ; une empreinte de votre identifiant ;
            les dates des dernières vérifications et du dernier paiement, les dates de pause éventuelles, et le dernier
            message d’erreur éventuel, et l’e-mail des confirmations, chiffré lui aussi.
          </li>
          <li>
            <strong>Sécurité :</strong> empreintes de votre adresse IP et de votre identifiant, pour limiter les tentatives
            de connexion.
          </li>
          <li>
            <strong>Journaux techniques :</strong> événements du service (connexion, paiement, erreur) avec identifiant et
            plaque masqués.
          </li>
        </ul>
        <p><PayByBot /> ne conserve ni nom, ni adresse postale, et ne voit jamais votre numéro de carte.</p>
      </Section>

      <Section title="3. Pourquoi, et sur quelle base">
        <ul>
          <li>
            <strong>Fournir le service que vous demandez</strong> (connexion, paiement, prolongation, renouvellement) :
            exécution des conditions d’utilisation que vous acceptez (article 6.1.b du RGPD).
          </li>
          <li>
            <strong>Vous tenir informé</strong> (code d’inscription, confirmation de paiement, alerte en cas de problème,
            confirmation de suppression) : exécution du service demandé (article 6.1.b). Aucune lettre d’information, aucune
            publicité.
          </li>
          <li>
            <strong>Sécuriser le service</strong> (limite de tentatives, journaux, prévention des paiements en double) :
            intérêt légitime de <PayByBot /> à protéger ses utilisateurs (article 6.1.f).
          </li>
        </ul>
        <p>
          Vos données ne servent à rien d’autre : pas de publicité, pas de profilage, pas de prospection, pas de revente.
        </p>
      </Section>

      <Section title="4. Destinataires et sous-traitants">
        <ul>
          <li>
            <strong><PayByPhone /></strong>, qui exploite votre compte et réalise les paiements, selon ses propres conditions et
            sa propre politique de confidentialité.
          </li>
          <li>
            <strong>Vercel Inc.</strong>, hébergeur de l’application. Les traitements s’exécutent dans sa région de Paris
            (France).
          </li>
          <li>
            <strong>Supabase Inc.</strong>, fournisseur de la base de données des comptes et des renouvellements, hébergée à Paris
            (France).
          </li>
          <li>
            <strong>Resend Inc.</strong>, pour l’envoi des e-mails de confirmation, depuis l’Irlande, sans suivi
            d’ouverture ni de clic. Il reçoit votre adresse et le contenu du message, uniquement au moment de l’envoi.
          </li>
          <li>
            <strong>Stripe</strong>, pour le paiement de l’abonnement : il reçoit votre e-mail et les données de votre
            carte, que <PayByBot /> ne voit jamais, et conserve les factures selon ses obligations légales.
          </li>
        </ul>
        <p>
          Vercel, Supabase et Resend sont des sociétés américaines. Les données sont hébergées et traitées dans l’Union européenne,
          et un éventuel accès depuis l’extérieur de l’Union est encadré par les garanties prévues par le RGPD, notamment les
          clauses contractuelles types de la Commission européenne prévues dans leurs accords de traitement des données.
        </p>
        <p>Aucune autre personne ou société n’a accès à vos données, sauf obligation légale.</p>
      </Section>

      <Section title="5. Durées de conservation">
        <ul>
          <li>
            Jetons de connexion (cookie) : 12 heures sans activité, 24 heures au plus ; 30 jours si vous cochez « Se
            souvenir de moi ».
          </li>
          <li>Compte <PayByBot /> (e-mail, prénom, arrondissement de résidence) : jusqu’à la suppression du compte.</li>
          <li>Renouvellement ou ticket programmé, y compris l’e-mail : tant qu’il est actif ; supprimé dès que vous l’arrêtez.</li>
          <li>
            Mois offert : une empreinte anonyme (chiffrée, impossible à relire) du compte <PayByPhone />, de l’e-mail et
            des plaques, avec la date de début du mois offert, gardée même après la suppression du compte, pour
            n’offrir ce mois qu’une fois.
          </li>
          <li>Tentatives de connexion : 24 heures au plus.</li>
          <li>E-mails envoyés : conservés par Resend pour une durée limitée, le temps d’assurer leur bonne livraison.</li>
          <li>Journaux techniques : durée limitée fixée par l’hébergeur.</li>
        </ul>
      </Section>

      <Section title="6. Cookies et stockage local">
        <p>
          <PayByBot /> utilise le cookie <strong>pbb_session</strong>, strictement nécessaire pour rester connecté, et,
          pendant l’inscription, <strong>pbb_pending</strong> (10 minutes, le temps de saisir le code). Ils ne servent
          pas au suivi et ne nécessitent donc pas de consentement. <PayByBot /> n’utilise aucun cookie publicitaire ni outil
          de mesure d’audience. Seule l’ouverture du lien privé est comptée, sans cookie ni adresse IP : l’application d’où
          il est ouvert, le type d’appareil et la ville approximative.
        </p>
        <p>
          Votre navigateur garde aussi votre dernière zone, dernier véhicule et dernière carte (stockage local) pour pré-remplir le prochain
          paiement. Vous pouvez l’effacer depuis les réglages de votre navigateur.
        </p>
      </Section>

      <Section title="7. Sécurité">
        <p>
          Les mesures techniques sont détaillées sur la page{' '}
          <a href="#/securite" className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
            Sécurité et données
          </a>
          . En cas de violation de données présentant un risque pour vous, nous la notifions à la CNIL et, si nécessaire,
          aux personnes concernées, comme le prévoit le RGPD.
        </p>
      </Section>

      <Section title="8. Vos droits">
        <p>
          Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, la limitation de leur traitement
          ou leur portabilité, et vous opposer à un traitement fondé sur l’intérêt légitime. Écrivez à <Mailto /> : nous
          répondons sous un mois. Arrêter un renouvellement ou un ticket programmé efface immédiatement les données correspondantes.
        </p>
      </Section>

      <Section title="9. Modifications">
        <p>
          Cette politique peut évoluer, par exemple si le service change. La date de dernière mise à jour figure en haut de
          cette page.
        </p>
      </Section>
    </>
  )
}

const Section = BaseSection

/** « PayByPhone » in plain text, without its green « By »: the terms name the brand without its visual identity. */
const PlainPayByPhone = () => <span className="whitespace-nowrap">PayByPhone</span>

function Terms() {
  // In the terms only, the brand stays in plain text (the other pages keep the green « By »).
  const PayByPhone = PlainPayByPhone
  const Section = (p: { title: string; children: ReactNode }) => <BaseSection {...p} plain />
  return (
    <>
      <p>
        Ces conditions encadrent l’utilisation de <PayByBot />. En vous connectant avec votre compte <PayByPhone />, vous les
        acceptez.
      </p>

      <Section title="1. Le service">
        <p>
          <PayByBot />, service appartenant à {PUBLISHER.name}, est une interface qui permet de piloter son propre compte <PayByPhone /> :
          payer un stationnement, prolonger un ticket en cours et, si vous l’activez, renouveler automatiquement un ticket
          résident chaque semaine ou prendre automatiquement un ticket (visiteur, carte mobilité CMI-S…) les jours et à l’heure
          que vous choisissez. Il s’adresse aux résidents comme aux non-résidents. Le service est payant après un mois
          offert (voir « Abonnement et paiement »).
        </p>
      </Section>

      <Section title="2. Indépendance vis-à-vis de PayByPhone">
        <p>
          <PayByBot /> est un service indépendant, non affilié à <PayByPhone />, ni approuvé ou soutenu par <PayByPhone />. Les noms et
          marques cités appartiennent à leurs propriétaires. Votre compte, vos tickets et vos paiements restent soumis aux
          conditions de <PayByPhone />, que vous acceptez directement auprès de <PayByPhone />.
        </p>
      </Section>

      <Section title="3. Mandat">
        <p>
          En utilisant <PayByBot />, vous l’autorisez à transmettre en votre nom à <PayByPhone /> les demandes que vous faites
          (paiement, prolongation) et, si vous activez un renouvellement résident ou un ticket programmé, à prendre
          automatiquement un nouveau ticket, à l’expiration du précédent ou aux jours et à l’heure choisis, avec le véhicule,
          la zone, le tarif, la durée et le moyen de paiement que vous avez choisis, jusqu’à ce que vous l’arrêtiez.
        </p>
        <p>
          Les tickets sont achetés par vous, depuis votre compte <PayByPhone />, au tarif de <PayByPhone />. <PayByBot /> n’encaisse pas
          le prix des tickets : seul l’abonnement à <PayByBot /> est facturé (voir « Abonnement et paiement »).
        </p>
      </Section>

      <Section title="4. Conditions d’accès">
        <ul>
          <li>
            Avoir un compte <PayByPhone />, avec un véhicule et une carte bancaire enregistrés : les paiements automatiques
            se font par carte. Le tarif résident n’est pas nécessaire.
          </li>
          <li>Être parrainé : l’inscription se fait par le lien d’un utilisateur de <PayByBot />.</li>
          <li>N’utiliser que son propre compte, ou un compte dont on a l’accord du titulaire.</li>
          <li>Être majeur ou disposer de l’accord de son représentant légal.</li>
        </ul>
      </Section>

      <Section title="5. Vos responsabilités">
        <ul>
          <li>
            Vérifier vous-même, dans l’application <PayByPhone />, qu’un ticket valide couvre votre véhicule pendant tout votre
            stationnement : seul ce ticket fait foi en cas de contrôle. <PayByBot /> est une aide, pas une garantie.
          </li>
          <li>
            Vérifier que la zone, le tarif et la durée correspondent à votre stationnement et à la signalisation sur place.
          </li>
          <li>
            Choisir le tarif qui vous correspond et disposer des droits nécessaires aux tarifs spéciaux, et les tenir à
            jour : tarif résident, carte mobilité inclusion mention stationnement (CMI-S) pour le ticket carte mobilité CMI-S, à placer
            derrière le pare-brise. <PayByPhone /> ne vérifie pas ces droits au moment de l’achat ; un tarif pris sans y avoir
            droit vous expose à un forfait post-stationnement et aux sanctions prévues.
          </li>
          <li>
            Indiquer le bon type de véhicule (léger ou lourd) pour le ticket visiteur : <PayByPhone /> ne connaît pas le poids
            du véhicule, et un tarif inférieur à celui dû ne vous couvre pas.
          </li>
          <li>
            Déplacer votre véhicule au moins une fois tous les 7 jours : un ticket payé, même renouvelé automatiquement, ne
            vous autorise pas à rester plus longtemps sur le même emplacement. Au-delà, le stationnement est considéré comme
            abusif (article R417-12 du Code de la route ; à Paris, 7 jours au plus pour les résidents) et vous expose à une
            amende et à une mise en fourrière, qui restent à votre charge. <PayByBot /> paie le ticket, il ne déplace pas
            votre véhicule.
          </li>
          <li>Garder vos identifiants <PayByPhone /> confidentiels.</li>
          <li>Payer vous-même votre stationnement dans l’application <PayByPhone /> quand un paiement automatique échoue.</li>
          <li>Ne pas perturber le service, ni tenter d’y accéder de façon non autorisée ou de l’utiliser de façon abusive.</li>
        </ul>
      </Section>

      <Section title="6. Renouvellement résident et tickets programmés">
        <p>
          <strong>Renouvellement résident.</strong> Une fois activé, le renouvellement paie automatiquement, sans nouvelle confirmation, une semaine au tarif résident
          après l’autre, tant que vous ne l’arrêtez pas. Chaque semaine est payée la veille de la fin du ticket en cours,
          en prolongeant ce ticket ; si <PayByPhone /> ne permet pas de le prolonger, elle est achetée à sa fin. Le même
          véhicule n’est jamais payé deux fois pour la même période.
        </p>
        <p>
          <strong>Tickets programmés.</strong> Une fois activé, un ticket programmé est pris automatiquement, sans nouvelle
          confirmation, chaque jour choisi à l’heure choisie, au tarif et pour la durée choisis, tant que vous ne l’arrêtez
          pas. Le service fonctionne en France, partout où <PayByPhone /> fonctionne ; à Paris, aucun ticket n’est pris le
          dimanche ni les jours fériés, où le stationnement est gratuit. Les heures sont celles de Paris (heure de France
          métropolitaine). La durée ne peut pas dépasser le maximum du tarif (par exemple 6 heures pour
          le ticket visiteur à Paris).
        </p>
        <p>
          Vous pouvez mettre un renouvellement ou un ticket programmé en pause entre deux dates, ou sans date de fin : aucun paiement n’est fait pendant la pause, et
          il reprend tout seul à la fin. Un ticket déjà payé avant le début de la pause n’est pas remboursé. <PayByBot /> vous envoie par e-mail une confirmation à chaque paiement et
          une alerte en cas de problème ; ces e-mails sont informatifs et ne remplacent pas la vérification de votre
          stationnement.
        </p>
        <p>
          Un paiement automatique peut ne pas aboutir, par exemple si votre connexion <PayByPhone /> a expiré, si votre carte est refusée, si votre
          droit au tarif choisi (résident, carte mobilité CMI-S) a pris fin ou si <PayByPhone /> modifie son service. Dans ces cas, <PayByBot /> l’indique sur votre
          tableau de bord, vous prévient par e-mail et réessaie automatiquement. Si votre banque demande une validation, <PayByBot /> ouvre
          automatiquement sa page de validation, pour que votre banque puisse vous envoyer sa notification ; <PayByBot /> ne valide jamais à votre place.
          Il vous prévient aussi et attend que vous validiez : sans validation avant la fin de votre ticket (ou sous 24 heures sans ticket en cours), le
          renouvellement ou le ticket programmé est suspendu. Il l’est aussi si un paiement n’est pas confirmé par <PayByPhone />, pour éviter un double paiement.
        </p>
        <p>
          En cas d’échec d’un paiement, <PayByBot /> vous en informera par e-mail. Le paiement de votre stationnement restera
          sous votre responsabilité : il vous appartiendra de le régler vous-même dans l’application <PayByPhone />.
        </p>
      </Section>

      <Section title="7. Disponibilité et responsabilité">
        <p>
          Le service est fourni en l’état, sans garantie de disponibilité ni de résultat. Il dépend du
          fonctionnement de <PayByPhone />, qui peut évoluer à tout moment, et peut être interrompu ou arrêté.
        </p>
        <p>
          <strong>Une aide, pas une garantie.</strong> <PayByBot /> est un outil d’assistance qui tente d’acheter vos tickets à
          votre place : il est tenu d’une obligation de moyens, et non de résultat. Il ne garantit pas qu’un ticket sera acheté,
          ni qu’il couvrira votre stationnement. Vous restez seul responsable du paiement de votre stationnement et du respect
          des règles de stationnement, avec ou sans <PayByBot />.
        </p>
        <p>
          <strong>Forfaits post-stationnement (FPS) et amendes.</strong> L’obligation de <PayByBot /> se limite à
          tenter le paiement automatique et à vous prévenir quand il n’aboutit pas. <PayByBot /> vous prévient, par e-mail et
          sur votre tableau de bord, notamment dans les cas suivants :
        </p>
        <ul>
          <li>
            votre abonnement <PayByBot /> n’est pas payé (paiement refusé par votre banque, ou mois offert
            utilisé sans abonnement en cours) : les renouvellements s’arrêtent jusqu’à la régularisation ;
          </li>
          <li>
            votre véhicule ne bénéficie plus, sur <PayByPhone />, du tarif choisi (droit résident expiré, véhicule ou adresse
            modifiés, tarif plus proposé dans la zone) ;
          </li>
          <li>votre compte <PayByPhone /> n’a plus de carte bancaire utilisable (carte supprimée, expirée ou bloquée) ;</li>
          <li>
            le paiement d’un stationnement échoue pour une autre raison (refus ou validation demandée par votre banque,
            connexion <PayByPhone /> expirée, service <PayByPhone /> indisponible).
          </li>
        </ul>
        <p>
          Dès que vous êtes prévenu, et plus généralement tant qu’aucun ticket n’est en cours pour votre véhicule, il vous
          appartient de payer vous-même votre stationnement dans l’application <PayByPhone />. Dans les limites permises par la
          loi, <PayByBot /> et son propriétaire ne sont donc pas responsables des forfaits post-stationnement, amendes,
          majorations, frais de fourrière ou d’enlèvement, des paiements refusés ou non réalisés, ni des indisponibilités de{' '}
          <PayByPhone /> ou de <PayByBot />, quelle qu’en soit la cause, y compris une erreur, un retard ou une panne de{' '}
          <PayByBot />. Si leur responsabilité était malgré tout retenue, elle serait limitée au montant de l’abonnement que
          vous avez payé au cours des 12 derniers mois. Ces limitations ne s’appliquent pas en cas de faute lourde ou
          intentionnelle.
        </p>
      </Section>

      <Section title="8. Données personnelles">
        <p>
          Leur traitement est décrit dans la{' '}
          <a href="#/confidentialite" className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
            politique de confidentialité
          </a>
          .
        </p>
      </Section>

      <Section title="9. Code source">
        <p>
          Le code de <PayByBot /> est libre, sous licence MIT, et public sur{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-bold text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink">
            GitHub
          </a>
          .
        </p>
      </Section>

      <Section title="10. Abonnement et paiement">
        <ul>
          <li>
            <strong>Mois offert :</strong> un mois gratuit, offert une seule fois par personne (même
            compte <PayByPhone />, e-mail ou plaque). Il commence quand vous choisissez votre offre, et non à l’inscription.
          </li>
          <li>
            <strong>Offres et prix :</strong> abonnement mensuel, ou annuel avec 20 % de remise, TTC : 9,50 € par véhicule et par mois, quel que soit le ticket (résident, visiteur, carte mobilité CMI-S) ou le type de véhicule,
            ou 91,20 € par véhicule et par an. Le prix exact est affiché avant tout paiement. Le paiement se fait par carte bancaire, via notre
            prestataire de paiement Stripe ; <PayByBot /> ne voit ni ne conserve votre numéro de carte.
          </li>
          <li>
            <strong>Véhicules couverts :</strong> l’abonnement couvre les véhicules cochés dans « Mon compte ».
            Aucun renouvellement, ticket programmé ou ticket ne peut être pris par <PayByBot /> pour un véhicule non
            couvert. Le mois commencé est toujours dû en entier. Un véhicule ajouté est facturé tout de suite pour le
            mois en cours (avec l’abonnement annuel : pour les mois restants jusqu’à l’échéance, au prix annuel) ; pendant
            le mois offert, rien n’est prélevé. Un véhicule retiré reste dû pour le mois en cours, son renouvellement
            s’arrête, et avec l’abonnement annuel les mois entiers suivants sont crédités sur la prochaine facture. Le
            nouveau prix de l’abonnement s’applique à la prochaine échéance. Vous pouvez résilier à tout moment depuis
            « Mon compte ».
          </li>
          <li>
            <strong>Changement de prix :</strong> si <PayByBot /> modifie ses prix, le nouveau prix ne s’applique qu’à partir du
            mois suivant, à votre prochaine échéance ; un abonnement annuel garde son prix jusqu’à la fin de l’année payée. Vous
            êtes prévenu par e-mail avant, et pouvez résilier sans frais depuis « Mon compte » si le nouveau prix ne vous convient pas.
          </li>
          <li>
            <strong>Arrêt d’un ticket dans PayByPhone :</strong> <PayByBot /> n’est pas informé quand vous arrêtez vous-même
            un ticket dans l’application <PayByPhone /> avant sa fin. Tant que le renouvellement ou le ticket programmé est actif dans
            <PayByBot />, un nouveau ticket est acheté à son prochain passage, et il reste dû. Pour ne plus rien payer, mettez
            le renouvellement en pause ou arrêtez-le depuis <PayByBot /> (« Gérer »). <PayByBot /> conserve, comme justificatif,
            la date et l’état de fin des tickets arrêtés avant leur terme, tels que <PayByPhone /> les indique.
          </li>
          <li>
            <strong>Premier prélèvement :</strong> rien n’est prélevé avant la fin du mois offert.
          </li>
          <li>
            <strong>Renouvellement :</strong> l’abonnement se renouvelle automatiquement à la fin de chaque période (mois ou
            année), au tarif en vigueur, jusqu’à sa résiliation.
          </li>
          <li>
            <strong>Résiliation :</strong> à tout moment, depuis « Mon compte », puis « Gérer ». Elle prend effet à la fin
            de la période en cours, déjà payée ; aucun prélèvement n’a lieu ensuite.
          </li>
          <li>
            <strong>Droit de rétractation :</strong> vous disposez de 14 jours à compter de votre souscription pour vous
            rétracter, sans motif, en écrivant à <Mailto />. Si vous avez demandé que le service commence avant la fin
            de ce délai, le montant correspondant au service déjà fourni reste dû ; le reste vous est remboursé.
          </li>
          <li>
            <strong>Sans abonnement en cours</strong> une fois le mois offert utilisé (par exemple s’il a été résilié pendant ce mois), ou si un paiement de l’abonnement échoue, votre
            compte est bloqué : le ticket en cours reste valable, mais le ticket suivant n’est pas payé. Vous en
            êtes prévenu par e-mail, et le renouvellement reprend dès que le paiement est fait.
          </li>
        </ul>
      </Section>

      <Section title="11. Arrêt, modification, droit applicable">
        <p>
          Vous pouvez cesser d’utiliser <PayByBot /> à tout moment. Ces conditions peuvent être modifiées ; la version en vigueur
          est celle publiée sur cette page. Elles sont soumises au droit français. En cas de difficulté, écrivez d’abord à{' '}
          <Mailto /> pour trouver une solution amiable.
        </p>
      </Section>
    </>
  )
}

function Notice() {
  return (
    <>
      <Section title="Propriétaire et éditeur">
        <p><PayByBot /> est un service appartenant à :</p>
        <p>
          {PUBLISHER.name}, {PUBLISHER.form}
          {PUBLISHER.capital ? ` au capital de ${PUBLISHER.capital}` : ''}
          <br />
          Siège : {PUBLISHER.address}
          <br />
          {PUBLISHER.rcs} — SIRET {PUBLISHER.siret}
          <br />
          TVA intracommunautaire : {PUBLISHER.vat}
          <br />
          Contact : <Mailto />
        </p>
        <p>Directeur de la publication : {PUBLISHER.director}</p>
      </Section>
      <Section title="Hébergement">
        <p>
          Application : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — vercel.com. Exécution dans la
          région de Paris (France).
        </p>
        <p>
          Base de données : Supabase Inc., 970 Toa Payoh North #07-04, Singapour 318992 — supabase.com. Hébergement à Paris
          (France).
        </p>
        <p>E-mails : Resend Inc., San Francisco, États-Unis — resend.com. Envoi depuis l’Irlande.</p>
      </Section>
      <Section title="Propriété intellectuelle">
        <p>
          Le code de <PayByBot /> est publié sous licence MIT. <PayByPhone /> est une marque de son propriétaire ; <PayByBot /> n’est pas
          affilié à <PayByPhone />.
        </p>
      </Section>
    </>
  )
}

const CONTENT: Record<LegalPage, { title: string; body: () => ReactNode }> = {
  securite: { title: 'Sécurité et données', body: Security },
  confidentialite: { title: 'Politique de confidentialité', body: Privacy },
  cgu: { title: "Conditions d'utilisation", body: Terms },
  'mentions-legales': { title: 'Mentions légales', body: Notice },
}

/** The legal pages, like a plain document: a way back, the title, the date, then small text in one narrow column. */
export function LegalView({ page, signedIn = false }: { page: LegalPage; hosted: boolean; signedIn?: boolean }) {
  const { title, body: Body } = CONTENT[page]
  const back = legalBack(signedIn)
  return (
    <div className="min-h-dvh bg-background text-ink">
      <main className="max-w-[34rem] px-4 pt-5 pb-20 sm:px-6">
        <a href={back.href} className="inline-flex items-center gap-1.5 text-[0.95rem] text-ink hover:text-ink/70">
          <ArrowLeft className="size-4" strokeWidth={1.75} /> {back.label}
        </a>
        <h1 className="mt-9 text-[1.6rem] leading-[1.3] font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-4 text-[0.95rem] text-ink/60">Dernière mise à jour le {LEGAL_UPDATED}</p>
        <div className="mt-4 text-[0.95rem] leading-[1.5] text-ink/70 [&>p]:mt-3">
          <Body />
        </div>
        <p className="mt-10 text-[0.95rem] leading-[1.5] text-ink/70">
          Une question ? <Mailto />
        </p>
      </main>
    </div>
  )
}
