import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { TopBar } from '@/components/TopBar'
import { api } from '@/lib/api'
import { ui } from '@/lib/styles'

/** The form that hands PayByPhone's bank page to the server, which shows it isolated from the site. */
function openBankPage(html: string, sig: string) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/validate/page'
  for (const [name, value] of [['html', html], ['sig', sig]]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
}

/** « Valider mon paiement », from the alert or the e-mail: a button first, since mail scanners open links on their own. */
export function ValidatePayment() {
  const [params] = useState(() => {
    const p = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    // Read once, then out of the address bar: replays and the history never see the token.
    if (p.get('t')) history.replaceState(history.state, '', window.location.pathname + '#/valider')
    return p
  })
  const token = params.get('t') ?? ''
  const [state, setState] = useState<'ready' | 'busy' | 'paid' | 'done'>('ready')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  async function validate() {
    setState('busy')
    setError(null)
    try {
      const answer = await api.validatePayment(token)
      if (answer.status === 'challenge' && answer.url) window.location.assign(answer.url)
      else if (answer.status === 'challenge' && answer.html && answer.sig) openBankPage(answer.html, answer.sig)
      else setState(answer.status === 'paid' ? 'paid' : 'done')
    } catch (e) {
      setError((e as Error).message)
      setState('ready')
    }
  }

  // Touched on the phone's alert: straight to the bank.
  useEffect(() => {
    if (started.current || params.get('go') !== '1') return
    started.current = true
    void validate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-dvh bg-background">
      <TopBar />
      <main className="mx-auto max-w-md px-6 pt-12 pb-20">
        {state === 'paid' || state === 'done' ? (
          <>
            <Check className="size-8 text-eu" />
            <h1 className={ui.title}>{state === 'paid' ? 'Paiement validé' : 'Rien à valider'}</h1>
            <p className={ui.subtitle}>{state === 'paid' ? 'Votre ticket est renouvelé.' : 'Ce paiement est déjà réglé, ou n’attend plus de validation.'}</p>
            <a href="/" className={`mt-8 ${ui.primaryGray}`}>Ouvrir PayByBot</a>
          </>
        ) : (
          <>
            <h1 className={ui.title}>Validez votre paiement</h1>
            <p className={ui.subtitle}>Votre banque demande de confirmer le paiement de votre ticket (Face ID ou code).</p>
            {error && <p role="alert" className="mt-5 rounded-xl border-l-4 border-destructive bg-destructive/8 px-4 py-3 text-sm text-destructive">{error}</p>}
            <button onClick={validate} disabled={state === 'busy' || !token} className={`mt-8 ${ui.primary}`}>
              {state === 'busy' ? <Loader2 className="size-5 animate-spin" /> : 'Valider mon paiement'}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
