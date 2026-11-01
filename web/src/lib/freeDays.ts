/** Sundays and public holidays, free in Paris: the same rule as the server (schedule.py). */
function easter(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const g = Math.floor((8 * b + 13) / 25)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 19 * l) / 433)
  const month = Math.floor((h + l - 7 * m + 90) / 25)
  return new Date(year, month - 1, (h + l - 7 * m + 33 * month + 19) % 32)
}

const FIXED = ['1-1', '5-1', '5-8', '7-14', '8-15', '11-1', '11-11', '12-25']

export function freeInParis(day: Date) {
  if (day.getDay() === 0 || FIXED.includes(`${day.getMonth() + 1}-${day.getDate()}`)) return true
  const e = easter(day.getFullYear())
  const after = (n: number) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + n).getTime()
  return [1, 39, 50].some((n) => after(n) === day.getTime())
}
