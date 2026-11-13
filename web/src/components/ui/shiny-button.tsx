import React from "react"

import { cn } from "@/lib/utils"

/** A button with a light sweeping across its border and label, in CSS only (no animation library): the sweep
 *  (« shiny-sweep » in index.css) loops with a pause, and the button shrinks a little when pressed. */
export const ShinyButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ children, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "shiny relative cursor-pointer rounded-lg border px-6 py-2 font-medium backdrop-blur-xl transition-[box-shadow,transform] duration-300 ease-in-out hover:shadow active:scale-95",
        className
      )}
      {...props}
    >
      <span
        className="relative flex size-full items-center justify-center gap-2"
        style={{
          maskImage:
            "linear-gradient(-75deg,#000 calc(var(--x) + 20%),rgb(0 0 0 / 0.55) calc(var(--x) + 30%),#000 calc(var(--x) + 100%))",
        }}
      >
        {children}
      </span>
      <span
        style={{
          mask: "linear-gradient(rgb(0,0,0), rgb(0,0,0)) content-box exclude,linear-gradient(rgb(0,0,0), rgb(0,0,0))",
          WebkitMask:
            "linear-gradient(rgb(0,0,0), rgb(0,0,0)) content-box exclude,linear-gradient(rgb(0,0,0), rgb(0,0,0))",
          backgroundImage:
            "linear-gradient(-75deg,color-mix(in srgb,var(--eu) 15%,transparent) calc(var(--x) + 20%),var(--eu) calc(var(--x) + 25%),color-mix(in srgb,var(--eu) 15%,transparent) calc(var(--x) + 100%))",
        }}
        className="absolute inset-0 z-10 block rounded-[inherit] p-px"
      />
    </button>
  )
)

ShinyButton.displayName = "ShinyButton"
