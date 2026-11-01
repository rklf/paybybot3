import { expect, test, type Page } from '@playwright/test'

/** The key journeys of paybybot.fr, on the demo account (no real PayByPhone call, nothing paid). */

const LINK = '/r/e2ecode/'
const CURTAIN = 'Fonctionne uniquement sur parrainage'

/** The home page, whatever its title says: its sign-up button. */
const home = (page: Page) => page.getByRole('link', { name: 'Essayer 1 mois gratuit' }).first()

/** Opens the private link, waits for the curtain to lift, then signs in to the demo account. */
async function demo(page: Page) {
  await page.goto(LINK + '#demo')
  await expect(page.getByRole('button', { name: 'Déconnexion' }).first()).toBeVisible()
}

/** The button that opens the ticket wizard (its name follows the offer: « Programmer un ticket », « Carte mobilité… »). */
const wizardButton = (page: Page) =>
  page.getByRole('button', { name: /Programmer un ticket|Carte mobilité/ }).first()

test('sans lien : le site reste flouté, le lien se demande par e-mail', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Recevoir mon lien d’accès/ })).toBeVisible()
  await expect(page.getByLabel('Votre e-mail')).toBeVisible()
})

test('sans lien, déjà un compte : la connexion reste ouverte', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Déjà un compte').getByRole('link', { name: 'Se connecter' }).click()
  await expect(page.getByRole('button', { name: /Recevoir mon lien/ })).toBeHidden()
  await expect(page.locator('input[type=password]').first()).toBeVisible()
})

test('lien invalide : dit que le lien n’est pas valable', async ({ page }) => {
  await page.goto('/r/pasbon/')
  await expect(page.getByText(/n’est pas valable/)).toBeVisible()
})

test('lien privé : le rideau se lève sur le site', async ({ page }) => {
  await page.goto(LINK)
  await expect(page.getByText('Lien de parrainage reconnu', { exact: false })).toBeVisible()
  await expect(page.getByText(CURTAIN)).toBeHidden({ timeout: 5_000 })
  await expect(home(page)).toBeVisible()
})

test('compte démo : le tableau de bord montre les véhicules', async ({ page }) => {
  await demo(page)
  await expect(page.getByText('AB-123-CD').first()).toBeVisible()
})

test('déconnexion après un lien : l’accueil, pas le rideau « parrainage »', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Déconnexion' }).first().click()
  await expect(home(page)).toBeVisible()
  // The curtain would lift by itself after 2.5 s: checked at once, never waited for.
  await page.waitForTimeout(400)
  expect(await page.getByText(CURTAIN).count()).toBe(0)
})

test('programmer un ticket : véhicule choisi, zone de France reconnue', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await expect(zone).toHaveValue('69000')
  await expect(page.getByText('zone PayByPhone reconnue', { exact: false })).toBeVisible()
})

test('programmer un ticket : les tarifs visiteur sont proposés', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByText('Quel ticket prendre ?')).toBeVisible()
  await expect(page.getByRole('button', { name: /Visiteur/ }).first()).toBeVisible()
})

test('programmer un ticket : un tarif sans durées ni nom ne fait pas planter', async ({ page }) => {
  const rate = { type: 'Visitor', maxStayStatus: null, parkingNotAllowedReason: null }
  await page.route('**/api/rates*', (r) => r.fulfill({ json: [
    { ...rate, ratePolicyId: 'a', name: 'Visiteur', acceptedTimeUnits: null },
    { ...rate, ratePolicyId: 'b', name: null, acceptedTimeUnits: ['Hours'] },
  ] }))
  await demo(page)
  await wizardButton(page).click()
  const zone = page.getByRole('combobox')
  await zone.fill('923')
  await page.getByRole('option', { name: '92300' }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByText('Quel ticket prendre ?')).toBeVisible()
  await expect(page.getByText('Un problème est survenu')).toBeHidden()
})

test('programmer un ticket : à Paris, les dimanches ne se choisissent pas', async ({ page }) => {
  const label = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const now = new Date()
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const sunday = new Date(firstOfNext.getFullYear(), firstOfNext.getMonth(), 1 + ((7 - firstOfNext.getDay()) % 7))
  const pick = async (typed: string, option: RegExp) => {
    await wizardButton(page).click()
    const zone = page.getByRole('combobox')
    await zone.fill(typed)
    await page.getByRole('option', { name: option }).first().click()
    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: /Visiteur/ }).first().click()
    await page.getByRole('button', { name: 'Suivant' }).click()
    await page.getByRole('button', { name: 'Date spécifique' }).click()
    await page.getByRole('button', { name: 'Mois suivant' }).click()
  }
  await demo(page)
  await pick('690', /69000/)
  await expect(page.getByRole('button', { name: label(sunday), exact: true })).toBeEnabled()
  await page.reload()
  await pick('750', /Paris/)
  await expect(page.getByRole('button', { name: label(sunday), exact: true })).toBeDisabled()
})

test('programmer un ticket : une heure déjà passée est refusée', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await page.getByRole('button', { name: /Visiteur/ }).first().click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await page.getByRole('button', { name: 'Date spécifique' }).click()
  const label = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (yesterday.getMonth() === today.getMonth()) await expect(page.getByRole('button', { name: label(yesterday), exact: true })).toBeDisabled()
  await page.getByRole('button', { name: label(today), exact: true }).click()
  const time = page.locator('input[type=time]')
  const parisHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const nextHour = `${String((parisHour + 1) % 24).padStart(2, '0')}:00`
  await expect(time).toHaveValue(nextHour) // by default, the hour after this one
  await time.fill('00:00')
  await expect(page.getByText('Cette heure est déjà passée')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suivant', exact: true })).toBeDisabled()
  if (parisHour < 23) await expect(time).toHaveValue(nextHour) // put right after a moment
  await time.fill('23:59')
  await expect(page.getByText('Cette heure est déjà passée')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Suivant', exact: true })).toBeEnabled()
})

test('retour de paiement : un ticket programmé n’affiche pas « automatisé »', async ({ page }) => {
  await demo(page)
  await page.route('**/api/billing/confirm', (r) => r.fulfill({ json: { plan: 'monthly' } }))
  await page.route('**/api/autopilots', (r) => r.request().method() === 'POST' ? r.fulfill({ json: { activation: null } }) : r.fallback())
  await page.evaluate(() => localStorage.setItem('pbb-pending-renewals', JSON.stringify({ at: Date.now(), items: [{ plate: 'AB123CD', days: [0], location: '69000', rate: '102', duration: 1, unit: 'Hours', paymentAccountId: 'demo-card' }] })))
  await page.evaluate(() => { window.location.hash = '#session_id=cs_test' })
  await page.reload()
  await expect(page.getByText('Ticket programmé').first()).toBeVisible()
  await expect(page.getByText('Votre stationnement est désormais automatisé')).toBeHidden()
})

test('renouvellement résident : s’active depuis la carte du véhicule', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Activer le renouvellement automatique' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  // Under the switch: « Activé » or the next renewal, depending on the ticket.
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
})

test('mon compte : la carte bancaire et sa date de fin', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Mon compte' }).first().click()
  await expect(page.getByRole('dialog').getByText('Carte bancaire')).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/Visa •••• 4242 — exp\. \d\d\/\d\d/)).toBeVisible()
  const app = page.getByRole('dialog').getByRole('link', { name: 'Ouvrir PayByPhone' })
  await expect(app).toHaveAttribute('href', 'https://paybyphone.onelink.me/ZQkh/')
})

test('admin : les dates de fin des cartes des clients', async ({ page }) => {
  const client = (name: string, cards: unknown) => ({
    name, email: `${name}@test.fr`, created: '2026-10-01T10:00:00Z', plan: 'monthly', subscribed: true, price: 450,
    renewals: 1, vehicles: [{ plate: 'AB123CD', expire: new Date(Date.now() + 3 * 86_400_000).toISOString() }], cards,
  })
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString()
  const replies: Record<string, unknown> = {
    stats: { accounts: 3, accounts_7d: 0, accounts_30d: 3, renewals: 3, renewals_active: 3, renewals_paused: 0, renewals_error: 0, paid_7d: 0, signups_by_day: [] },
    clients: [
      client('sereine', [{ exp: '04/99', validUntil: '2099-04-30T23:59:59+00:00', expired: false }]),
      client('bientot', [{ exp: '12/26', validUntil: soon, expired: false }]),
      client('perimee', [{ exp: '01/20', validUntil: '2020-01-31T23:59:59+00:00', expired: true }]),
    ],
    activity: [],
    service: { interrupted: false, customers: 0 },
  }
  await page.route('**/api/admin/*', (route) => route.fulfill({ json: replies[new URL(route.request().url()).pathname.split('/').pop()!] ?? {} }))
  await page.goto(LINK + '#/admin')
  await expect(page.getByText('1 client avec carte expirée')).toBeVisible()
  await expect(page.getByText('1 carte à renouveler sous 60 jours')).toBeVisible()
  await page.getByRole('combobox', { name: 'Filtrer : Carte' }).selectOption('Expirée')
  await expect(page.getByText('01/20')).toBeVisible()
  await expect(page.getByText('04/99')).toBeHidden()
})

test('admin : connecter le compte de secours', async ({ page }) => {
  const stats = { accounts: 0, accounts_7d: 0, accounts_30d: 0, renewals: 0, renewals_active: 0, renewals_paused: 0, renewals_error: 0, paid_7d: 0, signups_by_day: [] }
  let sent: unknown = null
  await page.route('**/api/admin/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!
    if (name === 'backup-account' && route.request().method() === 'POST') {
      sent = route.request().postDataJSON()
      return route.fulfill({ json: { connected: true, label: '0612•••78', cards: ['Visa •••• 9385 — exp. 07/31'] } })
    }
    const replies: Record<string, unknown> = {
      stats, clients: [], activity: [],
      'backup-account': { connected: false, label: null, weekCents: 0, capCents: 30000 },
    }
    return route.fulfill({ json: replies[name] ?? {} })
  })
  await page.goto(LINK + '#/admin')
  await page.getByLabel('Identifiant du compte PayByPhone de secours').fill('0612345678')
  await page.getByLabel('Mot de passe du compte PayByPhone de secours').fill('secret')
  await page.getByRole('button', { name: 'Connecter', exact: true }).click()
  await expect(page.getByText(/Connecté : compte 0612•••78 · Visa •••• 9385/)).toBeVisible()
  expect(sent).toEqual({ login: '0612345678', password: 'secret' })
  await expect(page.getByLabel('Mot de passe du compte PayByPhone de secours')).toBeHidden()
})

test('lien de test : le petit ticket à payer s’ouvre', async ({ page }) => {
  await demo(page)
  await page.evaluate(() => { window.location.hash = '#/test-ticket' })
  await expect(page.getByRole('heading', { name: 'Quel véhicule ?' })).toBeVisible()
})

test('pages légales : les conditions d’utilisation s’ouvrent', async ({ page }) => {
  await page.goto(LINK + '#/cgu')
  await expect(page.getByRole('heading', { name: /Conditions/ }).first()).toBeVisible()
})

test('lien de validation : rien ne part à l’ouverture, seulement au bouton', async ({ page }) => {
  const asked: string[] = []
  await page.route('**/api/validate', (r) => {
    asked.push(r.request().postData() ?? '')
    return r.fulfill({ json: { status: 'done' } })
  })
  await page.goto('/#/valider?t=jeton')
  const button = page.getByRole('button', { name: 'Valider mon paiement' })
  await expect(button).toBeVisible()
  expect(asked).toEqual([])
  await button.click()
  await expect(page.getByRole('heading', { name: 'Rien à valider' })).toBeVisible()
  expect(asked).toEqual([JSON.stringify({ t: 'jeton' })])
})

test('alerte du téléphone : la validation part directement', async ({ page }) => {
  await page.route('**/api/validate', (r) => r.fulfill({ json: { status: 'paid' } }))
  await page.goto('/#/valider?t=jeton&go=1')
  await expect(page.getByRole('heading', { name: 'Paiement validé' })).toBeVisible()
})

test('mobile : le menu ☰ propose de se connecter', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'menu ☰ : téléphone seulement')
  await page.goto(LINK)
  await expect(page.getByText(CURTAIN)).toBeHidden({ timeout: 5_000 })
  await expect(page.getByRole('link', { name: 'Se connecter' }).or(page.getByRole('button', { name: 'Se connecter' })).first()).toBeVisible()
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await expect(page.getByRole('button', { name: 'Fermer le menu' })).toBeVisible()
})

test('aucune erreur dans la console sur les pages principales', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  await demo(page)
  await page.goto(LINK + '#/tarifs')
  await page.goto(LINK + '#/faq')
  expect(errors).toEqual([])
})
