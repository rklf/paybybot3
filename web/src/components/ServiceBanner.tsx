import { TriangleAlert } from 'lucide-react'

/** PayByPhone no longer answers PayByBot (API blocked, down): said at the top of every page until the owner ends it. */
export function ServiceBanner() {
  return (
    <div role="alert" className="bg-[#741b11] px-6 py-3 text-white">
      <p className="mx-auto flex max-w-3xl items-start gap-3 text-[0.95rem] leading-snug">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" />
        <span>
          <strong className="font-semibold">PayByBot est interrompu.</strong> PayByPhone ne répond plus : vos tickets ne sont
          plus pris automatiquement. Payez votre stationnement vous-même dans l’app PayByPhone jusqu’à nouvel ordre.
        </span>
      </p>
    </div>
  )
}
