import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { freeInParis } from '@/lib/freeDays'
import { cn } from '@/lib/utils'

/** ISO day (local) of a date: 2026-10-26. */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** « le mar. 27 oct. » or « du lun. 26 oct. au sam. 31 oct. ». */
export function periodText(from: string, to?: string | null) {
  const f = (s: string) => fromIso(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return !to || to === from ? `le ${f(from)}` : `du ${f(from)} au ${f(to)}`
}

/** The days of a period a ticket is taken (Sundays and public holidays left out in Paris, where they are free). */
export function periodDays(from: string, to: string | null | undefined, paris: boolean) {
  const end = fromIso(to || from)
  let n = 0
  for (const d = fromIso(from); d <= end; d.setDate(d.getDate() + 1)) if (!(paris && freeInParis(d))) n++
  return n
}

const BLUE = '#2a66d1'
const BAND = '#e3efff'

/**
 * A month calendar to pick one day, or a period from a first day to a last one: past days greyed, the chosen days
 * in blue circles joined by a light blue band. Tap a day, then the last day for a period; tap again to start over.
 */
export function RangeCalendar({
  from,
  to,
  onChange,
  paris = false,
}: {
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
  /** A Paris zone: Sundays and public holidays are free, so they cannot be picked as a day. */
  paris?: boolean
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const first = from ? fromIso(from) : today
  const [month, setMonth] = useState(new Date(first.getFullYear(), first.getMonth(), 1))
  const start = from ? fromIso(from) : null
  const end = to ? fromIso(to) : null
  const same = (a: Date | null, b: Date) => !!a && a.getTime() === b.getTime()
  const lead = (month.getDay() + 6) % 7 // Monday first, like a French calendar
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ]
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  function tap(d: Date) {
    if (!start || end || d < start) onChange(isoDay(d), null)
    else onChange(isoDay(start), same(start, d) ? null : isoDay(d))
  }

  return (
    <div className="rounded-2xl border border-ink/10 px-3 py-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={month <= thisMonth}
          className="grid size-7 place-items-center rounded-full text-ink/60 hover:bg-ink/[0.06] disabled:opacity-25"
          aria-label="Mois précédent"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="font-semibold text-ink capitalize">{month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="grid size-7 place-items-center rounded-full text-ink/60 hover:bg-ink/[0.06]"
          aria-label="Mois suivant"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-ink/40">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const past = d < today || (paris && freeInParis(d))
          const isStart = same(start, d)
          const isEnd = same(end, d)
          const inside = !!start && !!end && d > start && d < end
          const edge = isStart || isEnd
          const band = !!end && (inside || isStart || isEnd)
          const col = i % 7
          return (
            <div key={i} className="relative flex h-8 items-center justify-center">
              {band && (
                <span
                  aria-hidden
                  className="absolute inset-y-0"
                  style={{
                    background: BAND,
                    left: isStart ? '50%' : 0,
                    right: isEnd ? '50%' : 0,
                    borderTopLeftRadius: col === 0 && !isStart ? 999 : 0,
                    borderBottomLeftRadius: col === 0 && !isStart ? 999 : 0,
                    borderTopRightRadius: col === 6 && !isEnd ? 999 : 0,
                    borderBottomRightRadius: col === 6 && !isEnd ? 999 : 0,
                  }}
                />
              )}
              <button
                type="button"
                disabled={past}
                aria-pressed={edge || inside}
                aria-label={d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                onClick={() => tap(d)}
                className={cn(
                  'relative grid size-8 place-items-center rounded-full font-heading text-[0.92rem] font-semibold tabular-nums transition',
                  past ? 'text-ink/20' : edge ? 'text-white' : 'text-ink hover:bg-ink/[0.06]',
                )}
                style={edge ? { background: BLUE } : undefined}
              >
                {d.getDate()}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
