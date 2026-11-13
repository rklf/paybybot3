/** The legal pages and their hash (#/cgu…): kept apart from Legal.tsx so the app knows them without loading
 *  the pages themselves (loaded only when one is opened). */
export type LegalPage = 'securite' | 'confidentialite' | 'cgu' | 'mentions-legales'

export const LEGAL_PAGES: { id: LegalPage; label: string }[] = [
  { id: 'securite', label: 'Sécurité et données' },
  { id: 'confidentialite', label: 'Confidentialité' },
  { id: 'cgu', label: "Conditions d'utilisation" },
  { id: 'mentions-legales', label: 'Mentions légales' },
]

export function legalPageFromHash(hash: string): LegalPage | null {
  const id = hash.replace(/^#\/?/, '').split('?')[0]
  return LEGAL_PAGES.some((p) => p.id === id) ? (id as LegalPage) : null
}
