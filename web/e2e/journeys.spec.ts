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

test('renouvellement résident : s’active depuis la carte du véhicule', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Activer le renouvellement automatique' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /^Activer le renouvellement/ }).click()
  await expect(page.getByText('Activé', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('switch', { name: /Renouvellement/ }).first()).toHaveAttribute('aria-checked', 'true')
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
