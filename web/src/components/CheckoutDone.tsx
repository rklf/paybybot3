import { cn } from '@/lib/utils'
import { ui } from '@/lib/styles'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { InviteButton } from '@/components/Invite'
import { arrondissement, vehicleType } from '@/components/signs'

/** Same palette as the sign-in scene (RemoteScene): flat white card, hairline border, muted teal accent. */
const TEAL = '#4e9aa0'
const INK = '#1c1b19'
const LINE = '#e3e3e3'

/**
 * Back from Stripe with a subscription: one short scene, played once (still with reduced motion). The renewal
 * plate, its type and zone appear, the renewal switch turns on, a check pops (no time left: nothing to worry about).
 */
/** The renewed car, as PayByPhone knows it. */
export type DoneVehicle = { plate: string; type?: string | null; zone?: string | null }

function DoneScene({ vehicle, className }: { vehicle?: DoneVehicle | null; className?: string }) {
  const kind = vehicleType(vehicle?.type) ?? 'Véhicule'
  const place = vehicle?.zone ? (arrondissement(vehicle.zone) ?? `Zone ${vehicle.zone}`) : null
  return (
    <svg viewBox="0 0 260 200" className={className} role="img" aria-label="Le renouvellement automatique est activé">
      <style>{`
        .cd * { transform-box: fill-box; }
        .cd-card { animation: cd-rise .6s cubic-bezier(.2,.8,.2,1) both; }
        .cd-line { opacity: 0; animation: cd-rise .4s ease-out forwards; }
        .cd-on { opacity: 0; animation: cd-fade .3s ease-out 1.1s forwards; }
        .cd-knob { animation: cd-knob .3s ease-out 1.1s forwards; }
        .cd-badge { transform-origin: center; transform: scale(0); animation: cd-pop .45s cubic-bezier(.3,1.6,.5,1) 1.6s forwards; }
        .cd-tick { stroke-dasharray: 30; stroke-dashoffset: 30; animation: cd-draw .35s ease-out 1.9s forwards; }
        @keyframes cd-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @keyframes cd-fade { to { opacity: 1 } }
        @keyframes cd-knob { to { transform: translateX(14px) } }
        @keyframes cd-pop { to { transform: scale(1) } }
        @keyframes cd-draw { to { stroke-dashoffset: 0 } }
        @media (prefers-reduced-motion: reduce) {
          .cd * { animation: none !important; }
          .cd-line, .cd-on { opacity: 1 } .cd-knob { transform: translateX(14px) } .cd-badge { transform: none } .cd-tick { stroke-dashoffset: 0 }
        }
      `}</style>
      <g className="cd" fontFamily="Figtree Variable, sans-serif">
        <g className="cd-card">
          <rect x="30" y="20" width="200" height="160" rx="12" fill="#fff" stroke={LINE} strokeWidth="1.5" />
          <text x="50" y="50" fontWeight="500" fontSize="15" fill={INK}>
            Pay<tspan fill="#64be38">By</tspan>Phone
          </text>
          <line x1="50" x2="210" y1="64" y2="64" stroke="#f0f0f0" />
          {/* the plate: blue EU band, black border */}
          <g className="cd-line" style={{ animationDelay: '.35s' }}>
            <rect x="50" y="76" width="112" height="26" rx="4" fill="#fff" stroke={INK} strokeWidth="2" />
            <rect x="51" y="77" width="12" height="24" rx="3" fill="#1d4ea3" />
            <text x="113" y="94" textAnchor="middle" fontFamily="Overpass Variable, sans-serif" fontWeight="700" fontSize="13" letterSpacing=".06em" fill={INK}>
              {vehicle?.plate ?? 'AB-123-CD'}
            </text>
          </g>
          <text x="50" y="124" fontSize="12" fill={INK} opacity=".6" className="cd-line" style={{ animationDelay: '.55s' }}>
            {kind}
            {place ? ` · ${place}` : ''}
          </text>
          <line x1="50" x2="210" y1="138" y2="138" stroke="#f0f0f0" />
          <text x="50" y="162" fontSize="12" fill={INK} className="cd-line" style={{ animationDelay: '.75s' }}>
            Renouvellement auto
          </text>
          <rect x="180" y="150" width="30" height="16" rx="8" fill={LINE} />
          <rect x="180" y="150" width="30" height="16" rx="8" fill={TEAL} className="cd-on" />
          <circle cx="188" cy="158" r="6" fill="#fff" className="cd-knob" />
        </g>
        <g className="cd-badge">
          <circle cx="236" cy="20" r="18" fill={TEAL} />
          <path d="M227 20 l6 6 l12 -12" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="cd-tick" />
        </g>
      </g>
    </svg>
  )
}

/**
 * After Stripe Checkout: the dashboard blurred behind, one card with the scene and « Votre stationnement est
 * désormais automatisé », then « Inviter un proche ».
 */
export function CheckoutDone({ vehicle, onClose }: { vehicle?: DoneVehicle | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-done-title"
      className="fixed inset-0 z-50 grid animate-in fade-in-0 duration-300 center-safe overflow-y-auto bg-white/40 px-4 py-8 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* About 70 % of the page: the scene above (grows with the space), the sentence and the button below. */}
      <div className="relative flex min-h-[70vh] w-full flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white text-center shadow-[0_40px_80px_-30px_rgb(11_16_36/0.35)] sm:w-[70vw] sm:max-w-4xl">
        <button onClick={onClose} aria-label="Fermer" className="absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full text-ink/60 transition hover:bg-ink/[0.06] hover:text-ink">
          <X className="size-5" />
        </button>
        {/* Qonto-like: the scene on light grey, the sentence on white */}
        <div className="flex flex-1 items-center justify-center px-8 pt-12 pb-10" style={{ background: '#f4f4f4' }}>
          <DoneScene vehicle={vehicle} className="h-[min(36vh,20rem)] w-auto max-w-full" />
        </div>
        <div className="px-7 pt-9 pb-10">
          <h1
            id="checkout-done-title"
            className={cn(ui.title, 'animate-[rise_.6s_ease-out_2.3s_both] motion-reduce:animate-none')}
          >
            Votre stationnement est désormais automatisé
          </h1>
          <p className="mt-3 animate-[rise_.6s_ease-out_2.5s_both] text-[1.05rem] leading-relaxed text-ink/60 motion-reduce:animate-none">
            Rien n’est prélevé avant la fin de votre mois offert.
          </p>
          <div className="mt-8 flex animate-[rise_.6s_ease-out_2.7s_both] justify-center motion-reduce:animate-none">
            <InviteButton big openAfter={3700} /> {/* the button shows at 2.7 s, then opens by itself 1 s later */}
          </div>
        </div>
      </div>
    </div>
  )
}
