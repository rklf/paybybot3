import { useId } from 'react'

/** A friendly Paris parking meter (the "bot" of PayByBot) handing out a ticket that renews itself. */
export function Horodateur({ className }: { className?: string }) {
  // Unique gradient ids: a hidden copy of the drawing (other screen size) must not own the ones in use.
  const id = useId().replace(/:/g, '')
  const g = (name: string) => `${id}-${name}`
  return (
    <svg viewBox="0 0 360 500" className={className} role="img" aria-label="Un horodateur parisien qui délivre un ticket">
      <defs>
        <linearGradient id={g('body')} x1="0" x2="1">
          <stop offset="0" stopColor="#3b4a5c" />
          <stop offset="1" stopColor="#2b3746" />
        </linearGradient>
        <linearGradient id={g('front')} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#53657a" />
          <stop offset="1" stopColor="#465769" />
        </linearGradient>
        <linearGradient id={g('solar')} x1="0" x2="1">
          <stop offset="0" stopColor="#1d2a6b" />
          <stop offset="1" stopColor="#2a3f9a" />
        </linearGradient>
        <linearGradient id={g('ticket')} x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f5fb" />
        </linearGradient>
      </defs>

      {/* ground */}
      <ellipse cx="170" cy="472" rx="120" ry="14" fill="#1d2a6b" opacity=".12" />

      {/* sparkles */}
      <g fill="#f2b705">
        <path d="M56 120l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" />
        <path d="M300 70l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" opacity=".8" />
        <path d="M318 300l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" opacity=".7" />
      </g>

      {/* post */}
      <rect x="140" y="380" width="60" height="92" rx="8" fill="#2b3746" />
      <rect x="128" y="458" width="84" height="16" rx="6" fill="#222c38" />

      {/* solar panel */}
      <path d="M92 74 L250 46 L262 76 L104 104 Z" fill={`url(#${g('solar')})`} />
      <path d="M118 70 L130 98 M146 65 L158 93 M174 60 L186 88 M202 55 L214 83 M230 50 L242 78 M98 89 L256 61"
            stroke="#8fa8ff" strokeWidth="1.5" opacity=".55" />
      <rect x="160" y="96" width="20" height="18" fill="#2b3746" />

      {/* body */}
      <rect x="96" y="108" width="148" height="284" rx="22" fill={`url(#${g('body')})`} />
      <rect x="110" y="122" width="120" height="256" rx="14" fill={`url(#${g('front')})`} />

      {/* blue P sign */}
      <rect x="146" y="134" width="48" height="48" rx="9" fill="#1d4ea3" />
      <rect x="150" y="138" width="40" height="40" rx="6" fill="none" stroke="#fff" strokeWidth="2.5" />
      <text x="170" y="171" textAnchor="middle" fontSize="32" fontWeight="900" fill="#fff"
            style={{ fontFamily: 'var(--font-plate)' }}>P</text>

      {/* screen with a face */}
      <rect x="124" y="194" width="92" height="62" rx="10" fill="#0f1a2b" />
      <rect x="130" y="200" width="80" height="50" rx="7" fill="#d9f2e1" />
      <ellipse cx="154" cy="220" rx="5.5" ry="7" fill="#0f1a2b" />
      <ellipse cx="186" cy="220" rx="5.5" ry="7" fill="#0f1a2b" />
      <circle cx="156" cy="217.5" r="1.8" fill="#fff" />
      <circle cx="188" cy="217.5" r="1.8" fill="#fff" />
      <path d="M158 234 Q170 244 182 234" stroke="#0f1a2b" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <circle cx="146" cy="234" r="4" fill="#f4a3a3" opacity=".7" />
      <circle cx="194" cy="234" r="4" fill="#f4a3a3" opacity=".7" />

      {/* keypad */}
      <g fill="#c9d3df">
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={128 + c * 22} y={268 + r * 18} width="16" height="12" rx="3" />),
        )}
      </g>
      <rect x="194" y="268" width="22" height="12" rx="3" fill="#5fbf6a" />
      <rect x="194" y="286" width="22" height="12" rx="3" fill="#e5675f" />
      <rect x="194" y="304" width="22" height="12" rx="3" fill="#f2b705" />

      {/* card slot with a blue card */}
      <rect x="126" y="330" width="56" height="8" rx="4" fill="#0f1a2b" />
      <rect x="134" y="318" width="40" height="16" rx="3" fill="#1d4ea3" />
      <rect x="138" y="322" width="9" height="6" rx="1.5" fill="#f2b705" />

      {/* ticket slot and the ticket coming out */}
      <rect x="236" y="250" width="14" height="70" rx="5" fill="#2b3746" />
      <g transform="rotate(-8 250 285)">
        <rect x="246" y="250" width="92" height="70" rx="8" fill={`url(#${g('ticket')})`} stroke="#dfe4ef" />
        <rect x="256" y="262" width="12" height="16" rx="2" fill="#1d4ea3" />
        <text x="273" y="275" fontSize="12" fontWeight="800" fill="#111" style={{ fontFamily: 'var(--font-plate)' }}>
          AB-123
        </text>
        <text x="256" y="296" fontSize="15" fontWeight="800" fill="#111" style={{ fontFamily: 'var(--font-heading)' }}>
          7 jours
        </text>
        <circle cx="322" cy="305" r="9" fill="#e7f6ec" />
        <path d="M317.5 305 l3 3 l6 -6" stroke="#1a9a4a" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M256 307 h40" stroke="#c9d0de" strokeWidth="2" strokeDasharray="3 3" />
      </g>

      {/* waving arm */}
      <path d="M96 250 C70 240 58 214 66 190" stroke="#2b3746" strokeWidth="14" fill="none" strokeLinecap="round" />
      <circle cx="66" cy="184" r="12" fill="#3b4a5c" />
    </svg>
  )
}
