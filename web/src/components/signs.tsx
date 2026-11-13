import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** French licence plate: white field, blue EU band with the country letter. */
/** « AB123CD » written as on the plate: « AB-123-CD » (other formats as given). */
export function plateText(plate: string) {
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(plate) ? `${plate.slice(0, 2)}-${plate.slice(2, 5)}-${plate.slice(5)}` : plate
}

export function Plate({ plate, size = 'md', className }: { plate: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const formatted = plateText(plate)
  return (
    <span
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-[6px] border-2 border-ink bg-white font-plate font-extrabold tracking-[0.06em] text-ink shadow-[0_2px_0_var(--ink)]',
        size === 'sm' && 'h-7 text-sm',
        size === 'md' && 'h-10 text-xl',
        size === 'lg' && 'h-14 text-3xl',
        className,
      )}
    >
      <span className={cn('flex flex-col items-center justify-end bg-eu pb-0.5 text-white', size === 'sm' ? 'w-4' : 'w-6')}>
        <svg viewBox="0 0 20 20" className={size === 'sm' ? 'size-2.5' : 'size-3.5'} aria-hidden>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2
            return <circle key={i} cx={10 + 7 * Math.cos(a)} cy={10 + 7 * Math.sin(a)} r="1.3" fill="#f2b705" />
          })}
        </svg>
        <span className={cn('leading-none font-bold', size === 'sm' ? 'text-[8px]' : 'text-[11px]')}>F</span>
      </span>
      {/* One width for every plate, like real ones: the widest French plate (WW-888-MM) fits, text centred. */}
      <span className={cn('flex min-w-[6.6em] items-center justify-center leading-none', size === 'sm' ? 'px-1.5' : 'px-3')}>
        {formatted}
      </span>
    </span>
  )
}

/** PayByPhone's vehicle type in plain French: « Voiture », « Deux-roues », « Utilitaire »; null when unknown. */
export function vehicleType(type?: string | null) {
  // PayByPhone's types: Car, Motorcycle, ElectricMotorcycle, HeavyGoodsVehicle.
  if (!type) return null
  if (/electricmotorcycle/i.test(type)) return 'Deux-roues électrique'
  if (/moto|motor|scooter|two|2\s*roues|deux|bike|cycle/i.test(type)) return 'Deux-roues'
  if (/heavy|goods|truck|van|utilit|commercial|lorry/i.test(type)) return 'Poids lourd'
  if (/car|auto|voiture|passenger/i.test(type)) return 'Voiture'
  return null
}

/** Paris resident zones are numbered like the postcode: 75017 -> « Paris 17e », 75001 -> « Paris 1er ». */
export function arrondissement(zone: string | null | undefined) {
  if (!zone) return null // a vehicle without a resident rate has no zone
  const m = zone.match(/^75(0(\d{2})|116)$/)
  if (!m) return null
  const n = m[1] === '116' ? 16 : Number(m[2])
  return n >= 1 && n <= 20 ? `Paris ${n === 1 ? '1er' : `${n}e`}` : null
}

/** Parking zone, shown as a quiet label next to the plate. */
export function ZonePlate({ zone, className }: { zone: string | null | undefined; className?: string }) {
  if (!zone) return null
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 text-ink', className)}>
      <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">Zone</span>
      <span className="font-plate text-base font-bold tabular-nums">{zone}</span>
    </span>
  )
}

/** The mark: three blue capsules, rising and falling like the renewals. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="16 10 92 100" className={cn('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id="pbb-c1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f6bff" /><stop offset="1" stopColor="#0a2fb8" /></linearGradient>
        <linearGradient id="pbb-c2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a9bff" /><stop offset="1" stopColor="#1f55e6" /></linearGradient>
        <linearGradient id="pbb-c3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8ad4ff" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
      </defs>
      <rect x="18" y="12" width="26" height="96" rx="13" fill="url(#pbb-c1)" />
      <rect x="51" y="50" width="24" height="54" rx="12" fill="url(#pbb-c2)" />
      <rect x="82" y="22" width="24" height="56" rx="12" fill="url(#pbb-c3)" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-heading text-[1.4rem] leading-none font-semibold tracking-[-0.025em] text-ink">
      <LogoMark />
      <span>
        Pay
        <span className="bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] bg-clip-text text-transparent">By</span>
        Bot
      </span>
    </span>
  )
}

/** PayByBot's name in running text, « by » in the wordmark's blue. */
export function PayByBot() {
  return (
    <span className="whitespace-nowrap">
      Pay
      <span className="bg-[linear-gradient(90deg,var(--eu)_0%,#2a66d1_100%)] bg-clip-text text-transparent">By</span>
      Bot
    </span>
  )
}

/** PayByPhone's name as its logo writes it: « By » in its green. */
export function PayByPhone() {
  return (
    <span className="whitespace-nowrap">
      Pay<span className="text-[#64be38]">By</span>Phone
    </span>
  )
}

/** A text with each « PayByPhone » shown as above. */
export function withPayByPhone(text: string): ReactNode {
  return text.split('PayByPhone').flatMap((part, i) => (i ? [<PayByPhone key={i} />, part] : [part]))
}

/** A text with each « PayByBot » and « PayByPhone » in its brand colours. */
export function withBrands(text: string): ReactNode[] {
  return text
    .split(/(PayByBot|PayByPhone)/)
    .map((part, i) => (part === 'PayByBot' ? <PayByBot key={i} /> : part === 'PayByPhone' ? <PayByPhone key={i} /> : part))
}

/** The same for a whole block of JSX: every text inside it, however deep (links and buttons left as they are). */
export function brandNodes(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.includes('PayBy') ? withBrands(node) : node
  if (Array.isArray(node)) return Children.map(node, brandNodes)
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return el.props.children === undefined ? el : cloneElement(el, undefined, brandNodes(el.props.children))
  }
  return node
}

/** PayByPhone's mark: its green keypad. */
export function PayByPhoneMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" className={className} aria-hidden>
      {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={c * 10 + 0.5} y={r * 10 + 0.5} width="9" height="9" rx="2.4" fill="#7ab943" />))}
    </svg>
  )
}
