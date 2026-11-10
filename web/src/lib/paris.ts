// Paris time, whatever the device's time zone: tickets are taken, and their times shown, at Paris time (a customer's
// phone set to another country's time must not see other hours, nor programme a ticket an hour off).

export const TZ = 'Europe/Paris'

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
})
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export type ParisTime = { y: number; mo: number; d: number; h: number; mi: number; wd: number; iso: string }

/** An instant's date and time in Paris; `wd` 0 = Monday … 6 = Sunday, `iso` its day as « 2026-11-14 ». */
export function paris(ms: number): ParisTime {
  const get = (type: string) => PARTS.formatToParts(new Date(ms)).find((p) => p.type === type)!.value
  const [y, mo, d, h, mi] = ['year', 'month', 'day', 'hour', 'minute'].map((t) => Number(get(t)))
  const pad = (n: number) => String(n).padStart(2, '0')
  return { y, mo, d, h, mi, wd: WEEK.indexOf(get('weekday')), iso: `${y}-${pad(mo)}-${pad(d)}` }
}

/** The instant at a Paris date and time (`mo` 1–12; a day past the month's end rolls over). */
export function parisMs(y: number, mo: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let t = wall
  // Paris is UTC+1 or +2: the offset is read at the guess, then once more in case the guess crossed a clock change.
  for (let i = 0; i < 2; i++) {
    const p = paris(t)
    t += wall - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
  }
  return t
}

/** « 20h », « 20h05 »: an instant's hour in Paris (minutes only when not on the hour). */
export function hourText(ms: number) {
  const p = paris(ms)
  return `${p.h}h${p.mi ? String(p.mi).padStart(2, '0') : ''}`
}
