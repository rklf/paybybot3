// Sample replies for the admin page in local development (PAYBYBOT_ADMIN_SAMPLE=1 npm run dev): the local
// server has no admin (online only). Never part of the build.
const H = 3600e3
const D = 86400e3
const at = (ms: number) => new Date(Date.now() + ms).toISOString()
const card = (exp: string, validUntil: string, expired = false) => ({ exp, validUntil, expired })

export function adminSample() {
  const clients = [
    { name: 'Maurice Kantor', email: 'maurice.k@gmail.com', created: '2026-10-21T10:00:00Z', plan: 'monthly', subscribed: true, trialEnd: '2026-10-28T10:00:00Z', price: 950, renewals: 2, origin: 'parrainage',
      vehicles: [{ plate: 'FJ745AC', expire: at(2 * D + 4 * H), resident: '75116', renewal: 'Actif' }, { plate: 'GH456JK', expire: at(5 * D), resident: '75116', renewal: 'Actif' }],
      cards: [card('09/28', '2028-09-30T23:59:59Z')] },
    { name: 'Claire Dubois', email: 'claire.dubois@orange.fr', created: '2026-11-03T09:00:00Z', plan: 'monthly', subscribed: true, trialEnd: at(23 * D), price: 950, renewals: 3, origin: 'sans_parrainage',
      vehicles: [{ plate: 'AB123CD', expire: at(6 * D), resident: '75005', renewal: 'Actif' }, { plate: 'EF789GH', expire: at(3 * H + 20 * 60e3), resident: '75005', renewal: 'Actif' }, { plate: 'KL012MN', expire: null, resident: '75005', renewal: 'Suspendu', failure: 'Votre banque n’a pas accepté ce paiement automatique. Renouvellement suspendu.' }],
      cards: [card('12/26', at(20 * D))] },
    { name: 'Paul Martin', email: 'paul.martin@free.fr', created: '2026-10-25T09:00:00Z', plan: 'monthly', subscribed: true, trialEnd: '2026-11-01T09:00:00Z', price: 950, renewals: 1, origin: 'parrainage',
      vehicles: [{ plate: 'PQ345RS', expire: at(4 * D), resident: '75011', renewal: 'Actif' }], cards: [card('05/29', '2029-05-31T23:59:59Z')] },
    { name: 'Sophie Lambert', email: 's.lambert@gmail.com', created: '2026-10-12T09:00:00Z', plan: 'yearly', subscribed: true, trialEnd: '2026-10-19T09:00:00Z', price: 9120, renewals: 1, origin: null,
      vehicles: [{ plate: 'TU678VW', expire: at(D), resident: '75015', renewal: 'Actif' }], cards: [card('01/20', '2020-01-31T23:59:59Z', true)] },
    { name: 'Julien Roche', email: 'julien.roche@yahoo.fr', created: '2026-10-18T09:00:00Z', plan: 'monthly', subscribed: false, trialEnd: '2026-10-25T09:00:00Z', price: 950, renewals: 0, origin: 'parrainage',
      vehicles: [{ plate: 'XY901ZA', expire: null, resident: '75020', renewal: 'Désactivé' }], cards: [card('03/27', '2027-03-31T23:59:59Z')] },
    { name: null, email: 'nadia.b@hotmail.fr', created: '2026-11-08T09:00:00Z', plan: null, subscribed: false, price: null, renewals: 0, origin: 'sans_parrainage', vehicles: null, cards: null },
  ]
  // A month of history: more clients, visitors and subscriptions spread over 30 days (always the same ones).
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const first = ['Léa', 'Hugo', 'Camille', 'Louis', 'Chloé', 'Gabriel', 'Inès', 'Arthur', 'Manon', 'Jules', 'Sarah', 'Nathan']
  const last = ['Bernard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'Fournier', 'Girard', 'Bonnet']
  const zones = ['75005', '75006', '75011', '75014', '75015', '75017', '75018', '75020']
  first.forEach((f, i) => {
    const ago = Math.floor(rand() * 28 + 1) * D
    const paying = rand() > 0.35
    const trialEnd = new Date(Date.now() - ago + 7 * D).toISOString()
    clients.push({
      name: f, email: `${f.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${last[i].toLowerCase()}@gmail.com`, created: at(-ago),
      plan: paying ? 'monthly' : null, subscribed: paying, trialEnd: paying ? trialEnd : undefined, price: paying ? 950 : null, renewals: paying ? 1 : 0,
      origin: rand() > 0.4 ? 'parrainage' : 'sans_parrainage',
      vehicles: [{ plate: `${'ABCDEFGHJK'[i % 10]}${'LMNPQRSTVW'[(i * 3) % 10]}${100 + i * 37}${'XYZ'[i % 3]}${'ABC'[i % 3]}`, expire: paying ? at(Math.floor(rand() * 6 + 1) * D) : null, resident: zones[i % zones.length], renewal: paying ? 'Actif' : null }],
      cards: [card(`0${(i % 9) + 1}/2${8 + (i % 2)}`, `20${28 + (i % 2)}-0${(i % 9) + 1}-28T23:59:59Z`)],
    } as (typeof clients)[number])
  })
  const sources = ['Carte de visite', 'WhatsApp', 'Direct', 'Google', 'SMS', 'Carte de visite', 'Instagram']
  const devices = ['iPhone', 'Android', 'Ordinateur']
  const activity: { id: number; at: string; event: string; who: string | null; detail: string | null; visitor?: string }[] = []
  for (let v = 0; v < 64; v++) {
    const t = -Math.pow(rand(), 0.7) * 30 * D
    activity.push({ id: 100 + v, at: at(t), event: 'Lien privé ouvert', who: null, detail: `${sources[v % sources.length]} · ${devices[v % 3]} · Paris, FR`, visitor: `v${v}` })
  }
  clients.filter((c) => c.subscribed).forEach((c, i) =>
    activity.push({ id: 300 + i, at: new Date(new Date(c.created).getTime() + 2 * H).toISOString(), event: 'Abonnement souscrit', who: c.email, detail: null }),
  )
  clients.forEach((c, i) => activity.push({ id: 400 + i, at: c.created, event: 'Inscription', who: c.email, detail: null }))
  activity.push({ id: 500, at: at(-40 * 60e3), event: 'Renouvellement suspendu', who: 'claire.dubois@orange.fr', detail: 'KL-012-MN · Paris 5e · carte refusée deux fois' })
  activity.push({ id: 501, at: at(-3 * H), event: 'Avance PayByBot', who: 'maurice.k@gmail.com', detail: 'FJ-745-AC · 9,50 € refacturés' })
  activity.sort((a, b) => b.at.localeCompare(a.at))
  const stats = { accounts: clients.length, accounts_7d: 2, accounts_30d: 6, renewals: 7, renewals_active: 6, renewals_paused: 1, renewals_error: 0, paid_7d: 3, signups_by_day: [] }
  return { stats, clients, activity, service: {}, login: { ok: true }, logout: { ok: true } }
}
