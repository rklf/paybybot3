import React, { useEffect, useState, type MouseEvent } from 'react'

import { cn } from '@/lib/utils'

// Magic UI's ripple button: a wave spreads from where it was pressed.
interface RippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  rippleColor?: string
  duration?: string
}

export const RippleButton = React.forwardRef<HTMLButtonElement, RippleButtonProps>(
  ({ className, children, rippleColor = '#ffffff', duration = '600ms', onClick, ...props }, ref) => {
    const [ripples, setRipples] = useState<{ x: number; y: number; size: number; key: number }[]>([])

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      setRipples((now) => [
        ...now,
        { x: event.clientX - rect.left - size / 2, y: event.clientY - rect.top - size / 2, size, key: Date.now() },
      ])
      onClick?.(event)
    }

    useEffect(() => {
      if (!ripples.length) return
      const last = ripples[ripples.length - 1]
      const t = setTimeout(() => setRipples((now) => now.filter((r) => r.key !== last.key)), parseInt(duration))
      return () => clearTimeout(t)
    }, [ripples, duration])

    return (
      <button
        className={cn('relative flex cursor-pointer items-center justify-center overflow-hidden text-center', className)}
        onClick={handleClick}
        ref={ref}
        {...props}
      >
        <div className="relative z-10">{children}</div>
        <span className="pointer-events-none absolute inset-0">
          {ripples.map((r) => (
            <span
              key={r.key}
              className="absolute animate-rippling rounded-full opacity-30"
              style={
                {
                  width: `${r.size}px`,
                  height: `${r.size}px`,
                  top: `${r.y}px`,
                  left: `${r.x}px`,
                  backgroundColor: rippleColor,
                  transform: 'scale(0)',
                  '--duration': duration,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      </button>
    )
  },
)

RippleButton.displayName = 'RippleButton'
