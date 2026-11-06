
export type Money = { amount: number; currency: string }

export type Vehicle = { plate: string; country?: string; type?: string; zone?: string | null }
export type PaymentMethod = { id: string; label: string; kind: 'card' | 'phone' | 'paypal'; validUntil?: string | null; expired?: boolean }
export type Session = {
  id: string
  location: string
  plate: string
  start: string
  expire: string
  rate: string
  /** A resident ticket (the weekly renewal is only for these); null when PayByPhone does not say. */
  resident?: boolean | null
  cost?: Money
  /** PayByPhone lets it be stopped now (« Arrêter » in its app). */
  stoppable?: boolean
  /** A non-resident ticket's kind: « Véhicule léger », « Véhicule lourd » or « Carte mobilité CMI-S ». */
  kind?: string | null
  /** Stopped (« Arrêter »): not running any more, though PayByPhone keeps it, blocking its zone, until its end. */
  stopped?: boolean
}
export type Unit = 'Days' | 'Hours' | 'Minutes'
export type Rate = {
  name: string
  type: string
  ratePolicyId: string
  acceptedTimeUnits: Unit[]
  parkingNotAllowedReason: string | null
}
export type Parking = {
  location: string
  rate: string
  duration: number
  unit: Unit
  plate: string
  paymentAccountId: string
}
/** What activating a weekly renewal did (first week paid, ticket extended, or paid the day before its end), in the
 *  words of the activation e-mail. */
export type Activation = { title: string; text: string; payYourself: string; failed?: boolean }

export type Autopilot = Parking & {
  id: string
  label: string
  enabled: boolean
  lastCheck: string | null
  lastPayment: string | null
  /** When the server looks at this renewal next (online only): the next payment, or a retry. */
  nextCheck?: string | null
  lastError: string | null
  /** The bank waits for a validation: the signed token of « Valider mon paiement ». */
  validate?: string | null
  email?: string
  pausedFrom?: string | null
  pausedUntil?: string | null
  /** Handi in Paris: the arrondissements covered at the same time, one free ticket in each. */
  locations?: string[] | null
  /** A CMI-S (Handi) ticket: the holder ticked the card attestation. */
  cmis?: boolean
  /** Its ticket is due now (today's window, not paid yet): an open page takes it at once. */
  due?: boolean
}
export type HistoryItem = { at: string; kind: 'success' | 'error'; message: string }
export type Overview = {
  vehicles: Vehicle[]
  payments: PaymentMethod[]
  sessions: Session[]
  autopilots: Autopilot[]
  history: HistoryItem[]
}
/** Sign-up waiting for the 6-digit code sent to the e-mail. */
export type SignupPending = { pending: true; email: string }
export const isPending = (x: Me | SignupPending): x is SignupPending => 'pending' in x

/** The PayByBot account: e-mail given at sign-up, home zone added by hand. */
export type Account = {
  email: string
  zone: string | null
  trialEnd?: string | null
  /** The free month not started yet: its length, from the day the offer is chosen. */
  trialDays?: number | null
  plan?: string | null
  /** 'grace': a charge was refused, renewals go on until graceEnd. Renewals stop while blocked: 'unpaid' (still not
   *  paid after the grace week) or 'trialOver' (no subscription). */
  blocked?: 'grace' | 'unpaid' | 'trialOver' | null
  graceEnd?: string | null
  /** A subscription is running: needed to activate a renewal, even during the free month. */
  subscribed?: boolean
  /** Plates the user ticked as SUV (PayByPhone does not say): the SUV price applies. */
  suvPlates?: string[]
}
/** « Mon abonnement »: the Stripe subscription as PayByBot shows it (amounts in cents). */
export type Subscription = {
  plan: 'monthly' | 'yearly'
  amount: number | null
  status: string
  nextBilling: string | null
  cancelAtPeriodEnd: boolean
  card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null
  invoices: { date: string; amount: number | null; status: string; url: string | null }[]
}
export type Me = { username: string; demo: boolean; hosted?: boolean; firstName?: string | null }

/** The account's prices in cents, by vehicle type and zone: per month, and per year with 20 % off (zone null: unknown). */
export type Pricing = {
  zone: string | null
  monthly: number | null
  yearly: number | null
  /** Resident status active on PayByPhone in the home zone (null while the zone is unknown). */
  resident?: boolean | null
  /** The « riverain » vehicles (a resident rate in the home zone), one price each. */
  vehicles?: PricedVehicle[]
  /** Plates the subscription is for: those with a renewal (the first vehicle while none has). */
  billed?: string[]
  /** Online (not the demo nor the local app): vehicles must be covered by the subscription. */
  billing?: boolean
}
export type PricedVehicle = {
  plate: string
  type?: string | null
  zone: string | null // the arrondissement PayByPhone gives it the resident rate in (never typed); null: no resident rate
  suv?: boolean
  monthly: number
  yearly: number
  renewed: boolean
  /** The resident week PayByPhone charges for it, in cents (null if unknown). */
  weekly?: number | null
  /** Its resident rate in that zone, as PayByPhone gives it (riverain vehicles only). */
  rate?: Rate | null
}

export class ApiError extends Error {
  status: number
  data: Record<string, unknown> // details sent with the error (e.g. how many vehicles)
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, "L'application PayByBot ne répond plus. Est-elle toujours lancée ?")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body.detail
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') throw new ApiError(res.status, detail.message, detail)
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Erreur inattendue.')
  }
  return res.json()
}

// The history lookup is slow-ish and asked twice at signup (loading screen, then setup): done once per login.
let zoneLookup: Promise<{ zone: string | null; manual?: boolean }> | null = null
export const forgetZoneLookup = () => {
  zoneLookup = null
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

let pricingCall: { at: number; p: Promise<Pricing> } | null = null

/** « Mon compte »: what changing the covered vehicles costs (confirm false), or the change itself (amounts in cents). */
export const api = {
  config: () =>
    request<{ hosted: boolean; turnstileSiteKey?: string | null; build?: string | null; inviteOnly?: boolean; interrupted?: boolean }>('/api/config'),
  inviteCheck: (code: string) => request<{ valid: boolean }>(`/api/invite/${encodeURIComponent(code)}`),
  linkOpen: (source: string, device: string, visit: number, visitor: string) =>
    post<{ id: number | null; sig: string | null }>('/api/link-open', { source, device, visit, visitor }),
  validatePayment: (t: string) =>
    post<{ status: 'challenge' | 'paid' | 'done'; url?: string; html?: string; sig?: string }>('/api/validate', { t }),
  pushKey: () => request<{ key: string }>('/api/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => post<{ ok: boolean }>('/api/push/subscribe', subscription),
  myInvite: () => request<{ code: string; url: string }>('/api/invite'),
  requestAccess: (email: string, turnstile = '') => post<{ ok: boolean }>('/api/access', { email, turnstile }),
  me: () => request<Me>('/api/me'),
  login: (
    username: string,
    password: string,
    accepted = false,
    signup?: { email: string; invite?: string; source?: string },
    remember = false,
    turnstile = '',
  ) =>
    post<Me | SignupPending>('/api/login', {
      username,
      password,
      accepted,
      remember,
      turnstile,
      ...(signup ? { signup: true, ...signup } : {}),
    }),
  account: () => request<Account>('/api/account'),
  setSuv: (plate: string, suv: boolean) =>
    request<Pricing>('/api/vehicles/suv', { method: 'PUT', body: JSON.stringify({ plate, suv }) }),
  updateAccount: (patch: Partial<Account>) =>
    request<Account>('/api/account', { method: 'PUT', body: JSON.stringify(patch) }),
  logout: () => post('/api/logout'),
  checkout: (plan: 'monthly' | 'yearly') => post<{ url: string }>('/api/billing/checkout', { plan }),
  contact: (p: { email: string; message: string; website: string }) => post<{ ok: true }>('/api/contact', p),
  confirmCheckout: (session_id: string) => post<{ plan: string }>('/api/billing/confirm', { session_id }),
  billingPortal: () => post<{ url: string }>('/api/billing/portal'),
  subscription: () => request<Subscription>('/api/billing/subscription'),
  cancelSubscription: (cancel: boolean) => post<Subscription>('/api/billing/cancel', { cancel }),
  changeCard: () => post<{ url: string }>('/api/billing/card'),
  unlock: () => post<{ url: string }>('/api/billing/unlock'),
  // Several parts of a page ask at once (top of the page, vehicles, account): one request for them all, as
  // each one makes PayByBot ask PayByPhone again (too many in a row and PayByPhone answers 429).
  /** maxAge: how old an answer may be reused (the renewal window takes the dashboard's, asked a moment before). */
  pricing: (maxAge = 3000) => {
    const now = Date.now()
    if (!pricingCall || now - pricingCall.at > maxAge) pricingCall = { at: now, p: request<Pricing>('/api/pricing') }
    return pricingCall.p
  },
  residentStatus: () => request<{ zone: string | null; resident: boolean | null }>('/api/resident-status'),
  adminLogin: (email: string, password: string, turnstile = '') =>
    post('/api/admin/login', { email, password, turnstile }),
  adminLogout: () => post('/api/admin/logout'),
  adminStats: () => request<import('@/components/Admin').AdminStats>('/api/admin/stats'),
  adminClients: () => request<import('@/components/Admin').AdminClient[]>('/api/admin/clients'),
  adminActivity: () => request<import('@/components/Admin').AdminActivity[]>('/api/admin/activity'),
  /** One action, or all of them without an id. */
  adminActivityDelete: (id?: number) =>
    request<{ ok: true }>(id == null ? '/api/admin/activity' : `/api/admin/activity/${id}`, { method: 'DELETE' }),
  adminService: () => request<import('@/components/Admin').ServiceState>('/api/admin/service'),
  adminServiceAction: (action: 'interrupt' | 'notify' | 'resume') =>
    post<import('@/components/Admin').ServiceState>('/api/admin/service', { action }),
  signupCheck: (username: string) => post<{ exists: boolean }>('/api/signup/check', { username }),
  verifySignup: (code: string) => post<Me>('/api/signup/verify', { code }),
  resendSignupCode: () => post<SignupPending>('/api/signup/resend'),
  deleteData: () => request('/api/me/data', { method: 'DELETE' }),
  overview: () => request<Overview>('/api/overview'),
  /** The weeks already paid, from PayByPhone, newest first. */
  history: () => request<Session[]>('/api/history'),
  /** Home zone guessed from the PayByPhone history (null if none). */
  residentZone: () => (zoneLookup ??= request<{ zone: string | null; manual?: boolean }>('/api/resident-zone').catch(() => ({ zone: null, manual: false }))),
  zone: (number: string) => request<{ found: boolean }>(`/api/zone?number=${encodeURIComponent(number)}`),
  recentZones: () => request<string[]>('/api/zones/recent'),
  rates: (location: string, plate: string) =>
    // PayByPhone can leave a rate's name or units out in some zones.
    request<Rate[]>(`/api/rates?${new URLSearchParams({ location, plate })}`).then((list) =>
      list.map((r) => ({ ...r, name: r.name ?? '', acceptedTimeUnits: r.acceptedTimeUnits ?? [] })),
    ),
  lastRate: (location: string, plate: string) =>
    request<{ rate: string | null; inZone: boolean }>(`/api/last-rate?${new URLSearchParams({ location, plate })}`),
  quote: (p: Parking & { sessionId?: string; renewal?: boolean }) =>
    post<{ cost: Money; start: string; expire: string; afterCurrent?: boolean; currentExpire?: string | null; priceSource?: 'history' | 'paris' | null }>('/api/quote', p),
  extend: (p: Parking & { sessionId: string }) => post<{ ok: true; expire: string; cost: Money }>('/api/extend', p),
  pay: (p: Parking) => post<{ ok: true; expire: string; cost: Money }>('/api/pay', p),
  addAutopilot: (p: Parking & { label: string; email?: string }) =>
    post<Autopilot & { activation?: Activation }>('/api/autopilots', p),
  pauseAutopilot: (id: string, start: string, end: string | null) =>
    post<Autopilot>(`/api/autopilots/${id}/pause`, { start, end }),
  lastCard: () => request<{ paymentAccountId: string | null }>('/api/last-card'),
  resumeAutopilot: (id: string) => request<Autopilot>(`/api/autopilots/${id}/pause`, { method: 'DELETE' }),
  setAutopilotEmail: (id: string, email: string) =>
    request<Autopilot>(`/api/autopilots/${id}/email`, { method: 'PUT', body: JSON.stringify({ email }) }),
  /** A programmed ticket's settings changed in place (its vehicle stays). */
  editAutopilot: (id: string, p: Parking & { label: string }) =>
    request<Autopilot>(`/api/autopilots/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  deleteAutopilot: (id: string) => request(`/api/autopilots/${id}`, { method: 'DELETE' }),
  /** Its tickets taken now, one wave per call (`more`: call again); how many of its zones are covered. */
  takeNow: (id: string) =>
    post<{ covered: number; total: number; more: boolean; error: string | null }>(`/api/autopilots/${id}/take`),
}

export const UNIT_LABEL: Record<Unit, [string, string]> = {
  Days: ['jour', 'jours'],
  Hours: ['heure', 'heures'],
  Minutes: ['minute', 'minutes'],
}

export function unitLabel(unit: Unit, n: number) {
  return UNIT_LABEL[unit][n > 1 ? 1 : 0]
}

export function money(m?: Money | null) {
  if (!m) return '—'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: m.currency || 'EUR' }).format(m.amount)
}

function dayAndTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const time = `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const day =
    d.toDateString() === today.toDateString()
      ? null
      : d.toDateString() === tomorrow.toDateString()
        ? 'demain'
        : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return { day, time }
}

/** "aujourd'hui à 21h56", "demain à 21h56", "le lundi 26 octobre à 21h56". */
export function clock(iso: string) {
  const { day, time } = dayAndTime(iso)
  if (!day) return `aujourd'hui à ${time}`
  return day === 'demain' ? `demain à ${time}` : `le ${day} à ${time}`
}

/** "jusqu'à 21h56", "jusqu'à demain 21h56", "jusqu'au lundi 26 octobre, 21h56". */
export function until(iso: string) {
  const { day, time } = dayAndTime(iso)
  if (!day) return `jusqu'à ${time}`
  return day === 'demain' ? `jusqu'à demain ${time}` : `jusqu'au ${day}, ${time}`
}

export function remaining(ms: number) {
  if (ms <= 0) return 'terminé'
  const min = Math.floor(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d) return `${d} j ${h} h`
  if (h) return `${h} h ${String(m).padStart(2, '0')}`
  return `${Math.max(m, 1)} min`
}
