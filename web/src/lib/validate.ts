/** Typed identifiers checked before sending: an e-mail in a valid format (and not a typo of a common provider),
 *  a French phone number. The server checks the same (paybybot3/web.py, email_problem / phone_problem). */

const EMAIL_FORMAT = /^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/

/** The common providers and their domains. `null`: any .com or country domain (hotmail.be, yahoo.co.uk…). */
const PROVIDERS: Record<string, string[] | null> = {
  gmail: ['gmail.com'],
  googlemail: ['googlemail.com'],
  icloud: ['icloud.com'],
  laposte: ['laposte.net'],
  orange: ['orange.fr'],
  wanadoo: ['wanadoo.fr'],
  free: ['free.fr'],
  sfr: ['sfr.fr'],
  neuf: ['neuf.fr'],
  bbox: ['bbox.fr'],
  protonmail: ['protonmail.com', 'protonmail.ch'],
  hotmail: null,
  outlook: null,
  live: null,
  yahoo: null,
}
/** What a domain of one of the `null` providers looks like: .com, or a country (with its .co./.com. if any). */
const ANY_COUNTRY = /^(com|(co\.|com\.)?[a-z]{2})$/

/** Damerau-Levenshtein distance, up to 2 (enough to spot a slip of the finger). */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

/** The domain the person most likely meant, when theirs is a typo of a common provider's; null otherwise. */
export function domainFix(domain: string): string | null {
  const host = domain.toLowerCase()
  const dot = host.indexOf('.')
  if (dot < 1) return null
  const label = host.slice(0, dot)
  const rest = host.slice(dot + 1)
  // The provider typed right, the end wrong (gmail.comm, orange.fe), or the provider mistyped (gmial.com).
  const provider =
    label in PROVIDERS
      ? label
      : label.length >= 5 && label !== 'email'
        ? (Object.keys(PROVIDERS).find((p) => p.length >= 5 && distance(label, p) === 1) ?? null)
        : null
  if (!provider) return null
  const domains = PROVIDERS[provider]
  if (domains) {
    if (domains.includes(host)) return null
    return domains.find((d) => distance(d.slice(d.indexOf('.') + 1), rest) <= 2) ?? domains[0]
  }
  if (provider === label && ANY_COUNTRY.test(rest)) return null
  // A mistyped name with a fine ending keeps it; a mistyped ending becomes .com or .fr, the closest.
  return provider + '.' + (ANY_COUNTRY.test(rest) ? rest : distance(rest, 'fr') < distance(rest, 'com') ? 'fr' : 'com')
}

/** What is wrong with an e-mail, to show under the form; null when it looks right. */
export function emailProblem(email: string): string | null {
  const value = email.trim()
  if (!EMAIL_FORMAT.test(value)) return 'Adresse e-mail invalide : vérifiez-la (exemple : prenom.nom@gmail.com).'
  const at = value.lastIndexOf('@')
  const fix = domainFix(value.slice(at + 1))
  return fix ? `Adresse e-mail invalide : vouliez-vous dire ${value.slice(0, at)}@${fix} ?` : null
}

/** A French number, typed with or without its 0 or +33: the 9 digits after +33, or null when it is not one. */
export function frenchDigits(phone: string): string | null {
  const raw = phone.trim()
  let digits = raw.replace(/[\s.\-()]/g, '')
  if (digits.startsWith('+33')) digits = digits.slice(3)
  else if (digits.startsWith('0033')) digits = digits.slice(4)
  else if (digits.startsWith('+')) return null
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[1-9]\d{8}$/.test(digits) ? digits : null
}

export function phoneProblem(phone: string): string | null {
  return frenchDigits(phone) ? null : 'Numéro invalide : un numéro français à 10 chiffres (exemple : 06 12 34 56 78).'
}
