import { useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { enablePush, needsHomeScreen, pushAvailable } from '@/lib/push'

const CLOSED = 'pbb_push_closed'

function closedBefore() {
  try {
    return !!localStorage.getItem(CLOSED)
  } catch {
    return false
  }
}

/** Offered once a renewal is on: the alert if the bank asks to validate a payment. */
export function PushOptIn() {
  const [closed, setClosed] = useState(closedBefore)
  const [busy, setBusy] = useState(false)
  const iphone = needsHomeScreen()
  if (closed || (!iphone && (!pushAvailable() || Notification.permission !== 'default'))) return null

  function close() {
    setClosed(true)
    try {
      localStorage.setItem(CLOSED, '1')
    } catch {
      // private window: offered again next time
    }
  }

  async function enable() {
    setBusy(true)
    try {
      if (await enablePush()) toast.success('Alertes activées sur cet appareil.')
      close()
    } catch {
      toast.error('Les alertes n’ont pas pu être activées sur cet appareil.')
    }
    setBusy(false)
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-ink/10 bg-white p-4">
      <Bell className="mt-0.5 size-5 shrink-0 text-eu" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Soyez alerté sur cet appareil</p>
        <p className="mt-1 text-sm text-ink/70">Si votre banque demande une validation, vous recevez une alerte pour valider en quelques secondes.</p>
        {iphone ? (
          <p className="mt-2 text-sm text-ink/70">Sur iPhone : touchez Partager, puis « Sur l’écran d’accueil », et rouvrez PayByBot depuis son icône.</p>
        ) : (
          <button onClick={enable} disabled={busy} className="mt-3 inline-flex h-10 items-center gap-2 rounded-[10px] border-[1.5px] border-eu px-4 text-sm font-semibold text-eu transition hover:bg-eu/[0.06] disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" />} Activer les alertes
          </button>
        )}
      </div>
      <button onClick={close} aria-label="Fermer" className="grid size-8 shrink-0 place-items-center rounded-md text-ink/40 transition hover:bg-ink/[0.05]">
        <X className="size-4" />
      </button>
    </div>
  )
}
