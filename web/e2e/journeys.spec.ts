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

/** Turns a switch on the way a person does: on its visible part (HeroUI's input itself is hidden). */
const press = (page: Page, name: string | RegExp) =>
  page.locator('[data-slot=switch-content]').filter({ has: page.getByRole('switch', { name }) }).first().click()

/** The hour field of the ticket wizard (HeroUI TimeField: one box for the hours, one for the minutes). */
const hourBoxes = (page: Page) => page.getByRole('group', { name: 'Heure de prise' }).getByRole('spinbutton')
async function setTime(page: Page, value: string) {
  const [h, m] = value.split(':')
  await hourBoxes(page).nth(0).click()
  await page.keyboard.type(h)
  await hourBoxes(page).nth(1).click()
  await page.keyboard.type(m)
}
const timeShown = async (page: Page) => (await hourBoxes(page).allInnerTexts()).map((t) => t.trim()).join(':')

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
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: 'Suivant' }).click() // the type (light by default), then the zone
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await expect(zone).toHaveValue('69000')
  await expect(page.getByText('zone PayByPhone reconnue', { exact: false })).toBeVisible()
})

test('sans voiture résidente ni ticket : une carte par voiture, l’interrupteur ouvre le programme', async ({ page }) => {
  const noResident = (v: { plate: string }) => !/AB.?123/.test(v.plate)
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json }) // not signed in yet
    await route.fulfill({ json: { ...json, vehicles: json.vehicles.filter(noResident), sessions: [], autopilots: [] } })
  })
  await page.route('**/api/pricing', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    await route.fulfill({ json: { ...json, zone: null, vehicles: (json.vehicles ?? []).filter(noResident).map((v: object) => ({ ...v, zone: null })) } })
  })
  await demo(page)
  await page.keyboard.press('Escape') // the wizard opens by itself on a first visit without a resident car
  await expect(page.getByText('Non couvert')).toHaveCount(2)
  await press(page, /LM.?789.?NP/)
  await expect(page.getByText(/Étape 1 sur 5/)).toBeVisible()
  await expect(page.getByRole('button', { name: /LM-789-NP/ })).toHaveAttribute('aria-pressed', 'true')
})

/** The demo account with one resident ticket running on AB-123-CD, and only the cars kept by `keep`. */
async function oneTicket(page: Page, keep: (v: { plate: string }) => boolean) {
  const ticket = {
    id: 'e2e-ticket', location: '75105', plate: 'AB123CD', start: new Date().toISOString(),
    expire: new Date(Date.now() + 3 * 86_400_000).toISOString(), rate: '101', resident: true,
    cost: { amount: 9.5, currency: 'EUR' }, stoppable: false, stopped: false,
  }
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    await route.fulfill({ json: { ...json, vehicles: json.vehicles.filter(keep), sessions: [ticket] } })
  })
}

test('tableau de bord : le gros bouton « Programmer un stationnement » ouvre l’assistant', async ({ page }) => {
  await oneTicket(page, (v) => /AB.?123.?CD/.test(v.plate))
  await demo(page)
  await expect(page.getByRole('button', { name: 'Renouveler un autre véhicule' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Programmer un stationnement' }).click()
  await expect(page.getByRole('dialog').getByText(/Étape 1 sur/)).toBeVisible()
})

test('un seul véhicule, résident et déjà renouvelé : aucun bouton qui mène à une impasse', async ({ page }) => {
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    await route.fulfill({ json: { ...json, vehicles: json.vehicles.filter((v: { plate: string }) => /AB.?123.?CD/.test(v.plate)) } })
  })
  await demo(page)
  await press(page, /Renouvellement/)
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toBeChecked({ timeout: 15_000 })
  // Nothing left to programme: neither the big button nor the top bar's.
  await expect(page.getByRole('button', { name: 'Programmer un stationnement' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Programmer un ticket' })).toHaveCount(0)
})

test('assistant : une voiture résidente déjà renouvelée se voit, mais ne se choisit pas', async ({ page }) => {
  await demo(page)
  await press(page, /Renouvellement/)
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toBeChecked({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Programmer un stationnement' }).click()
  const wizard = page.getByRole('dialog')
  await expect(wizard.getByRole('button', { name: /AB-123-CD/ })).toBeDisabled()
  await expect(wizard.getByText('Déjà renouvelé')).toBeVisible()
  await expect(wizard.getByRole('button', { name: /GH-456-JK/ })).toHaveAttribute('aria-pressed', 'true')
})

test('sans abonnement : « Programmer un ticket » ouvert avant le tarif résident n’est pas recouvert par le renouvellement', async ({ page }) => {
  // Online, no subscription yet, a resident car without renewal: once its resident rate is known, its renewal opens
  // by itself. The owner clicked « Programmer un ticket » before that: the wizard stays, nothing opens over it.
  for (const url of ['**/api/me', '**/api/login'])
    await page.route(url, async (route) => {
      const answer = await route.fetch()
      const json = await answer.json()
      await route.fulfill({ response: answer, json: json.username ? { ...json, demo: false, hosted: true } : json })
    })
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { email: 'a@b.fr', zone: '75105', subscribed: false, trialEnd: new Date(Date.now() + 16 * 86_400_000).toISOString() } }),
  )
  let release = () => {}
  const priced = new Promise<void>((r) => (release = r))
  await page.route('**/api/pricing', async (route) => {
    const answer = await route.fetch()
    await priced // the resident rate arrives late
    await route.fulfill({ response: answer })
  })
  await page.goto(LINK + '#demo')
  await page.getByRole('button', { name: 'Programmer un ticket' }).first().click()
  await expect(page.getByRole('dialog').getByText('Pris automatiquement les jours choisis')).toBeVisible()
  release()
  await page.waitForResponse('**/api/pricing')
  await page.waitForTimeout(800)
  await expect(page.getByRole('dialog').getByText('Pris automatiquement les jours choisis')).toBeVisible()
  await expect(page.getByText('Renouvellement hebdomadaire')).toHaveCount(0)
})

test('accueil : activer l’interrupteur de l’exemple mène à l’inscription', async ({ page }) => {
  await page.goto(LINK)
  await expect(home(page)).toBeVisible()
  const sample = page.getByRole('switch', { name: 'Activer le renouvellement automatique' })
  await expect(sample).not.toBeChecked()
  await press(page, 'Activer le renouvellement automatique')
  await expect(page).toHaveURL(/#\/inscription/)
  // The same card beside the sign-up and sign-in forms is a picture: nothing to press.
  await expect(page.getByRole('switch', { name: 'Activer le renouvellement automatique' })).toHaveCount(0)
})

test('inscription : le code à 6 chiffres se colle d’un coup et se vérifie seul', async ({ page }) => {
  await page.route('**/api/login', (r) => r.fulfill({ json: { pending: true, email: 'a@b.fr' } }))
  const verified: string[] = []
  await page.route('**/api/signup/verify', (r) => {
    verified.push(JSON.parse(r.request().postData() ?? '{}').code)
    return r.fulfill({ status: 400, json: { detail: 'Code incorrect.' } })
  })
  await page.goto(LINK + '#/inscription')
  await page.getByPlaceholder('Numéro PayByPhone').fill('612345678')
  await page.getByPlaceholder('Votre e-mail').fill('a@b.fr')
  await page.getByPlaceholder('Mot de passe PayByPhone').fill('secret')
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: /Continuer/ }).click()
  await expect(page.getByRole('heading', { name: 'Vérifiez votre e-mail' })).toBeVisible()
  await page.getByLabel('Code à 6 chiffres').fill('123456')
  await expect.poll(() => verified).toEqual(['123456'])
})

test('inscription : le code copié depuis l’e-mail se colle (Ctrl+V), même avec espace ou retour à la ligne', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'presse-papiers réel : Chromium')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/api/login', (r) => r.fulfill({ json: { pending: true, email: 'a@b.fr' } }))
  const verified: string[] = []
  await page.route('**/api/signup/verify', (r) => {
    verified.push(JSON.parse(r.request().postData() ?? '{}').code)
    return r.fulfill({ status: 400, json: { detail: 'Code incorrect.' } })
  })
  await page.goto(LINK + '#/inscription')
  await page.getByPlaceholder('Numéro PayByPhone').fill('612345678')
  await page.getByPlaceholder('Votre e-mail').fill('a@b.fr')
  await page.getByPlaceholder('Mot de passe PayByPhone').fill('secret')
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: /Continuer/ }).click()
  await expect(page.getByRole('heading', { name: 'Vérifiez votre e-mail' })).toBeVisible()
  // As copied from the e-mail: a space in the middle, a line break after.
  await page.evaluate(() => navigator.clipboard.writeText(' 123 456\n'))
  await page.getByLabel('Code à 6 chiffres').focus()
  await page.keyboard.press('ControlOrMeta+V')
  await expect.poll(() => verified).toEqual(['123456'])
})

test('inscription : « Continuer » avec des infos manquantes les encadre en rouge, sans rien envoyer', async ({ page }) => {
  let sent = 0
  await page.route('**/api/login', (r) => (sent++, r.fulfill({ json: { pending: true, email: 'a@b.fr' } })))
  await page.goto(LINK + '#/inscription')
  await page.getByPlaceholder('Numéro PayByPhone').fill('612345678')
  await page.getByPlaceholder('Votre e-mail').fill('a@b.fr')
  // No password, the terms not ticked: the button can still be pressed, and says what is missing.
  await page.getByRole('button', { name: /Continuer/ }).click()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('checkbox').first()).toHaveAttribute('aria-invalid', 'true')
  expect(sent).toBe(0)
  // Each one goes back to normal once filled in.
  await page.getByPlaceholder('Mot de passe PayByPhone').fill('secret')
  await expect(page.getByLabel('Mot de passe', { exact: true })).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('checkbox').first().check()
  await expect(page.getByRole('checkbox').first()).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: /Continuer/ }).click()
  await expect.poll(() => sent).toBe(1)
})

test('connexion sans compte puis « S’inscrire » : le message de la connexion ne suit pas sur l’inscription', async ({ page }) => {
  await page.route('**/api/login', (r) => r.fulfill({ status: 404, json: { detail: 'Aucun compte PayByBot pour ce compte PayByPhone.' } }))
  await page.goto(LINK + '#/connexion')
  await page.getByPlaceholder('Numéro PayByPhone').fill('612345678')
  await page.getByPlaceholder('Mot de passe PayByPhone').fill('secret')
  await page.getByRole('button', { name: 'Se connecter' }).last().click()
  const notice = page.getByText(/Aucun compte PayByBot/)
  await expect(notice).toBeVisible()
  await page.getByRole('alert').getByRole('link', { name: 'S\'inscrire' }).click()
  await expect(page).toHaveURL(/#\/inscription/)
  await expect(page.getByRole('button', { name: /Continuer/ })).toBeVisible()
  await expect(notice).toHaveCount(0)
  // What was typed stays: no need to type it again.
  await expect(page.getByPlaceholder('Numéro PayByPhone')).toHaveValue('612345678')
})

test('pause : le calendrier ne propose pas les jours passés', async ({ page }) => {
  await demo(page)
  await press(page, /Renouvellement/)
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toBeChecked({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Pause' }).first().click()
  await page.getByRole('button', { name: /Premier jour : ouvrir le calendrier/ }).click()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (yesterday.getMonth() === new Date().getMonth()) {
    const cell = page.getByRole('gridcell').filter({ hasText: new RegExp(`^${yesterday.getDate()}$`) }).first()
    await expect(cell).toHaveAttribute('aria-disabled', 'true')
  }
})

test('renouvellement : l’éteindre demande confirmation, « Annuler » le laisse actif', async ({ page }) => {
  await demo(page)
  await press(page, /Renouvellement/)
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  const renewal = page.getByRole('switch', { name: /Renouvellement/ }).first()
  await expect(renewal).toBeChecked({ timeout: 15_000 })
  await press(page, /Renouvellement/)
  const ask = page.getByRole('alertdialog')
  await expect(ask.getByText('Arrêter le renouvellement ?')).toBeVisible()
  await ask.getByRole('button', { name: 'Annuler' }).click()
  await expect(ask).toHaveCount(0)
  await expect(renewal).toBeChecked()
})

test('impasses : compte sans véhicule, une carte claire au lieu de fenêtres vides', async ({ page }) => {
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    await route.fulfill({ json: { ...json, vehicles: [], sessions: [], autopilots: [] } })
  })
  await demo(page)
  await expect(page.getByText(/Aucun véhicule sur votre compte/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rafraîchir' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Programmer un stationnement' })).toHaveCount(0)
})

test('impasses : carte expirée, l’assistant le dit dès le choix du véhicule', async ({ page }) => {
  await page.route('**/api/overview', async (route) => {
    const r = await route.fetch()
    const json = await r.json()
    if (json.payments) json.payments = json.payments.map((p: { kind: string }) => (p.kind === 'card' ? { ...p, expired: true } : p))
    await route.fulfill({ response: r, json })
  })
  await demo(page)
  await page.getByRole('button', { name: 'Programmer un stationnement' }).click()
  const wizard = page.getByRole('dialog')
  await expect(wizard.getByText('Votre carte bancaire PayByPhone a expiré.', { exact: false })).toBeVisible()
  await expect(wizard.getByRole('button', { name: 'Suivant', exact: true })).toBeDisabled()
})

test('impasses : la page « Valider mon paiement » sans son lien explique quoi faire', async ({ page }) => {
  await page.goto(LINK + '#/valider')
  await expect(page.getByRole('heading', { name: 'Lien incomplet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ouvrir PayByBot' })).toBeVisible()
})

test('impasses : la page de bienvenue permet de se déconnecter', async ({ page }) => {
  await demo(page)
  await page.goto(LINK + '#/bienvenue')
  // The card PayByPhone pays with is always shown there.
  await expect(page.getByText('Visa •••• 4242')).toBeVisible()
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0)
})

test('bienvenue sans carte bancaire valide : croix rouge, on ne passe pas', async ({ page }) => {
  let payments: object[] = [{ id: 'c1', label: 'Visa •••• 4242 — exp. 10/26', kind: 'card', expired: true }]
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    await route.fulfill({ json: { ...json, payments } })
  })
  await demo(page)
  await page.goto('/#/bienvenue')
  const next = page.getByRole('button', { name: /C’est bien moi/ })
  await expect(page.getByText(/Carte expirée/)).toBeVisible()
  await expect(page.getByText(/Apple Pay, Google Pay et PayPal/)).toBeVisible()
  await expect(next).toBeDisabled()
  payments = [{ id: 'c2', label: 'Visa •••• 1111 — exp. 04/29', kind: 'card' }]
  await page.getByRole('button', { name: 'Rafraîchir' }).click()
  await expect(next).toBeEnabled()
  // The card just added is shown.
  await expect(page.getByText('Visa •••• 1111')).toBeVisible()
})

test('programmer un ticket : une voiture résidente mène au renouvellement de la semaine', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  await page.getByRole('button', { name: /AB-123-CD/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByText('Renouvellement hebdomadaire')).toBeVisible()
  await expect(page.getByText('Type de véhicule')).toBeHidden()
  await page.getByRole('button', { name: 'Précédent' }).click() // back to the vehicle, still the one chosen
  await expect(page.getByText(/Étape 1 sur 5/)).toBeVisible()
  await expect(page.getByRole('button', { name: /AB-123-CD/ })).toHaveAttribute('aria-pressed', 'true')
})

test('programmer un ticket : le type de véhicule choisit le tarif visiteur', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: /Véhicule lourd/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  const zone = page.getByRole('combobox')
  await zone.fill('750')
  await page.getByRole('option', { name: /Paris/ }).first().click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  // Straight to the days: the heavy visitor rate, 6 hours in Paris at three times the light price.
  await expect(page.getByText('Prix d’un ticket')).toBeVisible()
  await expect(page.getByText('72,00 €').first()).toBeVisible()
})

test('programmer un ticket : carte mobilité CMI-S, « Tous » coche tout Paris', async ({ page }) => {
  await demo(page)
  await wizardButton(page).click()
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: /Carte mobilité CMI-S/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByRole('combobox')).toHaveCount(0) // no zone asked
  await expect(page.getByRole('button', { name: '5e', exact: true })).toHaveAttribute('aria-pressed', 'false') // none by default
  await page.getByRole('checkbox', { name: 'Tous' }).check()
  await expect(page.getByText('Arrondissements couverts · tout Paris')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suivant' })).toBeDisabled() // the card attestation first
  await page.getByRole('checkbox', { name: /titulaire/ }).check()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await expect(page.getByText(/ticket carte mobilité CMI-S d’une journée/)).toBeVisible()
})

test('programmer un ticket : un tarif sans durées ni nom ne fait pas planter', async ({ page }) => {
  const rate = { type: 'Visitor', maxStayStatus: null, parkingNotAllowedReason: null }
  await page.route('**/api/rates*', (r) => r.fulfill({ json: [
    { ...rate, ratePolicyId: 'a', name: 'Visiteur', acceptedTimeUnits: null },
    { ...rate, ratePolicyId: 'b', name: null, acceptedTimeUnits: ['Hours'] },
  ] }))
  await demo(page)
  await wizardButton(page).click()
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: 'Suivant' }).click() // the type (light by default), then the zone
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
    await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
    await page.getByRole('button', { name: 'Suivant' }).click() // the type (light by default), then the zone
    const zone = page.getByRole('combobox')
    await zone.fill(typed)
    await page.getByRole('option', { name: option }).first().click()
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
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: 'Suivant' }).click() // the type (light by default), then the zone
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await page.getByRole('button', { name: 'Date spécifique' }).click()
  const label = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (yesterday.getMonth() === today.getMonth()) await expect(page.getByRole('button', { name: label(yesterday), exact: true })).toBeDisabled()
  await page.getByRole('button', { name: label(today), exact: true }).click()
  const parisHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const nextHour = `${String((parisHour + 1) % 24).padStart(2, '0')}:00`
  await expect.poll(() => timeShown(page)).toBe(nextHour) // by default, the hour after this one
  await setTime(page, '00:00')
  await expect(page.getByText('Cette heure est déjà passée')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suivant', exact: true })).toBeDisabled()
  if (parisHour < 23) await expect.poll(() => timeShown(page)).toBe(nextHour) // put right after a moment
  await setTime(page, '23:59')
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
  await press(page, /Renouvellement/) // the switch alone, off, opens it
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  // Under the switch: « Activé » or the next renewal, depending on the ticket.
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toBeChecked({ timeout: 15_000 })
})

test('mon compte : la carte bancaire et sa date de fin', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Mon compte' }).first().click()
  await expect(page.getByRole('dialog').getByText('Carte bancaire')).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/Visa •••• 4242 — exp\. \d\d\/\d\d/)).toBeVisible()
  const app = page.getByRole('dialog').getByRole('link', { name: 'PayByPhone', exact: true })
  await expect(app).toHaveAttribute('href', 'https://paybyphone.onelink.me/ZQkh/')
})

test('mon compte : les véhicules sans prix ni choix à faire', async ({ page }) => {
  const vehicle = (plate: string) => ({ plate, zone: '75105', monthly: 950, yearly: 9120, renewed: false })
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { email: 'a@b.fr', zone: '75105', plan: 'yearly', subscribed: true } }),
  )
  await page.route('**/api/pricing', (route) =>
    route.fulfill({ json: { zone: '75105', monthly: 950, yearly: 9120, billing: true, billed: ['AB-123-CD', 'GH-456-JK', 'LM-789-NP'],
      vehicles: [vehicle('AB-123-CD'), vehicle('GH-456-JK'), vehicle('LM-789-NP')] } }),
  )
  await demo(page)
  await page.getByRole('button', { name: 'Mon compte' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Paiement et contact')).toBeVisible()
  await expect(dialog.getByText(/€/)).toHaveCount(0) // no price here, per vehicle or otherwise
  await expect(dialog.getByRole('switch')).toHaveCount(0)
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
})

test('programmer un ticket : un seul véhicule à la fois, sans paiement en plus', async ({ page }) => {
  const programmed: string[] = []
  const vehicle = (plate: string) => ({ plate, zone: null, monthly: 950, yearly: 9120, renewed: false })
  await page.route('**/api/pricing', (route) =>
    route.fulfill({ json: { zone: null, monthly: 950, yearly: 9120, billing: true, billed: ['AB-123-CD', 'GH-456-JK', 'LM-789-NP'],
      vehicles: [vehicle('AB-123-CD'), vehicle('GH-456-JK'), vehicle('LM-789-NP')] } }),
  )
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/autopilots') && programmed.push(r.postDataJSON().plate))
  await demo(page)
  await wizardButton(page).click()
  await page.getByRole('button', { name: /AB-123-CD/ }).click()
  await page.getByRole('button', { name: /GH-456-JK/ }).click()
  await expect(page.getByRole('button', { name: /GH-456-JK/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /AB-123-CD/ })).toHaveAttribute('aria-pressed', 'false') // one at a time
  await page.getByRole('button', { name: 'Suivant' }).click() // the vehicle, then its type
  await page.getByRole('button', { name: 'Suivant' }).click() // the type (light by default), then the zone
  const zone = page.getByRole('combobox')
  await zone.fill('690')
  await page.getByRole('option', { name: /69000/ }).click()
  await page.getByRole('button', { name: 'Suivant' }).click()
  await page.getByRole('button', { name: 'Date spécifique' }).click()
  await page.getByRole('button', { name: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), exact: true }).click()
  await setTime(page, '23:59')
  await page.getByRole('button', { name: 'Suivant', exact: true }).click()
  await page.getByRole('button', { name: 'Activer' }).click()
  await expect.poll(() => programmed.length).toBe(1)
  expect(programmed.map((p) => p.replace(/[^0-9A-Z]/gi, ''))).toEqual(['GH456JK'])
  await expect(page.getByText('Votre abonnement', { exact: true })).toBeHidden()
})

test('admin : les dates de fin des cartes des clients', async ({ page }) => {
  const client = (name: string, cards: unknown) => ({
    name, email: `${name}@test.fr`, created: '2026-10-01T10:00:00Z', plan: 'monthly', subscribed: true, price: 450,
    renewals: 1, vehicles: [{ plate: 'AB123CD', expire: new Date(Date.now() + 3 * 86_400_000).toISOString(), resident: '75005', covered: true, renewal: 'Suspendu' }], cards,
  })
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString()
  const replies: Record<string, unknown> = {
    stats: { accounts: 3, accounts_7d: 0, accounts_30d: 3, renewals: 3, renewals_active: 3, renewals_paused: 0, renewals_error: 0, paid_7d: 0, signups_by_day: [] },
    clients: [
      client('sereine', [{ exp: '04/99', validUntil: '2099-04-30T23:59:59+00:00', expired: false }]),
      client('bientot', [{ exp: '12/26', validUntil: soon, expired: false }]),
      client('perimee', [{ exp: '01/20', validUntil: '2020-01-31T23:59:59+00:00', expired: true }]),
      // No ticket and nothing failed: not a problem. A refused renewal: one.
      { ...client('sansticket', [{ exp: '04/99', validUntil: '2099-04-30T23:59:59+00:00', expired: false }]),
        vehicles: [{ plate: 'GH456JK', expire: null, resident: '75005', covered: true, renewal: null }] },
      { ...client('refuse', [{ exp: '04/99', validUntil: '2099-04-30T23:59:59+00:00', expired: false }]),
        vehicles: [{ plate: 'LM789NP', expire: null, resident: '75005', covered: true, renewal: 'Suspendu', failure: 'Carte refusée par la banque.' }] },
    ],
    activity: [],
    service: { interrupted: false, customers: 0 },
  }
  await page.route('**/api/admin/*', (route) => route.fulfill({ json: replies[new URL(route.request().url()).pathname.split('/').pop()!] ?? {} }))
  await page.goto(LINK + '#/admin')
  // The overview alone first: the other sections open from « Pilotage ».
  await expect(page.getByText('Revenu mensuel récurrent')).toBeVisible()
  await expect(page.getByText('1 client avec carte expirée')).toBeHidden()
  await page.getByRole('button', { name: /^À traiter/ }).click()
  await expect(page.getByText('1 client avec carte expirée')).toBeVisible()
  await expect(page.getByText('1 carte à renouveler sous 60 jours')).toBeVisible()
  await expect(page.getByText('1 client avec un échec PayByBot')).toBeVisible()
  await page.getByRole('button', { name: /^Clients/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'sansticket' }).getByText('Problème')).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'refuse@' }).getByText('Problème')).toBeVisible()
  await expect(page.getByText('Carte refusée par la banque.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Paris 5e' }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Suspendu' }).first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Filtrer : Carte' }).selectOption('Expirée')
  await expect(page.getByText('01/20')).toBeVisible()
  await expect(page.getByText('04/99')).toBeHidden()
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

test('carte bancaire qui expire ce mois-ci : bannière rouge, partie avec une carte renouvelée', async ({ page }) => {
  const now = new Date()
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59).toISOString()
  const later = new Date(now.getFullYear() + 2, 0, 31).toISOString()
  let validUntil = endOfMonth
  await page.route('**/api/overview', async (route) => {
    const r = await route.fetch()
    const json = await r.json()
    if (json.payments) json.payments = json.payments.map((p: { kind: string }) => (p.kind === 'card' ? { ...p, validUntil, expired: false } : p))
    await route.fulfill({ response: r, json })
  })
  await demo(page)
  await expect(page.getByRole('alert').filter({ hasText: 'expire ce mois-ci' })).toBeVisible()
  validUntil = later // renewed in PayByPhone: the next refresh drops the banner
  await page.reload()
  await expect(page.getByText('Votre stationnement', { exact: false }).or(page.getByText('Vos tickets', { exact: false })).first()).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'expire ce mois-ci' })).toHaveCount(0)
})


test.describe('téléphone réglé sur une autre heure que Paris', () => {
  test.use({ timezoneId: 'Asia/Jerusalem' }) // Paris + 1 h in winter

  test('la fin du ticket s’affiche à l’heure de Paris', async ({ page }) => {
    const ticket = {
      id: 'e2e-ticket', location: '75105', plate: 'AB123CD', start: '2026-12-08T11:00:00Z',
      // 12h in Paris (UTC+1 in December), 13h in Jerusalem
      expire: '2026-12-15T11:00:00Z', rate: '101', resident: true,
      cost: { amount: 9.5, currency: 'EUR' }, stoppable: false, stopped: false,
    }
    await page.route('**/api/overview', async (route) => {
      const answer = await route.fetch()
      const json = await answer.json()
      if (!json.vehicles) return route.fulfill({ response: answer, json })
      await route.fulfill({ json: { ...json, sessions: [ticket] } })
    })
    await demo(page)
    await expect(page.getByText(/Couvert jusqu’au mardi 15 décembre, 12h/)).toBeVisible()
  })
})

test('impasses : arrêter le renouvellement juste après la bienvenue ne rouvre pas la fenêtre', async ({ page }) => {
  await demo(page)
  await page.goto(LINK + '#/bienvenue')
  await page.getByRole('button', { name: /C’est bien moi/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  const renewal = page.getByRole('switch', { name: /Renouvellement/ }).first()
  await expect(renewal).toBeChecked({ timeout: 15_000 })
  await press(page, /Renouvellement/)
  const ask = page.getByRole('alertdialog')
  await ask.getByRole('button', { name: 'Arrêter le renouvellement' }).click()
  await expect(page.getByText('Renouvellement arrêté.')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('un seul véhicule résident renouvelé : « Programmer un stationnement » n’apparaît jamais, même le temps du chargement', async ({ page }) => {
  await page.route('**/api/overview', async (route) => {
    const answer = await route.fetch()
    const json = await answer.json()
    if (!json.vehicles) return route.fulfill({ response: answer, json })
    // As on a real account: the running ticket does not say « resident » (only the tariffs do).
    const sessions = json.sessions.map((x: object) => ({ ...x, resident: null }))
    await route.fulfill({ json: { ...json, vehicles: json.vehicles.slice(0, 1), sessions } })
  })
  await demo(page)
  await press(page, /Renouvellement/)
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toBeChecked({ timeout: 15_000 })
  // Back later in a new tab: the tariffs (which say which car is resident) answer 3 seconds after the page.
  await page.route('**/api/pricing', async (route) => {
    await new Promise((r) => setTimeout(r, 3000))
    await route.continue()
  })
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  // Watched every 100 ms while the tariffs are on their way: never there.
  let shown = 0
  for (let i = 0; i < 40; i++) {
    shown += await page.getByRole('button', { name: 'Programmer un stationnement' }).count()
    await page.waitForTimeout(100)
  }
  expect(shown).toBe(0)
  await expect(page.getByText('Renouvellement auto').first()).toBeVisible()
  await page.waitForTimeout(3500)
  await expect(page.getByRole('button', { name: 'Programmer un stationnement' })).toHaveCount(0)
})
