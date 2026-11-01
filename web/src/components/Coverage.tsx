import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Plate } from '@/components/signs'
import { api, type CoveredChange } from '@/lib/api'
import { listenCoverage, type CoverageRequest } from '@/lib/coverage'
import { ui } from '@/lib/styles'

const euros = (cents: number) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

/** The paywall for the covered vehicles: what is added or removed, what is charged now, the new subscription. The
 *  change (and its payment) is made only on « Payer » / « Confirmer »; a refused card changes nothing. */
export function CoverageHost() {
  const [request, setRequest] = useState<CoverageRequest | null>(null)
  const [preview, setPreview] = useState<CoveredChange | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listenCoverage((r) => {
      setRequest(r)
      setPreview(null)
      setError(null)
      api.coveredVehicles(r.plates, false).then(setPreview, (e) => setError((e as Error).message))
    })
    return () => listenCoverage(null)
  }, [])

  function close(done: boolean) {
    request?.resolve(done)
    setRequest(null)
  }

  async function confirm() {
    if (!request) return
    setBusy(true)
    setError(null)
    try {
      await api.coveredVehicles(request.plates, true)
      close(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!request) return null
  const per = preview?.plan === 'yearly' ? '/an' : '/mois'
  const action = !preview
    ? 'Confirmer'
    : preview.chargeCents
      ? `Payer ${euros(preview.chargeCents)} et continuer`
      : preview.added.length
        ? 'Ajouter et continuer'
        : 'Confirmer'
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && close(false)}>
      <DialogContent className={ui.dialog}>
        <div className="space-y-4 p-6">
          <div>
            <DialogTitle className={ui.dialogTitle}>Votre abonnement</DialogTitle>
            <DialogDescription className="mt-1 text-ink/60">
              Chaque véhicule utilisé par PayByBot doit être couvert par votre abonnement.
            </DialogDescription>
          </div>
          {!preview && !error && (
            <p className="flex items-center gap-2 text-ink/60">
              <Loader2 className="size-4 animate-spin" /> Calcul du prix…
            </p>
          )}
          {preview && (
            <>
              {preview.added.length > 0 && (
                <div>
                  <p className={ui.label}>{preview.added.length > 1 ? 'Véhicules ajoutés' : 'Véhicule ajouté'}</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.added.map((p) => (
                      <Plate key={p} plate={p} size="sm" />
                    ))}
                  </div>
                </div>
              )}
              {preview.removed.length > 0 && (
                <div>
                  <p className={ui.label}>{preview.removed.length > 1 ? 'Véhicules retirés' : 'Véhicule retiré'}</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.removed.map((p) => (
                      <Plate key={p} plate={p} size="sm" />
                    ))}
                  </div>
                  {preview.stops.length > 0 && (
                    <p className="mt-2 text-sm text-ink/60">Son renouvellement s’arrête ; le ticket en cours reste valable.</p>
                  )}
                </div>
              )}
              <dl className="divide-y divide-ink/[0.06] rounded-xl border border-ink/10 text-sm">
                <div className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-ink/60">Prélevé maintenant</dt>
                  <dd className="text-right font-semibold text-ink">
                    {preview.chargeCents
                      ? `${euros(preview.chargeCents)} · ${preview.months > 1 ? `le mois en cours et les ${preview.months - 1} suivants` : 'le mois en cours'}`
                      : preview.added.length && preview.nextBilling
                        ? `Rien avant le ${day(preview.nextBilling)}`
                        : 'Rien'}
                  </dd>
                </div>
                {preview.creditCents > 0 && (
                  <div className="flex justify-between gap-4 px-4 py-3">
                    <dt className="text-ink/60">Crédité</dt>
                    <dd className="text-right font-semibold text-ink">{euros(preview.creditCents)} sur la prochaine facture</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-ink/60">Nouvel abonnement</dt>
                  <dd className="text-right font-semibold text-ink">
                    {euros(preview.total)}
                    {per}
                    {preview.nextBilling ? ` dès le ${day(preview.nextBilling)}` : ''}
                  </dd>
                </div>
              </dl>
              {preview.removed.length > 0 && <p className="text-sm text-ink/60">Le mois en cours reste dû.</p>}
            </>
          )}
          {error && <p className={ui.error}>{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => close(false)} disabled={busy} className={ui.primaryGray}>
              Annuler
            </button>
            <button onClick={confirm} disabled={busy || !preview} className={ui.primary}>
              {busy && <Loader2 className="size-5 animate-spin" />} {action}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
