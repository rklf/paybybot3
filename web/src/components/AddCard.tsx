import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PayByPhone } from '@/components/signs'
import { api } from '@/lib/api'
import { ui } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** « Ajouter une carte »: a bank card added to the PayByPhone account from here. Passed straight on to PayByPhone,
 *  never kept by PayByBot; the fields are emptied as soon as it is sent. */
export function AddCardDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [number, setNumber] = useState('')
  const [expiry, setExpiry] = useState('') // « MM/AA »
  const [cvv, setCvv] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typed as the card shows it: groups of four, « MM/AA ».
  const grouped = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
  const monthYear = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4)
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
  }

  async function send() {
    const [month, year] = expiry.split('/')
    setBusy(true)
    setError(null)
    try {
      await api.addCard({ number, month, year, cvv, name })
      setNumber('')
      setCvv('')
      toast.success('Carte ajoutée à votre compte PayByPhone.')
      onAdded()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready = number.replace(/\D/g, '').length >= 12 && /^\d{2}\/\d{2}$/.test(expiry) && cvv.length >= 3 && name.trim().length >= 2
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={ui.dialog}>
        <form
          className="space-y-4 p-6 pt-7"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !busy) void send()
          }}
        >
          <div>
            <DialogTitle className={ui.dialogTitle}>Ajouter une carte</DialogTitle>
            <DialogDescription className="mt-1 text-ink/60">
              Elle est ajoutée directement à votre compte <PayByPhone /> : <span className="whitespace-nowrap">PayByBot</span> ne la garde pas.
            </DialogDescription>
          </div>
          <label className="block">
            <span className={ui.label}>Numéro de carte</span>
            <input
              className={cn(ui.field, 'tabular-nums')}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 5678 9012 3456"
              value={number}
              onChange={(e) => setNumber(grouped(e.target.value))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={ui.label}>Expiration</span>
              <input
                className={cn(ui.field, 'tabular-nums')}
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/AA"
                value={expiry}
                onChange={(e) => setExpiry(monthYear(e.target.value))}
              />
            </label>
            <label className="block">
              <span className={ui.label}>Code au dos</span>
              <input
                className={cn(ui.field, 'tabular-nums')}
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </label>
          </div>
          <label className="block">
            <span className={ui.label}>Nom sur la carte</span>
            <input className={ui.field} autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p className={ui.error}>{error}</p>}
          <button type="submit" disabled={!ready || busy} className={ui.primary}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : 'Ajouter la carte'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
