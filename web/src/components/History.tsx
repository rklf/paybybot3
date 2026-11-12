import { useEffect, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { LineBone } from '@/components/Skeletons'
import { PayByPhone, Plate } from '@/components/signs'
import { when, ZoneTag } from '@/components/Riverain'
import { api, type Session } from '@/lib/api'
import { ui } from '@/lib/styles'

const euros = (n: number) => n.toFixed(2).replace('.', ',') + ' €'

/** « Historique », beside « Mon compte »: the tickets PayByBot took, each with its dates and price, and the total. */
export function HistoryButton({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* On a phone, the icon alone (the top bar must fit 375 px). */}
      <button onClick={() => setOpen(true)} disabled={disabled} className={ui.navText} aria-label="Historique">
        <HistoryIcon className="size-5 lg:hidden" />
        <span className="hidden lg:inline">Historique</span>
      </button>
      {open && <HistoryDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Session[] | null>(null)
  useEffect(() => {
    api.history().then(setRows, () => setRows([]))
  }, [])
  const now = Date.now()
  const total = (rows ?? []).reduce((sum, r) => sum + (r.cost?.amount ?? 0), 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={ui.dialog}>
        <div className="px-6 pt-6 pb-7">
          <DialogTitle className={ui.dialogTitle}>Historique</DialogTitle>
          <DialogDescription className="mt-1 text-ink/60">
            Les tickets pris par PayByBot sur votre compte <PayByPhone />.
          </DialogDescription>

          {rows === null ? (
            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <LineBone key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="mt-6 rounded-xl bg-ink/[0.04] px-4 py-5 text-center text-ink/60">Aucun ticket pour l’instant.</p>
          ) : (
            <>
              <p className="mt-5 text-sm text-ink/55">
                {rows.length} ticket{rows.length > 1 ? 's' : ''}
                {total > 0 && <> · {euros(total)}</>}
              </p>
              {/* One list, a ticket per line: the plate and the zone as on the dashboard, when it was taken under. */}
              <div className="mt-3 divide-y divide-ink/[0.07] rounded-2xl border border-ink/10 bg-white">
                {rows.map((r) => {
                  const running = new Date(r.expire).getTime() > now && !r.stopped
                  return (
                    <div key={r.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <Plate plate={r.plate} size="sm" />
                        <ZoneTag zone={r.location} resident={r.resident !== false} kind={r.kind} />
                      </div>
                      <p className="mt-2.5 flex justify-between gap-4 text-sm text-ink/55">
                        <span>
                          Pris le {when(new Date(r.start).getTime())}
                          {running && ' · en cours'}
                        </span>
                        {r.cost && <span className="shrink-0 tabular-nums">{euros(r.cost.amount)}</span>}
                      </p>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
